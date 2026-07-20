// Unit tests for the BROWSER warm-pool path of createWasiThreadSpawn
// (src/host/wasiThreadHost.js).
//
// The host selects its environment at module-eval time via a `process.release`
// check. To exercise the browser branch under node's test runner we mask
// `process.release` BEFORE importing the module (IS_NODE is captured once), then
// restore it. Web `Worker` is not a node global, so we install a MockWorker that
// speaks the pool protocol (probe -> ready, run -> exit) and lets each test steer
// per-worker probe outcomes and whether a run auto-completes.

import test, { mock } from "node:test";
import assert from "node:assert/strict";

// --- Force the BROWSER branch, then restore process.release. ---
const originalRelease = Object.getOwnPropertyDescriptor(process, "release");
Object.defineProperty(process, "release", {
  value: { name: "browser-warm-pool-test" },
  configurable: true,
});
const { createWasiThreadSpawn } = await import(
  "../src/host/wasiThreadHost.js"
);
if (originalRelease) {
  Object.defineProperty(process, "release", originalRelease);
}

class MockWorker {
  constructor() {
    MockWorker.instances.push(this);
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    this.runCount = 0;
    // "ready" (default) | "fail" | "error" | "timeout"
    this.behavior = MockWorker.behaviors.shift() ?? "ready";
  }

  postMessage(message) {
    if (this.terminated) {
      return;
    }
    if (message.t === "probe") {
      if (this.behavior === "timeout") {
        return; // never replies -> the host's probe timeout must fire
      }
      queueMicrotask(() => {
        if (this.terminated) {
          return;
        }
        if (this.behavior === "error") {
          this.onerror?.({ message: "mock probe error" });
          return;
        }
        this.onmessage?.({
          data: { t: "ready", ok: this.behavior !== "fail" },
        });
      });
      return;
    }
    if (message.t === "run") {
      this.runCount += 1;
      if (MockWorker.autoExit) {
        queueMicrotask(() => {
          if (this.terminated) {
            return;
          }
          this.onmessage?.({ data: { t: "exit", tid: message.tid } });
        });
      }
    }
  }

  terminate() {
    this.terminated = true;
    MockWorker.terminatedCount += 1;
  }
}

const SHARED_MEMORY = { buffer: new SharedArrayBuffer(64) };
const WASM_MODULE = { __mockModule: true };

function installBrowserEnv({
  hardwareConcurrency = 8,
  armed = true,
  isolated = true,
  behaviors = [],
  autoExit = true,
} = {}) {
  MockWorker.instances = [];
  MockWorker.behaviors = behaviors.slice();
  MockWorker.autoExit = autoExit;
  MockWorker.terminatedCount = 0;
  globalThis.Worker = MockWorker;
  globalThis.URL.createObjectURL = () => "blob:mock-worker";
  globalThis.__SDM_ENABLE_BROWSER_WASI_THREADS__ = armed;
  globalThis.crossOriginIsolated = isolated;
  Object.defineProperty(globalThis, "navigator", {
    value: { hardwareConcurrency },
    configurable: true,
  });
}

function host({ requestedThreads } = {}) {
  return createWasiThreadSpawn({
    wasmModule: WASM_MODULE,
    memory: SHARED_MEMORY,
    requestedThreads,
  });
}

// A macrotask flush so queued {t:"exit"} microtask replies are delivered.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("all probes ready -> pool enabled; threadSpawn returns a live tid", async () => {
  installBrowserEnv({ hardwareConcurrency: 8, autoExit: false });
  const h = await host({ requestedThreads: 2 });
  // poolSize = min(hardwareConcurrency - 1, requested) = min(7, 2) = 2
  assert.equal(MockWorker.instances.length, 2);
  assert.equal(h.distinctOsThreadCount(), 2);

  const tid1 = h.threadSpawn(111);
  const tid2 = h.threadSpawn(222);
  assert.ok(tid1 > 0, "first spawn returns a positive tid");
  assert.ok(tid2 > 0 && tid2 !== tid1, "second spawn returns a distinct tid");
  assert.equal(h.spawnCount(), 2);
  assert.equal(h.activeThreadCount(), 2);

  // Pool exhausted (both busy, no auto-exit) -> decline so the guest runs inline.
  assert.equal(h.threadSpawn(333), -1);
  assert.equal(h.spawnCount(), 2, "declined spawn is not counted");

  await h.terminateAll();
});

