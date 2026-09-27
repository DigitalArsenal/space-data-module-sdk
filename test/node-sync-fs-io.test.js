// The Node synchronous-fs flatsql_io provider (design §5.6): one shared
// virtual-handle table in a SAB, fds opened lazily per worker, revocation per
// A23, and the flags of §5.4 (CREATE_PARENTS, UNLINK_IF_UNUSED, OPEN_DEFERRED).
// The conformance script runs in flatsql-io-conformance.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createWasiThreadSpawn } from "../src/host/wasiThreadHost.js";
import {
  createNodeSyncFsIo,
  createNodeSyncFsIoTable,
  resetNodeSyncFsIoInstance,
  revokeNodeSyncFsIoInstance,
} from "../src/host/nodeSyncFsIo.js";
import {
  FLATSQL_IO_CREATE,
  FLATSQL_IO_CREATE_PARENTS,
  FLATSQL_IO_ERR_ACCESS,
  FLATSQL_IO_ERR_BADHANDLE,
  FLATSQL_IO_ERR_BUSY,
  FLATSQL_IO_OPEN_DEFERRED,
  FLATSQL_IO_READ,
  FLATSQL_IO_UNLINK_IF_UNUSED,
  FLATSQL_IO_WRITE,
} from "../src/host/flatsqlIoContract.js";
import {
  IO_OP,
  buildIoGuestWasm,
  readIoProgramResults,
  writeIoProgram,
} from "./support/flatsql-io/ioGuestWasm.mjs";

const RW = FLATSQL_IO_READ | FLATSQL_IO_WRITE;
const RWC = RW | FLATSQL_IO_CREATE;
const GUEST = new WebAssembly.Module(buildIoGuestWasm());
const encoder = new TextEncoder();

