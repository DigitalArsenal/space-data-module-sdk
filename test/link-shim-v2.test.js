// FlatSQL link shim v2 (design §18 T9 #5, §20): a mailbox over imported lane
// memory with polling-bounded waits and no reliance on cross-executor notify.
// A stub lane (test/support/flatsql-io/stubLaneWorker.mjs) serves the mailbox
// from another thread, with and without notifying.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";

import {
  FLATSQL_LINK_BUSY,
  FLATSQL_LINK_MAILBOX,
  FLATSQL_LINK_PENDING,
  FLATSQL_LINK_SHIM_V2_WASM,
  FLATSQL_LINK_SHIM_WASM,
  FLATSQL_LINK_STATE,
  buildFlatsqlLinkShimV2Wasm,
  instantiateFlatsqlLinkShimV2,
} from "../src/flow/flatsqlLinkShim.js";
import { fnv1a64Hex } from "../src/http/index.js";

const LANE = new URL("./support/flatsql-io/stubLaneWorker.mjs", import.meta.url);
const MAILBOX = 256;
const STOP_WORD = 128;
const REQ = 8192;

function laneMemory() {
  return new WebAssembly.Memory({ initial: 4, maximum: 64, shared: true });
}

async function startLane(memory, options = {}) {
  const worker = new Worker(LANE, {
    workerData: { memory, mailbox: MAILBOX, stopWord: STOP_WORD, notify: true, ...options },
  });
  await new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
  return {
    async stop() {
      const stopped = new Promise((resolve) => worker.on("message", (m) => m.t === "stopped" && resolve(m)));
      Atomics.store(new Int32Array(memory.buffer), STOP_WORD >> 2, 1);
      const result = await stopped;
      await worker.terminate();
      return result;
    },
  };
}

function runCalls(shim, memory, calls, { pollNs, maxPolls = 0 }) {
  const u8 = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);
  let lost = 0;
  let wrong = 0;
  let x = 0x2545f491;
  for (let call = 0; call < calls; call += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const len = 1 + ((x >>> 0) % 255);
    let sum = 7;
    for (let i = 0; i < len; i += 1) {
      const byte = (x + i * 31) & 0xff;
      u8[REQ + i] = byte;
      sum += byte;
    }
    const seq = shim.mb_submit(MAILBOX, 7, REQ, len);
    assert.ok(seq > 0, `submit ${call} got ${seq}`);
    const status = shim.mb_wait(MAILBOX, seq, pollNs, maxPolls);
    if (status === FLATSQL_LINK_PENDING || shim.mb_poll(MAILBOX, seq) !== 1) {
      lost += 1;
      continue;
    }
    const respPtr = view.getInt32(MAILBOX + FLATSQL_LINK_MAILBOX.RESP_PTR, true);
    const respLen = view.getInt32(MAILBOX + FLATSQL_LINK_MAILBOX.RESP_LEN, true);
    let ok = status === sum && respLen === len;
    for (let i = 0; ok && i < len; i += 1) {
      ok = shim.peek8(respPtr + i) === u8[REQ + len - 1 - i];
    }
    if (view.getBigUint64(MAILBOX + FLATSQL_LINK_MAILBOX.GENERATION, true) !== BigInt(seq) * 2n) ok = false;
    if (!ok) wrong += 1;
    assert.equal(shim.mb_release(MAILBOX, seq), 0);
  }
  return { lost, wrong };
}

test("shim v2 bytes are deterministic, valid, and pinned; v1 is unchanged", () => {
  assert.deepEqual(buildFlatsqlLinkShimV2Wasm(), FLATSQL_LINK_SHIM_V2_WASM);
  assert.ok(WebAssembly.validate(FLATSQL_LINK_SHIM_V2_WASM.slice().buffer));
  // sdn-server embeds this artifact for linked flows on format 2 (T7) and pins
  // the same digest. Update both together when the shim changes.
  assert.equal(
    createHash("sha256").update(FLATSQL_LINK_SHIM_V2_WASM).digest("hex"),
    "67d5b2d9bc2d1b346a14a253a586fd4d08c8056d54eb62701b48000585ed9613",
  );
  assert.equal(
    createHash("sha256").update(FLATSQL_LINK_SHIM_WASM).digest("hex"),
    "8d83e69b087c5b8c96b4f1377a607c77380f58f9e338073f91b1e43eee1f788b",
    "v1 stays byte-identical (port before delete: v1 serves today's linked flows)",
  );
});

