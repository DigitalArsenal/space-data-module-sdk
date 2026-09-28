// The SAB I/O request ring (sabIoChannel.js) and its server (flatsqlIoServer.js)
// under real guest threads: a wasi-threads guest (test/support/flatsql-io/
// ioGuestWasm.mjs) spawned by createWasiThreadSpawn with the built-in
// `{ provider: "flatsql-io" }` extraImports, so every call crosses the same
// imports -> channel -> I/O worker path the browser uses (design §5.5, A7,
// A36, A38). Node worker_threads stand in for browser workers here; the real
// browser runs are in opfs-io-worker.browser.test.js.

import test from "node:test";
import assert from "node:assert/strict";

import { createWasiThreadSpawn } from "../src/host/wasiThreadHost.js";
import { createFlatsqlIoServer } from "../src/host/flatsqlIoServer.js";
import { createFlatsqlIoMemoryBackend } from "../src/host/flatsqlIoMemoryBackend.js";
import { createFlatsqlIoWorker } from "../src/host/flatsqlIoWorkers.js";
import {
  SAB_IO_H_SERVED,
  createSabIoAsyncClient,
  createSabIoChannelBuffer,
  describeSabIoChannel,
  failPendingSabIoRequests,
  reclaimSabIoSlots,
  revokeSabIoInstance,
} from "../src/host/sabIoChannel.js";
import { createSabIoMirrorBuffer, createSabIoMirrorMatcher } from "../src/host/sabIoMirror.js";
import {
  FLATSQL_IO_TRACE_OPS,
  createFlatsqlIoTraceBuffer,
  readFlatsqlIoTrace,
} from "../src/host/flatsqlIoImports.js";
import {
  FLATSQL_IO_CREATE,
  FLATSQL_IO_CREATE_PARENTS,
  FLATSQL_IO_ERR_ACCESS,
  FLATSQL_IO_ERR_IO,
  FLATSQL_IO_OPEN_DEFERRED,
  FLATSQL_IO_READ,
  FLATSQL_IO_WRITE,
} from "../src/host/flatsqlIoContract.js";
import {
  IO_OP,
  buildIoGuestWasm,
  ioProgramDone,
  readIoProgramResults,
  writeIoProgram,
} from "./support/flatsql-io/ioGuestWasm.mjs";

const RWC = FLATSQL_IO_READ | FLATSQL_IO_WRITE | FLATSQL_IO_CREATE | FLATSQL_IO_CREATE_PARENTS;
const GUEST = new WebAssembly.Module(buildIoGuestWasm());
const encoder = new TextEncoder();

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function fill(memory, at, length, seed) {
  const bytes = new Uint8Array(memory.buffer, at, length);
  for (let i = 0; i < length; i += 1) bytes[i] = (seed * 131 + i * 7) & 0xff;
  return bytes;
}

function expected(length, seed) {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = (seed * 131 + i * 7) & 0xff;
  return bytes;
}

/** Lay out a path string in memory, returning [ptr, len]. */
function putPath(memory, at, text) {
  const bytes = encoder.encode(text);
  new Uint8Array(memory.buffer).set(bytes, at);
  return [at, bytes.length];
}

async function waitDone(memory, programs, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (const program of programs) {
    const word = new Int32Array(memory.buffer, program.donePtr, 1);
    while (Atomics.load(word, 0) !== 1) {
      if (Date.now() > deadline) throw new Error("guest threads did not finish");
      const waited = Atomics.waitAsync(word, 0, 0, 50);
      if (waited.async) await waited.value;
    }
  }
}

async function spawnPool({ memory, channels, instanceId, poolSize, trace, mirror }) {
  return createWasiThreadSpawn({
    wasmModule: GUEST,
    memory,
    poolSize,
    instanceId,
    extraImports: [
      {
        provider: "flatsql-io",
        instanceId,
        channels,
        ...(trace ? { trace: { buffer: trace } } : {}),
        ...(mirror ? { mirror } : {}),
      },
    ],
  });
}

function newMemory(pages = 256) {
  return new WebAssembly.Memory({ initial: pages, maximum: 4096, shared: true });
}

// Resolves once at least `ms` have passed on performance.now(), the clock the
// I/O trace measures with. A bare setTimeout(ms) can fire up to 1 ms early
// against that clock, because timers run on libuv's whole-millisecond loop
// time. A 1000 ms open once traced at 999.8 ms that way. The guest's traced
// interval contains this one, so a delay of `ms` here is at least `ms` in the
// trace.
async function delayAtLeast(ms) {
  const until = performance.now() + ms;
  for (let left = ms; left > 0; left = until - performance.now()) {
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(left)));
  }
}

