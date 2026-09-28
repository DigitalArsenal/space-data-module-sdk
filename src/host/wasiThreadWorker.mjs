// Node worker_threads entry for a pooled wasi-threads guest thread.
//
// The wasi-threads contract: when the guest calls pthread_create it invokes the
// host `wasi.thread-spawn` import, which must run a NEW OS thread that
// instantiates the SAME module over the SAME shared linear memory and calls
// `wasi_thread_start(tid, startArg)`. This file is such a thread (a Node
// worker). Thread lifecycle/join synchronization happens entirely over shared
// memory atomics (memory.atomic.wait/notify emitted by the guest).
//
// Since SDK 0.8.25 the worker is pooled (wasiThreadPool.js): it serves one slot
// of the pool, blocking on it between threads, and runs every thread any guest
// thread assigns to it. Its guest threads get the pool's spawn as their own
// wasi.thread-spawn, and that spawn may start the next pool worker from this
// thread: a Node worker starts on its own thread without its parent's event
// loop, and every event loop here is blocked in the guest.
//
// `extraImports` entries arrive through workerData: built-in descriptors such
// as `{ provider: "flatsql-io" }` (SAB channel) or `{ provider:
// "flatsql-io-node", root, table }` (synchronous fs over a shared virtual-handle
// table, nodeSyncFsIo.js, design §5.6), and `{ moduleUrl }` factory modules.

import { writeSync } from "node:fs";
import { threadId, Worker, workerData } from "node:worker_threads";

import {
  createWasiThreadWorkerRuntime,
  resolveModuleExtraImports,
} from "./wasiThreadWorkerRuntime.js";
import { resolveNodeFlatsqlIoDescriptors } from "./nodeSyncFsIo.js";
import {
  createWasiThreadPoolSpawn,
  retireWasiThreadPoolSlot,
  serveWasiThreadPoolSlot,
  wasiThreadPoolLastTid,
} from "./wasiThreadPool.js";

const { wasmModule, memory, hostcallChannel, processState, pool, slot, execArgv } = workerData;

// A thread that faults never completes the pthread exit protocol, so the
// thread joining it blocks for good inside the guest. When that joiner is the
// thread that owns this worker, it can never run this worker's "error" event.
// Write the fault to stderr from here, synchronously, so it is always seen.
function reportGuestThreadFault(tid, what, error) {
  try {
    writeSync(2, `[wasi-thread] guest thread ${tid} ${what}: ${error?.stack ?? error}\n`);
  } catch {
    // stderr unavailable; the worker error event still carries the fault
  }
}

// A spawn from one of this worker's guest threads that finds every pool worker
// busy starts the next one here.
function grow(nextSlot) {
  const worker = new Worker(new URL(import.meta.url), {
    execArgv,
    workerData: { ...workerData, slot: nextSlot },
  });
  // The pool, not this worker's event loop, decides when it stops.
  worker.unref();
  // It reports its own faults on stderr; this loop rarely runs to hear them.
  worker.on("error", () => {});
}

let runtime;
try {
  const extraImports = resolveNodeFlatsqlIoDescriptors(
    await resolveModuleExtraImports(workerData.extraImports ?? []),
  );
  const spawn = createWasiThreadPoolSpawn(pool, { grow });
  runtime = createWasiThreadWorkerRuntime({
    wasmModule,
    memory,
    hostcallChannel,
    processState,
    extraImports,
    workerIndex: slot,
    threadSpawn: (startArg) => spawn(startArg).tid,
  });
  runtime.instantiate();
} catch (error) {
  // The slot already holds the thread this worker was started for.
  reportGuestThreadFault(wasiThreadPoolLastTid(pool, slot), "failed to instantiate", error);
  retireWasiThreadPoolSlot(pool, slot);
  try {
    runtime?.close();
  } catch {
    // the instantiate fault is the one to report
  }
  throw error;
}

let fault = null;
try {
  serveWasiThreadPoolSlot(pool, slot, {
    osThreadId: threadId,
    runThread(tid, startArg) {
      try {
        runtime.instantiate().exports.wasi_thread_start(tid, startArg);
        return true;
      } catch (error) {
        // WASI proc_exit surfaces as WasiExitError; a clean thread return is normal.
        if (error && error.name === "WasiExitError") return true;
        reportGuestThreadFault(tid, "trapped", error);
        fault = error;
        return false;
      }
    },
  });
} finally {
  runtime.close();
}
// Surface the fault as this worker's error event (onGuestError, A36).
if (fault) throw fault;
