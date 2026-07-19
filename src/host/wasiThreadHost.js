// Isomorphic wasi-threads spawn host.
//
// A wasm32-wasip1-threads (isomorphic-pthreads) artifact imports
// `wasi.thread-spawn` and exports `wasi_thread_start`. When the guest calls
// pthread_create it invokes `wasi.thread-spawn(startArg)`; the host must run a
// NEW OS thread that instantiates the SAME module over the SAME shared memory
// and calls `wasi_thread_start(tid, startArg)`. This module provides that host
// in BOTH environments:
//   - Node: a `node:worker_threads` Worker (src/host/wasiThreadWorker.mjs).
//   - Browser: a classic Blob-URL Worker (inlined below).
// Thread join/exit synchronization is done by the guest over shared-memory
// atomics (memory.atomic.wait/notify); the host only needs to start the thread.
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

// Classic (non-module) Blob worker source for the browser. Provides the WASI
// preview1 import set a spawned thread needs (a leaf compute thread barely
// touches WASI — args/environ/fd stubs are sufficient) plus the shared memory
// and a failing nested thread-spawn, then runs wasi_thread_start.
const BROWSER_WORKER_SOURCE = `
self.onmessage = function (event) {
  var data = event.data;
  var wasmModule = data.wasmModule;
  var memory = data.memory;
  var tid = data.tid;
  var startArg = data.startArg;
  var OK = 0, SPIPE = 70;
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
  var imports = { wasi_snapshot_preview1: wasi, env: { memory: memory }, wasi: { "thread-spawn": function () { return -1; } } };
  try {
    var instance = new WebAssembly.Instance(wasmModule, imports);
    instance.exports.wasi_thread_start(tid, startArg);
  } catch (err) {
    if (!(err && err.name === "WasiExitError")) { setTimeout(function () { throw err; }); }
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

/**
 * Create the `wasi.thread-spawn` host for a wasi-threads module. Returns the
 * import function plus liveness/cleanup helpers.
 *
 * @param {Object} options
 * @param {WebAssembly.Module} options.wasmModule compiled module the workers re-instantiate.
 * @param {WebAssembly.Memory} options.memory shared imported memory.
 * @returns {Promise<{ threadSpawn: Function, activeThreadCount: () => number, spawnCount: () => number, terminateAll: () => Promise<void> }>}
 */
export async function createWasiThreadSpawn({ wasmModule, memory }) {
  const workers = new Set();
  const osThreadIds = new Set();
  let nextTid = 0;
  let spawnCount = 0;

  let NodeWorker = null;
  let nodeWorkerUrl = null;
  if (IS_NODE) {
    const workerThreads = await import("node:worker_threads");
    NodeWorker = workerThreads.Worker;
    nodeWorkerUrl = new URL("./wasiThreadWorker.mjs", import.meta.url);
  }

  const threadSpawn = (startArg) => {
    const tid = (nextTid += 1);
    try {
      if (IS_NODE) {
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
      } else {
        // BROWSER: a wasi-threads guest thread needs a Worker that shares the
        // SAME SharedArrayBuffer-backed memory. A Worker created from WITHIN the
        // (module) worker that runs compute — i.e. a nested worker — does NOT
        // share that memory under Chromium's COOP/COEP: the nested worker
        // receives a COPY, so its atomic writes never reach the joining thread
        // and pthread_join would block forever. (Verified: a nested worker's SAB
        // writes do not propagate even when the parent is crossOriginIsolated.)
        //
        // So by default the browser host DECLINES to spawn (returns -1). The
        // guest's pthread_create then returns EAGAIN and the module runs its
        // stripe INLINE — a correct, non-hanging SEQUENTIAL compute of the exact
        // same artifact. Real multi-threading is delivered under Node
        // worker_threads (below) and WasmEdge wasi-threads server-side. Opt in
        // with globalThis.__SDM_ENABLE_BROWSER_WASI_THREADS__ = true once a
        // browser topology that truly shares memory into guest threads exists.
        if (globalThis.__SDM_ENABLE_BROWSER_WASI_THREADS__ !== true) {
          return -1;
        }
        const worker = new Worker(browserBlobUrl());
        worker.onerror = (error) => {
          // eslint-disable-next-line no-console
          console.error("[wasi-thread] worker error:", error?.message ?? error);
        };
        worker.postMessage({ wasmModule, memory, tid, startArg });
        workers.add(worker);
      }
      spawnCount += 1;
      return tid;
    } catch {
      // Signal spawn failure to the guest: wasi.thread-spawn returns a negative
      // value, pthread_create returns EAGAIN, and the module's sequential
      // fallback runs the stripe inline. Never abort.
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
