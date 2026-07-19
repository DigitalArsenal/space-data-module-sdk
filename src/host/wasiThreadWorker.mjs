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

import { createBrowserWasiShim } from "./wasiShim.js";

const { wasmModule, memory, tid, startArg } = workerData;

const wasi = createBrowserWasiShim({});
wasi.setMemory(memory);

const imports = {
  ...wasi.imports,
  env: { memory },
  // A leaf compute thread does not spawn further threads; satisfy the import
  // with a failing stub so any accidental nested spawn degrades rather than
  // recursing workers without bound.
  wasi: { "thread-spawn": () => -1 },
};

const instance = new WebAssembly.Instance(wasmModule, imports);
wasi.setMemory(instance.exports.memory ?? memory);

try {
  instance.exports.wasi_thread_start(tid, startArg);
} catch (error) {
  // WASI proc_exit surfaces as WasiExitError; a clean thread return is normal.
  if (!(error && error.name === "WasiExitError")) {
    throw error;
  }
}
