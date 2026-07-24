import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { WASI } from "node:wasi";

import * as flatbuffers from "../src/vendor/flatbuffers/flatbuffers.js";
import { PIV, PIVT } from "spacedatastandards.org/lib/js/PIV/PIV.js";
import { PIVRequestT } from "spacedatastandards.org/lib/js/PIV/PIVRequest.js";
import { PIVResponseT } from "spacedatastandards.org/lib/js/PIV/PIVResponse.js";
import { TABT } from "spacedatastandards.org/lib/js/PIV/TAB.js";
import { FlatBufferTypeRefT } from "spacedatastandards.org/lib/js/PIV/FlatBufferTypeRef.js";
import { bufferMutability as SdsBufferMutability } from "spacedatastandards.org/lib/js/PIV/bufferMutability.js";
import { bufferOwnership as SdsBufferOwnership } from "spacedatastandards.org/lib/js/PIV/bufferOwnership.js";

import * as sdk from "../src/index.js";
import {
  cleanupCompilation,
  compileModuleFromSource,
  decodePluginInvokeRequest,
  decodePluginInvokeResponse,
  encodePluginInvokeRequest,
  encodePluginInvokeResponse,
  encodePluginManifest,
  writePluginInvokeRequestToArena,
} from "../src/index.js";
import { BufferMutability } from "../src/generated/orbpro/stream/buffer-mutability.js";
import { BufferOwnership } from "../src/generated/orbpro/stream/buffer-ownership.js";

const ATM_TYPE = Object.freeze({
  schemaName: "ATM.fbs",
  fileIdentifier: "$ATM",
  rootTypeName: "ATM",
  byteLength: 8,
  requiredAlignment: 4,
});

const ATM_SCHEMA_HASH = Object.freeze([
  0x0f, 0xef, 0xdc, 0xa4, 0xbb, 0xcb, 0x78, 0x57,
  0xe9, 0x34, 0x03, 0xdd, 0x11, 0xf2, 0x9a, 0x67,
  0x8d, 0x45, 0x4a, 0xb7, 0x1b, 0x14, 0x38, 0x57,
  0x15, 0xc5, 0x2f, 0x6a, 0x72, 0xdd, 0x77, 0xec,
]);

const VERSIONED_ATM_TYPE = Object.freeze({
  ...ATM_TYPE,
  schemaVersion: "1.0.2",
  schemaHash: ATM_SCHEMA_HASH,
});

const GRV_TYPE = Object.freeze({
  schemaName: "GRV.fbs",
  fileIdentifier: "$GRV",
  rootTypeName: "GRV",
  byteLength: 72,
  requiredAlignment: 8,
});

function createCanonicalType(type = ATM_TYPE, overrides = {}) {
  return {
    schemaName: type.schemaName,
    fileIdentifier: type.fileIdentifier,
    rootTypeName: type.rootTypeName,
    ...(type.schemaVersion ? { schemaVersion: type.schemaVersion } : {}),
    ...(type.schemaHash ? { schemaHash: [...type.schemaHash] } : {}),
    wireFormat: "flatbuffer",
    ...overrides,
  };
}

function createAlignedType(type = ATM_TYPE, overrides = {}) {
  return {
    schemaName: type.schemaName,
    fileIdentifier: type.fileIdentifier,
    rootTypeName: type.rootTypeName,
    ...(type.schemaVersion ? { schemaVersion: type.schemaVersion } : {}),
    ...(type.schemaHash ? { schemaHash: [...type.schemaHash] } : {}),
    wireFormat: "aligned-binary",
    byteLength: type.byteLength,
    requiredAlignment: type.requiredAlignment,
    ...overrides,
  };
}

function createPort(portId, required = true, type = ATM_TYPE) {
  return {
    portId,
    acceptedTypeSets: [
      {
        setId: `${portId}-${type.rootTypeName.toLowerCase()}`,
        allowedTypes: [createCanonicalType(type), createAlignedType(type)],
      },
    ],
    minStreams: required ? 1 : 0,
    maxStreams: 1,
    required,
  };
}

function createInvokeManifest({
  pluginId = "com.digitalarsenal.examples.invoke-test",
  invokeSurfaces = ["direct"],
  methodId = "echo",
  inputPortIds = ["in"],
  outputPortIds = ["out"],
  inputType = ATM_TYPE,
  outputType = ATM_TYPE,
} = {}) {
  return {
    pluginId,
    name: "Invoke Test Module",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: [],
    externalInterfaces: [],
    invokeSurfaces,
    methods: [
      {
        methodId,
        displayName: methodId,
        inputPorts: inputPortIds.map((portId) => createPort(portId, true, inputType)),
        outputPorts: outputPortIds.map((portId) => createPort(portId, false, outputType)),
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  };
}

function createPayload(label) {
  return encodePluginManifest(
    createInvokeManifest({
      pluginId: `com.digitalarsenal.payload.${label}`,
      invokeSurfaces: [],
      methodId: "payload_method",
      inputPortIds: ["payload_in"],
      outputPortIds: ["payload_out"],
    }),
  );
}

function hasPivIdentifier(bytes) {
  return PIV.bufferHasIdentifier(new flatbuffers.ByteBuffer(bytes));
}

test("public invoke API exposes only SDS PIV envelopes", () => {
  assert.equal(typeof sdk.encodePluginInvokeRequest, "function");
  assert.equal(typeof sdk.writePluginInvokeRequestToArena, "function");
  assert.equal(typeof sdk.decodePluginInvokeRequest, "function");
  assert.equal(typeof sdk.encodeLegacyPluginInvokeRequest, "undefined");
  assert.equal(typeof sdk.decodeLegacyPluginInvokeRequest, "undefined");
  assert.equal(typeof sdk.LegacyPluginInvokeRequest, "undefined");
});

function getPivRequest(bytes) {
  const bb = new flatbuffers.ByteBuffer(bytes);
  return PIV.getRootAsPIV(bb).REQUEST();
}

function getPivResponse(bytes) {
  const bb = new flatbuffers.ByteBuffer(bytes);
  return PIV.getRootAsPIV(bb).RESPONSE();
}

function encodeExternalArenaPivRequest({
  methodId = "fanout",
  traceId = 0n,
  offset = 4096,
  size = 4,
} = {}) {
  const builder = new flatbuffers.Builder(1024);
  const root = new PIVT(
    new PIVRequestT(
      methodId,
      [
        new TABT(
          offset,
          size,
          8,
          0,
          new FlatBufferTypeRefT("ATM.fbs", "$ATM", null, "ATM"),
          SdsBufferMutability.IMMUTABLE,
          SdsBufferOwnership.HOST_OWNED,
          0n,
          "alpha",
        ),
      ],
      [],
      traceId,
      0,
    ),
    null,
  ).pack(builder);
  PIV.finishPIVBuffer(builder, root);
  return builder.asUint8Array();
}

function encodePivRequestWithTabRange({
  methodId = "fanout",
  traceId = 0n,
  offset = 0,
  size = 0,
  arena = [1, 2, 3, 4],
} = {}) {
  const builder = new flatbuffers.Builder(1024);
  const root = new PIVT(
    new PIVRequestT(
      methodId,
      [
        new TABT(
          offset,
          size,
          8,
          0,
          new FlatBufferTypeRefT("ATM.fbs", "$ATM", null, "ATM"),
          SdsBufferMutability.IMMUTABLE,
          SdsBufferOwnership.HOST_OWNED,
          0n,
          "alpha",
        ),
      ],
      arena,
      traceId,
      0,
    ),
    null,
  ).pack(builder);
  PIV.finishPIVBuffer(builder, root);
  return builder.asUint8Array();
}

function encodePivRequestWithSingleFrame({
  methodId = "guarded",
  portId = "alpha",
  typeRef = createCanonicalType(VERSIONED_ATM_TYPE),
  tabWireFormat,
  alignment,
  mutability = SdsBufferMutability.IMMUTABLE,
  ownership = SdsBufferOwnership.HOST_OWNED,
  frameId = 0n,
  payload = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0]),
} = {}) {
  const wireFormat = tabWireFormat ??
    (typeRef.wireFormat === "aligned-binary" ? 1 : 0);
  const frameAlignment = alignment ?? Math.max(
    4,
    Number(typeRef.requiredAlignment ?? 0),
  );
  const builder = new flatbuffers.Builder(1024);
  const root = new PIVT(
    new PIVRequestT(
      methodId,
      [
        new TABT(
          0,
          payload.length,
          frameAlignment,
          wireFormat,
          new FlatBufferTypeRefT(
            typeRef.schemaName ?? null,
            typeRef.fileIdentifier ?? null,
            typeRef.schemaVersion ?? null,
            typeRef.rootTypeName ?? null,
            typeRef.schemaHash ? [...typeRef.schemaHash] : [],
            false,
            typeRef.wireFormat === "aligned-binary" ? 1 : 0,
            typeRef.fixedStringLength ?? 0,
            typeRef.byteLength ?? 0,
            typeRef.requiredAlignment ?? 0,
          ),
          mutability,
          ownership,
          frameId,
          portId,
        ),
      ],
      [...payload],
      0n,
      0,
    ),
    null,
  ).pack(builder);
  PIV.finishPIVBuffer(builder, root);
  return builder.asUint8Array();
}

