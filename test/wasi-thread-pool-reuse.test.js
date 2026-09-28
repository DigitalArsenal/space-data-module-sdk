// The wasi-threads pool protocol (src/host/wasiThreadPool.js): spawning,
// dispatching and recycling a thread through shared memory, with no event loop.
//
// A guest runs pthread_create ... pthread_join without yielding the spawning
// thread's event loop, for the whole invoke, and any guest thread may spawn.
// Before 0.8.25 a pooled browser worker was dispatched by message and returned
// to idle only through a {t:"exit"} message on that event loop, so one invoke
// could spawn at most poolSize threads in total and conjunction screening (a
// coarse wave, then a refine wave) aborted in its second wave.
//
// These tests drive the BROWSER branch of createWasiThreadSpawn with a mock
// Worker (process.release is masked before the import, as in
// wasi-thread-host-browser-pool.test.js). A mock that answers the probe with
// protocol 2 is a current worker: it never gets a message after the probe, and
// the test plays its part through the same pool functions the real worker
// runs (take the assignment, finish the run). No test yields to the event loop
// between spawns. The real guest runs in wasi-thread-pool-reuse-guest.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Worker as NodeWorker } from "node:worker_threads";

const originalRelease = Object.getOwnPropertyDescriptor(process, "release");
Object.defineProperty(process, "release", {
  value: { name: "browser-pool-reuse-test" },
  configurable: true,
});
const { createWasiThreadSpawn, DEFAULT_WASI_THREAD_SPAWN_WAIT_MS } = await import(
  "../src/host/wasiThreadHost.js"
);
if (originalRelease) {
  Object.defineProperty(process, "release", originalRelease);
}
const {
  WASI_THREAD_POOL_PROTOCOL,
  WASI_THREAD_POOL_SLOT,
  armWasiThreadPoolSlot,
  createWasiThreadPool,
  finishWasiThreadPoolRun,
  openWasiThreadPoolSlots,
  readWasiThreadPoolReport,
  retireWasiThreadPoolSlot,
  takeWasiThreadPoolAssignment,
  wasiThreadPoolSlotState,
} = await import("../src/host/wasiThreadPool.js");

class MockWorker {
  constructor() {
    MockWorker.instances.push(this);
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    this.pool = null;
    this.slot = null;
    this.running = null;
    this.runs = [];
    this.messages = [];
    this.protocol = MockWorker.protocols.shift() ?? WASI_THREAD_POOL_PROTOCOL;
  }

  postMessage(message) {
    if (this.terminated) return;
    this.messages.push(message.t);
    if (message.t === "probe") {
      this.pool = message.pool;
      this.slot = message.slot;
      const reply = { t: "ready", ok: true };
      if (this.protocol === WASI_THREAD_POOL_PROTOCOL) reply.protocol = this.protocol;
      queueMicrotask(() => this.onmessage?.({ data: reply }));
      return;
    }
    if (message.t === "run") {
      assert.notEqual(this.protocol, WASI_THREAD_POOL_PROTOCOL, "a current worker is never sent a thread");
      this.running = message.tid;
      this.runs.push(message.tid);
    }
  }

  /** A current worker picks up the thread assigned to its slot. */
  take() {
    const assignment = takeWasiThreadPoolAssignment(this.pool, this.slot);
    if (assignment) {
      this.running = assignment.tid;
      this.runs.push(assignment.tid);
    }
    return assignment;
  }

  /** The guest thread returned. */
  finish() {
    assert.notEqual(this.running, null);
    this.running = null;
    finishWasiThreadPoolRun(this.pool, this.slot);
  }

  state() {
    return wasiThreadPoolSlotState(this.pool, this.slot);
  }

  terminate() {
    this.terminated = true;
  }
}

const SHARED_MEMORY = { buffer: new SharedArrayBuffer(64) };
const WASM_MODULE = { __mockModule: true };