test("any probe failure disables threading entirely and terminates the pool", async () => {
  installBrowserEnv({
    hardwareConcurrency: 8,
    behaviors: ["ready", "fail", "ready"],
    autoExit: false,
  });
  const h = await host({ requestedThreads: 3 });
  assert.equal(h.threadSpawn(1), -1, "spawn declined when pool is disabled");
  assert.equal(h.spawnCount(), 0);
  assert.equal(h.distinctOsThreadCount(), 0);
  assert.equal(
    MockWorker.terminatedCount,
    3,
    "every created worker is torn down on partial-pool failure",
  );
});

test("a probe error (onerror) also disables the whole pool", async () => {
  installBrowserEnv({
    hardwareConcurrency: 8,
    behaviors: ["ready", "error"],
    autoExit: false,
  });
  const h = await host({ requestedThreads: 2 });
  assert.equal(h.threadSpawn(1), -1);
  assert.equal(MockWorker.terminatedCount, 2);
});

test("a probe timeout disables the pool (no worker ever confirms ready)", async () => {
  installBrowserEnv({
    hardwareConcurrency: 8,
    behaviors: ["ready", "timeout"],
    autoExit: false,
  });
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const pending = host({ requestedThreads: 2 });
    // Let the ready worker's microtask reply drain, then trip the probe timeout.
    await Promise.resolve();
    mock.timers.tick(10000);
    const h = await pending;
    assert.equal(h.threadSpawn(1), -1);
    assert.equal(MockWorker.terminatedCount, 2);
  } finally {
    mock.timers.reset();
  }
});

test("worker exit returns it to the idle pool for reuse", async () => {
  installBrowserEnv({ hardwareConcurrency: 8, autoExit: true });
  const h = await host({ requestedThreads: 1 });
  assert.equal(MockWorker.instances.length, 1);

  const tid1 = h.threadSpawn(1);
  assert.ok(tid1 > 0);
  await flush(); // deliver {t:"exit"}
  assert.equal(h.activeThreadCount(), 0, "worker returned to idle after exit");

  const tid2 = h.threadSpawn(2);
  assert.ok(tid2 > 0, "the freed worker accepts a second run");
  assert.equal(
    MockWorker.instances.length,
    1,
    "no new worker was created; the pooled one was reused",
  );
  assert.equal(MockWorker.instances[0].runCount, 2);
  assert.equal(h.spawnCount(), 2);

  await h.terminateAll();
});

test("terminateAll tears down the pool and permanently disables spawning", async () => {
  installBrowserEnv({ hardwareConcurrency: 8, autoExit: false });
  const h = await host({ requestedThreads: 2 });
  await h.terminateAll();
  assert.equal(MockWorker.terminatedCount, 2);
  assert.equal(h.distinctOsThreadCount(), 0);
  assert.equal(h.threadSpawn(1), -1, "no spawn after terminateAll");
});

test("pool size is min(hardwareConcurrency - 1, requested)", async () => {
  installBrowserEnv({ hardwareConcurrency: 4, autoExit: false });
  const h = await host({ requestedThreads: 10 });
  // min(4 - 1, 10) = 3
  assert.equal(MockWorker.instances.length, 3);
  await h.terminateAll();
});

test("disabled gate (__SDM_ENABLE false) creates no workers", async () => {
  installBrowserEnv({ hardwareConcurrency: 8, armed: false });
  const h = await host({ requestedThreads: 4 });
  assert.equal(MockWorker.instances.length, 0);
  assert.equal(h.threadSpawn(1), -1);
});

test("no cross-origin isolation creates no workers", async () => {
  installBrowserEnv({ hardwareConcurrency: 8, isolated: false });
  const h = await host({ requestedThreads: 4 });
  assert.equal(MockWorker.instances.length, 0);
  assert.equal(h.threadSpawn(1), -1);
});

test("non-shared memory (no SharedArrayBuffer backing) creates no workers", async () => {
  installBrowserEnv({ hardwareConcurrency: 8 });
  const h = await createWasiThreadSpawn({
    wasmModule: WASM_MODULE,
    memory: { buffer: new ArrayBuffer(64) },
    requestedThreads: 4,
  });
  assert.equal(MockWorker.instances.length, 0);
  assert.equal(h.threadSpawn(1), -1);
});
