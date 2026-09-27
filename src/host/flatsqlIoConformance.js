// One `flatsql_io` conformance script for every host (docs/architecture/
// flatsql-partition-store.md 22.3a-6: "Run one flatsql_io conformance script on
// all three hosts").
//
// It drives a provider through the contract's observable behaviour: statuses,
// short reads, sparse writes, truncation both ways, flag semantics (EXCL,
// TRUNC, PROBE, UNLINK, UNLINK_IF_UNUSED, CREATE_PARENTS, DELETE_ON_CLOSE,
// OPEN_DEFERRED), access modes, confinement and multi-handle visibility. The
// same cases run against the Node sync-fs provider, the SAB channel over the
// memory backend, and the SAB channel over OPFS in real browsers; a host that
// differs fails by name.
//
// A provider for this script exposes (sync or async; every call is awaited):
//   open(path: string | Uint8Array, flags) -> handle | status
//   readInto(handle, view: Uint8Array, offset) -> count | status
//   writeFrom(handle, view: Uint8Array, offset) -> count | status
//   truncate(handle, size) / sync(handle) / close(handle) -> status
//   size(handle) -> number | status

import {
  FLATSQL_IO_CREATE,
  FLATSQL_IO_CREATE_PARENTS,
  FLATSQL_IO_DELETE_ON_CLOSE,
  FLATSQL_IO_ERR_ACCESS,
  FLATSQL_IO_ERR_BADHANDLE,
  FLATSQL_IO_ERR_BUSY,
  FLATSQL_IO_ERR_GENERIC,
  FLATSQL_IO_ERR_IO,
  FLATSQL_IO_ERR_NOENT,
  FLATSQL_IO_EXCL,
  FLATSQL_IO_OPEN_DEFERRED,
  FLATSQL_IO_PROBE,
  FLATSQL_IO_READ,
  FLATSQL_IO_TRUNC,
  FLATSQL_IO_UNLINK,
  FLATSQL_IO_UNLINK_IF_UNUSED,
  FLATSQL_IO_WRITE,
} from "./flatsqlIoContract.js";

const RW = FLATSQL_IO_READ | FLATSQL_IO_WRITE;
const RWC = RW | FLATSQL_IO_CREATE;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function pattern(length, seed) {
  const bytes = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    bytes[i] = x & 0xff;
  }
  return bytes;
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

class ConformanceFailure extends Error {}

function expect(condition, message) {
  if (!condition) throw new ConformanceFailure(message);
}

function expectStatus(actual, expected, what) {
  expect(actual === expected, `${what}: expected ${expected}, got ${actual}`);
}

function expectHandle(actual, what) {
  expect(Number.isInteger(actual) && actual >= 0, `${what}: expected a handle, got ${actual}`);
}

/**
 * The cases, in order. Each gets `(io, dir)` where `dir` is a fresh directory
 * prefix for the case.
 */