function installBrowserEnv({ hardwareConcurrency = 16, protocols = [] } = {}) {
  MockWorker.instances = [];
  MockWorker.protocols = protocols.slice();
  globalThis.Worker = MockWorker;
  globalThis.__SDM_ENABLE_BROWSER_WASI_THREADS__ = true;
  globalThis.crossOriginIsolated = true;
  Object.defineProperty(globalThis, "navigator", {
    value: { hardwareConcurrency },
    configurable: true,
  });
}

function host(options) {
  return createWasiThreadSpawn({ wasmModule: WASM_MODULE, memory: SHARED_MEMORY, ...options });
}

// Every worker takes whatever was assigned to it, as blocked real workers do.
const takeAll = () => MockWorker.instances.filter((worker) => worker.take());
const running = () => MockWorker.instances.filter((worker) => worker.running !== null);

function helper(workerData) {
  return new NodeWorker(new URL("./support/releasePoolSlotWorker.mjs", import.meta.url), { workerData });
}

test("one invoke spawns 3 waves of poolSize - 1 and of poolSize threads; no message, no event-loop turn", async () => {
  installBrowserEnv();
  const threads = await host({ requestedThreads: 4 });
  assert.equal(MockWorker.instances.length, 4);
  assert.deepEqual(MockWorker.instances.map((worker) => worker.slot), [0, 1, 2, 3]);
  assert.ok(
    MockWorker.instances.every((worker) => worker.pool.control.buffer === MockWorker.instances[0].pool.control.buffer),
    "one shared pool",
  );

  // Synchronous from here on, like a guest blocked in one invoke.
  for (const perWave of [3, 4]) {
    for (let wave = 0; wave < 3; wave += 1) {
      const tids = [];
      for (let spawn = 0; spawn < perWave; spawn += 1) tids.push(threads.threadSpawn(wave));
      assert.ok(tids.every((tid) => tid > 0), `wave ${wave} of ${perWave}: every spawn served`);
      assert.equal(takeAll().length, perWave, "each thread went to its own worker");
      assert.equal(threads.activeThreadCount(), perWave);
      for (const worker of running()) worker.finish();
      assert.equal(threads.activeThreadCount(), 0, "workers freed their slots themselves");
    }
  }
  const report = threads.spawnReport();
  assert.equal(report.spawned, 21);
  assert.equal(report.declined, 0);
  assert.equal(report.idle, 4);
  assert.ok(
    MockWorker.instances.every((worker) => worker.messages.join() === "probe"),
    "after the probe, no worker was sent a message",
  );
  await threads.terminateAll();
});

test("a spawn that finds every worker busy waits for a thread that finishes on another thread", async () => {
  installBrowserEnv();
  const threads = await host({ requestedThreads: 1, spawnWaitMs: 5000 });
  const [worker] = MockWorker.instances;
  const first = threads.threadSpawn(1);
  assert.ok(first > 0);
  worker.take();
  // Another OS thread finishes the first thread 100 ms from now; this thread
  // blocks in threadSpawn meanwhile, as the guest's spawning thread does.
  const finisher = helper({ op: "finish", pool: worker.pool, slot: worker.slot, delayMs: 100 });
  await once(finisher, "online");
  const started = performance.now();
  const second = threads.threadSpawn(2);
  const elapsed = performance.now() - started;
  worker.running = null;
  assert.ok(second > first, "the spawn was served by the freed worker");
  assert.ok(elapsed >= 20, `the spawn blocked until the thread finished (${elapsed.toFixed(1)} ms)`);
  assert.ok(elapsed < 5000, "and did not run out its wait");
  assert.equal(worker.state(), WASI_THREAD_POOL_SLOT.ASSIGNED);
  assert.equal(worker.take().tid, second);
  assert.equal(threads.spawnReport().waited, 1);
  await once(finisher, "exit");
  await threads.terminateAll();
});