// A backend wrapper that delays opens of matching paths (a slow getFileHandle)
// and slows each write call (a slow storage write) — the hazards the design's
// acceptance items are about.
function hazardBackend(inner, { openDelay = null, writeBusyMs = 0 } = {}) {
  return {
    kind: "hazard",
    async openFile(path, components, flags) {
      if (openDelay && openDelay.pattern.test(path)) {
        await delayAtLeast(openDelay.ms);
      }
      const file = inner.openFile(path, components, flags);
      if (!writeBusyMs) return file;
      return {
        ...file,
        read: file.read.bind(file),
        write(view, options) {
          const until = performance.now() + writeBusyMs;
          while (performance.now() < until) {
            // storage busy
          }
          return file.write(view, options);
        },
        truncate: file.truncate.bind(file),
        flush: file.flush.bind(file),
        getSize: file.getSize.bind(file),
        close: file.close.bind(file),
      };
    },
    exists: (path) => inner.exists(path),
    remove: (path) => inner.remove(path),
  };
}

for (const doorbell of ["atomics", "message"]) {
  test(`8 guest threads, mixed I/O through one I/O worker: 0 errors, 0 lost writes (${doorbell})`, async () => {
    const ioWorker = await createFlatsqlIoWorker({ backend: "memory", doorbell });
    const memory = newMemory();
    const instanceId = 1;
    assert.equal(await ioWorker.attachMemory(instanceId, memory), true);
    const pool = await spawnPool({ memory, channels: [ioWorker.buffer], instanceId, poolSize: 8 });
    const THREADS = 8;
    const BLOCKS = 32;
    const BLOCK = 4096;
    const programs = [];
    try {
      for (let t = 0; t < THREADS; t += 1) {
        const base = 64 * 1024 + t * 512 * 1024;
        const src = base + 1024;
        const dst = src + BLOCKS * BLOCK;
        fill(memory, src, BLOCKS * BLOCK, t + 1);
        const [ownPath, ownLen] = putPath(memory, base, `store/p/${t}/d-000000.fsd`);
        const [sharedPath, sharedLen] = putPath(memory, base + 256, "store/shared.bin");
        const ops = [
          { kind: IO_OP.open, reg: 0, a: ownPath, b: ownLen, c: RWC },
          { kind: IO_OP.open, reg: 1, a: sharedPath, b: sharedLen, c: RWC },
        ];
        for (let b = 0; b < BLOCKS; b += 1) {
          ops.push({ kind: IO_OP.write, reg: 0, a: src + b * BLOCK, b: BLOCK, off: b * BLOCK });
          ops.push({ kind: IO_OP.write, reg: 1, a: src + b * BLOCK, b: BLOCK, off: (t * BLOCKS + b) * BLOCK });
        }
        ops.push({ kind: IO_OP.sync, reg: 0 });
        ops.push({ kind: IO_OP.sync, reg: 1 });
        for (let b = 0; b < BLOCKS; b += 1) {
          ops.push({ kind: IO_OP.read, reg: 0, a: dst + b * BLOCK, b: BLOCK, off: b * BLOCK });
        }
        ops.push({ kind: IO_OP.size, reg: 0 });
        ops.push({ kind: IO_OP.close, reg: 0 });
        ops.push({ kind: IO_OP.close, reg: 1 });
        const program = writeIoProgram(memory, dst + BLOCKS * BLOCK + 64, ops);
        program.src = src;
        program.dst = dst;
        programs.push(program);
      }
      for (const program of programs) {
        assert.ok(pool.threadSpawn(program.arg) > 0, "spawn");
      }
      await waitDone(memory, programs);
      for (const [t, program] of programs.entries()) {
        const { results, errors } = readIoProgramResults(memory, program);
        assert.equal(errors, 0, `thread ${t}: no negative results`);
        assert.equal(results[results.length - 3], BLOCKS * BLOCK, `thread ${t}: file size`);
        const back = new Uint8Array(memory.buffer, program.dst, BLOCKS * BLOCK);
        assert.deepEqual(back, expected(BLOCKS * BLOCK, t + 1), `thread ${t}: read-back`);
      }
      // Read everything back through an independent client: no write was lost.
      const client = createSabIoAsyncClient({ buffer: ioWorker.buffer });
      const shared = await client.open("store/shared.bin", FLATSQL_IO_READ);
      for (let t = 0; t < THREADS; t += 1) {
        const own = await client.open(`store/p/${t}/d-000000.fsd`, FLATSQL_IO_READ);
        assert.deepEqual(await client.read(own, BLOCKS * BLOCK, 0), expected(BLOCKS * BLOCK, t + 1));
        await client.close(own);
        assert.deepEqual(
          await client.read(shared, BLOCKS * BLOCK, t * BLOCKS * BLOCK),
          expected(BLOCKS * BLOCK, t + 1),
        );
      }
      await client.close(shared);
      client.close$();
      const { stats, inventory } = await ioWorker.stats();
      assert.equal(inventory.handles, 0, "every handle closed");
      // Guest requests, plus the verifying client's (reads split into
      // slot-data-sized pieces).
      const pieces = Math.ceil((BLOCKS * BLOCK) / describeSabIoChannel(ioWorker.buffer).dataBytes);
      assert.equal(
        stats.served,
        THREADS * (3 * BLOCKS + 7) + 2 + THREADS * (2 + 2 * pieces),
        "every request was served by the worker",
      );
    } finally {
      await pool.terminateAll();
      await ioWorker.stop();
    }
  });
}

