// Another thread of the "process" in wasi-thread-pool-reuse.test.js, acting on
// a wasi-threads pool through shared memory only:
//   finish: after `delayMs`, finish the thread running on `slot`, as its pool
//           worker does when wasi_thread_start returns;
//   spawn:  spawn `count` threads, as a guest thread that is not the main
//           thread does, and post back the results;
//   serve:  serve `slot` as a pool worker does, counting each tid it runs in
//           the shared `runs` array, until the slot is retired.
import { parentPort, workerData } from "node:worker_threads";

import {
  createWasiThreadPoolSpawn,
  finishWasiThreadPoolRun,
  serveWasiThreadPoolSlot,
  takeWasiThreadPoolAssignment,
} from "../../src/host/wasiThreadPool.js";

const { op, pool, slot, delayMs = 0, count = 1, runs } = workerData;
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
if (op === "finish") {
  takeWasiThreadPoolAssignment(pool, slot);
  finishWasiThreadPoolRun(pool, slot);
} else if (op === "serve") {
  serveWasiThreadPoolSlot(pool, slot, {
    runThread(tid, startArg) {
      Atomics.add(runs, tid, 1);
      Atomics.add(runs, 0, startArg);
      return true;
    },
  });
} else if (op === "spawn") {
  const spawn = createWasiThreadPoolSpawn(pool);
  const results = [];
  for (let index = 0; index < count; index += 1) results.push(spawn(1000 + index));
  parentPort.postMessage(results);
}
