// Isomorphic wasi-threads spawn host.
//
// A wasm32-wasip1-threads (isomorphic-pthreads) artifact imports
// `wasi.thread-spawn` and exports `wasi_thread_start`. When the guest calls
// pthread_create it invokes `wasi.thread-spawn(startArg)`; the host must run a
// NEW OS thread that instantiates the SAME module over the SAME shared memory
// and calls `wasi_thread_start(tid, startArg)`. This module provides that host
// in BOTH environments:
//   - Node: a `node:worker_threads` Worker (src/host/wasiThreadWorker.mjs),
//     created lazily per spawn.
//   - Browser: a WARM POOL of classic Blob-URL Workers (inlined below), started
//     and confirmed ready during host creation, then dispatched to per spawn.
// Thread join/exit synchronization is done by the guest over shared-memory
// atomics (memory.atomic.wait/notify); the host only needs to start the thread.
//
// Why the browser needs a warm pool (correction of the earlier C6-era note):
//   - Nested Workers created under COOP/COEP DO share a single imported
//     WebAssembly.Memory by reference — a nested worker's atomic writes ARE
//     visible to the joining thread. Shared memory was never the problem.
//     (Proven headless + headed: nested-sab-microtest2/3/4.)
//   - The deadlock was STARTUP timing, not memory. The guest runs synchronous
//     WASM from pthread_create straight through pthread_join (memory.atomic.wait)
//     WITHOUT ever yielding this thread's event loop. A Worker created LAZILY at
//     pthread_create time needs the parent's event loop to run its startup, but
//     the parent is already blocked in the join — so the lazily-spawned worker
//     never starts and the join blocks forever.
//   - Fix: PRE-START the workers here (while this thread's event loop is still
//     free), confirm each is ready, and only postMessage work to an
//     already-running worker at spawn time. A message posted to a live worker is
//     delivered even while this thread is blocked in the synchronous join, so
//     the pooled worker runs the guest thread and notifies the join. (Proven.)
//
// See docs/isomorphic-pthreads.md and docs/browser-wasmedge-isomorphic.md.

const IS_NODE =
  typeof process !== "undefined" &&
  !!process.release &&
  process.release.name === "node";

/**
 * Does the compiled module require the wasi-threads host (i.e. does it import
 * `wasi.thread-spawn`)? Single-thread artifacts do not, so the host is only
 * wired up for genuinely-threaded modules.
 */
export function isWasiThreadsModule(wasmModule) {
  return WebAssembly.Module.imports(wasmModule).some(
    (entry) => entry.module === "wasi" && entry.name === "thread-spawn",
  );
}