function encodeExternalArenaPivResponse({
  traceId = 0n,
  offset = 4096,
  size = 4,
} = {}) {
  const builder = new flatbuffers.Builder(1024);
  const root = new PIVT(
    null,
    new PIVResponseT(
      0,
      0,
      false,
      0,
      [
        new TABT(
          offset,
          size,
          8,
          0,
          new FlatBufferTypeRefT("ATM.fbs", "$ATM", null, "ATM"),
          SdsBufferMutability.IMMUTABLE,
          SdsBufferOwnership.HOST_OWNED,
          0n,
          "alpha",
        ),
      ],
      [],
      null,
      null,
      traceId,
    ),
  ).pack(builder);
  PIV.finishPIVBuffer(builder, root);
  return builder.asUint8Array();
}

function createEchoSource(outputPortId = "out") {
  return `#include <stdint.h>
#include "space_data_module_invoke.h"

int echo(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) {
    plugin_set_error("missing-frame", "No input frame was provided.");
    return 3;
  }
  plugin_push_output(
    "${outputPortId}",
    frame->schema_name,
    frame->file_identifier,
    frame->payload,
    frame->payload_length
  );
  return 0;
}
`;
}

const FANOUT_SOURCE = `#include <stdint.h>
#include "space_data_module_invoke.h"

int fanout(void) {
  plugin_reset_output_state();
  const uint32_t input_count = plugin_get_input_count();
  for (uint32_t index = 0; index < input_count; index += 1) {
    const plugin_input_frame_t *frame = plugin_get_input_frame(index);
    if (!frame) {
      continue;
    }
    plugin_push_output_typed(
      frame->port_id,
      frame->schema_name,
      frame->file_identifier,
      frame->wire_format,
      frame->root_type_name,
      frame->fixed_string_length,
      frame->byte_length,
      frame->required_alignment,
      frame->payload,
      frame->payload_length
    );
  }
  return 0;
}
`;

const REJECTED_INPUT_GUARD_SOURCE = `#include <stdint.h>
#include "space_data_module_invoke.h"

int guarded(void) {
  plugin_set_error("handler-executed", "The guest handler executed.");
  return 91;
}
`;

const LOCAL_OUTPUT_SOURCE = `#include <stdint.h>
#include "space_data_module_invoke.h"

int local_output(void) {
  plugin_reset_output_state();
  uint8_t payload[8] = { 1, 1, 2, 3, 5, 8, 13, 21 };
  const int32_t output_index = plugin_push_output(
    "alpha",
    "ATM.fbs",
    "$ATM",
    payload,
    8
  );
  if (output_index < 0) {
    return 4;
  }
  for (uint32_t index = 0; index < 8; index += 1) {
    payload[index] = 0;
  }
  return 0;
}
`;

const STREAM_OUTPUT_SOURCE = `#include <stdint.h>
#include "space_data_module_invoke.h"

int stream_output(void) {
  static const uint8_t payload[4] = { 9, 8, 7, 6 };
  plugin_reset_output_state();
  int32_t output_index = plugin_push_output(
    "out",
    "ATM.fbs",
    "$ATM",
    payload,
    4
  );
  if (output_index < 0) {
    return 5;
  }
  if (plugin_set_output_stream_frame((uint32_t)output_index, 7, 1) != 0) {
    return 6;
  }
  return 0;
}
`;

const MIXED_FORMAT_SOURCE = `#include <stdint.h>
#include "space_data_module_invoke.h"

int propagate(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  static const uint8_t gravity_model_bytes[72] = {
    0, 1, 2, 3, 4, 5, 6, 7,
    8, 9, 10, 11, 12, 13, 14, 15,
    16, 17, 18, 19, 20, 21, 22, 23,
    24, 25, 26, 27, 28, 29, 30, 31,
    32, 33, 34, 35, 36, 37, 38, 39,
    40, 41, 42, 43, 44, 45, 46, 47,
    48, 49, 50, 51, 52, 53, 54, 55,
    56, 57, 58, 59, 60, 61, 62, 63,
    64, 65, 66, 67, 68, 69, 70, 71
  };
  if (!frame) {
    plugin_set_error("missing-frame", "No input frame was provided.");
    return 3;
  }
  plugin_push_output_typed(
    "state",
    "GRV.fbs",
    "$GRV",
    1,
    "GRV",
    0,
    72,
    8,
    gravity_model_bytes,
    72
  );
  return 0;
}
`;