test("a guest thread that is not the owner spawns through the pool", async () => {
  installBrowserEnv({ protocols: [WASI_THREAD_POOL_PROTOCOL, WASI_THREAD_POOL_PROTOCOL, WASI_THREAD_POOL_PROTOCOL, 1] });
  const threads = await host({ requestedThreads: 4, spawnWaitMs: 50 });
  const [coordinator] = MockWorker.instances;
  assert.ok(threads.threadSpawn(1) > 0);
  assert.equal(takeAll().length, 1);
  // The coordinator's guest thread spawns 3: two current workers are idle; the
  // fourth worker is an older script only the owner can send a thread to.
  const spawner = helper({ op: "spawn", pool: coordinator.pool, count: 3 });
  const [results] = await once(spawner, "message");
  assert.deepEqual(results.map((result) => result.tid > 0), [true, true, false]);
  assert.equal(results[2].reason, "pool-exhausted");
  assert.equal(takeAll().length, 2, "the spawned threads went to the idle current workers");
  assert.equal(MockWorker.instances[3].runs.length, 0);
  const report = threads.spawnReport();
  assert.equal(report.spawned, 3, "the owner's report counts spawns from every thread");
  assert.equal(report.declinedByReason["pool-exhausted"], 1);
  assert.equal(threads.activeThreadCount(), 3);
  await threads.terminateAll();
});

test("a pool that stays busy declines after spawnWaitMs, then at once until a thread finishes", async () => {
  installBrowserEnv();
  const declined = [];
  const threads = await host({
    requestedThreads: 1,
    spawnWaitMs: 80,
    onSpawnDeclined: (event) => declined.push(event.reason),
  });
  assert.ok(threads.threadSpawn(1) > 0);
  takeAll();

  let started = performance.now();
  assert.equal(threads.threadSpawn(2), -1);
  const firstWait = performance.now() - started;
  assert.ok(firstWait >= 75, `the first decline waited spawnWaitMs (${firstWait.toFixed(1)} ms)`);

  started = performance.now();
  assert.equal(threads.threadSpawn(3), -1);
  const secondWait = performance.now() - started;
  assert.ok(secondWait < 40, `no thread finished since, so no second wait (${secondWait.toFixed(1)} ms)`);

  MockWorker.instances[0].finish();
  assert.ok(threads.threadSpawn(4) > 0, "a finished thread's worker serves again");
  assert.deepEqual(declined, ["pool-exhausted", "pool-exhausted"]);
  assert.equal(threads.spawnReport().declined, 2);
  assert.equal(threads.spawnReport().waited, 0);
  await threads.terminateAll();
});

test("spawnWaitMs: 0 never waits; the default is 250 ms; bad values are refused", async () => {
  assert.equal(DEFAULT_WASI_THREAD_SPAWN_WAIT_MS, 250);
  installBrowserEnv();
  const threads = await host({ requestedThreads: 1, spawnWaitMs: 0 });
  assert.ok(threads.threadSpawn(1) > 0);
  const started = performance.now();
  assert.equal(threads.threadSpawn(2), -1);
  assert.ok(performance.now() - started < 40);
  await threads.terminateAll();
  for (const spawnWaitMs of [-1, Number.NaN, Infinity, "10"]) {
    await assert.rejects(host({ requestedThreads: 1, spawnWaitMs }), RangeError);
  }
});

test("an older worker script is sent its threads, and a late {t:\"exit\"} never frees a recycled worker", async () => {
  installBrowserEnv({ protocols: [1] });
  const threads = await host({ requestedThreads: 1, spawnWaitMs: 0 });
  const [worker] = MockWorker.instances;
  const first = threads.threadSpawn(1);
  assert.deepEqual(worker.runs, [first], "dispatched by message");
  worker.onmessage({ data: { t: "exit", tid: first } });
  const second = threads.threadSpawn(2);
  assert.ok(second > first);
  // A duplicate exit for the first thread arrives late.
  worker.onmessage({ data: { t: "exit", tid: first } });
  assert.equal(threads.activeThreadCount(), 1, "the second thread still owns the worker");
  assert.equal(threads.threadSpawn(3), -1);
  worker.onmessage({ data: { t: "exit", tid: second } });
  assert.equal(threads.activeThreadCount(), 0);
  assert.ok(threads.threadSpawn(4) > 0);
  await threads.terminateAll();
});

