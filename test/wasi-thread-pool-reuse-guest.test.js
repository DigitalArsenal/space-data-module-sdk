// A real wasi-threads guest that spawns waves of threads in ONE invoke
// (test/support/threadWaveGuest.mjs): waves of poolSize - 1 with the main
// thread running a stripe, waves of poolSize with the main thread only
// joining, and waves whose threads are spawned by a guest thread that is not
// the main thread. Before 0.8.25 a browser pool (and a Node explicit pool)
// served at most poolSize spawns per invoke, a Node pool without a size
// started a worker per spawn, and a spawn from a guest thread always failed.
//
// Node runs in every suite. The headless-Chromium run and the tri-runtime
// parity run are env-gated like the repo's other external-runtime suites:
//   SPACE_DATA_MODULE_SDK_ENABLE_BROWSER_THREADS=1   headless Chromium, Firefox
//     and WebKit through Playwright (npx playwright-core install chromium
//     firefox webkit; SPACE_DATA_MODULE_SDK_BROWSERS=chromium narrows the set)
//   SPACE_DATA_MODULE_SDK_ENABLE_TRI_RUNTIME_PARITY=1  browser, native WasmEdge
//     and Docker WasmEdge through the parity harness
// Inside a gate a lane that cannot run FAILS; it never skips.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { cleanupCompilation } from "../src/compiler/compileModule.js";
import { createBrowserModuleHarness } from "../src/host/browserModuleHarness.js";
import {
  compileThreadWaveGuest,
  threadWaveEnv,
  threadWaveRequest,
  threadWaveSpawns,
  threadWaveToolchainAvailable,
  THREAD_WAVE_ENV,
  THREAD_WAVE_MODE_ENV,
} from "./support/threadWaveGuest.mjs";

const TOOLCHAIN = threadWaveToolchainAvailable();
const BROWSER_ENABLED = process.env.SPACE_DATA_MODULE_SDK_ENABLE_BROWSER_THREADS === "1";
const BROWSERS = (process.env.SPACE_DATA_MODULE_SDK_BROWSERS ?? "chromium,firefox,webkit")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const PARITY_ENABLED = process.env.SPACE_DATA_MODULE_SDK_ENABLE_TRI_RUNTIME_PARITY === "1";
const LANES = [1, 2, 4, 8];
// "" = waves of poolSize - 1, "all" = waves of poolSize, "nested" = a guest
// thread spawns the rest of each wave.
const MODES = ["", "all", "nested"];
const modeLabel = (mode) => ({ "": "poolSize - 1", all: "poolSize", nested: "nested" })[mode];
// The guest's 8-byte checksum of its 840-cell grid after 3 waves. It does not
// depend on how many threads computed it; the browser, native WasmEdge and
// Docker WasmEdge lanes produced these same bytes.
const EXPECTED_OUTPUT_HEX = "ecbe247c0e7e1dec";

const toHex = (bytes) => Buffer.from(bytes).toString("hex");

let compilation = null;
async function guest() {
  compilation ??= await compileThreadWaveGuest();
  return compilation;
}
test.after(async () => {
  if (compilation) await cleanupCompilation(compilation);
});

async function invokeInNode({ env, poolSize, spawnWaitMs }) {
  const { wasmBytes } = await guest();
  const harness = await createBrowserModuleHarness({
    wasmSource: wasmBytes,
    surface: "direct",
    env,
    wasiThreadPoolSize: poolSize,
    wasiThreadSpawnWaitMs: spawnWaitMs,
  });
  try {
    const response = await harness.invoke(threadWaveRequest());
    return {
      response,
      report: harness.threadHost.spawnReport(),
      workers: harness.threadHost.distinctOsThreadCount(),
    };
  } finally {
    await harness.destroy();
  }
}

