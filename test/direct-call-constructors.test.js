import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileModuleFromSource, cleanupCompilation } from "../src/compiler/compileModule.js";
import { resolveWasiThreadsToolchain } from "../src/compiler/wasiThreadsToolchain.js";
import { encodePluginInvokeRequest, decodePluginInvokeResponse } from "../src/invoke/index.js";
import { createBrowserModuleHarness } from "../src/host/browserModuleHarness.js";
import { createStandaloneHarness } from "../src/testing/isomorphicHarness.js";
import { formatParityReport, runParityHarness } from "../src/testing/parityHarness.js";
import { resolveWasmEdgeBinary } from "../src/testing/parityLanes.js";

// A module built with BOTH the direct and the command surface links the wasi
// command crt: its constructors run inside _start, which then runs main. A host
// serving the direct surface must run the constructors (and, with the threads
// libc, the main-thread descriptor setup) exactly once without entering main.

const wasiThreadsAvailable = (() => {
  try {
    resolveWasiThreadsToolchain();
    return true;
  } catch {
    return false;
  }
})();

const MAGIC = 0x5eed;
const WASI_ERRNO_BUSY = 10;
const identity = { schemaName: "CAT.fbs", fileIdentifier: "$CAT", rootTypeName: "CAT" };
const port = (portId) => ({
  portId, required: true, minStreams: 1, maxStreams: 1,
  acceptedTypeSets: [{ setId: "catalog", allowedTypes: [{ ...identity, wireFormat: "flatbuffer" }] }],
});
const request = encodePluginInvokeRequest({
  methodId: "report", inputs: [{ portId: "request", typeRef: identity, payload: new Uint8Array(8) }],
});

// g_counts is zero-filled until its constructor runs; a zero-filled
// unordered_map traps on its first insert. g_ctor_runs is constant-initialized,
// so it counts constructor runs whatever the host does.
const globalState = `#include <cstdint>
#include <string>
#include <unordered_map>
#include "space_data_module_invoke.h"
static int g_ctor_runs = 0;
static std::unordered_map<std::string, uint32_t> g_counts;
struct Registration {
  uint32_t magic;
  Registration() : magic(0x5eedu) { g_ctor_runs += 1; g_counts["ctor"] = 1; }
};
static Registration g_registration;
`;

// The worker's trylock on a recursive mutex the main thread holds returns
// EBUSY only when the main thread has its pthread descriptor (its TID).
const threadedSource = `#include <pthread.h>
${globalState}
static pthread_mutex_t g_held;
static void *try_held(void *) {
  const int rc = pthread_mutex_trylock(&g_held);
  if (rc == 0) pthread_mutex_unlock(&g_held);
  return reinterpret_cast<void *>(static_cast<intptr_t>(rc));
}
extern "C" int report(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) return 3;
  pthread_mutexattr_t attr;
  pthread_mutexattr_init(&attr);
  pthread_mutexattr_settype(&attr, PTHREAD_MUTEX_RECURSIVE);
  pthread_mutex_init(&g_held, &attr);
  pthread_mutex_lock(&g_held);
  pthread_t worker;
  void *worker_rc = nullptr;
  if (pthread_create(&worker, nullptr, try_held, nullptr) != 0) return 5;
  pthread_join(worker, &worker_rc);
  pthread_mutex_unlock(&g_held);
  pthread_mutex_destroy(&g_held);
  const uint32_t calls = ++g_counts["calls"];
  const uint32_t out[5] = {
    g_registration.magic, static_cast<uint32_t>(g_ctor_runs), calls,
    static_cast<uint32_t>(g_counts.size()),
    static_cast<uint32_t>(reinterpret_cast<intptr_t>(worker_rc)),
  };
  plugin_push_output("response", frame->schema_name, frame->file_identifier,
                     reinterpret_cast<const uint8_t *>(out), sizeof out);
  return 0;
}`;

const sequentialSource = `${globalState}
extern "C" int report(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) return 3;
  const uint32_t calls = ++g_counts["calls"];
  const uint32_t out[4] = {
    g_registration.magic, static_cast<uint32_t>(g_ctor_runs), calls,
    static_cast<uint32_t>(g_counts.size()),
  };
  plugin_push_output("response", frame->schema_name, frame->file_identifier,
                     reinterpret_cast<const uint8_t *>(out), sizeof out);
  return 0;
}`;

function manifest(threaded) {
  return {
    pluginId: "com.digitalarsenal.test.direct-constructors", name: "Direct constructors",
    version: "0.1.0", pluginFamily: "analysis",
    runtimeTargets: ["browser", "wasmedge"], invokeSurfaces: ["direct", "command"],
    ...(threaded ? {} : {
      sequentialJustification: { kind: "pure-transform", detail: "Constructor fixture: one call, no concurrency." },
    }),
    methods: [{ methodId: "report", displayName: "Report", inputPorts: [port("request")],
      outputPorts: [port("response")], maxBatch: 1, drainPolicy: "single-shot" }],
  };
}

