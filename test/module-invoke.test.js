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
} from "../src/index.js";
import { BufferMutability } from "../src/generated/orbpro/stream/buffer-mutability.js";
import { BufferOwnership } from "../src/generated/orbpro/stream/buffer-ownership.js";

function createPort(portId, required = true) {
  return {
    portId,
    acceptedTypeSets: [
      {
        setId: `${portId}-any`,
        allowedTypes: [{ acceptsAnyFlatbuffer: true }],
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
        inputPorts: inputPortIds.map((portId) => createPort(portId, true)),
        outputPorts: outputPortIds.map((portId) => createPort(portId, false)),
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
  assert.equal(typeof sdk.decodePluginInvokeRequest, "function");
  assert.equal(typeof sdk.encodeLegacyPluginInvokeRequest, "undefined");
  assert.equal(typeof sdk.decodeLegacyPluginInvokeRequest, "undefined");
  assert.equal(typeof sdk.LegacyPluginInvokeRequest, "undefined");
});

function getPivRequest(bytes) {
  const bb = new flatbuffers.ByteBuffer(bytes);
  return PIV.getRootAsPIV(bb).REQUEST();
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
          new FlatBufferTypeRefT("PluginManifest.fbs", "PMAN", null, null),
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
          new FlatBufferTypeRefT("PluginManifest.fbs", "PMAN", null, null),
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
          new FlatBufferTypeRefT("PluginManifest.fbs", "PMAN", null, null),
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

const STREAM_OUTPUT_SOURCE = `#include <stdint.h>
#include "space_data_module_invoke.h"

int stream_output(void) {
  static const uint8_t payload[4] = { 9, 8, 7, 6 };
  plugin_reset_output_state();
  int32_t output_index = plugin_push_output(
    "out",
    "PluginManifest.fbs",
    "PMAN",
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
  static const uint8_t state_vector_bytes[24] = {
    0, 1, 2, 3, 4, 5, 6, 7,
    8, 9, 10, 11, 12, 13, 14, 15,
    16, 17, 18, 19, 20, 21, 22, 23
  };
  if (!frame) {
    plugin_set_error("missing-frame", "No input frame was provided.");
    return 3;
  }
  plugin_push_output_typed(
    "state",
    "StateVector.fbs",
    "STVC",
    1,
    "StateVector",
    0,
    24,
    8,
    state_vector_bytes,
    24
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

function invokeDirect(instance, requestBytes) {
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

  return {
    responseBytes,
    response: decodePluginInvokeResponse(responseBytes),
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

test("direct invoke ABI accepts PIV frames with omitted root type when schema identity matches", async () => {
  const manifest = {
    ...createInvokeManifest({
      pluginId: "com.digitalarsenal.examples.invoke-root-type-optional",
      invokeSurfaces: ["direct"],
      methodId: "fanout",
      inputPortIds: ["alpha"],
      outputPortIds: ["alpha"],
    }),
  };
  manifest.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes = [
    {
      schemaName: "PluginManifest.fbs",
      fileIdentifier: "PMAN",
      rootTypeName: "PluginManifest",
    },
  ];

  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: FANOUT_SOURCE,
    language: "c",
  });

  try {
    const { instance } = instantiateWithWasi(compilation.wasmBytes);
    const payload = createPayload("root-type-optional");
    const { response } = invokeDirect(
      instance,
      encodePluginInvokeRequest({
        methodId: "fanout",
        inputs: [
          {
            portId: "alpha",
            typeRef: {
              schemaName: "PluginManifest.fbs",
              fileIdentifier: "PMAN",
            },
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
          typeRef: {
            schemaName: "StateVector.fbs",
            fileIdentifier: "STVC",
            wireFormat: "aligned-binary",
            rootTypeName: "StateVector",
            fixedStringLength: 255,
            byteLength: 64,
            requiredAlignment: 16,
          },
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
    assert.equal(response.outputs[0].typeRef?.rootTypeName, "StateVector");
    assert.equal(response.outputs[0].typeRef?.fixedStringLength, 0);
    assert.equal(response.outputs[0].typeRef?.byteLength, payload.length);
    assert.equal(response.outputs[0].typeRef?.requiredAlignment, 16);
    assert.equal(response.outputs[0].alignment, 16);
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
    }),
    methods: [
      {
        methodId: "propagate",
        displayName: "propagate",
        inputPorts: [
          {
            portId: "request",
            acceptedTypeSets: [
              {
                setId: "omm",
                allowedTypes: [
                  {
                    schemaName: "OMM.fbs",
                    fileIdentifier: "$OMM",
                  },
                ],
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        outputPorts: [
          {
            portId: "state",
            acceptedTypeSets: [
              {
                setId: "aligned-state",
                allowedTypes: [
                  {
                    schemaName: "StateVector.fbs",
                    fileIdentifier: "STVC",
                  },
                  {
                    schemaName: "StateVector.fbs",
                    fileIdentifier: "STVC",
                    wireFormat: "aligned-binary",
                    rootTypeName: "StateVector",
                    byteLength: 24,
                    requiredAlignment: 8,
                  },
                ],
              },
            ],
            minStreams: 0,
            maxStreams: 1,
            required: false,
          },
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
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
          typeRef: {
            schemaName: "OMM.fbs",
            fileIdentifier: "$OMM",
          },
          payload: createPayload("omm-request"),
        },
      ],
    });
    const { response } = invokeDirect(instance, requestBytes);
    assert.equal(response.statusCode, 0);
    assert.equal(response.outputs.length, 1);
    assert.equal(response.outputs[0].portId, "state");
    assert.equal(response.outputs[0].typeRef?.schemaName, "StateVector.fbs");
    assert.equal(response.outputs[0].typeRef?.fileIdentifier, "STVC");
    assert.equal(response.outputs[0].typeRef?.wireFormat, "aligned-binary");
    assert.equal(response.outputs[0].typeRef?.rootTypeName, "StateVector");
    assert.equal(response.outputs[0].typeRef?.byteLength, 24);
    assert.equal(response.outputs[0].typeRef?.requiredAlignment, 8);
    assert.deepEqual(
      Array.from(response.outputs[0].payload),
      Array.from({ length: 24 }, (_, index) => index),
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
            typeRef: { schemaName: "PluginManifest.fbs", fileIdentifier: "PMAN" },
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
  const manifest = {
    ...createInvokeManifest({
      pluginId: "com.digitalarsenal.examples.invoke-input-type-guards",
      invokeSurfaces: ["direct"],
      methodId: "fanout",
      inputPortIds: ["alpha"],
      outputPortIds: ["alpha"],
    }),
    methods: [
      {
        methodId: "fanout",
        displayName: "fanout",
        inputPorts: [
          {
            portId: "alpha",
            acceptedTypeSets: [
              {
                setId: "plugin-manifest-only",
                allowedTypes: [
                  {
                    schemaName: "PluginManifest.fbs",
                    fileIdentifier: "PMAN",
                  },
                ],
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        outputPorts: [
          {
            portId: "alpha",
            acceptedTypeSets: [
              {
                setId: "alpha-any",
                allowedTypes: [{ acceptsAnyFlatbuffer: true }],
              },
            ],
            minStreams: 0,
            maxStreams: 1,
            required: false,
          },
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  };
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
              schemaName: "Other.fbs",
              fileIdentifier: "OTHR",
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
          typeRef: { schemaName: "PluginManifest.fbs", fileIdentifier: "PMAN" },
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
            typeRef: {
              schemaName: "PluginManifest.fbs",
              fileIdentifier: "PMAN",
            },
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
          typeRef: { schemaName: "PluginManifest.fbs", fileIdentifier: "PMAN" },
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