test("an open that resolves after 1 s blocks only its caller", async () => {
  const buffer = createSabIoChannelBuffer();
  const inner = createFlatsqlIoMemoryBackend();
  const server = createFlatsqlIoServer({
    buffer,
    backend: hazardBackend(inner, { openDelay: { pattern: /slow/, ms: 1000 } }),
  });
  server.start();
  const memory = newMemory();
  const instanceId = 3;
  server.attachMemory(instanceId, memory);
  const trace = createFlatsqlIoTraceBuffer(1 << 16);
  const pool = await spawnPool({ memory, channels: [buffer], instanceId, poolSize: 8, trace });
  try {
    // Seed the files the fast threads read.
    const seedClient = createSabIoAsyncClient({ buffer });
    for (let t = 0; t < 7; t += 1) {
      const h = await seedClient.open(`fast/${t}.bin`, RWC);
      await seedClient.write(h, expected(64 * 1024, t), 0);
      await seedClient.close(h);
    }
    seedClient.close$();

    const programs = [];
    const startedAt = performance.now();
    // The slow thread: one open whose getFileHandle takes 1 s.
    {
      const base = 32 * 1024;
      const [p, l] = putPath(memory, base, "slow/partition/d-000001.fsd");
      const program = writeIoProgram(memory, base + 512, [
        { kind: IO_OP.open, reg: 0, a: p, b: l, c: RWC },
        { kind: IO_OP.close, reg: 0 },
      ]);
      program.slow = true;
      programs.push(program);
    }
    for (let t = 0; t < 7; t += 1) {
      const base = 128 * 1024 + t * 64 * 1024;
      const [p, l] = putPath(memory, base, `fast/${t}.bin`);
      const program = writeIoProgram(
        memory,
        base + 512,
        [
          { kind: IO_OP.open, reg: 0, a: p, b: l, c: FLATSQL_IO_READ },
          { kind: IO_OP.read, reg: 0, a: base + 8192, b: 4096, off: 4096 * (t + 1) },
          { kind: IO_OP.close, reg: 0 },
        ],
        { loops: 100 },
      );
      programs.push(program);
    }
    for (const program of programs) assert.ok(pool.threadSpawn(program.arg) > 0);
    await waitDone(memory, programs.slice(1));
    const fastDoneMs = performance.now() - startedAt;
    const slowDoneBeforeFast = ioProgramDone(memory, programs[0]);
    await waitDone(memory, programs.slice(0, 1));
    const slowDoneMs = performance.now() - startedAt;

    for (const program of programs) {
      assert.equal(readIoProgramResults(memory, program).errors, 0);
    }
    const samples = readFlatsqlIoTrace(trace).samples;
    const opens = samples.filter((s) => s.op === FLATSQL_IO_TRACE_OPS.open);
    const reads = samples.filter((s) => s.op === FLATSQL_IO_TRACE_OPS.read).map((s) => s.micros);
    const slowOpen = Math.max(...opens.map((s) => s.micros));
    const readP99 = percentile(reads, 99);
    console.log(
      `[slow-open] slow open ${(slowOpen / 1000).toFixed(1)} ms; ${reads.length} fast reads, ` +
        `p50 ${percentile(reads, 50).toFixed(0)} us p99 ${readP99.toFixed(0)} us; ` +
        `fast threads done at ${fastDoneMs.toFixed(0)} ms, slow at ${slowDoneMs.toFixed(0)} ms`,
    );
    assert.ok(slowOpen >= 1_000_000, "the slow open waited for its 1 s getFileHandle");
    assert.equal(reads.length, 7 * 100, "every fast read ran");
    assert.equal(slowDoneBeforeFast, false, "the slow thread was still blocked when the fast ones finished");
    assert.ok(fastDoneMs < 1000, "the fast threads never waited for the slow open");
    assert.ok(
      Math.max(...reads) < 500_000,
      `no fast read waited for the open (max ${Math.max(...reads).toFixed(0)} us, p99 ${readP99.toFixed(0)} us)`,
    );
  } finally {
    await pool.terminateAll();
    await server.stop();
  }
});