// Classic (non-module) Blob worker source for the browser warm pool. Provides
// the WASI preview1 import set a spawned thread needs (a leaf compute thread
// barely touches WASI — args/environ/fd stubs are sufficient), the shared
// imported memory, and a failing nested thread-spawn. Protocol:
//   parent -> {t:"probe", wasmModule, memory}
//     worker instantiates the module over the shared memory to PROVE it is
//     ready, replies {t:"ready", ok:true|false}. (Instantiation runs no guest
//     code — reactors/commands have no wasm start section — so it never touches
//     shared state; only wasi_thread_start does.)
//   parent -> {t:"run", tid, startArg}
//     worker instantiates a FRESH instance (the wasi-threads contract: new
//     globals + stack pointer, same shared linear memory) and runs
//     wasi_thread_start(tid, startArg) to completion, then replies {t:"exit"}.
const BROWSER_WORKER_SOURCE = `
var OK = 0, SPIPE = 70;
var WASM_MODULE = null;
var SHARED_MEMORY = null;
function makeImports(memory) {
  function dv() { return new DataView(memory.buffer); }
  var wasi = {
    args_get: function () { return OK; },
    args_sizes_get: function (a, b) { var d = dv(); d.setUint32(a, 0, true); d.setUint32(b, 0, true); return OK; },
    environ_get: function () { return OK; },
    environ_sizes_get: function (a, b) { var d = dv(); d.setUint32(a, 0, true); d.setUint32(b, 0, true); return OK; },
    clock_time_get: function (id, p, ptr) { dv().setBigUint64(ptr, BigInt(Math.round((performance.timeOrigin + performance.now()) * 1e6)), true); return OK; },
    fd_close: function () { return OK; },
    fd_seek: function () { return SPIPE; },
    fd_read: function (fd, iovs, len, nread) { dv().setUint32(nread, 0, true); return OK; },
    fd_write: function (fd, iovs, len, nwritten) {
      var d = dv(), total = 0;
      for (var i = 0; i < len; i++) { total += d.getUint32(iovs + i * 8 + 4, true); }
      d.setUint32(nwritten, total, true); return OK;
    },
    fd_fdstat_get: function () { return OK; },
    random_get: function (ptr, n) { self.crypto.getRandomValues(new Uint8Array(memory.buffer, ptr, n)); return OK; },
    proc_exit: function (code) { throw { name: "WasiExitError", code: code }; },
    sched_yield: function () { return OK; }
  };
  return { wasi_snapshot_preview1: wasi, env: { memory: memory }, wasi: { "thread-spawn": function () { return -1; } } };
}
self.onmessage = function (event) {
  var data = event.data || {};
  if (data.t === "probe") {
    WASM_MODULE = data.wasmModule;
    SHARED_MEMORY = data.memory;
    try {
      new WebAssembly.Instance(WASM_MODULE, makeImports(SHARED_MEMORY));
      self.postMessage({ t: "ready", ok: true });
    } catch (err) {
      self.postMessage({ t: "ready", ok: false, error: String((err && err.message) || err) });
    }
    return;
  }
  if (data.t === "run") {
    var tid = data.tid;
    var startArg = data.startArg;
    try {
      var instance = new WebAssembly.Instance(WASM_MODULE, makeImports(SHARED_MEMORY));
      instance.exports.wasi_thread_start(tid, startArg);
    } catch (err) {
      if (!(err && err.name === "WasiExitError")) {
        // Keep the pooled worker alive for reuse; surface the fault for
        // diagnosis of a hung join rather than crashing the worker silently.
        self.postMessage({ t: "error", tid: tid, error: String((err && err.message) || err) });
      }
    }
    self.postMessage({ t: "exit", tid: tid });
    return;
  }
};
`;

let cachedBrowserBlobUrl = null;
function browserBlobUrl() {
  if (cachedBrowserBlobUrl) return cachedBrowserBlobUrl;
  const blob = new Blob([BROWSER_WORKER_SOURCE], { type: "text/javascript" });
  cachedBrowserBlobUrl = URL.createObjectURL(blob);
  return cachedBrowserBlobUrl;
}

// How long to wait for every pooled worker to confirm readiness before giving
// up and disabling browser threading entirely. Warm-pool startup is a handful
// of postMessage round-trips + one instantiation each, so this is generous.
const BROWSER_POOL_PROBE_TIMEOUT_MS = 10000;

function isSharedMemoryBacked(memory) {
  return (
    typeof SharedArrayBuffer === "function" &&
    !!memory &&
    memory.buffer instanceof SharedArrayBuffer
  );
}

function detectHardwareConcurrency() {
  if (
    typeof navigator !== "undefined" &&
    Number.isFinite(navigator.hardwareConcurrency)
  ) {
    return navigator.hardwareConcurrency;
  }
  if (
    typeof self !== "undefined" &&
    self.navigator &&
    Number.isFinite(self.navigator.hardwareConcurrency)
  ) {
    return self.navigator.hardwareConcurrency;
  }
  return 1;
}