test("Node, explicit pool: one invoke runs waves of poolSize - 1, of poolSize, and nested waves", {
  skip: !TOOLCHAIN && "wasi-threads toolchain unavailable",
}, async () => {
  for (const mode of MODES) {
    for (const lanes of LANES) {
      const label = `${modeLabel(mode)}, poolSize ${lanes}`;
      const { response, report, workers } = await invokeInNode({
        env: threadWaveEnv(lanes, { mode }),
        poolSize: lanes,
      });
      assert.equal(response.statusCode, 0, `${label}: ${response.errorMessage}`);
      assert.equal(toHex(response.outputs[0].payload), EXPECTED_OUTPUT_HEX, label);
      assert.equal(report.poolSize, lanes);
      assert.equal(report.spawned, threadWaveSpawns(lanes, { mode }), label);
      assert.equal(report.declined, 0, label);
      assert.ok(workers <= lanes, `${label}: ${workers} workers`);
    }
  }
});

test("Node, no pool: the same waves, on workers that are reused", {
  skip: !TOOLCHAIN && "wasi-threads toolchain unavailable",
}, async () => {
  for (const mode of MODES) {
    const { response, report } = await invokeInNode({ env: threadWaveEnv(8, { mode }) });
    assert.equal(response.statusCode, 0, response.errorMessage);
    assert.equal(toHex(response.outputs[0].payload), EXPECTED_OUTPUT_HEX);
    assert.equal(report.spawned, threadWaveSpawns(8, { mode }));
  }
});

test("Node: 14,000 threads in one invoke run on a handful of workers", {
  skip: !TOOLCHAIN && "wasi-threads toolchain unavailable",
  timeout: 300_000,
}, async () => {
  const waves = 2000;
  const rounds = 16;
  // The main thread alone computes the reference bytes.
  const reference = await invokeInNode({ env: threadWaveEnv(1, { waves, rounds }) });
  assert.equal(reference.response.statusCode, 0, reference.response.errorMessage);
  assert.equal(reference.report.spawned, 0);
  const expected = toHex(reference.response.outputs[0].payload);
  for (const [mode, poolSize] of [["", undefined], ["nested", 8]]) {
    const label = `${modeLabel(mode)}, ${poolSize ? `poolSize ${poolSize}` : "no pool"}`;
    const { response, report, workers } = await invokeInNode({
      env: threadWaveEnv(8, { mode, waves, rounds }),
      poolSize,
    });
    assert.equal(response.statusCode, 0, `${label}: ${response.errorMessage}`);
    assert.equal(toHex(response.outputs[0].payload), expected, label);
    assert.equal(report.spawned, threadWaveSpawns(8, { mode, waves }), label);
    assert.equal(report.declined, 0, label);
    // 7 threads run at once; a pool that can grow may start one or two more
    // while a joined thread's worker is still returning.
    assert.ok(workers <= 16, `${label}: ${report.spawned} threads ran on ${workers} workers`);
  }
});

test("Node, explicit pool: a pool still caps CONCURRENT threads", {
  skip: !TOOLCHAIN && "wasi-threads toolchain unavailable",
}, async () => {
  // 4 lanes spawn 3 threads at once; a pool of 2 declines the third (no wait:
  // the first two cannot have finished microseconds after they were spawned),
  // and the guest reports the declined spawn.
  const { response, report } = await invokeInNode({
    env: threadWaveEnv(4),
    poolSize: 2,
    spawnWaitMs: 0,
  });
  assert.equal(response.statusCode, 20, "declined in wave 0");
  assert.equal(response.errorCode, "thread-spawn-declined");
  assert.equal(report.spawned, 2);
  assert.equal(report.declinedByReason["pool-exhausted"], 1);
});

