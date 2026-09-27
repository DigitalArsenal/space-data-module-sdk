// Small-file mirror in a SharedArrayBuffer: the A7 head mirror
// (docs/architecture/flatsql-partition-store.md §22 A7).
//
// "After each head pwrite, the writer I/O worker copies the slot into a per-pid
// seqlock mirror in a SharedArrayBuffer. In the browser, §8 step 3 reads the
// mirror, never a handle."
//
// The mirror knows nothing about heads. It keeps, per mirrored path, the first
// `entryBytes` bytes of the file plus the file's exact size, as last written
// through the writing I/O worker. A reader that consults it gets exactly what a
// read of the file would return (page-cache semantics: written, not
// necessarily flushed) without a round trip to any I/O worker, so a reader
// never queues behind a writer's flush for a head.
//
// Concurrency: one writer per path (the partition's single writer, law
// refinement 1), any number of readers. Each entry is a seqlock: the writer
// makes the sequence odd, copies, and makes it even; a reader retries when the
// sequence was odd or changed. Entries are found by open addressing on an
// FNV-1a hash of the path, and the path bytes are compared exactly.
//
// Layout (all little-endian):
//   header   Int32[16]: magic 'SDMR', version, entries, entryBytes, maxPathBytes
//   records  entries x 32 B: Int32 {state, seq, hash, pathLen, covered, rsv}
//                            Float64 fileSize at +24
//   paths    entries x maxPathBytes
//   data     entries x entryBytes

const MIRROR_MAGIC = 0x524d4453; // "SDMR"
const MIRROR_VERSION = 1;
const HEADER_WORDS = 16;
const RECORD_BYTES = 32;
const R_STATE = 0;
const R_SEQ = 1;
const R_HASH = 2;
const R_PATH_LEN = 3;
const R_COVERED = 4;
const R_F64_SIZE = 3; // Float64 index within the record

const STATE_EMPTY = 0;
const STATE_CLAIMING = 1;
const STATE_LIVE = 2;
const STATE_CLEARED = 3;

/** Reads give up on the mirror after this many torn attempts and use the file. */
const MAX_READ_ATTEMPTS = 64;

const encoder = typeof TextEncoder === "function" ? new TextEncoder() : null;

function fnv1a(bytes) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/**
 * Allocate a mirror.
 * @param {object} [options]
 * @param {number} [options.entries=2048] mirrored files (the design sizes for
 *   2,048 partitions).
 * @param {number} [options.entryBytes=8192] mirrored prefix per file (a head is
 *   two 4 KiB slots).
 * @param {number} [options.maxPathBytes=512]
 */
export function createSabIoMirrorBuffer(options = {}) {
  const entries = options.entries ?? 2048;
  const entryBytes = options.entryBytes ?? 8192;
  const maxPathBytes = options.maxPathBytes ?? 512;
  if (!Number.isInteger(entries) || entries < 1) throw new RangeError("entries must be >= 1.");
  if (!Number.isInteger(entryBytes) || entryBytes < 8 || entryBytes % 8 !== 0) {
    throw new RangeError("entryBytes must be a positive multiple of 8.");
  }
  if (!Number.isInteger(maxPathBytes) || maxPathBytes < 8 || maxPathBytes % 8 !== 0) {
    throw new RangeError("maxPathBytes must be a positive multiple of 8.");
  }
  const bytes = HEADER_WORDS * 4 + entries * (RECORD_BYTES + maxPathBytes + entryBytes);
  const buffer = new SharedArrayBuffer(bytes);
  const header = new Int32Array(buffer, 0, HEADER_WORDS);
  header[0] = MIRROR_MAGIC;
  header[1] = MIRROR_VERSION;
  header[2] = entries;
  header[3] = entryBytes;
  header[4] = maxPathBytes;
  return buffer;
}

const layoutCache = new WeakMap();

