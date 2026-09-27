import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { compileModuleFromSource, cleanupCompilation } from "../src/compiler/compileModule.js";
import { encodePluginInvokeRequest, decodePluginInvokeResponse } from "../src/invoke/index.js";
import { createBrowserModuleHarness } from "../src/host/browserModuleHarness.js";
import { createBrowserWasiShim, createSharedWasiProcess } from "../src/host/wasiShim.js";
import { createStandaloneHarness } from "../src/testing/isomorphicHarness.js";
import { resolveWasmEdgeWasiThreadsRunner } from "../src/testing/buildWasmEdgeRunner.js";
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
#include <stdio.h>
#include "space_data_module_invoke.h"
static _Atomic int finished;
static void *work(void *arg) {
  (void)arg;
  if (getenv("SDM_WORKER_TRAP")) __builtin_trap();
  if (!getenv("SDM_PARITY_THREADS")) return NULL;
  fputs("worker ran\\n", stderr);
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
  assert.match(decodePluginInvokeResponse(harness.wasi.stdout).errorMessage, /request bytes are empty/i);
  assert.deepEqual(await harness.invokeRaw(request), first, "failure does not poison next invocation");
  const secondPayload = new Uint8Array(16385).map((_, i) => (i * 13) % 256);
  const secondRequest = encodePluginInvokeRequest({ methodId: "echo", inputs: [
    { portId: "request", typeRef: identity, payload: secondPayload },
  ] });
  assert.deepEqual(decodePluginInvokeResponse(await harness.invokeRaw(secondRequest)).outputs[0].payload, secondPayload);
  assert.equal(harness.threadHost.spawnCount(), 2);
  assert.equal(harness.threadHost.activeThreadCount(), 0);
  assert.equal(new TextDecoder().decode(harness.wasi.stderr), "worker ran\nworker ran\n");
  const direct = await createBrowserModuleHarness({ wasmSource: compilation.wasmBytes, surface: "direct", env: { SDM_PARITY_THREADS: "2" } });
  t.after(() => direct.destroy());
  assert.deepEqual(await direct.invokeRaw(request), first, "direct and command surfaces agree");
  const plan = { name: "threaded-command", threadEnvVar: "SDM_PARITY_THREADS", cases: [
    { id: "echo", stdinBytes: request, args: [], env: {}, threadCounts: [1, 2, 4, 8], expect: "ok" },
    { id: "empty", stdinBytes: new Uint8Array(), args: [], env: {}, threadCounts: [1], expect: "guest-error" },
  ] };
  if (process.env.SPACE_DATA_MODULE_SDK_ENABLE_WASMEDGE_PARITY === "1") {
    const runs = await runNativeWasmEdgeLane({
      wasmPath, wasmBytes: compilation.wasmBytes, plan, pin: loadWasmEdgePin(), timeoutMs: 15000,
    });
    for (const run of runs.filter((r) => r.caseId === "echo")) {
      assert.equal(run.exitClass, "ok", run.exitDetail);
      assert.deepEqual(run.stdout, first);
      assert.equal(run.spawnCount, run.threadCount);
    }
    assert.equal(runs.at(-1).exitClass, "guest-error");
    assert.match(new TextDecoder().decode(runs[0].stderr), /worker ran/);
    const trapped = await runNativeWasmEdgeLane({
      wasmPath, wasmBytes: compilation.wasmBytes, pin: loadWasmEdgePin(), timeoutMs: 5000,
      plan: { ...plan, cases: [{ ...plan.cases[0], env: { SDM_WORKER_TRAP: "1" }, threadCounts: [1] }] },
    });
    assert.equal(trapped[0].exitClass, "trap", "a worker trap cancels blocked pthread_join");
    for (const wasmEdgeRunnerBinary of [undefined, await resolveWasmEdgeWasiThreadsRunner()]) {
      const native = await createStandaloneHarness("wasmedge", wasmPath, {
        wasmEdgeRunnerBinary, env: { SDM_PARITY_THREADS: "2" },
      });
      try { assert.deepEqual(await native.invokeRaw(request), first); }
      finally { await native.destroy(); }
    }
  }
  if (process.env.SPACE_DATA_MODULE_SDK_ENABLE_TRI_RUNTIME_PARITY === "1") {
    const fixturePath = path.join(dir, "parity.json");
    await writeFile(fixturePath, JSON.stringify({ name: plan.name, threadEnvVar: plan.threadEnvVar,
      cases: plan.cases.map(({ stdinBytes, ...entry }) => ({ ...entry, stdinBase64: Buffer.from(stdinBytes).toString("base64") })),
    }));
    const { stdout } = await promisify(execFile)(process.execPath, [
      "bin/space-data-module.js", "parity", "--wasm", wasmPath, "--fixture", fixturePath,
      "--lanes", "browser,wasmedge,docker-wasmedge", "--json", "--timeout-sec", "60",
    ], { timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
    const report = JSON.parse(stdout);
    assert.equal(report.ok, true, formatParityReport(report));
    const digest = createHash("sha256").update(first).digest("hex");
    for (const run of report.runs.filter((r) => r.caseId === "echo")) {
      assert.equal(run.exitClass, "ok");
      assert.equal(run.stdoutSha256, digest);
      assert.equal(run.spawnCount, run.threadCount, `${run.lane} must actually spawn`);
    }
    const directReport = await runParityHarness({ wasmPath, plan: { ...plan, cases: [plan.cases[0]] }, browserSurface: "direct", timeoutMs: 60000 });
    assert.equal(directReport.ok, true, formatParityReport(directReport));
    for (const run of directReport.runs) {
      assert.equal(run.stdoutSha256, digest);
      assert.equal(run.spawnCount, run.threadCount);
    }
    if (process.env.SDM_THREAD_TEST_ARTIFACT_DIR) {
      await writeFile(path.join(process.env.SDM_THREAD_TEST_ARTIFACT_DIR, "parity.json"), await readFile(fixturePath));
      await writeFile(path.join(process.env.SDM_THREAD_TEST_ARTIFACT_DIR, "command-report.json"), JSON.stringify(report, null, 2));
      await writeFile(path.join(process.env.SDM_THREAD_TEST_ARTIFACT_DIR, "direct-report.json"), JSON.stringify(directReport, null, 2));
    }
  }
});

test("WASI process descriptors share input cursor, output, args and env across instances", () => {
  const processState = createSharedWasiProcess({ stdinBytes: Uint8Array.of(10, 20, 30, 40, 50), args: ["module.wasm"], env: { KEY: "value" }, maxOutputBytes: 8 });
  const reader = () => {
    const shim = createBrowserWasiShim({ processState });
    const memory = new WebAssembly.Memory({ initial: 1 });
    shim.setMemory(memory);
    const view = new DataView(memory.buffer);
    view.setUint32(0, 100, true); view.setUint32(4, 0, true);
    view.setUint32(8, 100, true); view.setUint32(12, 3, true);
    return { shim, view, bytes: new Uint8Array(memory.buffer), wasi: shim.imports.wasi_snapshot_preview1 };
  };
  const a = reader(), b = reader();
  assert.equal(a.wasi.fd_read(0, 0, 2, 16), 0);
  assert.deepEqual(a.bytes.slice(100, 103), Uint8Array.of(10, 20, 30));
  assert.equal(b.wasi.fd_read(0, 8, 1, 16), 0);
  assert.equal(b.view.getUint32(16, true), 2);
  assert.deepEqual(b.bytes.slice(100, 102), Uint8Array.of(40, 50));
  assert.equal(a.wasi.fd_read(0, 8, 1, 16), 0);
  assert.equal(a.view.getUint32(16, true), 0);
  assert.equal(a.wasi.fd_read(3, 8, 1, 16), 8);
  assert.equal(a.wasi.fd_write(1, 8, 1, 16), 0);
  assert.equal(b.wasi.fd_write(2, 8, 1, 16), 0);
  assert.deepEqual(b.shim.stdout, Uint8Array.of(10, 20, 30));
  assert.deepEqual(a.shim.stderr, Uint8Array.of(40, 50, 0));
  assert.equal(a.wasi.args_sizes_get(20, 24), 0);
  assert.equal(a.view.getUint32(20, true), 1);
  assert.equal(b.wasi.environ_sizes_get(20, 24), 0);
  assert.equal(b.view.getUint32(24, true), 10);
});
