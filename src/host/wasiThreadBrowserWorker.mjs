import { createWasiThreadWorkerRuntime } from "./wasiThreadWorkerRuntime.js";

let wasmModule = null;
let memory = null;
let hostcallChannel = null;
let runtime = null;

self.onmessage = (event) => {
  const message = event.data ?? {};
  if (message.t === "probe") {
    wasmModule = message.wasmModule;
    memory = message.memory;
    hostcallChannel = message.hostcallChannel ?? null;
    try {
      runtime = createWasiThreadWorkerRuntime({
        wasmModule,
        memory,
        hostcallChannel,
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
      self.postMessage({
        t: "error",
        tid: message.tid,
        error: String(error?.message ?? error),
      });
    }
  }
  self.postMessage({ t: "exit", tid: message.tid });
};
