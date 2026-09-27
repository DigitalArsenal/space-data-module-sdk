import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { compileModuleFromSource, cleanupCompilation } from "../src/compiler/compileModule.js";
import { encodePluginInvokeRequest, decodePluginInvokeResponse } from "../src/invoke/index.js";
import { createBrowserModuleHarness } from "../src/host/browserModuleHarness.js";
import { runNativeWasmEdgeLane } from "../src/testing/parityLanes.js";
import { loadWasmEdgePin, runParityHarness, formatParityReport } from "../src/testing/parityHarness.js";

const identity = { schemaName: "CAT.fbs", fileIdentifier: "$CAT", rootTypeName: "CAT" };
const port = (portId) => ({
  portId, required: true, minStreams: 1, maxStreams: 1,
  acceptedTypeSets: [{ setId: "catalog", allowedTypes: [
    { ...identity, wireFormat: "flatbuffer" },
    { ...identity, wireFormat: "aligned-binary", byteLength: 64, requiredAlignment: 8 },
  ] }],
});
const source = `#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>
#include "space_data_module_invoke.h"
static _Atomic int finished;
static void *work(void *arg) {
  (void)arg;
  atomic_fetch_add(&finished, 1);
  return NULL;
}
int echo(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) return 3;
  const char *setting = getenv("SDM_PARITY_THREADS");
  int n = setting ? atoi(setting) : 2;
  if (n < 1 || n > 8) return 4;
  pthread_t workers[8];
  atomic_store(&finished, 0);
  for (int i = 0; i < n; ++i) {
    if (pthread_create(&workers[i], NULL, work, NULL) != 0) return 5;
  }
  for (int i = 0; i < n; ++i) pthread_join(workers[i], NULL);
  if (atomic_load(&finished) != n) return 6;
  plugin_push_output("response", frame->schema_name, frame->file_identifier,
                     frame->payload, frame->payload_length);
  return 0;
}`;
const payload = new Uint8Array([0, 255, 13, 10, 0, 128, 42, 7]);
const request = encodePluginInvokeRequest({
  methodId: "echo", inputs: [{ portId: "request", typeRef: identity, payload }],
});

test("SDK pthread command delivers real stdin once, joins workers, and matches native WasmEdge", async (t) => {
  const compilation = await compileModuleFromSource({
    language: "c", sourceCode: source, threadModel: "emscripten-pthreads",
    manifest: {
      pluginId: "com.digitalarsenal.test.threaded-command", name: "Threaded command",
      version: "0.1.0", pluginFamily: "analysis",
      runtimeTargets: ["browser", "wasmedge"], invokeSurfaces: ["direct", "command"],
      methods: [{ methodId: "echo", displayName: "Echo", inputPorts: [port("request")],
        outputPorts: [port("response")], maxBatch: 1, drainPolicy: "single-shot" }],
    },
  });
  t.after(() => cleanupCompilation(compilation));
  assert.equal(compilation.threadFeatures.hasWasiThreadSpawnImport, true);
  const dir = await mkdtemp(path.join(os.tmpdir(), "sdm-thread-command-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const wasmPath = path.join(dir, "module.wasm");
  await writeFile(wasmPath, compilation.wasmBytes);
  if (process.env.SDM_THREAD_TEST_ARTIFACT_DIR) {
    await writeFile(path.join(process.env.SDM_THREAD_TEST_ARTIFACT_DIR, "module.wasm"), compilation.wasmBytes);
    await writeFile(path.join(process.env.SDM_THREAD_TEST_ARTIFACT_DIR, "request.bin"), request);
  }
  const harness = await createBrowserModuleHarness({
    wasmSource: compilation.wasmBytes, surface: "command", env: { SDM_PARITY_THREADS: "2" },
  });
  t.after(() => harness.destroy());
  assert.equal(harness.wasi.stdout.length, 0, "creation must not execute main");
  const first = await harness.invokeRaw(request);
  assert.deepEqual(decodePluginInvokeResponse(first).outputs[0].payload, payload);
  assert.deepEqual(await harness.invokeRaw(request), first, "fresh CRT per invocation");
  await assert.rejects(harness.invokeRaw(new Uint8Array()), { name: "WasiExitError", code: 1 });
  assert.match(new TextDecoder().decode(harness.wasi.stderr), /request bytes are empty/i);
  assert.deepEqual(await harness.invokeRaw(request), first, "failure does not poison next invocation");
  const direct = await createBrowserModuleHarness({ wasmSource: compilation.wasmBytes, surface: "direct" });
  t.after(() => direct.destroy());
  assert.deepEqual(await direct.invokeRaw(request), first, "direct and command surfaces agree");
  const plan = { name: "threaded-command", threadEnvVar: "SDM_PARITY_THREADS", cases: [
    { id: "echo", stdinBytes: request, args: [], env: {}, threadCounts: [1, 2, 4] },
    { id: "empty", stdinBytes: new Uint8Array(), args: [], env: {}, threadCounts: [1] },
  ] };
  if (process.env.SPACE_DATA_MODULE_SDK_ENABLE_WASMEDGE_PARITY === "1") {
    const runs = await runNativeWasmEdgeLane({
      wasmPath, wasmBytes: compilation.wasmBytes, plan, pin: loadWasmEdgePin(), timeoutMs: 15000,
    });
    for (const run of runs.filter((r) => r.caseId === "echo")) {
      assert.equal(run.exitClass, "ok", run.exitDetail);
      assert.deepEqual(run.stdout, first);
    }
    assert.equal(runs.at(-1).exitClass, "guest-error");
  }
  if (process.env.SPACE_DATA_MODULE_SDK_ENABLE_TRI_RUNTIME_PARITY === "1") {
    const report = await runParityHarness({ wasmPath, plan, timeoutMs: 60000 });
    assert.equal(report.ok, true, formatParityReport(report));
  }
});