function layoutOf(buffer) {
  let layout = layoutCache.get(buffer);
  if (layout) return layout;
  const header = new Int32Array(buffer, 0, HEADER_WORDS);
  if (header[0] !== MIRROR_MAGIC || header[1] !== MIRROR_VERSION) {
    throw new TypeError("Not a SAB I/O mirror buffer.");
  }
  const entries = header[2];
  const entryBytes = header[3];
  const maxPathBytes = header[4];
  const recordsOffset = HEADER_WORDS * 4;
  const pathsOffset = recordsOffset + entries * RECORD_BYTES;
  const dataOffset = pathsOffset + entries * maxPathBytes;
  layout = {
    entries,
    entryBytes,
    maxPathBytes,
    i32: new Int32Array(buffer, recordsOffset, (entries * RECORD_BYTES) / 4),
    f64: new Float64Array(buffer, recordsOffset, (entries * RECORD_BYTES) / 8),
    paths: new Uint8Array(buffer, pathsOffset, entries * maxPathBytes),
    data: new Uint8Array(buffer, dataOffset, entries * entryBytes),
  };
  layoutCache.set(buffer, layout);
  return layout;
}

/** The mirrored prefix length of this buffer. */
export function sabIoMirrorEntryBytes(buffer) {
  return layoutOf(buffer).entryBytes;
}

function toBytes(path) {
  return typeof path === "string" ? encoder.encode(path) : path;
}

function samePath(layout, index, bytes) {
  const base = index * (RECORD_BYTES / 4);
  if (Atomics.load(layout.i32, base + R_PATH_LEN) !== bytes.length) return false;
  const start = index * layout.maxPathBytes;
  for (let i = 0; i < bytes.length; i += 1) {
    if (layout.paths[start + i] !== bytes[i]) return false;
  }
  return true;
}

/** Index of the entry for `path`, or -1. Cleared entries are returned too. */
function find(layout, bytes, hash) {
  let index = (hash >>> 0) % layout.entries;
  for (let probe = 0; probe < layout.entries; probe += 1) {
    const base = index * (RECORD_BYTES / 4);
    const state = Atomics.load(layout.i32, base + R_STATE);
    if (state === STATE_EMPTY) return -1;
    if (
      (state === STATE_LIVE || state === STATE_CLEARED) &&
      Atomics.load(layout.i32, base + R_HASH) === hash &&
      samePath(layout, index, bytes)
    ) {
      return index;
    }
    index = (index + 1) % layout.entries;
  }
  return -1;
}

function insert(layout, bytes, hash) {
  let index = (hash >>> 0) % layout.entries;
  for (let probe = 0; probe < layout.entries; probe += 1) {
    const base = index * (RECORD_BYTES / 4);
    if (
      Atomics.compareExchange(layout.i32, base + R_STATE, STATE_EMPTY, STATE_CLAIMING) ===
      STATE_EMPTY
    ) {
      layout.paths.set(bytes, index * layout.maxPathBytes);
      Atomics.store(layout.i32, base + R_PATH_LEN, bytes.length);
      Atomics.store(layout.i32, base + R_HASH, hash);
      Atomics.store(layout.i32, base + R_COVERED, 0);
      layout.f64[index * (RECORD_BYTES / 8) + R_F64_SIZE] = 0;
      Atomics.store(layout.i32, base + R_STATE, STATE_CLEARED);
      return index;
    }
    index = (index + 1) % layout.entries;
  }
  return -1;
}

/** Entry index for `path`, or -1 when the path is not mirrored. */
export function findSabIoMirrorEntry(buffer, path) {
  const layout = layoutOf(buffer);
  const bytes = toBytes(path);
  if (bytes.length > layout.maxPathBytes) return -1;
  const index = find(layout, bytes, fnv1a(bytes));
  if (index < 0) return -1;
  return Atomics.load(layout.i32, index * (RECORD_BYTES / 4) + R_STATE) === STATE_LIVE
    ? index
    : -1;
}

/**
 * Record a write of `bytes` at `offset` (writer side). With `truncateTo`, the
 * file's size is set to exactly that value after the write (seeding and
 * truncation). Returns false when the mirror is full or the path too long;
 * readers then use the file.
 */