export const FLATSQL_IO_CONFORMANCE_CASES = Object.freeze([
  {
    name: "open without CREATE on a missing file is NOENT",
    async run(io, dir) {
      expectStatus(await io.open(`${dir}/missing.bin`, RW), FLATSQL_IO_ERR_NOENT, "open");
    },
  },
  {
    name: "create, write, size, short read at EOF, read past EOF",
    async run(io, dir) {
      const h = await io.open(`${dir}/a.bin`, RWC);
      expectHandle(h, "open");
      expectStatus(await io.writeFrom(h, encoder.encode("hello"), 0), 5, "write");
      expectStatus(await io.size(h), 5, "size");
      const buf = new Uint8Array(10);
      expectStatus(await io.readInto(h, buf, 0), 5, "short read");
      expect(decoder.decode(buf.subarray(0, 5)) === "hello", "short read bytes");
      expectStatus(await io.readInto(h, new Uint8Array(4), 5), 0, "read at EOF");
      expectStatus(await io.readInto(h, new Uint8Array(4), 100), 0, "read past EOF");
      expectStatus(await io.close(h), 0, "close");
    },
  },
  {
    name: "a write past EOF extends the file and the gap reads as zeros",
    async run(io, dir) {
      const h = await io.open(`${dir}/sparse.bin`, RWC);
      expectHandle(h, "open");
      expectStatus(await io.writeFrom(h, encoder.encode("ab"), 0), 2, "write head");
      expectStatus(await io.writeFrom(h, encoder.encode("z"), 100), 1, "write past EOF");
      expectStatus(await io.size(h), 101, "size");
      const gap = new Uint8Array(98);
      gap.fill(0xee);
      expectStatus(await io.readInto(h, gap, 2), 98, "read gap");
      expect(gap.every((b) => b === 0), "gap is zeros");
      expectStatus(await io.close(h), 0, "close");
    },
  },
  {
    name: "truncate shrinks and grows; grown bytes read as zeros",
    async run(io, dir) {
      const h = await io.open(`${dir}/t.bin`, RWC);
      expectHandle(h, "open");
      await io.writeFrom(h, encoder.encode("abcdefgh"), 0);
      expectStatus(await io.truncate(h, 3), 0, "truncate down");
      expectStatus(await io.size(h), 3, "size after shrink");
      expectStatus(await io.truncate(h, 10), 0, "truncate up");
      expectStatus(await io.size(h), 10, "size after grow");
      const buf = new Uint8Array(10);
      expectStatus(await io.readInto(h, buf, 0), 10, "read");
      expect(decoder.decode(buf.subarray(0, 3)) === "abc", "kept prefix");
      expect(buf.subarray(3).every((b) => b === 0), "grown tail is zeros");
      expectStatus(await io.sync(h), 0, "sync");
      expectStatus(await io.close(h), 0, "close");
    },
  },
  {
    name: "closed and bogus handles are BADHANDLE",
    async run(io, dir) {
      const h = await io.open(`${dir}/c.bin`, RWC);
      expectHandle(h, "open");
      expectStatus(await io.close(h), 0, "close");
      expectStatus(await io.close(h), FLATSQL_IO_ERR_BADHANDLE, "close again");
      expectStatus(await io.readInto(h, new Uint8Array(1), 0), FLATSQL_IO_ERR_BADHANDLE, "read");
      expectStatus(await io.size(0x7fff00), FLATSQL_IO_ERR_BADHANDLE, "bogus size");
    },
  },
  {
    name: "PROBE reports existence without a handle",
    async run(io, dir) {
      const h = await io.open(`${dir}/p.bin`, RWC);
      expectHandle(h, "open");
      await io.close(h);
      expectStatus(await io.open(`${dir}/p.bin`, FLATSQL_IO_PROBE), 0, "probe existing");
      expectStatus(await io.open(`${dir}/nope.bin`, FLATSQL_IO_PROBE), FLATSQL_IO_ERR_NOENT, "probe missing");
    },
  },
  {
    name: "EXCL on an existing file is GENERIC; TRUNC empties it",
    async run(io, dir) {
      const h = await io.open(`${dir}/x.bin`, RWC);
      expectHandle(h, "open");
      await io.writeFrom(h, encoder.encode("data"), 0);
      await io.close(h);
      expectStatus(
        await io.open(`${dir}/x.bin`, RWC | FLATSQL_IO_EXCL),
        FLATSQL_IO_ERR_GENERIC,
        "EXCL",
      );
      const t = await io.open(`${dir}/x.bin`, RW | FLATSQL_IO_TRUNC);
      expectHandle(t, "TRUNC open");
      expectStatus(await io.size(t), 0, "size after TRUNC");
      await io.close(t);
    },
  },
  {
    name: "CREATE under a missing directory is NOENT; CREATE_PARENTS makes it",
    async run(io, dir) {
      expectStatus(
        await io.open(`${dir}/p/00000001/h.fsh`, RWC),
        FLATSQL_IO_ERR_NOENT,
        "no parents",
      );
      const h = await io.open(`${dir}/p/00000001/h.fsh`, RWC | FLATSQL_IO_CREATE_PARENTS);
      expectHandle(h, "CREATE_PARENTS");
      expectStatus(await io.writeFrom(h, encoder.encode("head"), 0), 4, "write");
      await io.close(h);
      expectStatus(await io.open(`${dir}/p/00000001/h.fsh`, FLATSQL_IO_PROBE), 0, "probe");
    },
  },
  {
    name: "UNLINK_IF_UNUSED is BUSY while a handle is open; UNLINK removes",
    async run(io, dir) {
      const h = await io.open(`${dir}/u.bin`, RWC);
      expectHandle(h, "open");
      expectStatus(
        await io.open(`${dir}/u.bin`, FLATSQL_IO_UNLINK_IF_UNUSED),
        FLATSQL_IO_ERR_BUSY,
        "unlink while open",
      );
      await io.close(h);
      expectStatus(await io.open(`${dir}/u.bin`, FLATSQL_IO_UNLINK_IF_UNUSED), 0, "unlink unused");
      expectStatus(await io.open(`${dir}/u.bin`, FLATSQL_IO_PROBE), FLATSQL_IO_ERR_NOENT, "gone");
      expectStatus(await io.open(`${dir}/u.bin`, FLATSQL_IO_UNLINK), FLATSQL_IO_ERR_NOENT, "unlink missing");
      const again = await io.open(`${dir}/v.bin`, RWC);
      await io.close(again);
      expectStatus(await io.open(`${dir}/v.bin`, FLATSQL_IO_UNLINK), 0, "plain unlink");
    },
  },
  {
    name: "DELETE_ON_CLOSE drops the file with its last handle",
    async run(io, dir) {
      const h = await io.open(`${dir}/tmp.bin`, RWC | FLATSQL_IO_DELETE_ON_CLOSE);
      expectHandle(h, "open");
      await io.writeFrom(h, encoder.encode("scratch"), 0);
      expectStatus(await io.close(h), 0, "close");
      // Hosts that delete asynchronously finish before the next namespace op.
      expectStatus(await io.open(`${dir}/tmp.bin`, FLATSQL_IO_PROBE), FLATSQL_IO_ERR_NOENT, "probe");
    },
  },
  {
    name: "paths are confined below the root",
    async run(io, dir) {
      expectStatus(await io.open(`${dir}/../../escape.bin`, RWC), FLATSQL_IO_ERR_ACCESS, "..");
      expectStatus(await io.open("", RWC), FLATSQL_IO_ERR_GENERIC, "empty path");
    },
  },
  {
    name: "access modes: read-only handles refuse writes, write-only refuse reads",
    async run(io, dir) {
      const h = await io.open(`${dir}/m.bin`, RWC);
      await io.writeFrom(h, encoder.encode("mode"), 0);
      await io.close(h);
      const ro = await io.open(`${dir}/m.bin`, FLATSQL_IO_READ);
      expectHandle(ro, "read-only open");
      expectStatus(await io.writeFrom(ro, encoder.encode("x"), 0), FLATSQL_IO_ERR_IO, "write on RO");
      expectStatus(await io.truncate(ro, 0), FLATSQL_IO_ERR_IO, "truncate on RO");
      await io.close(ro);
      const wo = await io.open(`${dir}/m.bin`, FLATSQL_IO_WRITE);
      expectHandle(wo, "write-only open");
      expectStatus(await io.readInto(wo, new Uint8Array(2), 0), FLATSQL_IO_ERR_IO, "read on WO");
      await io.close(wo);
    },
  },
  {
    name: "OPEN_DEFERRED: a failed open surfaces at open or at first use",
    async run(io, dir) {
      const h = await io.open(`${dir}/deferred-missing.bin`, RW | FLATSQL_IO_OPEN_DEFERRED);
      if (h < 0) {
        expectStatus(h, FLATSQL_IO_ERR_NOENT, "sync host");
      } else {
        expectStatus(await io.readInto(h, new Uint8Array(1), 0), FLATSQL_IO_ERR_NOENT, "first use");
        expectStatus(await io.close(h), 0, "close failed deferred");
      }
      const ok = await io.open(`${dir}/deferred.bin`, RWC | FLATSQL_IO_OPEN_DEFERRED);
      expectHandle(ok, "deferred create");
      expectStatus(await io.writeFrom(ok, encoder.encode("later"), 0), 5, "write after deferred");
      expectStatus(await io.size(ok), 5, "size");
      await io.close(ok);
    },
  },
  {
    name: "two handles on one path see each other's writes",
    async run(io, dir) {
      const a = await io.open(`${dir}/shared.bin`, RWC);
      const b = await io.open(`${dir}/shared.bin`, RW);
      expectHandle(a, "a");
      expectHandle(b, "b");
      await io.writeFrom(a, encoder.encode("from-a"), 0);
      const buf = new Uint8Array(6);
      expectStatus(await io.readInto(b, buf, 0), 6, "read via b");
      expect(decoder.decode(buf) === "from-a", "b sees a");
      await io.writeFrom(b, encoder.encode("B"), 0);
      const one = new Uint8Array(1);
      await io.readInto(a, one, 0);
      expect(one[0] === 0x42, "a sees b");
      await io.close(a);
      await io.close(b);
    },
  },
  {
    name: "1 MiB round trip across chunk boundaries at an unaligned offset",
    async run(io, dir) {
      const h = await io.open(`${dir}/big.bin`, RWC);
      expectHandle(h, "open");
      const data = pattern(1024 * 1024 + 17, 0x9e3779b9);
      expectStatus(await io.writeFrom(h, data, 4093), data.length, "write");
      expectStatus(await io.size(h), 4093 + data.length, "size");
      const back = new Uint8Array(data.length);
      expectStatus(await io.readInto(h, back, 4093), data.length, "read");
      expect(equalBytes(back, data), "bytes round trip");
      await io.close(h);
    },
  },
]);

