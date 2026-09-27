// Node worker_threads entry for a spawned wasi-threads guest thread.
//
// The wasi-threads contract: when the guest calls pthread_create it invokes the
// host `wasi.thread-spawn` import, which must run a NEW OS thread that
// instantiates the SAME module over the SAME shared linear memory and calls
// `wasi_thread_start(tid, startArg)`. This file is that OS thread (a Node
// worker). Thread lifecycle/join synchronization happens entirely over shared
// memory atomics (memory.atomic.wait/notify emitted by the guest) — no
// messages are needed for correctness.
//
// `extraImports` entries arrive through workerData: built-in descriptors such
// as `{ provider: "flatsql-io" }` (SAB channel) or `{ provider:
// "flatsql-io-node", root, table }` (synchronous fs over a shared virtual-handle
// table, nodeSyncFsIo.js, design §5.6), and `{ moduleUrl }` factory modules.

import { writeSync } from "node:fs";
import { workerData } from "node:worker_threads";

import {
  createWasiThreadWorkerRuntime,
  resolveModuleExtraImports,
} from "./wasiThreadWorkerRuntime.js";
import { resolveNodeFlatsqlIoDescriptors } from "./nodeSyncFsIo.js";

const { wasmModule, memory, tid, startArg, hostcallChannel, processState } = workerData;

// A thread that faults never completes the pthread exit protocol, so the
// thread joining it blocks for good inside the guest. When that joiner is the
// thread that owns this worker, it can never run this worker's "error" event.
// Write the fault to stderr from here, synchronously, so it is always seen.
function reportGuestThreadFault(what, error) {
  try {
    writeSync(2, `[wasi-thread] guest thread ${tid} ${what}: ${error?.stack ?? error}\n`);
  } catch {
    // stderr unavailable; the worker error event still carries the fault
  }
}

let runtime;
let instance;
try {
  const extraImports = resolveNodeFlatsqlIoDescriptors(
    await resolveModuleExtraImports(workerData.extraImports ?? []),
  );
  runtime = createWasiThreadWorkerRuntime({
    wasmModule,
    memory,
    hostcallChannel,
    processState,
    extraImports,
    workerIndex: workerData.workerIndex,
    tid,
  });
  instance = runtime.instantiate();
} catch (error) {
  reportGuestThreadFault("failed to instantiate", error);
  runtime?.close();
  throw error;
}

try {
  instance.exports.wasi_thread_start(tid, startArg);
} catch (error) {
  // WASI proc_exit surfaces as WasiExitError; a clean thread return is normal.
  if (!(error && error.name === "WasiExitError")) {
    reportGuestThreadFault("trapped", error);
    throw error;
  }
} finally {
  runtime.close();
}