for (const browserName of BROWSERS) {
  test(`headless ${browserName}: one invoke runs waves of poolSize - 1, of poolSize, and nested waves`, {
    skip: (!BROWSER_ENABLED && "set SPACE_DATA_MODULE_SDK_ENABLE_BROWSER_THREADS=1") ||
      (!TOOLCHAIN && "wasi-threads toolchain unavailable"),
    timeout: 600_000,
  }, async () => {
    const launcher = (await import("playwright-core"))[browserName];
    assert.ok(launcher, `unknown browser ${browserName}`);
    const { startThreadWaveServer, runWaves } = await import("./support/threadWaveBrowser.mjs");
    const { wasmBytes } = await guest();
    const server = await startThreadWaveServer({ wasmBytes });
    const browser = await launcher.launch({ headless: true });
    try {
      const page = await browser.newPage();
      page.on("console", (message) => {
        if (message.type() === "error") console.log(`[${browserName}] ${message.text()}`);
      });
      await page.goto(server.url);
      // The implicit pool is min(hardwareConcurrency - 1, maxThreads).
      const hardwareConcurrency = await page.evaluate(() => navigator.hardwareConcurrency);
      const lanesHere = LANES.filter((lanes) => lanes <= hardwareConcurrency - 1);
      assert.ok(lanesHere.length >= 3, `hardwareConcurrency ${hardwareConcurrency} is too small`);
      for (const mode of MODES) {
        for (const lanes of lanesHere) {
          const label = `${modeLabel(mode)}, maxThreads ${lanes}`;
          // Two invokes on one harness: the pool is whole after the first.
          const result = await runWaves(page, {
            lanes,
            env: threadWaveEnv(lanes, { mode }),
            invokes: 2,
            request: threadWaveRequest(),
          });
          assert.equal(result.ok, true, `${label}: ${result.error}`);
          assert.equal(result.crossOriginIsolated, true);
          assert.equal(result.poolWorkers, lanes, `${label}: pool size`);
          for (const run of result.runs) {
            assert.equal(run.statusCode, 0, `${label}: ${run.errorMessage}`);
            assert.deepEqual(run.outputs, [EXPECTED_OUTPUT_HEX], label);
          }
          assert.equal(result.report.spawned, 2 * threadWaveSpawns(lanes, { mode }), label);
          assert.equal(result.report.declined, 0, label);
          assert.equal(result.report.active, 0, `${label}: every thread released`);
        }
      }
    } finally {
      await browser.close();
      await server.close();
    }
  });
}

test("tri-runtime parity: browser, native WasmEdge and Docker WasmEdge run the same waves", {
  skip: (!PARITY_ENABLED && "set SPACE_DATA_MODULE_SDK_ENABLE_TRI_RUNTIME_PARITY=1") ||
    (!TOOLCHAIN && "wasi-threads toolchain unavailable"),
  timeout: 900_000,
}, async (t) => {
  const { normalizeParityFixture, runParityHarness, formatParityReport } = await import(
    "../src/testing/parityHarness.js"
  );
  const { wasmBytes } = await guest();
  const dir = await mkdtemp(path.join(os.tmpdir(), "sdm-thread-waves-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const wasmPath = path.join(dir, "module.wasm");
  await writeFile(wasmPath, wasmBytes);
  const request = threadWaveRequest();
  const fixtureRequest = {
    methodId: request.methodId,
    inputs: request.inputs.map((input) => ({
      portId: input.portId,
      typeRef: input.typeRef,
      payloadHex: toHex(input.payload),
    })),
  };
  const caseIds = { "": "pool-minus-one", all: "full-pool", nested: "nested" };
  const plan = await normalizeParityFixture({
    name: "thread-waves",
    threadEnvVar: THREAD_WAVE_ENV,
    threadCounts: LANES,
    cases: MODES.map((mode) => ({
      id: caseIds[mode],
      ...(mode ? { env: { [THREAD_WAVE_MODE_ENV]: mode } } : {}),
      request: fixtureRequest,
      expect: "ok",
    })),
  });
  const report = await runParityHarness({
    wasmPath,
    plan,
    log: (line) => console.error(line),
    timeoutMs: 300_000,
  });
  if (!report.ok) console.error(formatParityReport(report));
  assert.equal(report.ok, true, "tri-runtime parity must hold");
  assert.deepEqual(report.lanes.map((lane) => lane.lane), ["browser", "wasmedge", "docker-wasmedge"]);
  const modeOf = Object.fromEntries(Object.entries(caseIds).map(([mode, id]) => [id, mode]));
  for (const run of report.runs) {
    assert.equal(run.exitClass, "ok");
    assert.equal(
      run.spawnCount,
      threadWaveSpawns(run.threadCount, { mode: modeOf[run.caseId] }),
      `${run.lane} ${run.caseId} t${run.threadCount}: every lane spawns every thread`,
    );
  }
});
