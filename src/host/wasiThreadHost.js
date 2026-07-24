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

const BROWSER_WORKER_URL = new URL(
  "./wasiThreadBrowserWorker.mjs",
  import.meta.url,
);

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

// How long to wait for a pooled worker to confirm readiness before giving up and
// disabling browser threading entirely. Warm-pool startup is a handful of
// postMessage round-trips + one instantiation each; on a genuinely cross-origin
// isolated context that completes in well under a second. This deadline is kept
// SHORT on purpose: when arming is contended or a worker never confirms, the
// guest must commit to its proven sequential path FAST (threadSpawn -> -1) rather
// than leave the caller's compute watchdog to absorb a multi-second stall. Arming
// also short-circuits the instant ANY worker reports not-ready (see armBrowserPool),
// so the honest bound on a failed arming decision is one worker's first turn, not
// this whole window.
const BROWSER_POOL_PROBE_TIMEOUT_MS = 1500;

// Arm the browser warm pool: probe every created worker and resolve a single
// all-or-nothing decision. Resolves true ONLY when every worker confirms
// {t:"ready", ok:true}; resolves false the instant ANY worker reports not-ready,
// errors, or misses the probe deadline — a committed, fast sequential fallback,
// never a wait for the slowest loser. The per-worker onmessage handler installed
// here is PERSISTENT: after arming it keeps dispatching {t:"exit"} (idle return)
// and {t:"error"} (guest fault surfacing) for the life of the pool.
function armBrowserPool(
  created,
  { wasmModule, memory, hostcallChannel, timeoutMs, onExit },
) {
  return new Promise((resolve) => {
    let remaining = created.length;
    let settled = false;
    const timers = [];
    const finish = (ok) => {
      if (settled) {
        return;
      }
      settled = true;
      for (const timer of timers) {
        clearTimeout(timer);
      }
      resolve(ok);
    };
    for (const worker of created) {
      const timer = setTimeout(() => finish(false), timeoutMs);
      timers.push(timer);
      worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.t === "ready") {
          clearTimeout(timer);
          if (message.ok === true) {
            remaining -= 1;
            if (remaining === 0) {
              finish(true);
            }
          } else {
            // One worker that cannot instantiate the module over the shared
            // memory disables the whole pool — decide NOW, do not wait out the
            // rest of the probes.
            finish(false);
          }
        } else if (message.t === "exit") {
          onExit(worker, message.tid);
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
        finish(false);
      };
      worker.postMessage({
        t: "probe",
        wasmModule,
        memory,
        hostcallChannel: hostcallChannel ?? null,
      });
    }
  });
}

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
 * @param {object} [options.hostcallChannel] request-isolated channel owned by
 *   the controlling host. Required when pthread workers import the generic
 *   module-host ABI.
 * @param {boolean} [options.requiresHostcalls] whether worker instances import
 *   the generic module-host ABI.
 * @param {boolean} [options.enableBrowserThreads] explicit successful host
 *   capability negotiation for an owning cross-origin-isolated worker harness.
 * @returns {Promise<{ threadSpawn: Function, activeThreadCount: () => number, spawnCount: () => number, distinctOsThreadCount: () => number, terminateAll: () => Promise<void> }>}
 */
export async function createWasiThreadSpawn({
  wasmModule,
  memory,
  requestedThreads,
  hostcallChannel,
  requiresHostcalls = false,
  enableBrowserThreads,
} = {}) {
  let nextTid = 0;
  let spawnCount = 0;
  if (requiresHostcalls && !hostcallChannel) {
    return {
      threadSpawn: () => -1,
      activeThreadCount: () => 0,
      spawnCount: () => 0,
      distinctOsThreadCount: () => 0,
      async terminateAll() {},
    };
  }

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
          workerData: {
            wasmModule,
            memory,
            tid,
            startArg,
            hostcallChannel: hostcallChannel ?? null,
          },
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

  const browserThreadsEnabled =
    enableBrowserThreads ??
    (globalThis.__SDM_ENABLE_BROWSER_WASI_THREADS__ === true);
  const armed =
    browserThreadsEnabled === true &&
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
      created.push(new Worker(BROWSER_WORKER_URL, { type: "module" }));
    }
    const armed = await armBrowserPool(created, {
      wasmModule,
      memory,
      hostcallChannel,
      timeoutMs: BROWSER_POOL_PROBE_TIMEOUT_MS,
      onExit: returnWorkerToIdle,
    });
    if (armed) {
      poolDisabled = false;
      for (const worker of created) {
        poolWorkers.push(worker);
        idleWorkers.push(worker);
      }
    } else {
      // Any failure disables browser threading entirely: threadSpawn returns -1,
      // the guest's pthread_create returns EAGAIN, and the module runs its whole
      // grid inline (correct, deterministic, non-hanging). Every created worker
      // is torn down — including ones that DID confirm ready — so no orphaned
      // nested worker lingers to contend with the sequential retry's pool.
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