/**
 * Run the conformance cases against `io`.
 *
 * @param {object} io provider (see the file header)
 * @param {object} [options]
 * @param {string} [options.prefix="conformance"] directory for the cases
 * @param {string[]} [options.skip] case names to skip, each with a reason in
 *   `options.skipReasons`
 * @returns {Promise<{ passed: string[], failed: { name: string, error: string }[], skipped: string[] }>}
 */
export async function runFlatsqlIoConformance(io, options = {}) {
  const prefix = options.prefix ?? "conformance";
  const skip = new Set(options.skip ?? []);
  const passed = [];
  const failed = [];
  const skipped = [];
  let index = 0;
  for (const testCase of FLATSQL_IO_CONFORMANCE_CASES) {
    index += 1;
    if (skip.has(testCase.name)) {
      skipped.push(testCase.name);
      continue;
    }
    const dir = `${prefix}/case-${String(index).padStart(2, "0")}`;
    // Every case starts from its own existing directory.
    const seed = await io.open(`${dir}/.keep`, RWC | FLATSQL_IO_CREATE_PARENTS);
    if (seed >= 0) await io.close(seed);
    try {
      await testCase.run(io, dir);
      passed.push(testCase.name);
    } catch (error) {
      failed.push({ name: testCase.name, error: String(error?.message ?? error) });
    }
  }
  return { passed, failed, skipped };
}

/** Adapt the async channel client (bytes-returning read) to the script's shape. */
export function conformanceAdapterForAsyncClient(client) {
  return {
    open: (path, flags) => client.open(path, flags),
    async readInto(handle, view, offset) {
      const result = await client.read(handle, view.length, offset);
      if (typeof result === "number") return result;
      view.set(result, 0);
      return result.length;
    },
    writeFrom: (handle, view, offset) => client.write(handle, view, offset),
    truncate: (handle, size) => client.truncate(handle, size),
    sync: (handle) => client.sync(handle),
    size: (handle) => client.size(handle),
    close: (handle) => client.close(handle),
  };
}
