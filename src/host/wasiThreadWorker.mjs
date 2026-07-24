// Node worker_threads entry for a spawned wasi-threads guest thread.
//
// The wasi-threads contract: when the guest calls pthread_create it invokes the
// host `wasi.thread-spawn` import, which must run a NEW OS thread that
// instantiates the SAME module over the SAME shared linear memory and calls
// `wasi_thread_start(tid, startArg)`. This file is that OS thread (a Node
// worker). Thread lifecycle/join synchronization happens entirely over shared
// memory atomics (memory.atomic.wait/notify emitted by the guest) — no
// messages are needed for correctness.

import { workerData } from "node:worker_threads";

import { createWasiThreadWorkerRuntime } from "./wasiThreadWorkerRuntime.js";

const { wasmModule, memory, tid, startArg, hostcallChannel } = workerData;
const runtime = createWasiThreadWorkerRuntime({
  wasmModule,
  memory,
  hostcallChannel,
});
const instance = runtime.instantiate();

try {
  instance.exports.wasi_thread_start(tid, startArg);
} catch (error) {
  // WASI proc_exit surfaces as WasiExitError; a clean thread return is normal.
  if (!(error && error.name === "WasiExitError")) {
    throw error;
  }
} finally {
  runtime.close();
}