function createWasi(args = ["module"], overrides = {}) {
  return new WASI({
    version: "preview1",
    args,
    env: {},
    preopens: {},
    returnOnExit: true,
    ...overrides,
  });
}

function instantiateWithWasi(wasmBytes, imports = {}, wasi = createWasi()) {
  const module = new WebAssembly.Module(wasmBytes);
  const instance = new WebAssembly.Instance(module, {
    ...wasi.getImportObject(),
    ...imports,
  });
  return { module, instance, wasi };
}

function invokeDirectBytes(instance, requestBytes) {
  const alloc = instance.exports.plugin_alloc;
  const free = instance.exports.plugin_free;
  const invoke = instance.exports.plugin_invoke_stream;
  const memory = instance.exports.memory;

  const requestPtr = alloc(requestBytes.length);
  new Uint8Array(memory.buffer, requestPtr, requestBytes.length).set(requestBytes);

  const lenOutPtr = alloc(4);
  const responsePtr = invoke(requestPtr, requestBytes.length, lenOutPtr);
  const responseLen = new DataView(memory.buffer).getUint32(lenOutPtr, true);
  const responseBytes = new Uint8Array(memory.buffer.slice(responsePtr, responsePtr + responseLen));

  free(requestPtr, requestBytes.length);
  free(responsePtr, responseLen);
  free(lenOutPtr, 4);

  return { memory, responseBytes };
}

function invokeDirect(instance, requestBytes) {
  const { memory, responseBytes } = invokeDirectBytes(instance, requestBytes);
  return {
    responseBytes,
    response: decodePluginInvokeResponse(responseBytes, {
      externalArena: new Uint8Array(memory.buffer),
    }),
  };
}

function invokeDirectRaw(instance, requestPtr, requestLen, responseLenOutPtr) {
  return instance.exports.plugin_invoke_stream(
    requestPtr,
    requestLen,
    responseLenOutPtr,
  );
}