test("OPEN_DEFERRED returns a handle at once; the first use waits for the open", async () => {
  const buffer = createSabIoChannelBuffer();
  const server = createFlatsqlIoServer({
    buffer,
    backend: hazardBackend(createFlatsqlIoMemoryBackend(), { openDelay: { pattern: /next/, ms: 300 } }),
  });
  server.start();
  const memory = newMemory();
  server.attachMemory(0, memory);
  const trace = createFlatsqlIoTraceBuffer(64);
  const pool = await spawnPool({ memory, channels: [buffer], instanceId: 0, poolSize: 1, trace });
  try {
    const [p, l] = putPath(memory, 1024, "p/1/d-000002.next");
    fill(memory, 8192, 16, 9);
    const program = writeIoProgram(memory, 4096, [
      { kind: IO_OP.open, reg: 0, a: p, b: l, c: RWC | FLATSQL_IO_OPEN_DEFERRED },
      { kind: IO_OP.write, reg: 0, a: 8192, b: 16, off: 0 },
      { kind: IO_OP.size, reg: 0 },
      { kind: IO_OP.close, reg: 0 },
    ]);
    assert.ok(pool.threadSpawn(program.arg) > 0);
    await waitDone(memory, [program]);
    const { results, errors } = readIoProgramResults(memory, program);
    assert.equal(errors, 0);
    assert.deepEqual(results.slice(1), [16, 16, 0]);
    const samples = readFlatsqlIoTrace(trace).samples;
    const open = samples.find((s) => s.op === FLATSQL_IO_TRACE_OPS.open).micros;
    const write = samples.find((s) => s.op === FLATSQL_IO_TRACE_OPS.write).micros;
    console.log(`[deferred] open returned in ${(open / 1000).toFixed(2)} ms, first write waited ${(write / 1000).toFixed(1)} ms`);
    assert.ok(open < 100_000, "the deferred open returned before its 300 ms open finished");
    assert.ok(write >= 150_000, "the first write waited for the pending open");
  } finally {
    await pool.terminateAll();
    await server.stop();
  }
});

test("revocation: later requests get ACCESS, handles close, and no byte is written after revoke resolves", async () => {
  const buffer = createSabIoChannelBuffer();
  const backend = createFlatsqlIoMemoryBackend();
  const server = createFlatsqlIoServer({ buffer, backend });
  server.start();
  const memory = newMemory();
  const instanceId = 5;
  server.attachMemory(instanceId, memory);
  // Two threads: Node reports a thread's exit asynchronously, so the second
  // program must not depend on the first worker having been reaped.
  const pool = await spawnPool({ memory, channels: [buffer], instanceId, poolSize: 2 });
  const observer = createSabIoAsyncClient({ buffer });
  try {
    const [p, l] = putPath(memory, 1024, "victim/d.bin");
    fill(memory, 8192, 4096, 1);
    const WRITES = 4000;
    // Thread 1 opens; thread 2 then rewrites a 4 KiB block WRITES times through
    // the same handle, so the revoke lands mid-stream.
    const opener = writeIoProgram(memory, 65536, [{ kind: IO_OP.open, reg: 0, a: p, b: l, c: RWC }]);
    const appender = writeIoProgram(memory, 70000, [{ kind: IO_OP.write, reg: 0, a: 8192, b: 4096, off: 0 }], {
      loops: WRITES,
    });
    assert.ok(pool.threadSpawn(opener.arg) > 0);
    await waitDone(memory, [opener]);
    const handle = readIoProgramResults(memory, opener).results[0];
    new DataView(memory.buffer).setInt32(appender.arg + 32 + 32, handle, true); // appender regs[0]
    const chunksBeforeAppends = server.stats.chunks;
    assert.ok(pool.threadSpawn(appender.arg) > 0);
    // Revoke once the appender is well into its stream.
    while (server.stats.chunks - chunksBeforeAppends < 100) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const servedBefore = Atomics.load(describeSabIoChannel(buffer).header, SAB_IO_H_SERVED);
    await revokeSabIoInstance(buffer, instanceId);
    const servedAtRevoke = Atomics.load(describeSabIoChannel(buffer).header, SAB_IO_H_SERVED);
    const statsAtRevoke = { ...server.stats };
    await waitDone(memory, [appender]);
    const { results, errors } = readIoProgramResults(memory, appender);
    assert.ok(servedAtRevoke >= servedBefore);
    assert.equal(results[0], FLATSQL_IO_ERR_ACCESS, "the last append after revoke got ACCESS");
    assert.ok(errors > 0, "appends after the revoke failed");
    assert.ok(errors < WRITES, "the revoke landed mid-stream");
    // No write was serviced after revoke resolved: every later request was refused.
    assert.equal(server.stats.chunks, statsAtRevoke.chunks, "0 chunks written after revoke");
    assert.equal(server.inventory().handles, 0, "the revoked instance's handles are closed");
    // Another (unrevoked) caller still works.
    const h = await observer.open("victim/d.bin", FLATSQL_IO_READ);
    assert.ok(h >= 0);
    assert.equal(await observer.size(h), 4096);
    await observer.close(h);
  } finally {
    observer.close$();
    await pool.terminateAll();
    await server.stop();
  }
});

