import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  cleanupCompilation,
  compileModuleFromSource,
  createModuleHarness,
} from "../src/index.js";

const execFile = promisify(execFileCallback);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function commandAvailable(command, args = ["--version"]) {
  try {
    await execFile(command, args);
    return true;
  } catch {
    return false;
  }
}

async function resolveEmccBinary() {
  const explicit = process.env.EMCC_BINARY;
  if (explicit) {
    return explicit;
  }
  const repoLocal = path.resolve(
    __dirname,
    "..",
    "..",
    "wasm-engine",
    ".emsdk",
    "upstream",
    "emscripten",
    "emcc",
  );
  try {
    await access(repoLocal);
    return repoLocal;
  } catch {
    return "emcc";
  }
}

async function threadedRunnerAvailable() {
  const runnerBinary = process.env.WASMEDGE_RUNNER_BINARY;
  if (!runnerBinary) {
    return false;
  }
  try {
    await access(runnerBinary);
    return true;
  } catch {
    return false;
  }
}

async function buildMinimalThreadedWasm() {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "space-data-module-sdk-wasmedge-pthread-"),
  );
  const sourcePath = path.join(tempDir, "with_thread.c");
  const wasmPath = path.join(tempDir, "with_thread.wasm");
  const emCachePath = path.join(tempDir, "em-cache");
  const emccBinary = await resolveEmccBinary();
  const source = `
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>

static int value = 0;

static void *thread_main(void *arg) {
  (void)arg;
  value = 42;
  return (void *)(intptr_t)7;
}

int main(void) {
  pthread_t thread;
  void *result = 0;
  int rc = pthread_create(&thread, NULL, thread_main, NULL);
  if (rc != 0) {
    fprintf(stderr, "pthread_create rc=%d\\n", rc);
    return rc;
  }
  rc = pthread_join(thread, &result);
  if (rc != 0) {
    fprintf(stderr, "pthread_join rc=%d\\n", rc);
    return rc;
  }
  printf("value=%d result=%ld\\n", value, (long)(intptr_t)result);
  return value == 42 && (intptr_t)result == 7 ? 0 : 99;
}
`.trimStart();
  await writeFile(sourcePath, source, "utf8");
  await execFile(emccBinary, [
    sourcePath,
    "-O2",
    "-pthread",
    "-sSTANDALONE_WASM=1",
    "-sPURE_WASI=1",
    "-o",
    wasmPath,
  ], {
    env: {
      ...process.env,
      EM_CACHE: emCachePath,
    },
  });
  return { tempDir, wasmPath };
}

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
  pluginId = "com.digitalarsenal.examples.wasmedge-runtime-host",
  methodId = "echo",
} = {}) {
  return {
    pluginId,
    name: "WasmEdge Runtime Host Test Module",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: [],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    methods: [
      {
        methodId,
        displayName: methodId,
        inputPorts: [createPort("request", true)],
        outputPorts: [createPort("result", false)],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  };
}

function createEchoSource(prefix) {
  return `#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "space_data_module_invoke.h"

int echo(void) {
  static const char kPrefix[] = ${JSON.stringify(prefix)};
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) {
    plugin_set_error("missing-frame", "No input frame was provided.");
    return 3;
  }

  const uint32_t prefix_length = (uint32_t)(sizeof(kPrefix) - 1U);
  const uint32_t payload_length = frame->payload_length;
  uint8_t *combined = (uint8_t *)malloc(prefix_length + payload_length);
  if (!combined) {
    plugin_set_error("oom", "Failed to allocate echo buffer.");
    return 4;
  }

  memcpy(combined, kPrefix, prefix_length);
  if (payload_length > 0 && frame->payload) {
    memcpy(combined + prefix_length, frame->payload, payload_length);
  }

  const int32_t push_result = plugin_push_output(
    "result",
    frame->schema_name,
    frame->file_identifier,
    combined,
    prefix_length + payload_length
  );
  free(combined);
  return push_result == 0 ? 0 : 5;
}
`;
}

function createCountingEchoSource() {
  return `#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "space_data_module_invoke.h"

static uint32_t call_count = 0;

int echo(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) {
    plugin_set_error("missing-frame", "No input frame was provided.");
    return 3;
  }

  call_count += 1U;
  const uint32_t payload_length = frame->payload_length;
  const uint32_t prefix_length = 2U;
  uint8_t *combined = (uint8_t *)malloc(prefix_length + payload_length);
  if (!combined) {
    plugin_set_error("oom", "Failed to allocate echo buffer.");
    return 4;
  }

  combined[0] = (uint8_t)('0' + (call_count % 10U));
  combined[1] = (uint8_t)':';
  if (payload_length > 0 && frame->payload) {
    memcpy(combined + prefix_length, frame->payload, payload_length);
  }

  const int32_t push_result = plugin_push_output(
    "result",
    frame->schema_name,
    frame->file_identifier,
    combined,
    prefix_length + payload_length
  );
  free(combined);
  return push_result == 0 ? 0 : 5;
}
`;
}

async function buildRuntimeHostEchoModule(prefix = "runtime-host:") {
  return compileModuleFromSource({
    manifest: createInvokeManifest({
      pluginId: `com.digitalarsenal.examples.wasmedge-runtime-host.${prefix.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    }),
    sourceCode: createEchoSource(prefix),
    language: "c",
  });
}

async function buildRuntimeHostCountingModule() {
  return compileModuleFromSource({
    manifest: createInvokeManifest({
      pluginId: "com.digitalarsenal.examples.wasmedge-runtime-host.counter",
    }),
    sourceCode: createCountingEchoSource(),
    language: "c",
  });
}

function readLengthPrefixedFrames(stream) {
  let buffer = Buffer.alloc(0);
  const frames = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      while (buffer.length >= 4) {
        const frameLength = buffer.readUInt32LE(0);
        if (buffer.length < 4 + frameLength) {
          break;
        }
        frames.push(buffer.subarray(4, 4 + frameLength));
        buffer = buffer.subarray(4 + frameLength);
      }
    });
    stream.on("end", () => resolve(frames));
    stream.on("error", reject);
  });
}

test("threaded WasmEdge runner executes a real guest pthread_create flow", async (t) => {
  if (!(await threadedRunnerAvailable())) {
    t.skip("Set WASMEDGE_RUNNER_BINARY to verify real guest pthread creation.");
    return;
  }
  if (!(await commandAvailable(await resolveEmccBinary()))) {
    t.skip("No usable emcc binary is available on this machine.");
    return;
  }

  const { tempDir, wasmPath } = await buildMinimalThreadedWasm();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const { stdout, stderr } = await execFile(
    process.env.WASMEDGE_RUNNER_BINARY,
    [wasmPath],
    {
      env: {
        ...process.env,
        DYLD_LIBRARY_PATH: "",
        DYLD_FALLBACK_LIBRARY_PATH: "",
        DYLD_FRAMEWORK_PATH: "",
        DYLD_FALLBACK_FRAMEWORK_PATH: "",
        LIBRARY_PATH: "",
      },
    },
  );

  assert.equal(stderr.trim(), "");
  assert.equal(stdout.trim(), "value=42 result=7");
});

test("threaded WasmEdge runner can expose an empty runtime-host control surface before any modules are installed", async (t) => {
  if (!(await threadedRunnerAvailable())) {
    t.skip("Set WASMEDGE_RUNNER_BINARY to verify runtime-host runner mode.");
    return;
  }

  const child = spawn(process.env.WASMEDGE_RUNNER_BINARY, ["--serve-runtime-host"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      DYLD_LIBRARY_PATH: "",
      DYLD_FALLBACK_LIBRARY_PATH: "",
      DYLD_FRAMEWORK_PATH: "",
      DYLD_FALLBACK_FRAMEWORK_PATH: "",
      LIBRARY_PATH: "",
    },
  });
  const stdoutFramesPromise = readLengthPrefixedFrames(child.stdout);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const payload = Buffer.from(JSON.stringify({}), "utf8");
  const request = Buffer.alloc(4 + 5 + payload.length);
  request.writeUInt32LE(5 + payload.length, 0);
  request.write("ORPW", 4, "utf8");
  request[8] = 17;
  payload.copy(request, 9);
  child.stdin.end(request);

  const [frames, exitCode] = await Promise.all([
    stdoutFramesPromise,
    once(child, "close").then(([code]) => code),
  ]);

  assert.equal(exitCode, 0);
  assert.equal(stderr.trim(), "");
  assert.equal(frames.length, 1);
  assert.deepEqual(JSON.parse(frames[0].toString("utf8")), []);
});

test("threaded WasmEdge runner serves real runtime-host install/invoke and row-region controls", async (t) => {
  if (!(await threadedRunnerAvailable())) {
    t.skip("Set WASMEDGE_RUNNER_BINARY to verify runtime-host runner mode.");
    return;
  }

  const compilation = await buildRuntimeHostEchoModule("runtime-host:");
  t.after(async () => {
    await cleanupCompilation(compilation);
  });

  const harness = await createModuleHarness({
    runtime: {
      kind: "wasmedge",
      hostProfile: "runtime-host",
      wasmEdgeRunnerBinary: process.env.WASMEDGE_RUNNER_BINARY,
      modules: [
        {
          moduleId: "echo",
          wasmPath: compilation.outputPath,
          metadata: { tier: "test" },
          methodIds: ["echo"],
        },
      ],
      defaultModuleId: "echo",
    },
  });
  t.after(async () => {
    await harness.destroy();
  });

  assert.deepEqual(
    await harness.listModules(),
    [
      {
        moduleId: "echo",
        metadata: { tier: "test" },
        methodIds: ["echo"],
      },
    ],
  );

  const response = await harness.invoke({
    methodId: "echo",
    inputs: [
      {
        portId: "request",
        typeRef: {
          schemaName: "Blob.fbs",
          fileIdentifier: "BLOB",
        },
        payload: new TextEncoder().encode("hello runtime host"),
      },
    ],
  });
  assert.equal(response.statusCode, 0);
  assert.equal(response.outputs.length, 1);
  assert.equal(
    new TextDecoder().decode(response.outputs[0].payload),
    "runtime-host:hello runtime host",
  );

  const rowHandle = await harness.appendRow({
    schemaFileId: "OMM",
    payload: { norad: 25544, name: "ISS" },
  });
  assert.deepEqual(await harness.resolveRow(rowHandle), {
    handle: rowHandle,
    payload: { norad: 25544, name: "ISS" },
  });
  assert.deepEqual(await harness.listRows("OMM"), [
    {
      handle: rowHandle,
      payload: { norad: 25544, name: "ISS" },
    },
  ]);

  const region = await harness.allocateRegion({
    layoutId: "state-vector",
    recordByteLength: 4,
    alignment: 4,
    initialRecords: [Uint8Array.from([1, 2, 3, 4])],
  });
  assert.deepEqual(await harness.describeRegion(region.regionId), region);
  assert.deepEqual(
    await harness.resolveRecord({ regionId: region.regionId, recordIndex: 0 }),
    {
      regionId: region.regionId,
      recordIndex: 0,
      layoutId: "state-vector",
      recordByteLength: 4,
      alignment: 4,
      byteLength: 4,
      bytes: Uint8Array.from([1, 2, 3, 4]),
    },
  );

  assert.equal(await harness.unloadModule("echo"), true);
  assert.deepEqual(await harness.listModules(), []);
});

test("threaded WasmEdge runtime-host keeps installed module instances resident across invokes", async (t) => {
  if (!(await threadedRunnerAvailable())) {
    t.skip("Set WASMEDGE_RUNNER_BINARY to verify runtime-host runner mode.");
    return;
  }

  const compilation = await buildRuntimeHostCountingModule();
  t.after(async () => {
    await cleanupCompilation(compilation);
  });

  const harness = await createModuleHarness({
    runtime: {
      kind: "wasmedge",
      hostProfile: "runtime-host",
      wasmEdgeRunnerBinary: process.env.WASMEDGE_RUNNER_BINARY,
      modules: [
        {
          moduleId: "counter",
          wasmPath: compilation.outputPath,
          metadata: { tier: "resident" },
          methodIds: ["echo"],
        },
      ],
      defaultModuleId: "counter",
    },
  });
  t.after(async () => {
    await harness.destroy();
  });

  const invokeCounter = async (text) => {
    const response = await harness.invoke({
      methodId: "echo",
      inputs: [
        {
          portId: "request",
          typeRef: {
            schemaName: "Blob.fbs",
            fileIdentifier: "BLOB",
          },
          payload: new TextEncoder().encode(text),
        },
      ],
    });
    assert.equal(response.statusCode, 0);
    return new TextDecoder().decode(response.outputs[0].payload);
  };

  assert.equal(await invokeCounter("state"), "1:state");
  assert.equal(await invokeCounter("state"), "2:state");
});
