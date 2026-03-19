import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { WASI } from "node:wasi";

import {
  cleanupCompilation,
  compileModuleFromSource,
  decodePluginInvokeRequest,
  decodePluginInvokeResponse,
  encodePluginInvokeRequest,
  encodePluginInvokeResponse,
  encodePluginManifest,
} from "../src/index.js";

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
    const { response } = invokeDirect(instance, requestBytes);
    assert.equal(response.statusCode, 0);
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

test("direct invoke ABI preserves explicit aligned layout metadata", async () => {
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
    assert.equal(response.outputs[0].typeRef?.fixedStringLength, 255);
    assert.equal(response.outputs[0].typeRef?.byteLength, 64);
    assert.equal(response.outputs[0].typeRef?.requiredAlignment, 16);
    assert.equal(response.outputs[0].alignment, 16);
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
    assert.equal(missingRequiredInput.errorCode, "missing-required-input");

    const invalidRequest = invokeDirect(
      instance,
      Uint8Array.from([0, 1, 2, 3, 4, 5]),
    ).response;
    assert.equal(invalidRequest.statusCode, 400);
    assert.equal(invalidRequest.errorCode, "invalid-request");
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
