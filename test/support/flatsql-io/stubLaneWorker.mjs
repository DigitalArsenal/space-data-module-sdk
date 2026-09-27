// A stub reader lane for the link shim v2 mailbox protocol
// (src/flow/flatsqlLinkShim.js). It serves one mailbox in shared "lane
// memory": waits (bounded) on the doorbell, claims SUBMITTED requests, answers
// with status = op + sum(request bytes) and a response equal to the request
// reversed, and publishes DONE. With notify:false it never notifies, which is
// what a lane on another WasmEdge executor looks like to the flow.
import { workerData, parentPort } from "node:worker_threads";

const { memory, mailbox, stopWord, notify, slowMs = 0, cancelStatus = -125 } = workerData;
const i32 = new Int32Array(memory.buffer);
const u8 = new Uint8Array(memory.buffer);
const view = new DataView(memory.buffer);
const W = (offset) => (mailbox + offset) >> 2;
const STATE = W(0);
const SEQ = W(4);
const DONE_SEQ = W(8);
const DOORBELL = W(36);
const CANCEL = W(40);
let served = 0;
let lastDoorbell = Atomics.load(i32, DOORBELL);

function sleepCheckingCancel(ms, seq) {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    if (Atomics.load(i32, CANCEL) === seq) return true;
    Atomics.wait(i32, DOORBELL, Atomics.load(i32, DOORBELL), 1);
  }
  return false;
}

parentPort.postMessage({ t: "ready" });
while (Atomics.load(i32, stopWord >> 2) === 0) {
  if (Atomics.load(i32, STATE) !== 1) {
    // Bounded wait on the doorbell: a lane never relies on the notify either.
    Atomics.wait(i32, DOORBELL, lastDoorbell, 1);
    lastDoorbell = Atomics.load(i32, DOORBELL);
    continue;
  }
  if (Atomics.compareExchange(i32, STATE, 1, 2) !== 1) continue;
  const seq = Atomics.load(i32, SEQ);
  const op = view.getInt32(mailbox + 12, true);
  const reqPtr = view.getInt32(mailbox + 16, true);
  const reqLen = view.getInt32(mailbox + 20, true);
  let status = op;
  for (let i = 0; i < reqLen; i += 1) status += u8[reqPtr + i];
  const respPtr = reqPtr + 4096;
  for (let i = 0; i < reqLen; i += 1) u8[respPtr + i] = u8[reqPtr + reqLen - 1 - i];
  if (slowMs > 0 && sleepCheckingCancel(slowMs, seq)) status = cancelStatus;
  view.setInt32(mailbox + 24, status, true);
  view.setInt32(mailbox + 28, respPtr, true);
  view.setInt32(mailbox + 32, reqLen, true);
  view.setBigUint64(mailbox + 48, BigInt(seq) * 2n, true);
  Atomics.store(i32, DONE_SEQ, seq);
  Atomics.store(i32, STATE, 3);
  if (notify) Atomics.notify(i32, STATE);
  served += 1;
}
parentPort.postMessage({ t: "stopped", served });