export function updateSabIoMirror(buffer, path, offset, bytes, { truncateTo } = {}) {
  const layout = layoutOf(buffer);
  const key = toBytes(path);
  if (key.length > layout.maxPathBytes) return false;
  const hash = fnv1a(key);
  let index = find(layout, key, hash);
  if (index < 0) index = insert(layout, key, hash);
  if (index < 0) return false;
  const base = index * (RECORD_BYTES / 4);
  const sizeIndex = index * (RECORD_BYTES / 8) + R_F64_SIZE;
  const dataStart = index * layout.entryBytes;
  const wasLive = Atomics.load(layout.i32, base + R_STATE) === STATE_LIVE;

  Atomics.add(layout.i32, base + R_SEQ, 1); // odd: writing
  let size = wasLive ? layout.f64[sizeIndex] : 0;
  let covered = wasLive ? Atomics.load(layout.i32, base + R_COVERED) : 0;
  if (!wasLive) {
    layout.data.fill(0, dataStart, dataStart + layout.entryBytes);
  }
  if (bytes.length > 0 && offset < layout.entryBytes) {
    const end = Math.min(layout.entryBytes, offset + bytes.length);
    if (offset > covered) {
      layout.data.fill(0, dataStart + covered, dataStart + offset); // a hole reads as zeros
    }
    layout.data.set(bytes.subarray(0, end - offset), dataStart + offset);
  }
  if (bytes.length > 0) {
    size = Math.max(size, offset + bytes.length);
  }
  if (truncateTo !== undefined) {
    if (truncateTo < covered) {
      layout.data.fill(0, dataStart + truncateTo, dataStart + covered);
    }
    size = truncateTo;
  }
  covered = Math.min(size, layout.entryBytes);
  layout.f64[sizeIndex] = size;
  Atomics.store(layout.i32, base + R_COVERED, covered);
  Atomics.store(layout.i32, base + R_STATE, STATE_LIVE);
  Atomics.add(layout.i32, base + R_SEQ, 1); // even: stable
  return true;
}

/** Forget a path (unlinked, or its writer gave it up). */
export function clearSabIoMirror(buffer, path) {
  const layout = layoutOf(buffer);
  const key = toBytes(path);
  if (key.length > layout.maxPathBytes) return;
  const index = find(layout, key, fnv1a(key));
  if (index < 0) return;
  const base = index * (RECORD_BYTES / 4);
  Atomics.add(layout.i32, base + R_SEQ, 1);
  Atomics.store(layout.i32, base + R_STATE, STATE_CLEARED);
  Atomics.store(layout.i32, base + R_COVERED, 0);
  layout.f64[index * (RECORD_BYTES / 8) + R_F64_SIZE] = 0;
  Atomics.add(layout.i32, base + R_SEQ, 1);
}

/**
 * Serve a read from the mirror (reader side). Copies into `dst` and returns
 * the byte count (short at EOF, 0 past EOF), or -1 when the mirror cannot
 * answer: the path is not mirrored, or the range reaches past the mirrored
 * prefix of a longer file. The caller then reads the file.
 */
export function readSabIoMirror(buffer, path, dst, offset) {
  const layout = layoutOf(buffer);
  const key = toBytes(path);
  if (key.length > layout.maxPathBytes) return -1;
  const index = find(layout, key, fnv1a(key));
  if (index < 0) return -1;
  return readSabIoMirrorEntry(buffer, index, dst, offset);
}

/** readSabIoMirror for an entry index already found. */
export function readSabIoMirrorEntry(buffer, index, dst, offset) {
  const layout = layoutOf(buffer);
  const base = index * (RECORD_BYTES / 4);
  const sizeIndex = index * (RECORD_BYTES / 8) + R_F64_SIZE;
  const dataStart = index * layout.entryBytes;
  for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt += 1) {
    const before = Atomics.load(layout.i32, base + R_SEQ);
    if (before & 1) continue;
    if (Atomics.load(layout.i32, base + R_STATE) !== STATE_LIVE) return -1;
    const size = layout.f64[sizeIndex];
    const covered = Atomics.load(layout.i32, base + R_COVERED);
    let result;
    if (offset >= size) {
      result = 0;
    } else {
      const want = Math.min(dst.length, size - offset);
      if (offset + want > covered) {
        result = -1;
      } else {
        dst.set(layout.data.subarray(dataStart + offset, dataStart + offset + want), 0);
        result = want;
      }
    }
    if (Atomics.load(layout.i32, base + R_SEQ) === before) return result;
  }
  return -1;
}

/** A matcher over path suffixes, e.g. ["/h.fsh"] for partition and type heads. */
export function createSabIoMirrorMatcher(suffixes = ["/h.fsh"]) {
  const list = Array.from(suffixes, String);
  return (path) => {
    const text = String(path);
    for (const suffix of list) {
      if (text.endsWith(suffix) || text === suffix.replace(/^\//, "")) return true;
    }
    return false;
  };
}
