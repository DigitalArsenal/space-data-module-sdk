import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

import {
  cleanupCompilation,
  compileModuleFromSource,
  loadModule,
  ModuleThreadModel,
} from "../src/index.js";
import { createBrowserHost } from "../src/browser.js";
import { createBrowserModuleHarness } from "../src/testing/browserModuleHarness.js";

const execFile = promisify(execFileCallback);

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
  pluginId = "com.digitalarsenal.examples.browser-harness-test",
  runtimeTargets = ["browser", "wasmedge"],
  invokeSurfaces = ["command"],
} = {}) {
  return {
    pluginId,
    name: "Browser Harness Test Module",
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

async function commandAvailable(command) {
  try {
    await execFile(command, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

test("browser+wasmedge runtime targets default to a shared single-thread artifact", async (t) => {
  const compilation = await compileModuleFromSource({
    manifest: createInvokeManifest(),
    sourceCode: createEchoSource(),
    language: "c",
  });
  t.after(async () => {
    await cleanupCompilation(compilation);
  });

  const imports = WebAssembly.Module.imports(
    new WebAssembly.Module(compilation.wasmBytes),
  );
  const importedModuleNames = Array.from(
    new Set(imports.map((entry) => entry.module)),
  ).sort();

  assert.equal(compilation.threadModel, ModuleThreadModel.SINGLE_THREAD);
  assert.equal(compilation.guestLink?.threadModel, ModuleThreadModel.SINGLE_THREAD);
  assert.deepEqual(importedModuleNames, ["wasi_snapshot_preview1"]);
});

test("browser harness executes command-surface invoke envelopes for the shared artifact", async (t) => {
  const compilation = await compileModuleFromSource({
    manifest: createInvokeManifest(),
    sourceCode: createEchoSource(),
    language: "c",
  });
  t.after(async () => {
    await cleanupCompilation(compilation);
  });

  const harness = await createBrowserModuleHarness({
    wasmSource: compilation.wasmBytes,
  });
  t.after(() => {
    harness.destroy();
  });

  const response = await harness.invoke({
    methodId: "echo",
    inputs: [
      {
        portId: "request",
        typeRef: {
          schemaName: "Blob.fbs",
          fileIdentifier: "BLOB",
        },
        payload: new TextEncoder().encode("hello from browser"),
      },
    ],
  });

  assert.equal(response.statusCode, 0);
  assert.equal(response.outputs.length, 1);
  assert.equal(response.outputs[0].portId, "response");
  assert.equal(
    new TextDecoder().decode(response.outputs[0].payload),
    "hello from browser",
  );
});

test("browser host exposes a virtual filesystem edge shim", async () => {
  const host = createBrowserHost({
    capabilities: ["filesystem"],
  });

  await host.filesystem.mkdir("data", { recursive: true });
  await host.filesystem.writeFile("data/example.txt", "alpha");
  await host.filesystem.appendFile("data/example.txt", "-beta");

  const fileText = await host.filesystem.readFile("data/example.txt", {
    encoding: "utf8",
  });
  const stat = await host.filesystem.stat("data/example.txt");
  const listing = await host.filesystem.readdir("data");
  const renamed = await host.filesystem.rename(
    "data/example.txt",
    "data/final.txt",
  );

  assert.equal(host.hasCapability("filesystem"), true);
  assert.deepEqual(host.listOperations().includes("filesystem.readFile"), true);
  assert.equal(host.filesystem.resolvePath("data/final.txt"), "/data/final.txt");
  assert.equal(fileText, "alpha-beta");
  assert.deepEqual(stat.isFile, true);
  assert.deepEqual(listing, [
    {
      name: "example.txt",
      isFile: true,
      isDirectory: false,
    },
  ]);
  assert.deepEqual(renamed, {
    from: "/data/example.txt",
    to: "/data/final.txt",
  });
});

test("the same browser+wasmedge artifact can run in both browser harness and WasmEdge", async (t) => {
  if (process.env.SPACE_DATA_MODULE_SDK_ENABLE_WASMEDGE_PARITY !== "1") {
    t.skip(
      "Set SPACE_DATA_MODULE_SDK_ENABLE_WASMEDGE_PARITY=1 to run the live browser/WasmEdge parity check.",
    );
    return;
  }
  if (!(await commandAvailable("wasmedge"))) {
    t.skip("Install the wasmedge CLI to verify live browser/WasmEdge artifact parity.");
    return;
  }

  const compilation = await compileModuleFromSource({
    manifest: createInvokeManifest({
      pluginId: "com.digitalarsenal.examples.browser-wasmedge-parity",
    }),
    sourceCode: createEchoSource(),
    language: "c",
  });
  t.after(async () => {
    await cleanupCompilation(compilation);
  });

  const browserHarness = await createBrowserModuleHarness({
    wasmSource: compilation.wasmBytes,
  });
  t.after(() => {
    browserHarness.destroy();
  });

  const wasmedgeHarness = await loadModule({
    wasmSource: compilation.outputPath,
    runtimeKind: "wasmedge",
    enableThreads: false,
  });
  t.after(async () => {
    await wasmedgeHarness.destroy();
  });

  const request = {
    methodId: "echo",
    inputs: [
      {
        portId: "request",
        typeRef: {
          schemaName: "Blob.fbs",
          fileIdentifier: "BLOB",
        },
        payload: new TextEncoder().encode("same artifact"),
      },
    ],
  };

  const [browserResponse, wasmedgeResponse] = await Promise.all([
    browserHarness.invoke(request),
    wasmedgeHarness.invoke(request),
  ]);

  assert.deepEqual(browserResponse.statusCode, 0);
  assert.deepEqual(browserResponse, wasmedgeResponse);
});
