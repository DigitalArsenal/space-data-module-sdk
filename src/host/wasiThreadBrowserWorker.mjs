import {
  createWasiThreadWorkerRuntime,
  resolveModuleExtraImports,
} from "./wasiThreadWorkerRuntime.js";

// One pooled browser worker = one guest OS thread. It is pre-started and
// probed by createWasiThreadSpawn (wasiThreadHost.js), then runs
// wasi_thread_start for each {t:"run"} it is dispatched. The same source ships
// as a self-contained classic bundle spawned from a blob: URL (A39,
// hostWorkerBundles.js); nothing here depends on the module-worker form except
// `{ moduleUrl }` extraImports entries, which need a module worker.

let runtime = null;

self.onmessage = async (event) => {
  const message = event.data ?? {};
  if (message.t === "probe") {
    try {
      const extraImports = await resolveModuleExtraImports(message.extraImports ?? []);
      runtime = createWasiThreadWorkerRuntime({
        wasmModule: message.wasmModule,
        memory: message.memory,
        hostcallChannel: message.hostcallChannel ?? null,
        processState: message.processState,
        extraImports,
        workerIndex: message.workerIndex,
      });
      runtime.instantiate();
      self.postMessage({ t: "ready", ok: true });
    } catch (error) {
      runtime?.close();
      runtime = null;
      self.postMessage({
        t: "ready",
        ok: false,
        error: String(error?.message ?? error),
      });
    }
    return;
  }
  if (message.t !== "run") return;

  try {
    const instance = runtime.instantiate();
    instance.exports.wasi_thread_start(message.tid, message.startArg);
  } catch (error) {
    if (!(error && error.name === "WasiExitError")) {
      // The thread that joins this one may be blocked in the guest and never
      // handle the message below; report the fault from this worker as well.
      console.error(`[wasi-thread] guest thread ${message.tid} trapped:`, error);
      self.postMessage({
        t: "error",
        tid: message.tid,
        error: String(error?.message ?? error),
      });
    }
  }
  self.postMessage({ t: "exit", tid: message.tid });
};
