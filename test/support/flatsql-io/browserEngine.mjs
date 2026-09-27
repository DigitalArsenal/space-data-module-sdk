// Engine-worker driver for the real-browser T9 suite
// (test/opfs-io-worker.browser.test.js). The page spawns this as a CLASSIC
// worker from a blob: URL (it is bundled as an IIFE, like the dashboard's
// engine worker, A39); it then spawns the wasi-threads pool and the FlatSQL I/O
// workers from the SDK's self-contained blob bundles, under the dashboard's
// CSP (`worker-src 'self' blob:`) and COOP/COEP.
//
// Each scenario returns plain measurements; the Node test asserts on them.

import { createWasiThreadSpawn } from "../../../src/host/wasiThreadHost.js";
import { createFlatsqlIoWorker } from "../../../src/host/flatsqlIoWorkers.js";
import { hostWorkerBundleUrl } from "../../../src/host/hostWorkerBundles.js";
import {
  createSabIoAsyncClient,
  createSabIoChannelBuffer,
  revokeSabIoInstance,
} from "../../../src/host/sabIoChannel.js";
import { createSabIoMirrorBuffer } from "../../../src/host/sabIoMirror.js";
import {
  FLATSQL_IO_TRACE_OPS,
  createFlatsqlIoTraceBuffer,
  readFlatsqlIoTrace,
} from "../../../src/host/flatsqlIoImports.js";
import {
  conformanceAdapterForAsyncClient,
  runFlatsqlIoConformance,
} from "../../../src/host/flatsqlIoConformance.js";
import { probeWorkerCapabilities } from "../../../src/host/browserCapabilityProbe.js";
import {
  FLATSQL_IO_CREATE,
  FLATSQL_IO_CREATE_PARENTS,
  FLATSQL_IO_OPEN_DEFERRED,
  FLATSQL_IO_PROBE,
  FLATSQL_IO_READ,
  FLATSQL_IO_UNLINK,
  FLATSQL_IO_WRITE,
} from "../../../src/host/flatsqlIoContract.js";
import {
  IO_OP,
  buildIoGuestWasm,
  ioProgramDone,
  readIoProgramResults,
  writeIoProgram,
} from "./ioGuestWasm.mjs";

const RWC = FLATSQL_IO_READ | FLATSQL_IO_WRITE | FLATSQL_IO_CREATE | FLATSQL_IO_CREATE_PARENTS;
const GUEST = new WebAssembly.Module(buildIoGuestWasm());
const encoder = new TextEncoder();
const KiB = 1024;
const MiB = 1024 * 1024;

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function summarize(values) {
  return {
    n: values.length,
    p50: percentile(values, 50),
    p99: percentile(values, 99),
    max: values.length ? Math.max(...values) : null,
  };
}

function timerResolutionMicros() {
  let best = Infinity;
  let last = performance.now();
  for (let i = 0; i < 200000 && best > 0.001; i += 1) {
    const now = performance.now();
    if (now !== last) {
      best = Math.min(best, now - last);
      last = now;
    }
  }
  return best * 1000;
}

function pattern(length, seed) {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = (seed * 131 + i * 7) & 0xff;
  return bytes;
}

function putPath(memory, at, text) {
  const bytes = encoder.encode(text);
  new Uint8Array(memory.buffer).set(bytes, at);
  return [at, bytes.length];
}

function newMemory(pages) {
  return new WebAssembly.Memory({ initial: pages, maximum: 16384, shared: true });
}

async function waitDone(memory, programs, timeoutMs = 120_000) {
  const deadline = performance.now() + timeoutMs;
  for (const program of programs) {
    const word = new Int32Array(memory.buffer, program.donePtr, 1);
    while (Atomics.load(word, 0) !== 1) {
      if (performance.now() > deadline) throw new Error("guest threads did not finish");
      const waited = Atomics.waitAsync(word, 0, 0, 20);
      if (waited.async) await waited.value;
    }
  }
}

/**
 * A guest's done flag is set before its pool worker reports the thread's exit
 * to this event loop; wait until the pool has `count` idle workers again.
 */