function words(responseBytes) {
  const response = decodePluginInvokeResponse(responseBytes);
  assert.equal(response.statusCode, 0, response.errorMessage ?? "");
  const payload = response.outputs[0].payload;
  return Array.from(new Uint32Array(payload.slice().buffer));
}

async function compileFixture(t, threaded) {
  const compilation = await compileModuleFromSource({
    language: "c++",
    sourceCode: threaded ? threadedSource : sequentialSource,
    threadModel: threaded ? "emscripten-pthreads" : "wasi-sequential",
    manifest: manifest(threaded),
  });
  t.after(() => cleanupCompilation(compilation));
  const dir = await mkdtemp(path.join(os.tmpdir(), "sdm-direct-ctors-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const wasmPath = path.join(dir, "module.wasm");
  await writeFile(wasmPath, compilation.wasmBytes);
  const exports = WebAssembly.Module.exports(new WebAssembly.Module(compilation.wasmBytes)).map((e) => e.name);
  assert.ok(exports.includes("_start"), "command entry");
  assert.ok(exports.includes("plugin_invoke_stream"), "direct entry");
  assert.ok(exports.includes("__wasm_call_ctors"), "constructor entry for direct hosts");
  assert.ok(!exports.includes("_initialize"), "a command artifact is not a reactor");
  return { compilation, wasmPath };
}

async function assertBrowserSurfaces(t, wasmBytes, expected) {
  const direct = await createBrowserModuleHarness({ wasmSource: wasmBytes, surface: "direct" });
  t.after(() => direct.destroy());
  assert.equal(direct.wasi.stdout.length, 0, "initializing the direct surface must not run main");
  const first = await direct.invokeRaw(request);
  assert.deepEqual(words(first), expected(1));
  direct.instance.exports.__wasm_call_ctors();
  assert.deepEqual(words(await direct.invokeRaw(request)), expected(2), "constructors ran once; state persists");

  const command = await createBrowserModuleHarness({ wasmSource: wasmBytes, surface: "command" });
  t.after(() => command.destroy());
  assert.deepEqual(await command.invokeRaw(request), first, "a fresh command instance answers like the first direct call");
  assert.deepEqual(await command.invokeRaw(request), first);
  return first;
}

test("threaded command artifacts run constructors and main-thread setup once before the first direct call", {
  skip: !wasiThreadsAvailable && "wasi-threads toolchain unavailable",
}, async (t) => {
  const { compilation, wasmPath } = await compileFixture(t, true);
  const expected = (calls) => [MAGIC, 1, calls, 2, WASI_ERRNO_BUSY];
  const first = await assertBrowserSurfaces(t, compilation.wasmBytes, expected);

  if (process.env.SPACE_DATA_MODULE_SDK_ENABLE_WASMEDGE_PARITY === "1") {
    for (const surface of ["direct", "command"]) {
      const native = await createStandaloneHarness("wasmedge", wasmPath, { surface });
      try {
        assert.equal(native.runtime.surface, surface);
        assert.equal(native.launchPlan.args.includes("--sdm-direct"), surface === "direct");
        assert.deepEqual(await native.invokeRaw(request), first, `WasmEdge ${surface} surface`);
      } finally {
        await native.destroy();
      }
    }
  }
  if (process.env.SPACE_DATA_MODULE_SDK_ENABLE_TRI_RUNTIME_PARITY === "1") {
    const report = await runParityHarness({
      wasmPath, surface: "direct", timeoutMs: 60000,
      plan: { name: "direct-constructors", threadEnvVar: "SDM_PARITY_THREADS", cases: [
        { id: "report", stdinBytes: request, args: [], env: {}, threadCounts: [1], expect: "ok" },
      ] },
    });
    assert.equal(report.ok, true, formatParityReport(report));
    const digest = createHash("sha256").update(first).digest("hex");
    for (const run of report.runs) {
      assert.equal(run.stdoutSha256, digest, `${run.lane} direct surface`);
    }
  }
});

test("sequential command artifacts run constructors once before the first direct call", {
  skip: !wasiThreadsAvailable && "wasi-threads toolchain unavailable",
}, async (t) => {
  const { compilation, wasmPath } = await compileFixture(t, false);
  const first = await assertBrowserSurfaces(t, compilation.wasmBytes, (calls) => [MAGIC, 1, calls, 2]);
  if (process.env.SPACE_DATA_MODULE_SDK_ENABLE_WASMEDGE_PARITY === "1") {
    const native = await createStandaloneHarness("wasmedge", wasmPath, { wasmEdgeBinary: await resolveWasmEdgeBinary(), enableThreads: true });
    try {
      assert.equal(native.runtime.surface, "command");
      assert.deepEqual(await native.invokeRaw(request), first);
    } finally {
      await native.destroy();
    }
  }
});