test("shim v2 imports only the lane's SHARED memory and exports the mailbox protocol", () => {
  const mod = new WebAssembly.Module(FLATSQL_LINK_SHIM_V2_WASM.slice().buffer);
  assert.deepEqual(WebAssembly.Module.imports(mod), [
    { module: "flatsql", name: "memory", kind: "memory" },
  ]);
  assert.deepEqual(
    WebAssembly.Module.exports(mod).map((e) => e.name).sort(),
    [
      "count_frames", "fnv1a64", "load32_acquire", "mb_cancel", "mb_poll", "mb_release",
      "mb_submit", "mb_wait", "peek32", "peek64", "peek8", "poke32", "poke8", "store32_release",
    ],
  );
  const unshared = new WebAssembly.Memory({ initial: 1 });
  assert.throws(
    () => new WebAssembly.Instance(mod, { flatsql: { memory: unshared } }),
    "v2 refuses a non-shared memory: lanes live in shared memory",
  );
});

test("v2 keeps v1's helpers: fnv1a64 and count_frames over lane memory", async () => {
  const memory = laneMemory();
  const shim = (await instantiateFlatsqlLinkShimV2(memory)).exports;
  const bytes = new Uint8Array(1000).map((_, i) => (i * 131 + 7) & 0xff);
  new Uint8Array(memory.buffer).set(bytes, 4096);
  assert.equal(BigInt.asUintN(64, shim.fnv1a64(4096, 1000)).toString(16).padStart(16, "0"), fnv1a64Hex(bytes));
  const view = new DataView(memory.buffer);
  view.setUint32(512, 3, true);
  view.setUint32(519, 0, true);
  view.setUint32(523, 2, true);
  assert.equal(shim.count_frames(512, 17), 2);
});

for (const [label, laneOptions, pollNs] of [
  ["lane notifies", { notify: true }, 200_000n],
  ["lane NEVER notifies (another executor)", { notify: false }, 100_000n],
  ["client polls without waiting (poll_ns = 0)", { notify: true }, 0n],
]) {
  test(`10,000 calls against a stub lane lose 0 completions: ${label}`, async () => {
    const memory = laneMemory();
    const shim = (await instantiateFlatsqlLinkShimV2(memory)).exports;
    const lane = await startLane(memory, laneOptions);
    const started = performance.now();
    const { lost, wrong } = runCalls(shim, memory, 10_000, { pollNs });
    const elapsed = performance.now() - started;
    const { served } = await lane.stop();
    console.log(`[link-shim-v2] ${label}: 10000 calls in ${elapsed.toFixed(0)} ms, lost ${lost}, wrong ${wrong}`);
    assert.equal(lost, 0, "0 lost completions");
    assert.equal(wrong, 0, "every completion carried its own request's answer");
    assert.equal(served, 10_000);
  });
}

test("waits are bounded: max_polls returns PENDING, and a later wait still completes", async () => {
  const memory = laneMemory();
  const shim = (await instantiateFlatsqlLinkShimV2(memory)).exports;
  new Uint8Array(memory.buffer).set([1, 2, 3], REQ);
  const seq = shim.mb_submit(MAILBOX, 1, REQ, 3);
  assert.equal(shim.mb_submit(MAILBOX, 1, REQ, 3), FLATSQL_LINK_BUSY, "one request per mailbox");
  const before = performance.now();
  assert.equal(shim.mb_wait(MAILBOX, seq, 1_000_000n, 5), FLATSQL_LINK_PENDING, "no lane yet");
  const waited = performance.now() - before;
  assert.ok(waited >= 4 && waited < 1000, `five 1 ms polls took ${waited.toFixed(1)} ms`);
  assert.equal(shim.mb_release(MAILBOX, seq), -1, "not complete, not releasable");
  const lane = await startLane(memory, { notify: false });
  assert.equal(shim.mb_wait(MAILBOX, seq, 1_000_000n, 0), 1 + 1 + 2 + 3);
  assert.equal(shim.mb_release(MAILBOX, seq), 0);
  assert.equal(new Int32Array(memory.buffer)[MAILBOX >> 2], FLATSQL_LINK_STATE.IDLE);
  await lane.stop();
});

test("mb_cancel reaches a running lane request", async () => {
  const memory = laneMemory();
  const shim = (await instantiateFlatsqlLinkShimV2(memory)).exports;
  const lane = await startLane(memory, { notify: true, slowMs: 5_000, cancelStatus: -125 });
  new Uint8Array(memory.buffer).set([9], REQ);
  const seq = shim.mb_submit(MAILBOX, 1, REQ, 1);
  // Let the lane claim it, then cancel.
  while (new Int32Array(memory.buffer)[MAILBOX >> 2] !== FLATSQL_LINK_STATE.CLAIMED) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const before = performance.now();
  assert.equal(shim.mb_cancel(MAILBOX, seq), 0);
  assert.equal(shim.mb_wait(MAILBOX, seq, 1_000_000n, 0), -125);
  assert.ok(performance.now() - before < 1000, "the cancel ended the 5 s request early");
  assert.equal(shim.mb_release(MAILBOX, seq), 0);
  await lane.stop();
});