async function withRoot(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sdm-fsio-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function waitDone(memory, programs) {
  for (const program of programs) {
    const word = new Int32Array(memory.buffer, program.donePtr, 1);
    while (Atomics.load(word, 0) !== 1) {
      const waited = Atomics.waitAsync(word, 0, 0, 50);
      if (waited.async) await waited.value;
    }
  }
}

test("guest threads share virtual handles across workers; each worker opens its own fd lazily", async () => {
  await withRoot(async (root) => {
    const table = createNodeSyncFsIoTable();
    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const pool = await createWasiThreadSpawn({
      wasmModule: GUEST,
      memory,
      poolSize: 4,
      extraImports: [{ provider: "flatsql-io-node", root, table, instanceId: 1 }],
    });
    try {
      const pathBytes = encoder.encode("fsql2/p/00000007/d-000000.fsd");
      new Uint8Array(memory.buffer).set(pathBytes, 1024);
      // Thread 1 creates the file (with parents) and leaves the handle in its register.
      const opener = writeIoProgram(memory, 4096, [
        {
          kind: IO_OP.open,
          reg: 0,
          a: 1024,
          b: pathBytes.length,
          c: RWC | FLATSQL_IO_CREATE_PARENTS,
        },
      ]);
      assert.ok(pool.threadSpawn(opener.arg) > 0);
      await waitDone(memory, [opener]);
      const handle = readIoProgramResults(memory, opener).results[0];
      assert.ok(handle >= 0, `open returned ${handle}`);
      // Threads 2-4 write disjoint blocks through the SAME handle, then one syncs.
      const writers = [];
      for (let t = 0; t < 3; t += 1) {
        const src = 65536 + t * 8192;
        new Uint8Array(memory.buffer, src, 8192).fill(0x41 + t);
        const program = writeIoProgram(memory, 16384 + t * 1024, [
          { kind: IO_OP.write, reg: 0, a: src, b: 8192, off: t * 8192 },
          { kind: IO_OP.sync, reg: 0 },
        ]);
        new DataView(memory.buffer).setInt32(program.arg + 32 + 2 * 32, handle, true);
        writers.push(program);
      }
      for (const program of writers) assert.ok(pool.threadSpawn(program.arg) > 0);
      await waitDone(memory, writers);
      for (const program of writers) {
        assert.equal(readIoProgramResults(memory, program).errors, 0);
      }
      const onDisk = fs.readFileSync(path.join(root, "fsql2/p/00000007/d-000000.fsd"));
      assert.equal(onDisk.length, 3 * 8192);
      for (let t = 0; t < 3; t += 1) {
        assert.ok(onDisk.subarray(t * 8192, (t + 1) * 8192).every((b) => b === 0x41 + t));
      }
    } finally {
      await pool.terminateAll();
    }
  });
});

test("a stale handle is BADHANDLE in every worker, and stale fds are swept", async () => {
  await withRoot(async (root) => {
    const table = createNodeSyncFsIoTable({ maxHandles: 8 });
    const a = createNodeSyncFsIo({ root, table });
    const b = createNodeSyncFsIo({ root, table });
    const h = a.open("x.bin", RWC);
    assert.ok(h >= 0);
    assert.equal(b.writeFrom(h, encoder.encode("from-b"), 0), 6);
    assert.equal(b.localFdCount(), 1, "b opened its own fd lazily");
    assert.equal(a.close(h), 0);
    assert.equal(b.size(h), FLATSQL_IO_ERR_BADHANDLE, "b sees the close through the shared table");
    // The slot is reused with a new generation; the old handle stays dead.
    const h2 = a.open("y.bin", RWC);
    assert.notEqual(h2, h);
    assert.equal(b.size(h), FLATSQL_IO_ERR_BADHANDLE);
    assert.equal(b.close(h), FLATSQL_IO_ERR_BADHANDLE);
    b.open("z.bin", RWC); // an open sweeps stale fds
    assert.ok(b.localFdCount() <= 1, "the stale fd was closed");
  });
});

test("CREATE_PARENTS makes nested directories; UNLINK_IF_UNUSED is BUSY while any worker holds the path", async () => {
  await withRoot(async (root) => {
    const table = createNodeSyncFsIoTable();
    const a = createNodeSyncFsIo({ root, table });
    const b = createNodeSyncFsIo({ root, table });
    const h = a.open("fsql2/t/0000abcd/g-000000.fsg", RWC | FLATSQL_IO_CREATE_PARENTS);
    assert.ok(h >= 0);
    assert.ok(fs.statSync(path.join(root, "fsql2/t/0000abcd")).isDirectory());
    assert.equal(
      b.open("fsql2/t/0000abcd/g-000000.fsg", FLATSQL_IO_UNLINK_IF_UNUSED),
      FLATSQL_IO_ERR_BUSY,
    );
    assert.equal(a.close(h), 0);
    assert.equal(b.open("fsql2/t/0000abcd/g-000000.fsg", FLATSQL_IO_UNLINK_IF_UNUSED), 0);
    assert.equal(fs.existsSync(path.join(root, "fsql2/t/0000abcd/g-000000.fsg")), false);
  });
});

test("OPEN_DEFERRED is a plain synchronous open on Node (A38)", async () => {
  await withRoot(async (root) => {
    const io = createNodeSyncFsIo({ root, table: createNodeSyncFsIoTable() });
    const h = io.open("deferred.bin", RWC | FLATSQL_IO_OPEN_DEFERRED);
    assert.ok(h >= 0);
    assert.equal(io.writeFrom(h, encoder.encode("now"), 0), 3);
    assert.equal(io.close(h), 0);
  });
});

test("paths escaping the root, including through a planted symlink, are ACCESS", async () => {
  await withRoot(async (root) => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "sdm-fsio-outside-"));
    try {
      fs.symlinkSync(outside, path.join(root, "link"));
      const io = createNodeSyncFsIo({ root, table: createNodeSyncFsIoTable() });
      assert.equal(io.open("../escape.bin", RWC), FLATSQL_IO_ERR_ACCESS);
      assert.equal(io.open("link/planted.bin", RWC), FLATSQL_IO_ERR_ACCESS);
      assert.equal(fs.existsSync(path.join(outside, "planted.bin")), false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("revocation (A23): calls after revoke return ACCESS and nothing of the instance is written afterwards", async () => {
  await withRoot(async (root) => {
    const table = createNodeSyncFsIoTable();
    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const pool = await createWasiThreadSpawn({
      wasmModule: GUEST,
      memory,
      poolSize: 2,
      extraImports: [{ provider: "flatsql-io-node", root, table, instanceId: 3 }],
    });
    try {
      const pathBytes = encoder.encode("victim.bin");
      new Uint8Array(memory.buffer).set(pathBytes, 1024);
      new Uint8Array(memory.buffer, 65536, 4096).fill(7);
      // Open, then append 4 KiB blocks at growing offsets (one op per offset).
      const ops = [{ kind: IO_OP.open, reg: 0, a: 1024, b: pathBytes.length, c: RWC }];
      const BLOCKS = 3000;
      for (let i = 0; i < BLOCKS; i += 1) {
        ops.push({ kind: IO_OP.write, reg: 0, a: 65536, b: 4096, off: i * 4096 });
      }
      const program = writeIoProgram(memory, 131072, ops);
      assert.ok(pool.threadSpawn(program.arg) > 0);
      const file = path.join(root, "victim.bin");
      while (!fs.existsSync(file) || fs.statSync(file).size < 64 * 4096) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      revokeNodeSyncFsIoInstance(table, 3);
      const sizeAtRevoke = fs.statSync(file).size;
      await waitDone(memory, [program]);
      const { results, errors } = readIoProgramResults(memory, program);
      assert.equal(fs.statSync(file).size, sizeAtRevoke, "0 bytes written after revoke returned");
      assert.ok(errors > 0 && errors < BLOCKS, "the revoke landed mid-stream");
      assert.equal(results[results.length - 1], FLATSQL_IO_ERR_ACCESS);
      assert.equal(sizeAtRevoke, (BLOCKS - errors) * 4096, "every accepted write is on disk");
      resetNodeSyncFsIoInstance(table, 3);
    } finally {
      await pool.terminateAll();
    }
  });
});
