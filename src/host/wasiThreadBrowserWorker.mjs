import {
  createWasiThreadWorkerRuntime,
  resolveModuleExtraImports,
} from "./wasiThreadWorkerRuntime.js";
import {
  WASI_THREAD_POOL_PROTOCOL,
  createWasiThreadPoolSpawn,
  serveWasiThreadPoolSlot,
} from "./wasiThreadPool.js";

// One pooled browser worker = one guest OS thread at a time. It is pre-started
// and probed by createWasiThreadSpawn (wasiThreadHost.js). The same source
// ships as a self-contained classic bundle spawned from a blob: URL (A39,
// hostWorkerBundles.js); nothing here depends on the module-worker form except
// `{ moduleUrl }` extraImports entries, which need a module worker.
//
// With a pool in the probe (SDK 0.8.25), this worker then serves its pool slot
// (wasiThreadPool.js): it blocks on the slot, runs wasi_thread_start for each
// thread any guest thread assigns to it, and frees the slot when the thread
// returns. It never goes back to its event loop, so nothing it does waits for
// the spawner's. Every guest thread it runs gets the pool's spawn as its
// wasi.thread-spawn. Without a pool (an older host) it runs {t:"run"} messages
// and answers each with {t:"exit"}, as before.

let runtime = null;

function runThread(tid, startArg) {
  try {
    const instance = runtime.instantiate();
    instance.exports.wasi_thread_start(tid, startArg);
    return true;
  } catch (error) {
    if (error && error.name === "WasiExitError") return true;
    // The thread that joins this one may be blocked in the guest and never
    // handle the message below; report the fault from this worker as well.
    console.error(`[wasi-thread] guest thread ${tid} trapped:`, error);
    self.postMessage({ t: "error", tid, error: String(error?.message ?? error) });
    return false;
  }
}

self.onmessage = async (event) => {
  const message = event.data ?? {};
  if (message.t === "probe") {
    const pool = message.pool ?? null;
    try {
      const extraImports = await resolveModuleExtraImports(message.extraImports ?? []);
      const spawn = pool ? createWasiThreadPoolSpawn(pool) : null;
      runtime = createWasiThreadWorkerRuntime({
        wasmModule: message.wasmModule,
        memory: message.memory,
        hostcallChannel: message.hostcallChannel ?? null,
        processState: message.processState,
        extraImports,
        workerIndex: message.workerIndex,
        threadSpawn: spawn ? (startArg) => spawn(startArg).tid : undefined,
      });
      runtime.instantiate();
      self.postMessage({ t: "ready", ok: true, protocol: WASI_THREAD_POOL_PROTOCOL });
    } catch (error) {
      runtime?.close();
      runtime = null;
      self.postMessage({
        t: "ready",
        ok: false,
        error: String(error?.message ?? error),
      });
      return;
    }
    if (pool) {
      // A trapped thread retires the slot and ends the loop.
      serveWasiThreadPoolSlot(pool, message.slot, { runThread });
    }
    return;
  }
  if (message.t !== "run") return;
  runThread(message.tid, message.startArg);
  self.postMessage({ t: "exit", tid: message.tid });
};