test("a worker that dies mid-thread is reported and never serves again; no wait on a dead pool", async () => {
  installBrowserEnv();
  const errors = [];
  const threads = await host({
    requestedThreads: 1,
    spawnWaitMs: 5000,
    instanceId: 3,
    onGuestError: (instanceId, tid, error) => errors.push({ instanceId, tid, error }),
  });
  const tid = threads.threadSpawn(1);
  MockWorker.instances[0].take();
  MockWorker.instances[0].onerror({ message: "worker crashed" });
  assert.deepEqual(errors, [{ instanceId: 3, tid, error: { message: "worker crashed" } }]);
  assert.equal(MockWorker.instances[0].state(), WASI_THREAD_POOL_SLOT.RETIRED);
  assert.equal(threads.distinctOsThreadCount(), 0);
  const started = performance.now();
  assert.equal(threads.threadSpawn(2), -1, "declined");
  assert.ok(performance.now() - started < 100, "at once: no worker can come free");
  await threads.terminateAll();
});

test("terminateAll retires every slot, which ends a blocked worker's loop", async () => {
  installBrowserEnv();
  const threads = await host({ requestedThreads: 2 });
  await threads.terminateAll();
  assert.ok(MockWorker.instances.every((worker) => worker.state() === WASI_THREAD_POOL_SLOT.RETIRED));
  assert.equal(threads.threadSpawn(1), -1);
});

test("three threads spawning at once through a 4-worker pool: every thread runs exactly once", async () => {
  const SPAWNERS = 3;
  const PER_SPAWNER = 200;
  const pool = createWasiThreadPool({ capacity: 4, spawnWaitMs: 10_000 });
  openWasiThreadPoolSlots(pool, 4);
  for (let slot = 0; slot < 4; slot += 1) armWasiThreadPoolSlot(pool, slot);
  // runs[0] sums the start arguments; runs[tid] counts how often tid ran.
  const runs = new Int32Array(new SharedArrayBuffer(4 * (SPAWNERS * PER_SPAWNER + 1)));
  const servers = [0, 1, 2, 3].map((slot) => helper({ op: "serve", pool, slot, runs }));
  const spawners = Array.from({ length: SPAWNERS }, () => helper({ op: "spawn", pool, count: PER_SPAWNER }));
  const results = (await Promise.all(spawners.map((spawner) => once(spawner, "message")))).map(([r]) => r);
  const tids = results.flat().map((result) => result.tid);
  assert.ok(tids.every((tid) => tid > 0), "no spawn was declined");
  assert.equal(new Set(tids).size, SPAWNERS * PER_SPAWNER, "every tid is unique");
  const deadline = Date.now() + 10_000;
  while (readWasiThreadPoolReport(pool).active > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  for (let tid = 1; tid <= SPAWNERS * PER_SPAWNER; tid += 1) {
    assert.equal(Atomics.load(runs, tid), 1, `tid ${tid} ran exactly once`);
  }
  // Each spawner passed start arguments 1000 .. 1199.
  const expectedArgs = SPAWNERS * (PER_SPAWNER * 1000 + (PER_SPAWNER * (PER_SPAWNER - 1)) / 2);
  assert.equal(Atomics.load(runs, 0), expectedArgs, "every thread got its own start argument");
  const report = readWasiThreadPoolReport(pool);
  assert.equal(report.spawned, SPAWNERS * PER_SPAWNER);
  assert.equal(report.declined, 0);
  assert.equal(report.idle, 4);
  for (let slot = 0; slot < 4; slot += 1) retireWasiThreadPoolSlot(pool, slot);
  await Promise.all(servers.map((server) => once(server, "exit")));
});
