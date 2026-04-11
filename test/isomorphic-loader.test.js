import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  cleanupCompilation,
  compileModuleFromSource,
  createNodeHost,
  inspectModule,
  loadModule,
  ModuleThreadModel,
} from "../src/index.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const echoProcessFixturePath = path.join(
  testDir,
  "..",
  "fixtures",
  "process-invoke",
  "echo-plugin-server.mjs",
);

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
  pluginId = "com.digitalarsenal.examples.isomorphic-loader-test",
  runtimeTargets = ["browser", "wasmedge"],
  invokeSurfaces = ["command"],
} = {}) {
  return {
    pluginId,
    name: "Isomorphic Loader Test Module",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: [],
    externalInterfaces: [],
    runtimeTargets,
    invokeSurfaces,
    methods: [
      {
        methodId: "echo",
        displayName: "echo",
        inputPorts: [createPort("request", true)],
        outputPorts: [createPort("response", false)],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  };
}

function createEchoSource(outputPortId = "response") {
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

function hasWasmEdgeCli() {
  if (process.env.WASMEDGE_RUNNER_BINARY) {
    return true;
  }
  const result = spawnSync("wasmedge", ["--version"], {
    stdio: "ignore",
  });
  return result.status === 0;
}

test("inspectModule reports the standalone profile for shared browser/WasmEdge artifacts", async (t) => {
  const compilation = await compileModuleFromSource({
    manifest: createInvokeManifest(),
    sourceCode: createEchoSource(),
    language: "c",
  });
  t.after(async () => {
    await cleanupCompilation(compilation);
  });

  assert.equal(compilation.threadModel, ModuleThreadModel.SINGLE_THREAD);

  const inspection = await inspectModule(compilation.wasmBytes);
  const importedModuleNames = Array.from(
    new Set(inspection.imports.map((entry) => entry.module)),
  ).sort();

  assert.equal(inspection.profile, "standalone");
  assert.deepEqual(importedModuleNames, ["wasi_snapshot_preview1"]);
  assert.ok(inspection.exports.includes("_start"));
  assert.ok(inspection.exports.includes("plugin_get_manifest_flatbuffer"));
  assert.ok(inspection.exports.includes("plugin_get_manifest_flatbuffer_size"));
});

test("loadModule can drive generic process runtimes on the server path", async (t) => {
  const harness = await loadModule({
    wasmSource: echoProcessFixturePath,
    runtimeKind: "process",
    command: process.execPath,
    args: [echoProcessFixturePath],
  });
  t.after(async () => {
    await harness.destroy();
  });

  const response = await harness.invoke({
    methodId: "echo",
    inputs: [
      {
        portId: "request",
        payload: new TextEncoder().encode("server-path"),
      },
    ],
  });

  assert.equal(response.statusCode, 0);
  assert.equal(response.outputs.length, 1);
  assert.equal(
    new TextDecoder().decode(response.outputs[0].payload),
    "echo:server-path",
  );
});

test("loadModule exposes awaited host dispatch on the server path when a host is provided", async (t) => {
  const harness = await loadModule({
    wasmSource: echoProcessFixturePath,
    runtimeKind: "process",
    command: process.execPath,
    args: [echoProcessFixturePath],
    host: createNodeHost({
      capabilities: ["ipfs"],
      ipfs: {
        async resolve(params) {
          return {
            path: params.path,
            cid: "bafyloadercid",
          };
        },
      },
    }),
  });
  t.after(async () => {
    await harness.destroy();
  });

  const response = await harness.callHost("ipfs.invoke", {
    operation: "resolve",
    path: "/ipns/loader",
  });

  assert.deepEqual(response, {
    path: "/ipns/loader",
    cid: "bafyloadercid",
  });
});

test("loadModule can drive standalone artifacts through the WasmEdge server path", async (t) => {
  if (!hasWasmEdgeCli()) {
    t.skip("Install wasmedge to exercise the isomorphic WasmEdge loader path.");
    return;
  }

  const compilation = await compileModuleFromSource({
    manifest: createInvokeManifest({
      pluginId: "com.digitalarsenal.examples.isomorphic-loader-wasmedge-test",
    }),
    sourceCode: createEchoSource(),
    language: "c",
  });
  t.after(async () => {
    await cleanupCompilation(compilation);
  });

  let harness;
  try {
    harness = await loadModule({
      wasmSource: compilation.outputPath,
      runtimeKind: "wasmedge",
      enableThreads: false,
    });
  } catch (error) {
    if (/spawn wasmedge ENOENT|command not found|Failed to launch/i.test(String(error))) {
      t.skip("Install wasmedge to exercise the isomorphic WasmEdge loader path.");
      return;
    }
    throw error;
  }
  t.after(async () => {
    await harness.destroy();
  });

  const response = await harness.invoke({
    methodId: "echo",
    inputs: [
      {
        portId: "request",
        payload: new TextEncoder().encode("wasmedge-server-path"),
      },
    ],
  });

  assert.equal(response.statusCode, 0);
  assert.equal(response.outputs.length, 1);
  assert.equal(
    new TextDecoder().decode(response.outputs[0].payload),
    "wasmedge-server-path",
  );
});
