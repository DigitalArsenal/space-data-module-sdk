// T9 (FlatSQL partition store §5.5, §18 T9 #3, A36): an EXPLICIT pool size in
// createWasiThreadSpawn, partial-spawn reporting, and guest-error hooks.
//
// Browser branch: exercised with a mock Worker exactly like
// wasi-thread-host-browser-pool.test.js (process.release is masked before the
// import so the host takes its browser branch). The real-browser run of the
// same acceptance is in opfs-io-worker.browser.test.js.

import test from "node:test";
import assert from "node:assert/strict";

const originalRelease = Object.getOwnPropertyDescriptor(process, "release");
Object.defineProperty(process, "release", {
  value: { name: "browser-pool-size-test" },
  configurable: true,
});
const { createWasiThreadSpawn } = await import("../src/host/wasiThreadHost.js");
if (originalRelease) {
  Object.defineProperty(process, "release", originalRelease);
}

class MockWorker {
  constructor(url, options) {
    MockWorker.instances.push(this);
    this.url = String(url);
    this.options = options ?? null;
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    this.probes = [];
    this.behavior = MockWorker.behaviors.shift() ?? "ready";
  }

  postMessage(message) {
    if (this.terminated) return;
    if (message.t === "probe") {
      this.probes.push(message);
      if (this.behavior === "timeout") return;
      queueMicrotask(() => {
        if (this.terminated) return;
        if (this.behavior === "error-after-ready") {
          this.onmessage?.({ data: { t: "ready", ok: true } });
          return;
        }
        this.onmessage?.({ data: { t: "ready", ok: this.behavior !== "fail" } });
      });
      return;
    }
    if (message.t === "run") this.lastRunTid = message.tid;
    if (message.t === "run" && MockWorker.autoExit) {
      queueMicrotask(() => {
        if (this.terminated) return;
        this.onmessage?.({ data: { t: "exit", tid: message.tid } });
      });
    }
  }

  terminate() {
    this.terminated = true;
  }
}

const SHARED_MEMORY = { buffer: new SharedArrayBuffer(64) };
const WASM_MODULE = { __mockModule: true };

function installBrowserEnv({ hardwareConcurrency = 2, behaviors = [], autoExit = false } = {}) {
  MockWorker.instances = [];
  MockWorker.behaviors = behaviors.slice();
  MockWorker.autoExit = autoExit;
  globalThis.Worker = MockWorker;
  globalThis.__SDM_ENABLE_BROWSER_WASI_THREADS__ = true;
  globalThis.crossOriginIsolated = true;
  Object.defineProperty(globalThis, "navigator", {
    value: { hardwareConcurrency },
    configurable: true,
  });
}

test("poolSize=6 on hardwareConcurrency=2 pre-starts 6 workers; spawn 7 returns -1 and is reported", async () => {
  installBrowserEnv({ hardwareConcurrency: 2 });
  const declined = [];
  const host = await createWasiThreadSpawn({
    wasmModule: WASM_MODULE,
    memory: SHARED_MEMORY,
    poolSize: 6,
    onSpawnDeclined: (event) => declined.push(event),
  });
  assert.equal(MockWorker.instances.length, 6, "six workers, not hardwareConcurrency - 1 = 1");
  assert.equal(host.distinctOsThreadCount(), 6);
  const tids = [];
  for (let i = 0; i < 6; i += 1) tids.push(host.threadSpawn(i));
  assert.ok(tids.every((tid) => tid > 0), "six spawns succeed");
  assert.equal(new Set(tids).size, 6);
  assert.equal(host.threadSpawn(99), -1, "the seventh spawn is declined");
  assert.equal(declined.length, 1);
  assert.equal(declined[0].reason, "pool-exhausted");
  assert.equal(declined[0].poolSize, 6);
  const report = host.spawnReport();
  assert.equal(report.poolSize, 6);
  assert.equal(report.armed, 6);
  assert.equal(report.failedToArm, 0);
  assert.equal(report.spawned, 6);
  assert.equal(report.declined, 1);
  assert.equal(report.declinedByReason["pool-exhausted"], 1);
  assert.equal(report.active, 6);
  await host.terminateAll();
});