async function awaitIdle(pool, count = 1) {
  for (let i = 0; i < 10_000; i += 1) {
    if ((pool.spawnReport().idle ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("pool workers never returned to idle");
}

let runCounter = 0;
function runDirectory(name) {
  runCounter += 1;
  return `sdm-t9/${name}-${Date.now().toString(36)}-${runCounter}`;
}

async function startIo(options = {}) {
  return createFlatsqlIoWorker({
    lock: options.lock,
    busyRetry: options.busyRetry,
    workerUrl: hostWorkerBundleUrl("flatsql-io"),
    workerType: "classic",
    backend: options.backend ?? "opfs",
    role: options.role ?? "writer",
    doorbell: options.doorbell ?? "auto",
    rootDirectory: options.rootDirectory,
    openDelay: options.openDelay,
    mirror: options.mirror,
    buffer: options.buffer,
    restart: options.restart,
    onError: options.onError,
    channel: options.channel,
  });
}

async function startPool({ memory, channels, instanceId, poolSize, trace, mirror, onGuestError }) {
  return createWasiThreadSpawn({
    wasmModule: GUEST,
    memory,
    poolSize,
    instanceId,
    enableBrowserThreads: true,
    probeTimeoutMs: 10_000,
    browserWorkerUrl: hostWorkerBundleUrl("wasi-thread-pool"),
    browserWorkerType: "classic",
    onGuestError,
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

function traceMicros(trace, op) {
  return readFlatsqlIoTrace(trace)
    .samples.filter((s) => s.op === op)
    .map((s) => s.micros);
}

async function seedFile(client, path, bytes) {
  const h = await client.open(path, RWC);
  if (h < 0) throw new Error(`seed open ${path}: ${h}`);
  const n = await client.write(h, bytes, 0);
  if (n !== bytes.length) throw new Error(`seed write ${path}: ${n}`);
  await client.sync(h);
  await client.close(h);
}

// ---------------------------------------------------------------------------

/**
 * T9 #1 (original wording) and #4: 8 guest threads run mixed I/O through ONE
 * I/O worker while the engine performs 200 async opens and 50 unlinks.
 */
async function scenarioMixed({ doorbell = "auto" } = {}) {
  const root = runDirectory("mixed");
  const io = await startIo({ rootDirectory: root, doorbell });
  const memory = newMemory(1024);
  await io.attachMemory(1, memory);
  const trace = createFlatsqlIoTraceBuffer(1 << 16);
  const pool = await startPool({ memory, channels: [io.buffer], instanceId: 1, poolSize: 8, trace });
  const client = createSabIoAsyncClient({ buffer: io.buffer });
  const THREADS = 8;
  const BLOCKS = 32;
  const BLOCK = 4 * KiB;
  const READ_PASSES = 4;
  try {
    const programs = [];
    for (let t = 0; t < THREADS; t += 1) {
      const base = 64 * KiB + t * 512 * KiB;
      const src = base + KiB;
      const dst = src + BLOCKS * BLOCK;
      new Uint8Array(memory.buffer, src, BLOCKS * BLOCK).set(pattern(BLOCKS * BLOCK, t + 1));
      const [own, ownLen] = putPath(memory, base, `p/${t}/d-000000.fsd`);
      const [shared, sharedLen] = putPath(memory, base + 256, "shared.fsd");
      const ops = [
        { kind: IO_OP.open, reg: 0, a: own, b: ownLen, c: RWC },
        { kind: IO_OP.open, reg: 1, a: shared, b: sharedLen, c: RWC },
      ];
      for (let b = 0; b < BLOCKS; b += 1) {
        ops.push({ kind: IO_OP.write, reg: 0, a: src + b * BLOCK, b: BLOCK, off: b * BLOCK });
        ops.push({ kind: IO_OP.write, reg: 1, a: src + b * BLOCK, b: BLOCK, off: (t * BLOCKS + b) * BLOCK });
      }
      ops.push({ kind: IO_OP.sync, reg: 0 }, { kind: IO_OP.sync, reg: 1 });
      for (let pass = 0; pass < READ_PASSES; pass += 1) {
        for (let b = 0; b < BLOCKS; b += 1) {
          ops.push({ kind: IO_OP.read, reg: 0, a: dst + b * BLOCK, b: BLOCK, off: b * BLOCK });
        }
      }
      ops.push({ kind: IO_OP.close, reg: 0 }, { kind: IO_OP.close, reg: 1 });
      const program = writeIoProgram(memory, dst + BLOCKS * BLOCK + 64, ops);
      program.dst = dst;
      programs.push(program);
    }
    const started = performance.now();
    for (const program of programs) {
      if (!(pool.threadSpawn(program.arg) > 0)) throw new Error("spawn declined");
    }
    // Meanwhile: 200 async opens (new files, new directories) and 50 unlinks.
    const opens = [];
    const namespaceErrors = [];
    for (let i = 0; i < 200; i += 1) {
      opens.push(
        (async () => {
          const h = await client.open(`opens/${i % 20}/f-${i}.bin`, RWC);
          if (h < 0) namespaceErrors.push(`open ${i}: ${h}`);
          else {
            await client.write(h, pattern(64, i), 0);
            await client.close(h);
          }
        })(),
      );
    }
    await Promise.all(opens);
    const unlinks = [];
    for (let i = 0; i < 50; i += 1) {
      unlinks.push(
        client.open(`opens/${(i * 4) % 20}/f-${i * 4}.bin`, FLATSQL_IO_UNLINK).then((status) => {
          if (status !== 0) namespaceErrors.push(`unlink ${i * 4}: ${status}`);
        }),
      );
    }
    await Promise.all(unlinks);
    await waitDone(memory, programs);
    const elapsedMs = performance.now() - started;

    let guestErrors = 0;
    let lostWrites = 0;
    for (const [t, program] of programs.entries()) {
      guestErrors += readIoProgramResults(memory, program).errors;
      const back = new Uint8Array(memory.buffer, program.dst, BLOCKS * BLOCK);
      const want = pattern(BLOCKS * BLOCK, t + 1);
      for (let i = 0; i < want.length; i += 1) {
        if (back[i] !== want[i]) {
          lostWrites += 1;
          break;
        }
      }
    }
    // Independent read-back of every file the threads wrote.
    const sharedHandle = await client.open("shared.fsd", FLATSQL_IO_READ);
    for (let t = 0; t < THREADS; t += 1) {
      const got = await client.read(sharedHandle, BLOCKS * BLOCK, t * BLOCKS * BLOCK);
      const want = pattern(BLOCKS * BLOCK, t + 1);
      if (typeof got === "number" || got.length !== want.length || got.some((b, i) => b !== want[i])) {
        lostWrites += 1;
      }
    }
    await client.close(sharedHandle);
    let survivors = 0;
    let unlinkedPresent = 0;
    for (let i = 0; i < 200; i += 1) {
      const exists = (await client.open(`opens/${i % 20}/f-${i}.bin`, FLATSQL_IO_PROBE)) === 0;
      const unlinked = i % 4 === 0 && i / 4 < 50;
      if (unlinked && exists) unlinkedPresent += 1;
      if (!unlinked && exists) survivors += 1;
    }
    const reads = traceMicros(trace, FLATSQL_IO_TRACE_OPS.read);
    return {
      doorbell: io.info.doorbellMode,
      sharedModes: io.info.sharedModes,
      sharedViews: io.info.sharedViews,
      guestErrors,
      namespaceErrors,
      lostWrites,
      survivors,
      unlinkedPresent,
      asyncOpens: 200,
      unlinks: 50,
      elapsedMs,
      read4k: summarize(reads),
      write4k: summarize(traceMicros(trace, FLATSQL_IO_TRACE_OPS.write)),
      spawnReport: pool.spawnReport(),
    };
  } finally {
    client.close$();
    await pool.terminateAll();
    await io.clear();
    await io.stop();
  }
}

/**
 * A7 (replaces T9 #1): lane 4 KiB reads while the WRITER I/O worker runs 100
 * back-to-back 4 MiB write-and-flush cycles, on the same partition and on
 * another. Writer and reader I/O workers are separate (A7); lanes read the
 * same partition's active file directly where shared handle modes exist
 * (Chromium), else its sealed segment (no local store there: §22.4-6).
 */
async function scenarioA7({ cycles = 100 } = {}) {
  const root = runDirectory("a7");
  const mirror = createSabIoMirrorBuffer({ entries: 64 });
  const writerIo = await startIo({ rootDirectory: root, role: "writer", mirror: { buffer: mirror, write: true } });
  const readerIo = await startIo({ rootDirectory: root, role: "reader", mirror: { buffer: mirror, write: false } });
  const seedClient = createSabIoAsyncClient({ buffer: writerIo.buffer });
  const sharedModes = writerIo.info.sharedModes === true && readerIo.info.sharedModes === true;
  await seedFile(seedClient, "p/00000001/d-000000.fsd", pattern(MiB, 1));
  await seedFile(seedClient, "p/00000002/d-000000.fsd", pattern(MiB, 2));
  await seedFile(seedClient, "p/00000001/d-000001.fsd", pattern(MiB, 3));
  seedClient.close$();

  const writerMemory = newMemory(1024);
  const readerMemory = newMemory(256);
  await writerIo.attachMemory(1, writerMemory);
  await readerIo.attachMemory(2, readerMemory);
  const writerTrace = createFlatsqlIoTraceBuffer(4096);
  // One lane pool per measured lane, each with its own trace.
  const sameTrace = createFlatsqlIoTraceBuffer(1 << 17);
  const otherTrace = createFlatsqlIoTraceBuffer(1 << 17);
  const writerPool = await startPool({ memory: writerMemory, channels: [writerIo.buffer], instanceId: 1, poolSize: 1, trace: writerTrace });
  const samePool = await startPool({ memory: readerMemory, channels: [readerIo.buffer], instanceId: 2, poolSize: 1, trace: sameTrace });
  const otherPool = await startPool({ memory: readerMemory, channels: [readerIo.buffer], instanceId: 2, poolSize: 1, trace: otherTrace });
  try {
    // Writer: append 4 MiB and flush, `cycles` times, to P's active segment.
    const SRC = 32 * MiB;
    new Uint8Array(writerMemory.buffer, SRC, 4 * MiB).set(pattern(4 * MiB, 5));
    const [wp, wl] = putPath(writerMemory, 1024, "p/00000001/d-000001.fsd");
    const writerOps = [{ kind: IO_OP.open, reg: 0, a: wp, b: wl, c: RWC }];
    for (let i = 0; i < cycles; i += 1) {
      writerOps.push({ kind: IO_OP.write, reg: 0, a: SRC, b: 4 * MiB, off: MiB + i * 4 * MiB });
      writerOps.push({ kind: IO_OP.sync, reg: 0 });
    }
    writerOps.push({ kind: IO_OP.close, reg: 0 });
    const writer = writeIoProgram(writerMemory, 4096, writerOps);

    // Lanes read committed bytes: the active segment's first MiB (Chromium,
    // shared handle modes) or the partition's sealed segment.
    const samePath = sharedModes ? "p/00000001/d-000001.fsd" : "p/00000001/d-000000.fsd";
    const laneProgram = (path, base, round) => {
      const [p, l] = putPath(readerMemory, base, path);
      const ops = [{ kind: IO_OP.open, reg: 0, a: p, b: l, c: FLATSQL_IO_READ }];
      for (let i = 0; i < 64; i += 1) {
        ops.push({
          kind: IO_OP.read,
          reg: 0,
          a: base + 8192,
          b: 4 * KiB,
          off: ((round * 64 + i) * 4 * KiB) % (MiB - 4 * KiB),
        });
      }
      ops.push({ kind: IO_OP.close, reg: 0 });
      return writeIoProgram(readerMemory, base + 4096, ops);
    };

    const started = performance.now();
    if (!(writerPool.threadSpawn(writer.arg) > 0)) throw new Error("writer spawn declined");
    let rounds = 0;
    let laneErrors = 0;
    const same = [];
    const other = [];
    while (!ioProgramDone(writerMemory, writer) && rounds < 100000) {
      const sameBefore = readFlatsqlIoTrace(sameTrace).recorded;
      const otherBefore = readFlatsqlIoTrace(otherTrace).recorded;
      const lanes = [
        laneProgram(samePath, 64 * KiB, rounds),
        laneProgram("p/00000002/d-000000.fsd", 256 * KiB, rounds),
      ];
      await awaitIdle(samePool);
      await awaitIdle(otherPool);
      if (!(samePool.threadSpawn(lanes[0].arg) > 0)) throw new Error("lane spawn declined");
      if (!(otherPool.threadSpawn(lanes[1].arg) > 0)) throw new Error("lane spawn declined");
      await waitDone(readerMemory, lanes);
      rounds += 1;
      for (const lane of lanes) laneErrors += readIoProgramResults(readerMemory, lane).errors;
      if (!ioProgramDone(writerMemory, writer)) {
        // Only rounds that ran entirely while the writer was writing count.
        for (const s of readFlatsqlIoTrace(sameTrace).samples.slice(sameBefore)) {
          if (s.op === FLATSQL_IO_TRACE_OPS.read) same.push(s.micros);
        }
        for (const s of readFlatsqlIoTrace(otherTrace).samples.slice(otherBefore)) {
          if (s.op === FLATSQL_IO_TRACE_OPS.read) other.push(s.micros);
        }
      }
    }
    await waitDone(writerMemory, [writer]);
    const writerMs = performance.now() - started;
    return {
      sharedModes,
      samePartitionFile: samePath,
      writerErrors: readIoProgramResults(writerMemory, writer).errors,
      laneErrors,
      cycles,
      writerMs,
      rounds,
      samePartition: summarize(same),
      otherPartition: summarize(other),
      writer4MiB: summarize(traceMicros(writerTrace, FLATSQL_IO_TRACE_OPS.write)),
      writerFlush: summarize(traceMicros(writerTrace, FLATSQL_IO_TRACE_OPS.sync)),
    };
  } finally {
    await writerPool.terminateAll();
    await samePool.terminateAll();
    await otherPool.terminateAll();
    await writerIo.clear();
    await writerIo.stop();
    await readerIo.stop();
  }
}

/** T9 #2 and A38: a 500 ms open blocks only its caller; OPEN_DEFERRED returns at once. */
async function scenarioSlowOpen() {
  const root = runDirectory("slow");
  const io = await startIo({ rootDirectory: root, openDelay: { pattern: "slow", ms: 500 } });
  const memory = newMemory(512);
  await io.attachMemory(1, memory);
  const client = createSabIoAsyncClient({ buffer: io.buffer });
  for (let t = 0; t < 7; t += 1) await seedFile(client, `fast/${t}.fsd`, pattern(256 * KiB, t));
  const run = async ({ slow, deferred }) => {
    const trace = createFlatsqlIoTraceBuffer(1 << 15);
    const pool = await startPool({ memory, channels: [io.buffer], instanceId: 1, poolSize: 8, trace });
    try {
      const programs = [];
      if (slow) {
        const [p, l] = putPath(memory, 16 * KiB, `slow/${deferred ? "deferred" : "plain"}-${Date.now()}.fsd`);
        new Uint8Array(memory.buffer, 20 * KiB, 16).fill(9);
        programs.push(
          writeIoProgram(memory, 24 * KiB, [
            { kind: IO_OP.open, reg: 0, a: p, b: l, c: RWC | (deferred ? FLATSQL_IO_OPEN_DEFERRED : 0) },
            { kind: IO_OP.write, reg: 0, a: 20 * KiB, b: 16, off: 0 },
            { kind: IO_OP.close, reg: 0 },
          ]),
        );
      }
      for (let t = 0; t < 7; t += 1) {
        const base = 128 * KiB + t * 64 * KiB;
        const [p, l] = putPath(memory, base, `fast/${t}.fsd`);
        const ops = [{ kind: IO_OP.open, reg: 0, a: p, b: l, c: FLATSQL_IO_READ }];
        // The read target sits past the ~13 KiB program laid out at base + 1 KiB.
        for (let i = 0; i < 300; i += 1) {
          ops.push({ kind: IO_OP.read, reg: 0, a: base + 32 * KiB, b: 4 * KiB, off: (i * 4 * KiB) % (256 * KiB) });
        }
        ops.push({ kind: IO_OP.close, reg: 0 });
        programs.push(writeIoProgram(memory, base + 1024, ops));
      }
      const started = performance.now();
      for (const program of programs) {
        if (!(pool.threadSpawn(program.arg) > 0)) throw new Error("spawn declined");
      }
      const fast = slow ? programs.slice(1) : programs;
      await waitDone(memory, fast);
      const fastMs = performance.now() - started;
      const slowStillBlocked = slow ? !ioProgramDone(memory, programs[0]) : null;
      await waitDone(memory, programs);
      const allMs = performance.now() - started;
      let errors = 0;
      for (const program of programs) errors += readIoProgramResults(memory, program).errors;
      const opens = traceMicros(trace, FLATSQL_IO_TRACE_OPS.open);
      const writes = traceMicros(trace, FLATSQL_IO_TRACE_OPS.write);
      return {
        errors,
        fastMs,
        allMs,
        slowStillBlocked,
        fastReads: summarize(traceMicros(trace, FLATSQL_IO_TRACE_OPS.read)),
        maxOpenMicros: opens.length ? Math.max(...opens) : null,
        minOpenMicros: opens.length ? Math.min(...opens) : null,
        slowWriteMicros: slow ? Math.max(...writes) : null,
      };
    } finally {
      await pool.terminateAll();
    }
  };
  try {
    // Alternate the conditions three times: p99 over one run is a handful of
    // samples, and the machine is shared. Report every run and the medians.
    const runs = { baseline: [], plain: [], deferred: [] };
    for (let round = 0; round < 3; round += 1) {
      runs.baseline.push(await run({ slow: false }));
      runs.plain.push(await run({ slow: true, deferred: false }));
      runs.deferred.push(await run({ slow: true, deferred: true }));
    }
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const p99 = (list) => median(list.map((r) => r.fastReads.p99));
    return {
      runs,
      baselineP99: p99(runs.baseline),
      plainP99: p99(runs.plain),
      deferredP99: p99(runs.deferred),
    };
  } finally {
    client.close$();
    await io.clear();
    await io.stop();
  }
}

/** T9 #3: poolSize=6 on hardwareConcurrency=2 spawns 6 workers; spawn 7 is -1 and reported. */
async function scenarioPoolSize() {
  const proto = Object.getPrototypeOf(self.navigator);
  const original = Object.getOwnPropertyDescriptor(proto, "hardwareConcurrency");
  Object.defineProperty(proto, "hardwareConcurrency", { get: () => 2, configurable: true });
  const root = runDirectory("pool");
  const io = await startIo({ rootDirectory: root });
  const memory = newMemory(512);
  await io.attachMemory(1, memory);
  const declined = [];
  let pool;
  try {
    const client = createSabIoAsyncClient({ buffer: io.buffer });
    await seedFile(client, "pool/data.fsd", pattern(64 * KiB, 1));
    client.close$();
    pool = await createWasiThreadSpawn({
      wasmModule: GUEST,
      memory,
      poolSize: 6,
      instanceId: 1,
      enableBrowserThreads: true,
      probeTimeoutMs: 10_000,
      browserWorkerUrl: hostWorkerBundleUrl("wasi-thread-pool"),
      browserWorkerType: "classic",
      onSpawnDeclined: (event) => declined.push(event),
      extraImports: [{ provider: "flatsql-io", instanceId: 1, channels: [io.buffer] }],
    });
    const programs = [];
    for (let t = 0; t < 6; t += 1) {
      const base = 64 * KiB + t * 32 * KiB;
      const [p, l] = putPath(memory, base, "pool/data.fsd");
      programs.push(
        writeIoProgram(
          memory,
          base + 1024,
          [
            { kind: IO_OP.open, reg: 0, a: p, b: l, c: FLATSQL_IO_READ },
            { kind: IO_OP.read, reg: 0, a: base + 8 * KiB, b: 4 * KiB, off: 0 },
            { kind: IO_OP.close, reg: 0 },
          ],
          { loops: 200 },
        ),
      );
    }
    const tids = programs.map((program) => pool.threadSpawn(program.arg));
    const seventh = pool.threadSpawn(programs[0].arg);
    const report = pool.spawnReport();
    await waitDone(memory, programs);
    let errors = 0;
    for (const program of programs) errors += readIoProgramResults(memory, program).errors;
    return {
      hardwareConcurrency: self.navigator.hardwareConcurrency,
      workers: pool.distinctOsThreadCount(),
      tids,
      seventh,
      declined,
      report,
      errors,
    };
  } finally {
    if (original) Object.defineProperty(proto, "hardwareConcurrency", original);
    else delete proto.hardwareConcurrency;
    await pool?.terminateAll();
    await io.clear();
    await io.stop();
  }
}

/** The flatsql_io conformance script against OPFS and the memory backend. */
async function scenarioConformance() {
  const out = {};
  for (const backend of ["opfs", "memory"]) {
    const io = await startIo({ backend, rootDirectory: runDirectory(`conf-${backend}`) });
    const client = createSabIoAsyncClient({ buffer: io.buffer });
    try {
      out[backend] = await runFlatsqlIoConformance(conformanceAdapterForAsyncClient(client), {
        prefix: "conformance",
      });
    } finally {
      client.close$();
      if (backend === "opfs") await io.clear();
      await io.stop();
    }
  }
  return out;
}

/** A36: guest traps reach onGuestError; a dead I/O worker fails pending requests; restart serves. */
async function scenarioSupervision() {
  const root = runDirectory("supervise");
  const ioErrors = [];
  const io = await startIo({
    rootDirectory: root,
    openDelay: { pattern: "hang", ms: 20_000 },
    restart: true,
    onError: (error, info) => ioErrors.push({ message: String(error?.message ?? error), ...info }),
  });
  const memory = newMemory(256);
  await io.attachMemory(9, memory);
  const guestErrors = [];
  const pool = await startPool({
    memory,
    channels: [io.buffer],
    instanceId: 9,
    poolSize: 2,
    onGuestError: (instanceId, tid, error) => guestErrors.push({ instanceId, tid, error: String(error) }),
  });
  try {
    // 1. A trapping guest thread (its program pointer is out of bounds).
    const trapTid = pool.threadSpawn(0x7ffffff0);
    for (let i = 0; i < 200 && guestErrors.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // 2. A guest blocked on an open when the I/O worker dies.
    const [p, l] = putPath(memory, 1024, "hang/forever.fsd");
    const program = writeIoProgram(memory, 4096, [
      { kind: IO_OP.open, reg: 0, a: p, b: l, c: RWC },
      { kind: IO_OP.size, reg: 0 },
    ]);
    if (!(pool.threadSpawn(program.arg) > 0)) throw new Error("spawn declined");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const blockedBeforeKill = !ioProgramDone(memory, program);
    io.worker.terminate();
    io.kill();
    await waitDone(memory, [program], 10_000);
    const { results } = readIoProgramResults(memory, program);
    for (let i = 0; i < 300 && !io.info; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await io.attachMemory(9, memory);
    const client = createSabIoAsyncClient({ buffer: io.buffer });
    const reopened = await client.open("after/restart.fsd", RWC);
    if (reopened >= 0) await client.close(reopened);
    client.close$();
    return {
      trapTid,
      guestErrors,
      blockedBeforeKill,
      pendingResult: results[0],
      nextResult: results[1],
      ioErrors,
      restarts: io.restarts,
      reopened,
    };
  } finally {
    await pool.terminateAll();
    await io.clear();
    await io.stop();
  }
}

/** A36: revoke an instance mid-stream; 0 bytes are written after revoke resolves. */
async function scenarioRevoke() {
  const root = runDirectory("revoke");
  const io = await startIo({ rootDirectory: root });
  const memory = newMemory(256);
  await io.attachMemory(4, memory);
  const pool = await startPool({ memory, channels: [io.buffer], instanceId: 4, poolSize: 1 });
  const observer = createSabIoAsyncClient({ buffer: io.buffer });
  try {
    const [p, l] = putPath(memory, 1024, "victim.fsd");
    new Uint8Array(memory.buffer, 65536, 4096).fill(7);
    const BLOCKS = 4000;
    const ops = [{ kind: IO_OP.open, reg: 0, a: p, b: l, c: RWC }];
    for (let i = 0; i < BLOCKS; i += 1) ops.push({ kind: IO_OP.write, reg: 0, a: 65536, b: 4096, off: i * 4096 });
    const program = writeIoProgram(memory, 131072, ops);
    if (!(pool.threadSpawn(program.arg) > 0)) throw new Error("spawn declined");
    const h = await (async () => {
      for (;;) {
        const handle = await observer.open("victim.fsd", FLATSQL_IO_READ);
        if (handle >= 0) return handle;
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    })();
    while ((await observer.size(h)) < 128 * 4096) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await revokeSabIoInstance(io.buffer, 4);
    const sizeAtRevoke = await observer.size(h);
    await waitDone(memory, [program]);
    const sizeAfter = await observer.size(h);
    const { results, errors } = readIoProgramResults(memory, program);
    await observer.close(h);
    return { blocks: BLOCKS, sizeAtRevoke, sizeAfter, errors, lastResult: results[results.length - 1] };
  } finally {
    observer.close$();
    await pool.terminateAll();
    await io.clear();
    await io.stop();
  }
}

/** §5.5 window store: the memory backend writes nothing to OPFS; reset drops it. */
async function scenarioWindowStore() {
  const opfsRoot = await navigator.storage.getDirectory();
  const listRoot = async () => {
    const names = [];
    for await (const name of opfsRoot.keys()) names.push(name);
    return names.sort();
  };
  const before = await listRoot();
  const io = await startIo({ backend: "memory" });
  const memory = newMemory(256);
  await io.attachMemory(1, memory);
  const pool = await startPool({ memory, channels: [io.buffer], instanceId: 1, poolSize: 2 });
  const client = createSabIoAsyncClient({ buffer: io.buffer });
  try {
    const programs = [];
    for (let t = 0; t < 2; t += 1) {
      const base = 64 * KiB + t * 64 * KiB;
      const [p, l] = putPath(memory, base, `window/${t}.fsd`);
      new Uint8Array(memory.buffer, base + 4096, 16384).set(pattern(16384, t));
      programs.push(
        writeIoProgram(memory, base + 1024, [
          { kind: IO_OP.open, reg: 0, a: p, b: l, c: RWC },
          { kind: IO_OP.write, reg: 0, a: base + 4096, b: 16384, off: 0 },
          { kind: IO_OP.sync, reg: 0 },
          { kind: IO_OP.close, reg: 0 },
        ]),
      );
    }
    for (const program of programs) pool.threadSpawn(program.arg);
    await waitDone(memory, programs);
    let errors = 0;
    for (const program of programs) errors += readIoProgramResults(memory, program).errors;
    const probeBefore = await client.open("window/0.fsd", FLATSQL_IO_PROBE);
    const usage = (await io.stats()).usage;
    await io.reset();
    const probeAfter = await client.open("window/0.fsd", FLATSQL_IO_PROBE);
    const after = await listRoot();
    return { errors, probeBefore, probeAfter, usage, opfsBefore: before, opfsAfter: after };
  } finally {
    client.close$();
    await pool.terminateAll();
    await io.stop();
  }
}

/**
 * A37 building block: the store lock lives in the writer I/O worker. A second
 * context with ifAvailable is refused; a waiting context takes over when the
 * holder stops (handles closed first) and opens the same files.
 */
async function scenarioLock() {
  const root = runDirectory("lock");
  const name = `sdn-flatsql-store/2/test-${Date.now().toString(36)}`;
  const leader = await startIo({ rootDirectory: root, lock: { name } });
  const leaderClient = createSabIoAsyncClient({ buffer: leader.buffer });
  const h = await leaderClient.open("p/00000001/h.fsh", RWC);
  await leaderClient.write(h, pattern(8192, 3), 0);
  await leaderClient.sync(h);
  leaderClient.close$();
  let refused = null;
  try {
    const intruder = await startIo({ rootDirectory: root, lock: { name, ifAvailable: true } });
    await intruder.stop();
    refused = false;
  } catch (error) {
    refused = error?.lockUnavailable === true;
  }
  let takeoverReady = false;
  const successorPromise = startIo({
    rootDirectory: root,
    lock: { name },
    busyRetry: { attempts: 8, baseMs: 5 },
  }).then((io) => {
    takeoverReady = true;
    return io;
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const waitedWhileHeld = takeoverReady === false;
  const stopAt = performance.now();
  await leader.stop();
  const successor = await successorPromise;
  const takeoverMs = performance.now() - stopAt;
  const client = createSabIoAsyncClient({ buffer: successor.buffer });
  try {
    const handle = await client.open("p/00000001/h.fsh", FLATSQL_IO_READ | FLATSQL_IO_WRITE);
    const bytes = handle >= 0 ? await client.read(handle, 8192, 0) : handle;
    const same =
      typeof bytes !== "number" && bytes.length === 8192 && bytes.every((b, i) => b === pattern(8192, 3)[i]);
    if (handle >= 0) await client.close(handle);
    return { refused, waitedWhileHeld, takeoverMs, reopened: handle, sameBytes: same, lock: successor.info.lock };
  } finally {
    client.close$();
    await successor.clear();
    await successor.stop();
  }
}

async function scenarioWorkerProbe() {
  return probeWorkerCapabilities();
}

const SCENARIOS = {
  mixed: scenarioMixed,
  a7: scenarioA7,
  slowOpen: scenarioSlowOpen,
  poolSize: scenarioPoolSize,
  conformance: scenarioConformance,
  supervision: scenarioSupervision,
  revoke: scenarioRevoke,
  windowStore: scenarioWindowStore,
  lock: scenarioLock,
  workerProbe: scenarioWorkerProbe,
  timer: async () => ({ resolutionMicros: timerResolutionMicros() }),
};

self.onmessage = async (event) => {
  const { id, scenario, options } = event.data ?? {};
  try {
    const fn = SCENARIOS[scenario];
    if (!fn) throw new Error(`unknown scenario ${scenario}`);
    const result = await fn(options ?? {});
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: `${error?.name ?? "Error"}: ${error?.message ?? error}\n${error?.stack ?? ""}` });
  }
};
self.postMessage({ ready: true, crossOriginIsolated: self.crossOriginIsolated === true });