function runCommandModule(wasmBytes, { args = [], stdinBytes = new Uint8Array() } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "space-data-module-sdk-wasi-"));
  const stdinPath = path.join(tempRoot, "stdin.bin");
  const stdoutPath = path.join(tempRoot, "stdout.bin");
  const stderrPath = path.join(tempRoot, "stderr.txt");
  fs.writeFileSync(stdinPath, stdinBytes);
  fs.writeFileSync(stdoutPath, new Uint8Array());
  fs.writeFileSync(stderrPath, "");

  const stdin = fs.openSync(stdinPath, "r");
  const stdout = fs.openSync(stdoutPath, "w+");
  const stderr = fs.openSync(stderrPath, "w+");

  try {
    const wasi = createWasi(["module", ...args], { stdin, stdout, stderr });
    const module = new WebAssembly.Module(wasmBytes);
    const instance = new WebAssembly.Instance(module, wasi.getImportObject());
    const exitCode = wasi.start(instance);
    fs.closeSync(stdin);
    fs.closeSync(stdout);
    fs.closeSync(stderr);
    return {
      exitCode,
      imports: WebAssembly.Module.imports(module),
      stdoutBytes: new Uint8Array(fs.readFileSync(stdoutPath)),
      stderrText: fs.readFileSync(stderrPath, "utf8"),
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("plugin invoke request and response round-trip through FlatBuffer encoding", () => {
  const payloadAlpha = createPayload("alpha");
  const payloadBeta = createPayload("beta");

  const encodedRequest = encodePluginInvokeRequest({
    methodId: "fanout",
    inputs: [
      {
        portId: "alpha",
        typeRef: {
          schemaName: "PluginManifest.fbs",
          fileIdentifier: "PMAN",
        },
        payload: payloadAlpha,
      },
      {
        portId: "beta",
        typeRef: {
          schemaName: "PluginManifest.fbs",
          fileIdentifier: "PMAN",
        },
        payload: payloadBeta,
      },
    ],
  });
  const decodedRequest = decodePluginInvokeRequest(encodedRequest);
  assert.equal(decodedRequest.methodId, "fanout");
  assert.equal(decodedRequest.inputs.length, 2);
  assert.deepEqual(Array.from(decodedRequest.inputs[0].payload), Array.from(payloadAlpha));
  assert.deepEqual(Array.from(decodedRequest.inputs[1].payload), Array.from(payloadBeta));

  const encodedResponse = encodePluginInvokeResponse({
    statusCode: 12,
    yielded: true,
    backlogRemaining: 7,
    errorCode: "custom-error",
    errorMessage: "something happened",
    outputs: [
      {
        portId: "out",
        typeRef: {
          schemaName: "PluginManifest.fbs",
          fileIdentifier: "PMAN",
        },
        payload: payloadAlpha,
      },
    ],
  });
  const decodedResponse = decodePluginInvokeResponse(encodedResponse);
  assert.equal(decodedResponse.statusCode, 12);
  assert.equal(decodedResponse.yielded, true);
  assert.equal(decodedResponse.backlogRemaining, 7);
  assert.equal(decodedResponse.errorCode, "custom-error");
  assert.equal(decodedResponse.outputs.length, 1);
  assert.deepEqual(Array.from(decodedResponse.outputs[0].payload), Array.from(payloadAlpha));
});

test("public invoke codec emits SDS PIV envelopes by default", () => {
  const payload = createPayload("piv-envelope");
  const encodedRequest = encodePluginInvokeRequest({
    methodId: "fanout",
    inputs: [
      {
        portId: "input",
        typeRef: {
          schemaName: "PluginManifest.fbs",
          fileIdentifier: "PMAN",
        },
        mutability: BufferMutability.MUTABLE,
        ownership: BufferOwnership.HOST_OWNED,
        sequence: 5,
        endOfStream: true,
        payload,
      },
    ],
    traceId: 42n,
  });
  const encodedResponse = encodePluginInvokeResponse({
    statusCode: 0,
    outputs: [
      {
        portId: "output",
        typeRef: {
          schemaName: "PluginManifest.fbs",
          fileIdentifier: "PMAN",
        },
        payload,
      },
    ],
  });

  assert.equal(hasPivIdentifier(encodedRequest), true);
  assert.equal(hasPivIdentifier(encodedResponse), true);
  const request = getPivRequest(encodedRequest);
  assert.equal(request.TRACE_ID(), 42n);
  const frame = request.INPUTS(0);
  assert.equal(frame.MUTABILITY(), SdsBufferMutability.SINGLE_WRITER_MUTABLE);
  assert.equal(frame.OWNERSHIP(), SdsBufferOwnership.HOST_OWNED);
  assert.equal(frame.FRAME_ID(), 11n);
});

test("public invoke decoder materializes SDS PIV external arenas only when provided", () => {
  const externalArena = Uint8Array.from(
    { length: 16 },
    (_, index) => index + 1,
  );
  assert.throws(
    () =>
      decodePluginInvokeRequest(
        encodeExternalArenaPivRequest({ offset: 8, size: 4 }),
      ),
    /external arena/i,
  );
  assert.throws(
    () =>
      decodePluginInvokeResponse(
        encodeExternalArenaPivResponse({ offset: 8, size: 4 }),
      ),
    /external arena/i,
  );

  assert.deepEqual(
    Array.from(
      decodePluginInvokeRequest(
        encodeExternalArenaPivRequest({ offset: 8, size: 4 }),
        { externalArena },
      ).inputs[0].payload,
    ),
    [9, 10, 11, 12],
  );
  assert.deepEqual(
    Array.from(
      decodePluginInvokeResponse(
        encodeExternalArenaPivResponse({ offset: 8, size: 4 }),
        { externalArena },
      ).outputs[0].payload,
    ),
    [9, 10, 11, 12],
  );
});

test("public invoke encoder can describe SharedArrayBuffer external payload arenas without copying them into PIV", () => {
  if (typeof SharedArrayBuffer !== "function") {
    return;
  }
  const externalArena = new Uint8Array(new SharedArrayBuffer(64));
  externalArena.set([9, 10, 11, 12], 16);

  const encodedRequest = encodePluginInvokeRequest({
    methodId: "external-arena",
    externalArena,
    inputs: [
      {
        portId: "coverage",
        offset: 16,
        size: 4,
        alignment: 8,
        typeRef: {
          schemaName: "SCV/main.fbs",
          fileIdentifier: "$SCV",
          rootTypeName: "SCV",
        },
      },
    ],
  });

  const request = getPivRequest(encodedRequest);
  assert.equal(request.payloadArenaArray().length, 0);
  assert.equal(request.INPUTS(0).OFFSET(), 16);
  assert.equal(request.INPUTS(0).SIZE(), 4);

  const decoded = decodePluginInvokeRequest(encodedRequest, { externalArena });
  assert.equal(decoded.payloadArena.length, 0);
  assert.equal(decoded.inputs[0].payload.buffer, externalArena.buffer);
  assert.deepEqual(Array.from(decoded.inputs[0].payload), [9, 10, 11, 12]);
});

test("public invoke encoder can author direct PIV requests inside a supplied arena", () => {
  const externalArena = new Uint8Array(new ArrayBuffer(64));
  externalArena.set([9, 10, 11, 12], 16);
  const requestArena = new Uint8Array(new ArrayBuffer(4096));

  const encodedRequest = writePluginInvokeRequestToArena(
    {
      methodId: "external-arena",
      externalArena,
      inputs: [
        {
          portId: "coverage",
          offset: 16,
          size: 4,
          alignment: 8,
          typeRef: {
            schemaName: "SCV/main.fbs",
            fileIdentifier: "$SCV",
            rootTypeName: "SCV",
          },
        },
      ],
    },
    requestArena,
  );

  assert.equal(encodedRequest.buffer, requestArena.buffer);
  assert.equal(hasPivIdentifier(encodedRequest), true);
  const decoded = decodePluginInvokeRequest(encodedRequest, { externalArena });
  assert.equal(decoded.payloadArena.length, 0);
  assert.deepEqual(Array.from(decoded.inputs[0].payload), [9, 10, 11, 12]);
});

test("plugin invoke envelopes round-trip large payload arenas without stack overflow", () => {
  const payload = Uint8Array.from(
    { length: 200000 },
    (_, index) => index & 0xff,
  );

  const encodedRequest = encodePluginInvokeRequest({
    methodId: "large-payload",
    inputs: [
      {
        portId: "blob",
        typeRef: {
          schemaName: "Blob.fbs",
          fileIdentifier: "BLOB",
          wireFormat: "aligned-binary",
          rootTypeName: "Blob",
          requiredAlignment: 16,
          byteLength: payload.length,
        },
        payload,
      },
    ],
  });
  const decodedRequest = decodePluginInvokeRequest(encodedRequest);
  assert.equal(decodedRequest.inputs.length, 1);
  assert.deepEqual(
    Array.from(decodedRequest.inputs[0].payload),
    Array.from(payload),
  );

  const encodedResponse = encodePluginInvokeResponse({
    statusCode: 0,
    outputs: [
      {
        portId: "blob",
        typeRef: {
          schemaName: "Blob.fbs",
          fileIdentifier: "BLOB",
          wireFormat: "aligned-binary",
          rootTypeName: "Blob",
          requiredAlignment: 16,
          byteLength: payload.length,
        },
        payload,
      },
    ],
  });
  const decodedResponse = decodePluginInvokeResponse(encodedResponse);
  assert.equal(decodedResponse.outputs.length, 1);
  assert.deepEqual(
    Array.from(decodedResponse.outputs[0].payload),
    Array.from(payload),
  );
});

test("plugin invoke codecs decode payload arenas without generated scalar-list unpacking", () => {
  const payload = Uint8Array.from(
    { length: 256000 },
    (_, index) => (index * 17) & 0xff,
  );
  const encodedRequest = encodePluginInvokeRequest({
    methodId: "zero-copy-input",
    inputs: [
      {
        portId: "blob",
        typeRef: {
          schemaName: "Blob.fbs",
          fileIdentifier: "BLOB",
          wireFormat: "aligned-binary",
          rootTypeName: "Blob",
          requiredAlignment: 16,
          byteLength: payload.length,
        },
        payload,
      },
    ],
  });
  const encodedResponse = encodePluginInvokeResponse({
    statusCode: 0,
    outputs: [
      {
        portId: "blob",
        typeRef: {
          schemaName: "Blob.fbs",
          fileIdentifier: "BLOB",
          wireFormat: "aligned-binary",
          rootTypeName: "Blob",
          requiredAlignment: 16,
          byteLength: payload.length,
        },
        payload,
      },
    ],
  });

  const originalCreateScalarList =
    flatbuffers.ByteBuffer.prototype.createScalarList;
  flatbuffers.ByteBuffer.prototype.createScalarList = () => {
    throw new Error("generated scalar-list unpacking was used");
  };
  try {
    const decodedRequest = decodePluginInvokeRequest(encodedRequest);
    const decodedResponse = decodePluginInvokeResponse(encodedResponse);

    assert.equal(decodedRequest.inputs.length, 1);
    assert.equal(decodedResponse.outputs.length, 1);
    assert.equal(decodedRequest.payloadArena.buffer, encodedRequest.buffer);
    assert.equal(decodedResponse.payloadArena.buffer, encodedResponse.buffer);
    assert.equal(decodedRequest.inputs[0].payload.buffer, encodedRequest.buffer);
    assert.equal(decodedResponse.outputs[0].payload.buffer, encodedResponse.buffer);
    assert.deepEqual(
      Array.from(decodedRequest.inputs[0].payload.subarray(0, 32)),
      Array.from(payload.subarray(0, 32)),
    );
    assert.deepEqual(
      Array.from(decodedResponse.outputs[0].payload.subarray(-32)),
      Array.from(payload.subarray(-32)),
    );
  } finally {
    flatbuffers.ByteBuffer.prototype.createScalarList =
      originalCreateScalarList;
  }
});

test("source compile exports canonical direct invoke ABI", async () => {
  const manifest = createInvokeManifest({ invokeSurfaces: ["direct"] });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: createEchoSource("out"),
    language: "c",
  });

  try {
    const exportNames = WebAssembly.Module.exports(
      new WebAssembly.Module(compilation.wasmBytes),
    ).map((entry) => entry.name);
    assert.ok(exportNames.includes("plugin_get_manifest_flatbuffer"));
    assert.ok(exportNames.includes("plugin_get_manifest_flatbuffer_size"));
    assert.ok(exportNames.includes("plugin_invoke_stream"));
    assert.ok(exportNames.includes("plugin_alloc"));
    assert.ok(exportNames.includes("plugin_free"));
    assert.equal(exportNames.includes("_start"), false);
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("direct invoke ABI routes multi-port frames and round-trips payload bytes", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-direct",
    invokeSurfaces: ["direct"],
    methodId: "fanout",
    inputPortIds: ["alpha", "beta"],
    outputPortIds: ["alpha", "beta"],
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: FANOUT_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    const payloadAlpha = createPayload("alpha");
    const payloadBeta = createPayload("beta");
    const requestBytes = encodePluginInvokeRequest({
      methodId: "fanout",
      traceId: 987654321n,
      inputs: [
        {
          portId: "alpha",
          typeRef: createCanonicalType(),
          payload: payloadAlpha,
        },
        {
          portId: "beta",
          typeRef: createCanonicalType(),
          payload: payloadBeta,
        },
      ],
    });
    const { responseBytes, response } = invokeDirect(instance, requestBytes);
    assert.equal(hasPivIdentifier(responseBytes), true);
    assert.equal(response.statusCode, 0);
    assert.equal(response.traceId, 987654321n);
    assert.equal(response.outputs.length, 2);
    assert.deepEqual(
      response.outputs.map((frame) => frame.portId),
      ["alpha", "beta"],
    );
    assert.deepEqual(Array.from(response.outputs[0].payload), Array.from(payloadAlpha));
    assert.deepEqual(Array.from(response.outputs[1].payload), Array.from(payloadBeta));

  } finally {
    await cleanupCompilation(compilation);
  }
});

test("zero-length canonical inputs do not force plugin-owned output descriptors", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-zero-length-input",
    invokeSurfaces: ["direct"],
    methodId: "local_output",
    inputPortIds: ["alpha"],
    outputPortIds: ["alpha"],
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: LOCAL_OUTPUT_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    const requestBytes = encodePluginInvokeRequest({
      methodId: "local_output",
      inputs: [
        {
          portId: "alpha",
          typeRef: createCanonicalType(),
          payload: new Uint8Array(),
        },
      ],
    });
    const { responseBytes } = invokeDirectBytes(instance, requestBytes);
    const response = decodePluginInvokeResponse(responseBytes);

    assert.equal(response.statusCode, 0);
    assert.equal(response.outputs.length, 1);
    assert.equal(response.outputs[0].ownership, BufferOwnership.HOST_OWNED);
    assert.deepEqual(
      Array.from(response.outputs[0].payload),
      [1, 1, 2, 3, 5, 8, 13, 21],
    );
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("direct invoke ABI accepts an exact canonical SDS input identity", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-exact-canonical-input",
    invokeSurfaces: ["direct"],
    methodId: "fanout",
    inputPortIds: ["alpha"],
    outputPortIds: ["alpha"],
  });

  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: FANOUT_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    const payload = createPayload("exact-canonical-input");
    const { response } = invokeDirect(
      instance,
      encodePluginInvokeRequest({
        methodId: "fanout",
        inputs: [
          {
            portId: "alpha",
            typeRef: createCanonicalType(),
            payload,
          },
        ],
      }),
    );

    assert.equal(response.statusCode, 0);
    assert.equal(response.outputs.length, 1);
    assert.deepEqual(Array.from(response.outputs[0].payload), Array.from(payload));
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("generated guest outputs carry the exact declared SDS schema identity", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-exact-output-identity",
    invokeSurfaces: ["direct"],
    methodId: "fanout",
    inputPortIds: ["state"],
    outputPortIds: ["state"],
    inputType: VERSIONED_ATM_TYPE,
    outputType: VERSIONED_ATM_TYPE,
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: FANOUT_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    for (const typeRef of [
      createCanonicalType(VERSIONED_ATM_TYPE),
      createAlignedType(VERSIONED_ATM_TYPE),
    ]) {
      const payload = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
      const { response } = invokeDirect(
        instance,
        encodePluginInvokeRequest({
          methodId: "fanout",
          inputs: [{ portId: "state", typeRef, payload }],
        }),
      );

      assert.equal(response.statusCode, 0, typeRef.wireFormat);
      assert.equal(response.outputs.length, 1, typeRef.wireFormat);
      assert.equal(
        response.outputs[0].typeRef?.schemaVersion,
        VERSIONED_ATM_TYPE.schemaVersion,
        typeRef.wireFormat,
      );
      assert.deepEqual(
        Array.from(response.outputs[0].typeRef?.schemaHash ?? []),
        [...ATM_SCHEMA_HASH],
        typeRef.wireFormat,
      );
    }
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("direct invoke ABI preserves SDS PIV/TAB aligned layout metadata", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-aligned-metadata",
    invokeSurfaces: ["direct"],
    methodId: "fanout",
    inputPortIds: ["state"],
    outputPortIds: ["state"],
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: FANOUT_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    const payload = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const requestBytes = encodePluginInvokeRequest({
      methodId: "fanout",
      inputs: [
        {
          portId: "state",
          typeRef: createAlignedType(),
          payload,
        },
      ],
    });
    const { response } = invokeDirect(instance, requestBytes);
    assert.equal(response.statusCode, 0);
    assert.equal(response.outputs.length, 1);
    assert.equal(response.outputs[0].portId, "state");
    assert.deepEqual(Array.from(response.outputs[0].payload), Array.from(payload));
    assert.equal(response.outputs[0].typeRef?.wireFormat, "aligned-binary");
    assert.equal(response.outputs[0].typeRef?.rootTypeName, "ATM");
    assert.equal(response.outputs[0].typeRef?.fixedStringLength, 0);
    assert.equal(response.outputs[0].typeRef?.byteLength, ATM_TYPE.byteLength);
    assert.equal(response.outputs[0].typeRef?.requiredAlignment, ATM_TYPE.requiredAlignment);
    assert.equal(response.outputs[0].alignment, ATM_TYPE.requiredAlignment);
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("direct invoke ABI supports regular flatbuffer inputs and aligned-binary outputs", async () => {
  const manifest = {
    ...createInvokeManifest({
      pluginId: "com.digitalarsenal.examples.invoke-mixed-formats",
      invokeSurfaces: ["direct"],
      methodId: "propagate",
      inputPortIds: ["request"],
      outputPortIds: ["state"],
      inputType: ATM_TYPE,
      outputType: GRV_TYPE,
    }),
  };
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: MIXED_FORMAT_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    const requestBytes = encodePluginInvokeRequest({
      methodId: "propagate",
      inputs: [
        {
          portId: "request",
          typeRef: createCanonicalType(),
          payload: createPayload("omm-request"),
        },
      ],
    });
    const { response } = invokeDirect(instance, requestBytes);
    assert.equal(response.statusCode, 0);
    assert.equal(response.outputs.length, 1);
    assert.equal(response.outputs[0].portId, "state");
    assert.equal(response.outputs[0].typeRef?.schemaName, "GRV.fbs");
    assert.equal(response.outputs[0].typeRef?.fileIdentifier, "$GRV");
    assert.equal(response.outputs[0].typeRef?.wireFormat, "aligned-binary");
    assert.equal(response.outputs[0].typeRef?.rootTypeName, "GRV");
    assert.equal(response.outputs[0].typeRef?.byteLength, 72);
    assert.equal(response.outputs[0].typeRef?.requiredAlignment, 8);
    assert.deepEqual(
      Array.from(response.outputs[0].payload),
      Array.from({ length: 72 }, (_, index) => index),
    );
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("direct invoke ABI returns canonical error responses for invalid requests", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-errors",
    invokeSurfaces: ["direct"],
    methodId: "fanout",
    inputPortIds: ["alpha"],
    outputPortIds: ["alpha"],
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: FANOUT_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);

    const unknownMethod = invokeDirect(
      instance,
      encodePluginInvokeRequest({ methodId: "missing", inputs: [] }),
    ).response;
    assert.equal(unknownMethod.statusCode, 404);
    assert.equal(unknownMethod.errorCode, "unknown-method");

    const missingRequiredInput = invokeDirect(
      instance,
      encodePluginInvokeRequest({
        methodId: "fanout",
        inputs: [
          {
            portId: "wrong-port",
            typeRef: createCanonicalType(),
            payload: createPayload("wrong-port"),
          },
        ],
      }),
    ).response;
    assert.equal(missingRequiredInput.statusCode, 400);
    assert.equal(missingRequiredInput.errorCode, "unknown-input-port");

    const invalidRequest = invokeDirect(
      instance,
      Uint8Array.from([0, 1, 2, 3, 4, 5]),
    ).response;
    assert.equal(invalidRequest.statusCode, 400);
    assert.equal(invalidRequest.errorCode, "invalid-request");

    const externalArenaRequest = invokeDirect(
      instance,
      encodeExternalArenaPivRequest({
        methodId: "fanout",
        traceId: 22n,
        offset: 0x7ffffff0,
        size: 4,
      }),
    ).response;
    assert.equal(externalArenaRequest.statusCode, 400);
    assert.equal(externalArenaRequest.errorCode, "invalid-request-pointer");
    assert.equal(externalArenaRequest.traceId, 22n);

    const wrappingRangeRequest = invokeDirect(
      instance,
      encodePivRequestWithTabRange({
        methodId: "fanout",
        traceId: 33n,
        offset: 0xfffffffe,
        size: 4,
        arena: [1, 2, 3, 4],
      }),
    ).response;
    assert.equal(wrappingRangeRequest.statusCode, 400);
    assert.equal(wrappingRangeRequest.errorCode, "invalid-request-frame");
    assert.equal(wrappingRangeRequest.traceId, 33n);
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("direct invoke ABI rejects unsupported declared input frame types", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-input-type-guards",
    invokeSurfaces: ["direct"],
    methodId: "fanout",
    inputPortIds: ["alpha"],
    outputPortIds: ["alpha"],
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: FANOUT_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    const unsupportedType = invokeDirect(
      instance,
      encodePluginInvokeRequest({
        methodId: "fanout",
        inputs: [
          {
            portId: "alpha",
            typeRef: {
              ...createCanonicalType(GRV_TYPE),
            },
            payload: createPayload("unsupported-input-type"),
          },
        ],
      }),
    ).response;

    assert.equal(unsupportedType.statusCode, 400);
    assert.equal(unsupportedType.errorCode, "unsupported-input-type");
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("generated guest validation matches exact SDS schema identity before dispatch", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-exact-input-identity",
    invokeSurfaces: ["direct"],
    methodId: "guarded",
    inputPortIds: ["alpha"],
    outputPortIds: [],
    inputType: VERSIONED_ATM_TYPE,
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: REJECTED_INPUT_GUARD_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    const exactType = createCanonicalType(VERSIONED_ATM_TYPE);
    const accepted = invokeDirect(
      instance,
      encodePivRequestWithSingleFrame({ typeRef: exactType }),
    ).response;
    assert.equal(accepted.statusCode, 91);
    assert.equal(accepted.errorCode, "handler-executed");

    const mismatches = [
      ["schema name", { schemaName: "atm.fbs" }],
      ["file identifier", { fileIdentifier: "$GRV" }],
      ["root type", { rootTypeName: "GRV" }],
      ["schema version", { schemaVersion: "1.0.3" }],
      [
        "schema hash",
        { schemaHash: [...ATM_SCHEMA_HASH.slice(0, -1), 0xed] },
      ],
    ];
    for (const [label, mutation] of mismatches) {
      const response = invokeDirect(
        instance,
        encodePivRequestWithSingleFrame({
          typeRef: { ...exactType, ...mutation },
        }),
      ).response;
      assert.equal(response.statusCode, 400, label);
      assert.equal(response.errorCode, "unsupported-input-type", label);
    }
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("generated guest normalizes aligned-peer layout hints on canonical PIV inputs", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-canonical-layout-normalization",
    invokeSurfaces: ["direct"],
    methodId: "guarded",
    inputPortIds: ["alpha"],
    outputPortIds: [],
    inputType: VERSIONED_ATM_TYPE,
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: REJECTED_INPUT_GUARD_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    const response = invokeDirect(
      instance,
      encodePivRequestWithSingleFrame({
        typeRef: createCanonicalType(VERSIONED_ATM_TYPE, {
          fixedStringLength: 16,
          byteLength: VERSIONED_ATM_TYPE.byteLength,
          requiredAlignment: VERSIONED_ATM_TYPE.requiredAlignment,
        }),
      }),
    ).response;

    assert.equal(response.statusCode, 91);
    assert.equal(response.errorCode, "handler-executed");
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("generated guest validation matches aligned wire and fixed layout before dispatch", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-exact-aligned-layout",
    invokeSurfaces: ["direct"],
    methodId: "guarded",
    inputPortIds: ["alpha"],
    outputPortIds: [],
    inputType: VERSIONED_ATM_TYPE,
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: REJECTED_INPUT_GUARD_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    const exactType = createAlignedType(VERSIONED_ATM_TYPE);
    const accepted = invokeDirect(
      instance,
      encodePivRequestWithSingleFrame({ typeRef: exactType }),
    ).response;
    assert.equal(accepted.statusCode, 91);
    assert.equal(accepted.errorCode, "handler-executed");

    const mismatches = [
      ["byte length", { typeRef: { ...exactType, byteLength: 16 } }],
      [
        "required alignment",
        {
          typeRef: { ...exactType, requiredAlignment: 8 },
          alignment: 4,
        },
      ],
      [
        "fixed string length",
        { typeRef: { ...exactType, fixedStringLength: 1 } },
      ],
      ["wire format", { typeRef: exactType, tabWireFormat: 0 }],
      ["payload size", { typeRef: exactType, payload: Uint8Array.from([1, 2, 3, 4]) }],
      ["TAB alignment", { typeRef: exactType, alignment: 1 }],
    ];
    for (const [label, mutation] of mismatches) {
      const response = invokeDirect(
        instance,
        encodePivRequestWithSingleFrame(mutation),
      ).response;
      assert.equal(response.statusCode, 400, label);
      assert.equal(response.errorCode, "unsupported-input-type", label);
    }
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("generated guest validation rejects incompatible TAB ownership and mutability before dispatch", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-input-buffer-contract",
    invokeSurfaces: ["direct"],
    methodId: "guarded",
    inputPortIds: ["alpha"],
    outputPortIds: [],
    inputType: VERSIONED_ATM_TYPE,
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: REJECTED_INPUT_GUARD_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    const exactType = createAlignedType(VERSIONED_ATM_TYPE);
    const admissibleContracts = [
      [SdsBufferMutability.IMMUTABLE, SdsBufferOwnership.HOST_OWNED],
      [SdsBufferMutability.IMMUTABLE, SdsBufferOwnership.PLUGIN_OWNED],
      [SdsBufferMutability.IMMUTABLE, SdsBufferOwnership.TRANSFERRED],
      [SdsBufferMutability.SINGLE_WRITER_MUTABLE, SdsBufferOwnership.TRANSFERRED],
      [SdsBufferMutability.APPEND_ONLY, SdsBufferOwnership.TRANSFERRED],
    ];
    for (const [mutability, ownership] of admissibleContracts) {
      const response = invokeDirect(
        instance,
        encodePivRequestWithSingleFrame({ typeRef: exactType, mutability, ownership }),
      ).response;
      assert.equal(response.statusCode, 91, `${mutability}/${ownership}`);
      assert.equal(response.errorCode, "handler-executed", `${mutability}/${ownership}`);
    }

    const incompatibleContracts = [
      [SdsBufferMutability.SINGLE_WRITER_MUTABLE, SdsBufferOwnership.HOST_OWNED],
      [SdsBufferMutability.SINGLE_WRITER_MUTABLE, SdsBufferOwnership.PLUGIN_OWNED],
      [SdsBufferMutability.APPEND_ONLY, SdsBufferOwnership.HOST_OWNED],
      [SdsBufferMutability.APPEND_ONLY, SdsBufferOwnership.PLUGIN_OWNED],
      [SdsBufferMutability.IMMUTABLE, 255],
      [255, SdsBufferOwnership.HOST_OWNED],
    ];
    for (const [mutability, ownership] of incompatibleContracts) {
      const response = invokeDirect(
        instance,
        encodePivRequestWithSingleFrame({ typeRef: exactType, mutability, ownership }),
      ).response;
      assert.equal(response.statusCode, 400, `${mutability}/${ownership}`);
      assert.equal(
        response.errorCode,
        "incompatible-input-buffer-contract",
        `${mutability}/${ownership}`,
      );
    }
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("direct invoke ABI accepts SDS PIV TAB payloads from SDK-owned guest memory", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-external-arena",
    invokeSurfaces: ["direct"],
    methodId: "fanout",
    inputPortIds: ["alpha"],
    outputPortIds: ["alpha"],
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: FANOUT_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    const alloc = instance.exports.plugin_alloc;
    const free = instance.exports.plugin_free;
    const memory = instance.exports.memory;
    const payload = createPayload("external-arena");
    const payloadPtr = alloc(payload.length);
    new Uint8Array(memory.buffer, payloadPtr, payload.length).set(payload);

    const { response } = invokeDirect(
      instance,
      encodeExternalArenaPivRequest({
        methodId: "fanout",
        traceId: 55n,
        offset: payloadPtr,
        size: payload.length,
      }),
    );
    assert.equal(response.statusCode, 0);
    assert.equal(response.traceId, 55n);
    assert.equal(response.outputs.length, 1);
    assert.equal(response.outputs[0].portId, "alpha");
    assert.deepEqual(Array.from(response.outputs[0].payload), Array.from(payload));

    free(payloadPtr, payload.length);
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("direct invoke ABI emits output TAB descriptors into guest memory without response payload copies", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-direct-output-descriptors",
    invokeSurfaces: ["direct"],
    methodId: "fanout",
    inputPortIds: ["alpha"],
    outputPortIds: ["alpha"],
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: FANOUT_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    const alloc = instance.exports.plugin_alloc;
    const free = instance.exports.plugin_free;
    const memory = instance.exports.memory;
    const payload = createPayload("direct-output-descriptor");
    const payloadPtr = alloc(payload.length);
    new Uint8Array(memory.buffer, payloadPtr, payload.length).set(payload);

    const { responseBytes } = invokeDirectBytes(
      instance,
      encodeExternalArenaPivRequest({
        methodId: "fanout",
        traceId: 99n,
        offset: payloadPtr,
        size: payload.length,
      }),
    );
    const responseTable = getPivResponse(responseBytes);
    assert.equal(responseTable.payloadArenaArray().length, 0);
    assert.equal(responseTable.outputsLength(), 1);

    const output = responseTable.OUTPUTS(0);
    assert.equal(output.OFFSET(), payloadPtr);
    assert.equal(output.SIZE(), payload.length);
    assert.equal(output.OWNERSHIP(), SdsBufferOwnership.PLUGIN_OWNED);

    const response = decodePluginInvokeResponse(responseBytes, {
      externalArena: new Uint8Array(memory.buffer),
    });
    assert.equal(response.statusCode, 0);
    assert.equal(response.traceId, 99n);
    assert.equal(response.outputs.length, 1);
    assert.equal(response.outputs[0].payload.buffer, memory.buffer);
    assert.equal(response.outputs[0].payload.byteOffset, payloadPtr);
    assert.deepEqual(Array.from(response.outputs[0].payload), Array.from(payload));

    free(payloadPtr, payload.length);
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("direct invoke ABI owns plugin_push_output payload lifetime", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-local-output-lifetime",
    invokeSurfaces: ["direct"],
    methodId: "local_output",
    inputPortIds: ["alpha"],
    outputPortIds: ["alpha"],
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: LOCAL_OUTPUT_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    const alloc = instance.exports.plugin_alloc;
    const free = instance.exports.plugin_free;
    const memory = instance.exports.memory;
    const input = createPayload("local-output-lifetime");
    const inputPtr = alloc(input.length);
    new Uint8Array(memory.buffer, inputPtr, input.length).set(input);

    const { responseBytes } = invokeDirectBytes(
      instance,
      encodeExternalArenaPivRequest({
        methodId: "local_output",
        traceId: 101n,
        offset: inputPtr,
        size: input.length,
      }),
    );
    const responseTable = getPivResponse(responseBytes);
    assert.equal(responseTable.payloadArenaArray().length, 0);

    const response = decodePluginInvokeResponse(responseBytes, {
      externalArena: new Uint8Array(memory.buffer),
    });
    assert.equal(response.statusCode, 0);
    assert.equal(response.traceId, 101n);
    assert.deepEqual(
      Array.from(response.outputs[0].payload),
      [1, 1, 2, 3, 5, 8, 13, 21],
    );

    free(inputPtr, input.length);
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("direct invoke ABI fails closed for invalid guest ABI pointers", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-pointer-guards",
    invokeSurfaces: ["direct"],
    methodId: "fanout",
    inputPortIds: ["alpha"],
    outputPortIds: ["alpha"],
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: FANOUT_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    const alloc = instance.exports.plugin_alloc;
    const free = instance.exports.plugin_free;
    const memory = instance.exports.memory;
    const lenOutPtr = alloc(4);

    let responsePtr = 0;
    assert.doesNotThrow(() => {
      responsePtr = invokeDirectRaw(instance, 0x7ffffff0, 16, lenOutPtr);
    });
    const responseLen = new DataView(memory.buffer).getUint32(lenOutPtr, true);
    const responseBytes = new Uint8Array(
      memory.buffer.slice(responsePtr, responsePtr + responseLen),
    );
    const response = decodePluginInvokeResponse(responseBytes);
    assert.equal(response.statusCode, 400);
    assert.equal(response.errorCode, "invalid-request-pointer");
    free(responsePtr, responseLen);
    free(lenOutPtr, 4);
    assert.doesNotThrow(() => {
      free(0x7ffffff0, 16);
    });

    const requestBytes = encodePluginInvokeRequest({
      methodId: "fanout",
      inputs: [
        {
          portId: "alpha",
          typeRef: createCanonicalType(),
          payload: createPayload("pointer-guard"),
        },
      ],
    });
    const requestPtr = alloc(requestBytes.length);
    new Uint8Array(memory.buffer, requestPtr, requestBytes.length).set(requestBytes);
    assert.doesNotThrow(() => {
      assert.equal(
        invokeDirectRaw(instance, requestPtr, requestBytes.length, 0x7ffffff0),
        0,
      );
    });
    free(requestPtr, requestBytes.length);
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("direct invoke ABI serializes explicit output stream frame metadata into TAB.FRAME_ID", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-output-stream-frame",
    invokeSurfaces: ["direct"],
    methodId: "stream_output",
    inputPortIds: ["in"],
    outputPortIds: ["out"],
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: STREAM_OUTPUT_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    const { response } = invokeDirect(
      instance,
      encodePluginInvokeRequest({
        methodId: "stream_output",
        inputs: [
          {
            portId: "in",
            typeRef: createCanonicalType(),
            payload: createPayload("stream-frame-input"),
          },
        ],
      }),
    );
    assert.equal(response.statusCode, 0);
    assert.equal(response.outputs.length, 1);
    assert.equal(response.outputs[0].sequence, 7n);
    assert.equal(response.outputs[0].endOfStream, true);
    assert.equal(response.outputs[0].traceId, 15n);
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("WASI command mode reads canonical invoke envelopes from stdin and writes responses to stdout", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-command",
    invokeSurfaces: ["command"],
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: createEchoSource("out"),
    language: "c",
  });

  try {
    const payload = createPayload("command");
    const requestBytes = encodePluginInvokeRequest({
      methodId: "echo",
      inputs: [
        {
          portId: "in",
          typeRef: createCanonicalType(),
          payload,
        },
      ],
    });

    const result = runCommandModule(compilation.wasmBytes, {
      stdinBytes: requestBytes,
    });
    assert.equal(result.exitCode, 0);
    assert.ok(result.imports.every((entry) => entry.module === "wasi_snapshot_preview1"));
    const decoded = decodePluginInvokeResponse(result.stdoutBytes);
    assert.equal(decoded.statusCode, 0);
    assert.equal(decoded.outputs.length, 1);
    assert.equal(decoded.outputs[0].portId, "out");
    assert.deepEqual(Array.from(decoded.outputs[0].payload), Array.from(payload));
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("WASI raw shortcut mode emits raw payload bytes for single-port methods", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-shortcut",
    invokeSurfaces: ["command"],
    methodId: "echo",
    inputPortIds: ["echo"],
    outputPortIds: ["echo"],
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: createEchoSource("echo"),
    language: "c",
  });

  try {
    const payload = createPayload("shortcut");
    const result = runCommandModule(compilation.wasmBytes, {
      args: ["--method", "echo"],
      stdinBytes: payload,
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(Array.from(result.stdoutBytes), Array.from(payload));
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("WASI raw shortcut mode rejects multi-port methods", async () => {
  const manifest = createInvokeManifest({
    pluginId: "com.digitalarsenal.examples.invoke-shortcut-reject",
    invokeSurfaces: ["command"],
    methodId: "fanout",
    inputPortIds: ["left", "right"],
    outputPortIds: ["left", "right"],
  });
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: FANOUT_SOURCE,
    language: "c",
  });

  try {
    const result = runCommandModule(compilation.wasmBytes, {
      args: ["--method", "fanout"],
      stdinBytes: createPayload("shortcut-reject"),
    });
    assert.equal(result.exitCode, 64);
    assert.match(result.stderrText, /does not support raw stdin\/stdout shortcut mode/i);
  } finally {
    await cleanupCompilation(compilation);
  }
});