test("explicit pools arm partially: failed workers are dropped and reported, the rest serve", async () => {
  installBrowserEnv({
    hardwareConcurrency: 16,
    behaviors: ["ready", "fail", "ready", "timeout"],
  });
  const host = await createWasiThreadSpawn({
    wasmModule: WASM_MODULE,
    memory: SHARED_MEMORY,
    poolSize: 4,
    probeTimeoutMs: 50,
  });
  assert.equal(MockWorker.instances.length, 4);
  const report = host.spawnReport();
  assert.equal(report.armed, 2, "two workers armed");
  assert.equal(report.failedToArm, 2, "one not-ready and one timeout");
  assert.equal(MockWorker.instances.filter((w) => w.terminated).length, 2, "losers terminated");
  assert.ok(host.threadSpawn(1) > 0);
  assert.ok(host.threadSpawn(2) > 0);
  assert.equal(host.threadSpawn(3), -1, "only the armed workers serve");
  assert.equal(host.spawnReport().declinedByReason["pool-exhausted"], 1);
  await host.terminateAll();
});

test("an explicit pool with no armed worker declines every spawn with a reason", async () => {
  installBrowserEnv({ behaviors: ["fail", "fail"] });
  const declined = [];
  const host = await createWasiThreadSpawn({
    wasmModule: WASM_MODULE,
    memory: SHARED_MEMORY,
    poolSize: 2,
    onSpawnDeclined: (event) => declined.push(event.reason),
  });
  assert.equal(host.threadSpawn(1), -1);
  assert.deepEqual(declined, ["pool-not-armed"]);
  assert.equal(host.spawnReport().failedToArm, 2);
});

test("extraImports descriptors reach every worker's probe with its worker index", async () => {
  installBrowserEnv({ hardwareConcurrency: 4 });
  const channel = new SharedArrayBuffer(8);
  const host = await createWasiThreadSpawn({
    wasmModule: WASM_MODULE,
    memory: SHARED_MEMORY,
    poolSize: 3,
    extraImports: [{ provider: "flatsql-io", instanceId: 2, channels: [channel] }],
  });
  const probes = MockWorker.instances.map((worker) => worker.probes[0]);
  assert.deepEqual(
    probes.map((probe) => probe.workerIndex),
    [0, 1, 2],
  );
  for (const probe of probes) {
    assert.equal(probe.extraImports.length, 1);
    assert.equal(probe.extraImports[0].provider, "flatsql-io");
    assert.equal(probe.extraImports[0].channels[0], channel);
  }
  await host.terminateAll();
});

test("function extraImports are refused: they cannot cross into a worker", async () => {
  installBrowserEnv();
  await assert.rejects(
    createWasiThreadSpawn({
      wasmModule: WASM_MODULE,
      memory: SHARED_MEMORY,
      poolSize: 1,
      extraImports: [() => ({})],
    }),
    TypeError,
  );
});

test("onGuestError reports guest traps and dead workers with the instance id and tid (A36)", async () => {
  installBrowserEnv({ hardwareConcurrency: 4 });
  const errors = [];
  const host = await createWasiThreadSpawn({
    wasmModule: WASM_MODULE,
    memory: SHARED_MEMORY,
    poolSize: 2,
    instanceId: 7,
    onGuestError: (instanceId, tid, error) => errors.push({ instanceId, tid, error }),
  });
  const tid = host.threadSpawn(1);
  const worker = MockWorker.instances.find((candidate) => candidate.lastRunTid === tid);
  // A guest trap reported by the worker.
  worker.onmessage({ data: { t: "error", tid, error: "unreachable executed" } });
  assert.deepEqual(errors[0], { instanceId: 7, tid, error: "unreachable executed" });
  // The worker itself dies while running that thread: it leaves the pool.
  worker.onerror({ message: "worker crashed" });
  assert.equal(errors[1].instanceId, 7);
  assert.equal(errors[1].tid, tid);
  assert.equal(host.distinctOsThreadCount(), 1, "the dead worker left the pool");
  await host.terminateAll();
});

test("the classic worker type builds classic workers (blob bundles, A39)", async () => {
  installBrowserEnv({ hardwareConcurrency: 4 });
  const host = await createWasiThreadSpawn({
    wasmModule: WASM_MODULE,
    memory: SHARED_MEMORY,
    poolSize: 1,
    browserWorkerUrl: "blob:mock-bundle",
    browserWorkerType: "classic",
  });
  assert.equal(MockWorker.instances[0].url, "blob:mock-bundle");
  assert.equal(MockWorker.instances[0].options, null, "no { type: module }");
  await host.terminateAll();
});