/**
 * Create the `wasi.thread-spawn` host for a wasi-threads module. Returns the
 * import function plus liveness/cleanup helpers.
 *
 * @param {Object} options
 * @param {WebAssembly.Module} options.wasmModule compiled module the workers re-instantiate.
 * @param {WebAssembly.Memory} options.memory shared imported memory.
 * @param {number} [options.requestedThreads] upper bound on how many guest
 *   threads the module will ask for (browser warm-pool sizing). Defaults to the
 *   host's hardware concurrency.
 * @returns {Promise<{ threadSpawn: Function, activeThreadCount: () => number, spawnCount: () => number, distinctOsThreadCount: () => number, terminateAll: () => Promise<void> }>}
 */
export async function createWasiThreadSpawn({
  wasmModule,
  memory,
  requestedThreads,
} = {}) {
  let nextTid = 0;
  let spawnCount = 0;

  if (IS_NODE) {
    // NODE: lazy per-spawn worker_threads. Node workers start on their own OS
    // thread independently of the parent's event loop, so lazy creation at
    // pthread_create time is fine here — there is no startup-vs-join deadlock.
    const workers = new Set();
    const osThreadIds = new Set();
    const workerThreads = await import("node:worker_threads");
    const NodeWorker = workerThreads.Worker;
    const nodeWorkerUrl = new URL("./wasiThreadWorker.mjs", import.meta.url);

    const threadSpawn = (startArg) => {
      const tid = (nextTid += 1);
      try {
        const worker = new NodeWorker(nodeWorkerUrl, {
          workerData: { wasmModule, memory, tid, startArg },
        });
        // Node exposes the OS-thread id per Worker — distinct ids are direct
        // evidence that pthread_create ran real concurrent threads.
        if (typeof worker.threadId === "number") {
          osThreadIds.add(worker.threadId);
        }
        worker.on("error", (error) => {
          // A worker crash cannot be surfaced to the guest synchronously; log it
          // so a hung pthread_join is diagnosable rather than silent.
          // eslint-disable-next-line no-console
          console.error("[wasi-thread] worker error:", error);
        });
        worker.once("exit", () => workers.delete(worker));
        workers.add(worker);
        spawnCount += 1;
        return tid;
      } catch {
        // Signal spawn failure to the guest: wasi.thread-spawn returns a
        // negative value, pthread_create returns EAGAIN, and the module's
        // sequential fallback runs the stripe inline. Never abort.
        return -1;
      }
    };

    return {
      threadSpawn,
      activeThreadCount: () => workers.size,
      spawnCount: () => spawnCount,
      distinctOsThreadCount: () => osThreadIds.size,
      async terminateAll() {
        for (const worker of workers) {
          try {
            await worker.terminate?.();
          } catch {
            // best effort
          }
        }
        workers.clear();
      },
    };
  }

  // BROWSER: warm pool. A guest thread needs a Worker that shares the SAME
  // SharedArrayBuffer-backed memory; nested workers DO share it by reference.
  // The only hazard is lazy startup during the guest's synchronous, no-yield
  // pthread_create->pthread_join window, so we pre-start the pool here and only
  // ever dispatch to an already-running worker.
  const idleWorkers = [];
  const busyByTid = new Map();
  const poolWorkers = [];
  // Threading stays disabled (threadSpawn returns -1 -> guest runs inline) unless
  // the entire pool comes up green. Any probe failure/timeout disables it.
  let poolDisabled = true;

  const armed =
    globalThis.__SDM_ENABLE_BROWSER_WASI_THREADS__ === true &&
    globalThis.crossOriginIsolated === true &&
    isSharedMemoryBacked(memory);

  const hardwareConcurrency = detectHardwareConcurrency();
  const requested = Number.isFinite(requestedThreads)
    ? Math.floor(requestedThreads)
    : hardwareConcurrency;
  // N = min(hardwareConcurrency - 1, requested). The main compute thread is one
  // core; the pool provides the rest. Clamped at >= 0 (a 1-core host gets no
  // pool and runs the proven sequential path).
  const poolSize = armed
    ? Math.max(0, Math.min(Math.floor(hardwareConcurrency) - 1, requested))
    : 0;

  const returnWorkerToIdle = (worker, tid) => {
    if (tid !== undefined && tid !== null) {
      busyByTid.delete(tid);
    }
    if (
      !poolDisabled &&
      poolWorkers.includes(worker) &&
      !idleWorkers.includes(worker)
    ) {
      idleWorkers.push(worker);
    }
  };

  if (poolSize > 0) {
    const created = [];
    for (let i = 0; i < poolSize; i += 1) {
      created.push(new Worker(browserBlobUrl()));
    }
    // Persistent per-worker handler dispatches ready/exit/error; readiness is
    // awaited via a per-worker promise resolved on the first {t:"ready"}.
    const readyPromises = created.map(
      (worker) =>
        new Promise((resolve) => {
          let settled = false;
          const settle = (ok) => {
            if (!settled) {
              settled = true;
              resolve(ok);
            }
          };
          const timer = setTimeout(
            () => settle(false),
            BROWSER_POOL_PROBE_TIMEOUT_MS,
          );
          worker.onmessage = (event) => {
            const message = event.data || {};
            if (message.t === "ready") {
              clearTimeout(timer);
              settle(message.ok === true);
            } else if (message.t === "exit") {
              returnWorkerToIdle(worker, message.tid);
            } else if (message.t === "error") {
              // eslint-disable-next-line no-console
              console.error(
                "[wasi-thread] pooled worker guest error:",
                message.error,
              );
            }
          };
          worker.onerror = (error) => {
            clearTimeout(timer);
            // eslint-disable-next-line no-console
            console.error(
              "[wasi-thread] pooled worker error:",
              error?.message ?? error,
            );
            settle(false);
          };
          worker.postMessage({ t: "probe", wasmModule, memory });
        }),
    );

    const results = await Promise.all(readyPromises);
    if (results.length > 0 && results.every((ok) => ok === true)) {
      poolDisabled = false;
      for (const worker of created) {
        poolWorkers.push(worker);
        idleWorkers.push(worker);
      }
    } else {
      // Any failure disables browser threading entirely: threadSpawn returns -1,
      // the guest's pthread_create returns EAGAIN, and the module runs its whole
      // grid inline (correct, deterministic, non-hanging).
      for (const worker of created) {
        try {
          worker.terminate();
        } catch {
          // best effort
        }
      }
    }
  }

  const threadSpawn = (startArg) => {
    if (poolDisabled) {
      return -1;
    }
    const worker = idleWorkers.pop();
    if (!worker) {
      // Pool exhausted (guest asked for more concurrent threads than the pool
      // holds): decline this one so the guest runs the stripe inline. Correct
      // and non-hanging; the already-dispatched threads still run in parallel.
      return -1;
    }
    const tid = (nextTid += 1);
    busyByTid.set(tid, worker);
    try {
      // Dispatch to a PRE-STARTED worker: its event loop is already live on its
      // own thread, so this postMessage is delivered even while THIS thread then
      // blocks in the guest's synchronous pthread_join (memory.atomic.wait).
      worker.postMessage({ t: "run", tid, startArg });
    } catch {
      busyByTid.delete(tid);
      idleWorkers.push(worker);
      return -1;
    }
    spawnCount += 1;
    return tid;
  };

  return {
    threadSpawn,
    activeThreadCount: () => busyByTid.size,
    spawnCount: () => spawnCount,
    // No OS-thread ids in the browser; the count of distinct pooled Worker
    // threads is the honest analogue.
    distinctOsThreadCount: () => poolWorkers.length,
    async terminateAll() {
      poolDisabled = true;
      for (const worker of poolWorkers) {
        try {
          worker.terminate();
        } catch {
          // best effort
        }
      }
      poolWorkers.length = 0;
      idleWorkers.length = 0;
      busyByTid.clear();
    },
  };
}