test("a dead I/O worker completes pending requests with an error; the guest never throws (A36)", async () => {
  const buffer = createSabIoChannelBuffer();
  const never = {
    kind: "never",
    openFile: () => new Promise(() => {}),
    exists: () => false,
    remove: () => {},
  };
  const server = createFlatsqlIoServer({ buffer, backend: never });
  server.start();
  const memory = newMemory();
  server.attachMemory(0, memory);
  const pool = await spawnPool({ memory, channels: [buffer], instanceId: 0, poolSize: 1 });
  try {
    const [p, l] = putPath(memory, 1024, "hangs/forever.bin");
    const program = writeIoProgram(memory, 4096, [
      { kind: IO_OP.open, reg: 0, a: p, b: l, c: RWC },
      { kind: IO_OP.size, reg: 0 },
    ]);
    assert.ok(pool.threadSpawn(program.arg) > 0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(ioProgramDone(memory, program), false, "the guest is blocked on the open");
    // The supervisor's reaction to the I/O worker's onerror.
    await server.stop();
    assert.equal(failPendingSabIoRequests(buffer, FLATSQL_IO_ERR_IO), 1);
    // The guest resumes: its open failed with IO; the next request waits for
    // a replacement server, which answers BADHANDLE for the stale handle.
    const replacement = createFlatsqlIoServer({ buffer, backend: createFlatsqlIoMemoryBackend() });
    replacement.start();
    replacement.attachMemory(0, memory);
    await waitDone(memory, [program]);
    const { results } = readIoProgramResults(memory, program);
    assert.equal(results[0], FLATSQL_IO_ERR_IO);
    assert.ok(results[1] < 0, "a stale handle is refused by the replacement");
    await replacement.stop();
  } finally {
    await pool.terminateAll();
  }
});

test("the I/O worker controller supervises: kill -> onError, pending failed, restart serves again", async () => {
  const errors = [];
  const ioWorker = await createFlatsqlIoWorker({
    backend: "memory",
    restart: true,
    onError: (error, info) => errors.push({ message: String(error?.message ?? error), ...info }),
  });
  const client = createSabIoAsyncClient({ buffer: ioWorker.buffer });
  try {
    const h = await client.open("a/b.bin", RWC);
    assert.ok(h >= 0);
    ioWorker.kill();
    assert.equal(errors.length, 1);
    assert.equal(errors[0].restarted, true);
    // Wait for the replacement to come up, then use the channel again.
    for (let i = 0; i < 100 && !ioWorker.info; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(ioWorker.info, "the replacement started");
    assert.equal(ioWorker.restarts, 1);
    assert.ok((await client.size(h)) < 0, "handles do not survive a dead worker");
    const again = await client.open("a/c.bin", RWC);
    assert.ok(again >= 0, "the replacement serves new opens");
    await client.close(again);
  } finally {
    client.close$();
    await ioWorker.stop();
  }
});

test("writes are serviced in <= 256 KiB steps, and small reads interleave with a large write", async () => {
  const buffer = createSabIoChannelBuffer();
  const server = createFlatsqlIoServer({
    buffer,
    backend: hazardBackend(createFlatsqlIoMemoryBackend(), { writeBusyMs: 4 }),
  });
  server.start();
  const memory = newMemory(512);
  server.attachMemory(0, memory);
  const trace = createFlatsqlIoTraceBuffer(1 << 14);
  const pool = await spawnPool({ memory, channels: [buffer], instanceId: 0, poolSize: 2, trace });
  const seed = createSabIoAsyncClient({ buffer });
  try {
    const h = await seed.open("tail/sealed.bin", RWC);
    await seed.write(h, expected(8192, 1), 0);
    await seed.close(h);
    const BIG = 4 * 1024 * 1024;
    fill(memory, 8 * 1024 * 1024, BIG, 3);
    const [wp, wl] = putPath(memory, 1024, "tail/active.bin");
    const writer = writeIoProgram(memory, 2048, [
      { kind: IO_OP.open, reg: 0, a: wp, b: wl, c: RWC },
      { kind: IO_OP.write, reg: 0, a: 8 * 1024 * 1024, b: BIG, off: 0 },
      { kind: IO_OP.close, reg: 0 },
    ]);
    const [rp, rl] = putPath(memory, 16384, "tail/sealed.bin");
    const reader = writeIoProgram(
      memory,
      20000,
      [
        { kind: IO_OP.open, reg: 0, a: rp, b: rl, c: FLATSQL_IO_READ },
        { kind: IO_OP.read, reg: 0, a: 32768, b: 4096, off: 4096 },
        { kind: IO_OP.close, reg: 0 },
      ],
      { loops: 20 },
    );
    const chunksBefore = server.stats.chunks;
    assert.ok(pool.threadSpawn(writer.arg) > 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(pool.threadSpawn(reader.arg) > 0);
    await waitDone(memory, [writer, reader]);
    assert.equal(readIoProgramResults(memory, writer).results[1], BIG);
    assert.equal(readIoProgramResults(memory, reader).errors, 0);
    const samples = readFlatsqlIoTrace(trace).samples;
    const write = samples.find((s) => s.op === FLATSQL_IO_TRACE_OPS.write).micros;
    const reads = samples.filter((s) => s.op === FLATSQL_IO_TRACE_OPS.read).map((s) => s.micros);
    console.log(
      `[chunking] 4 MiB write took ${(write / 1000).toFixed(1)} ms in ${server.stats.chunks - chunksBefore - reads.length} steps; ` +
        `4 KiB reads p99 ${percentile(reads, 99).toFixed(0)} us`,
    );
    assert.ok(server.stats.chunks - chunksBefore >= 16 + reads.length, "the write ran in >= 16 steps of 256 KiB");
    assert.ok(write >= 16 * 4000, "each step paid the slow storage write");
    assert.ok(Math.max(...reads) < write * 0.75, "no read waited for the whole write");
  } finally {
    seed.close$();
    await pool.terminateAll();
    await server.stop();
  }
});

test("head mirror (A7): a reader's head reads come from the SAB mirror, byte-identical, with no I/O worker round trip", async () => {
  const buffer = createSabIoChannelBuffer();
  const mirror = createSabIoMirrorBuffer({ entries: 64 });
  const server = createFlatsqlIoServer({
    buffer,
    backend: createFlatsqlIoMemoryBackend(),
    mirror: { buffer: mirror, match: createSabIoMirrorMatcher(["/h.fsh"]), write: true },
  });
  server.start();
  const writerMemory = newMemory();
  const readerMemory = newMemory();
  server.attachMemory(1, writerMemory);
  server.attachMemory(2, readerMemory);
  const trace = createFlatsqlIoTraceBuffer(256);
  const mirrorDescriptor = { buffer: mirror, suffixes: ["/h.fsh"] };
  const writerPool = await spawnPool({ memory: writerMemory, channels: [buffer], instanceId: 1, poolSize: 1 });
  const readerPool = await spawnPool({
    memory: readerMemory,
    channels: [buffer],
    instanceId: 2,
    poolSize: 1,
    trace,
    mirror: mirrorDescriptor,
  });
  try {
    const [p, l] = putPath(writerMemory, 1024, "fsql2/p/00000001/h.fsh");
    fill(writerMemory, 8192, 8192, 11);
    const writer = writeIoProgram(writerMemory, 4096, [
      { kind: IO_OP.open, reg: 0, a: p, b: l, c: RWC },
      { kind: IO_OP.write, reg: 0, a: 8192, b: 4096, off: 0 },
      { kind: IO_OP.write, reg: 0, a: 8192 + 4096, b: 4096, off: 4096 },
    ]);
    assert.ok(writerPool.threadSpawn(writer.arg) > 0);
    await waitDone(writerMemory, [writer]);
    assert.equal(readIoProgramResults(writerMemory, writer).errors, 0);

    const [rp, rl] = putPath(readerMemory, 1024, "fsql2/p/00000001/h.fsh");
    const reader = writeIoProgram(readerMemory, 4096, [
      { kind: IO_OP.open, reg: 0, a: rp, b: rl, c: FLATSQL_IO_READ },
      { kind: IO_OP.read, reg: 0, a: 16384, b: 4096, off: 4096 },
      { kind: IO_OP.read, reg: 0, a: 20480, b: 64, off: 8190 },
      { kind: IO_OP.close, reg: 0 },
    ]);
    const servedBefore = Atomics.load(describeSabIoChannel(buffer).header, SAB_IO_H_SERVED);
    assert.ok(readerPool.threadSpawn(reader.arg) > 0);
    await waitDone(readerMemory, [reader]);
    const servedAfter = Atomics.load(describeSabIoChannel(buffer).header, SAB_IO_H_SERVED);
    const { results, errors } = readIoProgramResults(readerMemory, reader);
    assert.equal(errors, 0);
    assert.equal(results[1], 4096, "slot B from the mirror");
    assert.equal(results[2], 2, "short read at EOF, from the mirror");
    assert.deepEqual(
      new Uint8Array(readerMemory.buffer, 16384, 4096),
      expected(8192, 11).subarray(4096),
      "mirror bytes equal the file",
    );
    assert.equal(servedAfter - servedBefore, 2, "only open and close reached the I/O worker");
    const mirrorReads = readFlatsqlIoTrace(trace).samples.filter(
      (s) => s.op === FLATSQL_IO_TRACE_OPS.mirrorRead,
    );
    assert.equal(mirrorReads.length, 2);
  } finally {
    await writerPool.terminateAll();
    await readerPool.terminateAll();
    await server.stop();
  }
});

test("scratch (unattached) and direct (attached) transfers move identical bytes", async () => {
  const buffer = createSabIoChannelBuffer({ dataBytes: 8192 });
  const server = createFlatsqlIoServer({ buffer, backend: createFlatsqlIoMemoryBackend() });
  server.start();
  const memory = newMemory();
  // Instance 4 is never attached: its requests take the slot data area.
  const pool = await spawnPool({ memory, channels: [buffer], instanceId: 4, poolSize: 1 });
  try {
    const [p, l] = putPath(memory, 1024, "scratch/f.bin");
    fill(memory, 65536, 100_000, 21);
    const program = writeIoProgram(memory, 4096, [
      { kind: IO_OP.open, reg: 0, a: p, b: l, c: RWC },
      { kind: IO_OP.write, reg: 0, a: 65536, b: 100_000, off: 3 },
      { kind: IO_OP.read, reg: 0, a: 262144, b: 100_000, off: 3 },
      { kind: IO_OP.close, reg: 0 },
    ]);
    assert.ok(pool.threadSpawn(program.arg) > 0);
    await waitDone(memory, [program]);
    const { results, errors } = readIoProgramResults(memory, program);
    assert.equal(errors, 0);
    assert.deepEqual(results.slice(1, 3), [100_000, 100_000]);
    assert.deepEqual(new Uint8Array(memory.buffer, 262144, 100_000), expected(100_000, 21));
    const client = createSabIoAsyncClient({ buffer });
    const h = await client.open("scratch/f.bin", FLATSQL_IO_READ);
    assert.deepEqual(await client.read(h, 100_000, 3), expected(100_000, 21));
    await client.close(h);
    client.close$();
  } finally {
    await pool.terminateAll();
    await server.stop();
  }
});

test("pre-open (A38, §5.5): a pre-opened path's guest open returns at once while its first open paid the delay", async () => {
  const buffer = createSabIoChannelBuffer();
  const server = createFlatsqlIoServer({
    buffer,
    backend: hazardBackend(createFlatsqlIoMemoryBackend(), { openDelay: { pattern: /d-0000/, ms: 200 } }),
  });
  server.start();
  const memory = newMemory();
  server.attachMemory(0, memory);
  const trace = createFlatsqlIoTraceBuffer(64);
  const pool = await spawnPool({ memory, channels: [buffer], instanceId: 0, poolSize: 1, trace });
  try {
    const paths = ["p/1/d-000001.fsd", "p/2/d-000001.fsd", "p/3/d-000001.fsd"];
    const started = performance.now();
    const statuses = await server.preopen(paths, RWC);
    const preopenMs = performance.now() - started;
    assert.deepEqual(statuses, [0, 0, 0]);
    assert.ok(preopenMs < 400, `the three opens ran in parallel (${preopenMs.toFixed(0)} ms)`);
    assert.equal(server.inventory().files.filter((f) => f.pins === 1).length, 3);
    const [p, l] = putPath(memory, 1024, paths[1]);
    fill(memory, 8192, 64, 4);
    const program = writeIoProgram(memory, 4096, [
      { kind: IO_OP.open, reg: 0, a: p, b: l, c: RWC },
      { kind: IO_OP.write, reg: 0, a: 8192, b: 64, off: 0 },
      { kind: IO_OP.close, reg: 0 },
    ]);
    assert.ok(pool.threadSpawn(program.arg) > 0);
    await waitDone(memory, [program]);
    assert.equal(readIoProgramResults(memory, program).errors, 0);
    const open = readFlatsqlIoTrace(trace).samples.find((s) => s.op === FLATSQL_IO_TRACE_OPS.open);
    assert.ok(open.micros < 100_000, `the guest open took ${(open.micros / 1000).toFixed(2)} ms, not 200`);
    // The pinned file stays open after the guest closes; releasing the pin closes it.
    assert.equal(server.inventory().files.length, 3);
    server.releasePreopen(paths);
    assert.equal(server.inventory().files.length, 0);
  } finally {
    await pool.terminateAll();
    await server.stop();
  }
});

test("two reader I/O workers (A7): opens are routed by path hash and every later call reaches the same worker", async () => {
  const servers = [];
  const buffers = [];
  const backends = [];
  for (let i = 0; i < 2; i += 1) {
    const buffer = createSabIoChannelBuffer();
    const backend = createFlatsqlIoMemoryBackend();
    const server = createFlatsqlIoServer({ buffer, backend });
    server.start();
    servers.push(server);
    buffers.push(buffer);
    backends.push(backend);
  }
  const memory = newMemory();
  for (const server of servers) server.attachMemory(6, memory);
  const pool = await spawnPool({ memory, channels: buffers, instanceId: 6, poolSize: 1 });
  try {
    const FILES = 16;
    const ops = [];
    for (let i = 0; i < FILES; i += 1) {
      const [p, l] = putPath(memory, 1024 + i * 64, `sealed/${i}/d-000000.fsd`);
      ops.push({ kind: IO_OP.open, reg: i % 16, a: p, b: l, c: RWC });
    }
    fill(memory, 65536, 4096, 8);
    for (let i = 0; i < FILES; i += 1) {
      ops.push({ kind: IO_OP.write, reg: i % 16, a: 65536, b: 4096, off: i });
      ops.push({ kind: IO_OP.size, reg: i % 16 });
    }
    for (let i = 0; i < FILES; i += 1) ops.push({ kind: IO_OP.close, reg: i % 16 });
    const program = writeIoProgram(memory, 16384, ops);
    assert.ok(pool.threadSpawn(program.arg) > 0);
    await waitDone(memory, [program]);
    const { results, errors } = readIoProgramResults(memory, program);
    assert.equal(errors, 0);
    for (let i = 0; i < FILES; i += 1) {
      assert.equal(results[FILES + 2 * i + 1], 4096 + i, `file ${i} size through its own worker`);
    }
    const listed = backends.map((backend) => backend.list());
    assert.ok(listed[0].length > 0 && listed[1].length > 0, "both workers hold files");
    assert.equal(listed[0].length + listed[1].length, FILES, "each file lives in exactly one worker");
    assert.equal(new Set([...listed[0], ...listed[1]]).size, FILES);
  } finally {
    await pool.terminateAll();
    for (const server of servers) await server.stop();
  }
});

test("terminated pools leak no request slots: 10 pools of 8 threads on a 16-slot ring all complete", async () => {
  const buffer = createSabIoChannelBuffer({ slots: 16 });
  const server = createFlatsqlIoServer({ buffer, backend: createFlatsqlIoMemoryBackend() });
  server.start();
  const memory = newMemory();
  server.attachMemory(0, memory);
  try {
    for (let round = 0; round < 10; round += 1) {
      const pool = await spawnPool({ memory, channels: [buffer], instanceId: 0, poolSize: 8 });
      const programs = [];
      for (let t = 0; t < 8; t += 1) {
        const base = 65536 + t * 8192;
        const [p, l] = putPath(memory, base, `round/${round}/${t}.bin`);
        programs.push(
          writeIoProgram(memory, base + 1024, [
            { kind: IO_OP.open, reg: 0, a: p, b: l, c: RWC },
            { kind: IO_OP.write, reg: 0, a: base + 4096, b: 64, off: 0 },
            { kind: IO_OP.close, reg: 0 },
          ]),
        );
      }
      for (const program of programs) assert.ok(pool.threadSpawn(program.arg) > 0);
      await waitDone(memory, programs);
      for (const program of programs) assert.equal(readIoProgramResults(memory, program).errors, 0);
      await pool.terminateAll();
    }
    const layout = describeSabIoChannel(buffer);
    const busy = layout.slots.filter((slot) => Atomics.load(slot.i32, 0) !== 0).length;
    assert.equal(busy, 0, "every slot is free after the pools are gone");
  } finally {
    await server.stop();
  }
});

test("reclaimSabIoSlots frees the completed, never-read slots of a dead instance", async () => {
  const buffer = createSabIoChannelBuffer({ slots: 4 });
  const layout = describeSabIoChannel(buffer);
  // Two slots left DONE by instance 7 (its threads died before reading), one
  // still PENDING (the server owns it), one belonging to instance 1.
  const mark = (index, state, instanceId) => {
    Atomics.store(layout.slots[index].i32, 5, instanceId);
    Atomics.store(layout.slots[index].i32, 0, state);
  };
  mark(0, 4, 7);
  mark(1, 4, 7);
  mark(2, 2, 7);
  mark(3, 4, 1);
  assert.equal(reclaimSabIoSlots(buffer, 7), 2);
  assert.deepEqual(
    layout.slots.map((slot) => Atomics.load(slot.i32, 0)),
    [0, 0, 2, 4],
  );
});
