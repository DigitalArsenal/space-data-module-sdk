// Node synchronous-fs `flatsql_io` provider (docs/architecture/flatsql-partition-store.md
// §5.6, 22.3a-6/7).
//
// "flatsql_io is implemented with synchronous fs calls in each worker, over a
// shared virtual-handle table in a SAB. Each worker opens its own fds lazily."
//
// A handle is `(slot << 8) | gen`, the same virtual-handle shape as the SDN C
// host module (§5.4). The table in a SharedArrayBuffer records, per slot, the
// path (relative to the root), the open flags, the opening instance and a
// generation. Any guest thread can use any handle: the first time a worker
// touches a slot it opens its own fd for the recorded path, without CREATE,
// TRUNC or EXCL. Closing bumps the generation, so other workers' cached fds for
// that slot are detected as stale and closed on their next use or sweep.
//
// Semantics match the Go HostIO and the C host:
// - paths are confined below `root` (".." and escaping symlinked parents are
//   ACCESS);
// - O_RDONLY for no WRITE, O_WRONLY for WRITE without READ, else O_RDWR;
// - EEXIST maps to GENERIC;
// - CREATE_PARENTS makes missing directories, syncing each new directory's
//   parent, and syncs the parent when the file itself is new;
// - UNLINK_IF_UNUSED is BUSY while any live slot names the path;
// - OPEN_DEFERRED is a plain synchronous open (A38);
// - sync is fdatasync (libuv issues F_FULLFSYNC on darwin).
//
// Revocation follows A23: a call increments its instance's in-flight counter
// and then checks the revoked flag; revokeNodeSyncFsIoInstance sets the flag and
// waits for the counter to reach zero, so no byte of a revoked instance is
// written after it returns.
//
// Fault injection (§19, 22.3a-7) belongs to the FlatSQL Node host (T4); this
// provider exposes `interpose` so that host can wrap every syscall.

import fs from "node:fs";
import path from "node:path";

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
  FLATSQL_IO_PROBE,
  FLATSQL_IO_READ,
  FLATSQL_IO_TRUNC,
  FLATSQL_IO_UNLINK,
  FLATSQL_IO_UNLINK_IF_UNUSED,
  FLATSQL_IO_WRITE,
  decodeFlatsqlIoPath,
  splitFlatsqlIoPath,
  flatsqlIoStatusOf,
} from "./flatsqlIoContract.js";
import { createFlatsqlIoImports } from "./flatsqlIoImports.js";

const TABLE_MAGIC = 0x464e4453; // "SDNF"
const TABLE_VERSION = 1;
const HEADER_WORDS = 16;
const SLOT_WORDS = 8;
const S_STATE = 0;
const S_GEN = 1;
const S_FLAGS = 2;
const S_PATH_LEN = 3;
const S_OWNER = 4;

const SLOT_FREE = 0;
const SLOT_CLAIMING = 1;
const SLOT_LIVE = 2;
const SLOT_CLOSING = 3;

const INSTANCE_LIVE = 0;
const INSTANCE_REVOKED = 1;
/** Instance id for callers that are not a revocable instance. */
export const NODE_SYNC_FS_ANONYMOUS_INSTANCE = -1;

export const NODE_SYNC_FS_PROVIDER_DESCRIPTOR = "flatsql-io-node";

/**
 * Allocate the shared virtual-handle table.
 * @param {object} [options]
 * @param {number} [options.maxHandles=4096] the design's process fd cap.
 * @param {number} [options.maxPathBytes=1024] longest root-relative path.
 * @param {number} [options.maxInstances=64]
 */
export function createNodeSyncFsIoTable(options = {}) {
  const maxHandles = options.maxHandles ?? 4096;
  const maxPathBytes = options.maxPathBytes ?? 1024;
  const maxInstances = options.maxInstances ?? 64;
  if (!Number.isInteger(maxHandles) || maxHandles < 1 || maxHandles > 1 << 23) {
    throw new RangeError("maxHandles must be in 1..2^23.");
  }
  const bytes =
    HEADER_WORDS * 4 + maxInstances * 8 + maxHandles * SLOT_WORDS * 4 + maxHandles * maxPathBytes;
  const buffer = new SharedArrayBuffer(bytes);
  const header = new Int32Array(buffer, 0, HEADER_WORDS);
  header[0] = TABLE_MAGIC;
  header[1] = TABLE_VERSION;
  header[2] = maxHandles;
  header[3] = maxPathBytes;
  header[4] = maxInstances;
  return buffer;
}

function tableLayout(buffer) {
  const header = new Int32Array(buffer, 0, HEADER_WORDS);
  if (header[0] !== TABLE_MAGIC || header[1] !== TABLE_VERSION) {
    throw new TypeError("Not a Node sync-fs flatsql_io handle table.");
  }
  const maxHandles = header[2];
  const maxPathBytes = header[3];
  const maxInstances = header[4];
  let offset = HEADER_WORDS * 4;
  // Two words per instance: [revoked, inFlight].
  const instances = new Int32Array(buffer, offset, maxInstances * 2);
  offset += maxInstances * 8;
  const slots = new Int32Array(buffer, offset, maxHandles * SLOT_WORDS);
  offset += maxHandles * SLOT_WORDS * 4;
  const paths = new Uint8Array(buffer, offset, maxHandles * maxPathBytes);
  return { header, maxHandles, maxPathBytes, maxInstances, instances, slots, paths };
}

function syncDirectory(dir) {
  let fd = -1;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch (error) {
    // Some filesystems refuse fsync on a directory fd; that is not a failure
    // of the operation that asked for it (SQLite makes the same call).
    if (!["EINVAL", "ENOTSUP", "EISDIR", "EBADF", "EPERM", "EACCES"].includes(error?.code)) {
      throw error;
    }
  } finally {
    if (fd >= 0) fs.closeSync(fd);
  }
}

/**
 * Revoke an instance (A23): later calls from it return ACCESS; returns after
 * every call of it that was in flight has finished.
 */
export function revokeNodeSyncFsIoInstance(table, instanceId) {
  const layout = tableLayout(table);
  if (instanceId < 0 || instanceId >= layout.maxInstances) {
    throw new RangeError(`instanceId ${instanceId} is outside 0..${layout.maxInstances - 1}.`);
  }
  Atomics.store(layout.instances, instanceId * 2, INSTANCE_REVOKED);
  for (;;) {
    const inFlight = Atomics.load(layout.instances, instanceId * 2 + 1);
    if (inFlight === 0) return;
    Atomics.wait(layout.instances, instanceId * 2 + 1, inFlight, 5);
  }
}

/** Clear a revocation so a replacement instance may reuse the id. */
export function resetNodeSyncFsIoInstance(table, instanceId) {
  const layout = tableLayout(table);
  Atomics.store(layout.instances, instanceId * 2, INSTANCE_LIVE);
}

/**
 * Create the provider for one thread.
 *
 * @param {object} options
 * @param {string} options.root store root; every path is confined below it.
 * @param {SharedArrayBuffer} options.table createNodeSyncFsIoTable() result,
 *   shared by every thread that uses the same handles.
 * @param {number} [options.instanceId] revocation domain (A23).
 * @param {() => WebAssembly.Memory} [options.getMemory] memory that `ptr`
 *   arguments address.
 * @param {(op: string, fn: Function, args: any[]) => any} [options.interpose]
 *   wraps every syscall (fault injection, instrumentation).
 */
export function createNodeSyncFsIo(options = {}) {
  if (typeof options.root !== "string" || options.root.length === 0) {
    throw new TypeError("createNodeSyncFsIo requires a root directory.");
  }
  const layout = tableLayout(options.table);
  const rawRoot = path.resolve(options.root);
  let realRoot = rawRoot;
  try {
    realRoot = fs.realpathSync(rawRoot);
  } catch {
    // created later by the caller; containment still checks rawRoot
  }
  const instanceId = Number.isInteger(options.instanceId)
    ? options.instanceId
    : NODE_SYNC_FS_ANONYMOUS_INSTANCE;
  const getMemory = typeof options.getMemory === "function" ? options.getMemory : () => null;
  const interpose =
    typeof options.interpose === "function" ? options.interpose : (_op, fn, args) => fn(...args);
  const localFds = new Map(); // slot -> { gen, fd }
  const encoder = new TextEncoder();

  const call = (op, fn, ...args) => interpose(op, fn, args);

  function within(candidate, base) {
    return candidate === base || candidate.startsWith(base + path.sep);
  }

  function resolvePath(relative) {
    const full = path.join(rawRoot, relative);
    if (!within(full, rawRoot)) return FLATSQL_IO_ERR_ACCESS;
    // The deepest existing ancestor must really live inside the root, so a
    // symlink planted in the store cannot point outside it.
    let probe = path.dirname(full);
    for (;;) {
      try {
        const real = fs.realpathSync(probe);
        if (!within(real, realRoot) && !within(real, rawRoot)) return FLATSQL_IO_ERR_ACCESS;
        break;
      } catch {
        const parent = path.dirname(probe);
        if (parent === probe) break;
        probe = parent;
      }
    }
    return full;
  }

  function enter() {
    if (instanceId < 0) return true;
    Atomics.add(layout.instances, instanceId * 2 + 1, 1);
    if (Atomics.load(layout.instances, instanceId * 2) === INSTANCE_REVOKED) {
      leave();
      return false;
    }
    return true;
  }

  function leave() {
    if (instanceId < 0) return;
    Atomics.sub(layout.instances, instanceId * 2 + 1, 1);
    Atomics.notify(layout.instances, instanceId * 2 + 1);
  }

  function slotBase(slot) {
    return slot * SLOT_WORDS;
  }

  function slotPath(slot) {
    const len = Atomics.load(layout.slots, slotBase(slot) + S_PATH_LEN);
    const start = slot * layout.maxPathBytes;
    return new TextDecoder().decode(layout.paths.slice(start, start + len));
  }

  function samePath(slot, bytes) {
    if (Atomics.load(layout.slots, slotBase(slot) + S_PATH_LEN) !== bytes.length) return false;
    const start = slot * layout.maxPathBytes;
    for (let i = 0; i < bytes.length; i += 1) {
      if (layout.paths[start + i] !== bytes[i]) return false;
    }
    return true;
  }

  function pathInUse(bytes) {
    for (let slot = 0; slot < layout.maxHandles; slot += 1) {
      const state = Atomics.load(layout.slots, slotBase(slot) + S_STATE);
      if ((state === SLOT_LIVE || state === SLOT_CLAIMING) && samePath(slot, bytes)) return true;
    }
    return false;
  }

  function claimSlot(bytes, flags) {
    const start = (Atomics.add(layout.header, 5, 1) >>> 0) % layout.maxHandles;
    for (let step = 0; step < layout.maxHandles; step += 1) {
      const slot = (start + step) % layout.maxHandles;
      const base = slotBase(slot);
      if (
        Atomics.compareExchange(layout.slots, base + S_STATE, SLOT_FREE, SLOT_CLAIMING) ===
        SLOT_FREE
      ) {
        const gen = (Atomics.load(layout.slots, base + S_GEN) + 1) & 0xff;
        layout.paths.set(bytes, slot * layout.maxPathBytes);
        Atomics.store(layout.slots, base + S_PATH_LEN, bytes.length);
        Atomics.store(layout.slots, base + S_FLAGS, flags);
        Atomics.store(layout.slots, base + S_OWNER, instanceId);
        Atomics.store(layout.slots, base + S_GEN, gen);
        return { slot, gen };
      }
    }
    return null;
  }

  function sweep() {
    for (const [slot, cached] of localFds) {
      const base = slotBase(slot);
      if (
        Atomics.load(layout.slots, base + S_STATE) !== SLOT_LIVE ||
        Atomics.load(layout.slots, base + S_GEN) !== cached.gen
      ) {
        try {
          fs.closeSync(cached.fd);
        } catch {
          // already closed
        }
        localFds.delete(slot);
      }
    }
  }

  function openFlagsFor(flags, forReopen) {
    const c = fs.constants;
    let mode = c.O_RDONLY;
    if (flags & FLATSQL_IO_WRITE) {
      mode = flags & FLATSQL_IO_READ ? c.O_RDWR : c.O_WRONLY;
    }
    if (!forReopen) {
      if (flags & FLATSQL_IO_CREATE) mode |= c.O_CREAT;
      if (flags & FLATSQL_IO_EXCL) mode |= c.O_EXCL;
      if (flags & FLATSQL_IO_TRUNC) mode |= c.O_TRUNC;
    }
    return mode;
  }

  /** The fd this thread uses for `handle`, or a negative status. */
  function fdFor(handle) {
    if (!Number.isInteger(handle) || handle < 0) return FLATSQL_IO_ERR_BADHANDLE;
    const slot = handle >>> 8;
    const gen = handle & 0xff;
    if (slot >= layout.maxHandles) return FLATSQL_IO_ERR_BADHANDLE;
    const base = slotBase(slot);
    const cached = localFds.get(slot);
    if (
      Atomics.load(layout.slots, base + S_STATE) !== SLOT_LIVE ||
      Atomics.load(layout.slots, base + S_GEN) !== gen
    ) {
      if (cached && cached.gen === gen) {
        // The slot was closed elsewhere: this thread's fd for it is stale.
        try {
          fs.closeSync(cached.fd);
        } catch {
          // already closed
        }
        localFds.delete(slot);
      }
      return FLATSQL_IO_ERR_BADHANDLE;
    }
    if (cached && cached.gen === gen) return cached.fd;
    if (cached) {
      try {
        fs.closeSync(cached.fd);
      } catch {
        // stale
      }
      localFds.delete(slot);
    }
    const full = path.join(rawRoot, slotPath(slot));
    const flags = Atomics.load(layout.slots, base + S_FLAGS);
    try {
      const fd = call("open", fs.openSync, full, openFlagsFor(flags, true), 0o600);
      localFds.set(slot, { gen, fd });
      return fd;
    } catch (error) {
      return flatsqlIoStatusOf(error);
    }
  }

  function slotFlags(handle) {
    return Atomics.load(layout.slots, slotBase(handle >>> 8) + S_FLAGS);
  }

  function ensureParents(full) {
    const parent = path.dirname(full);
    const missing = [];
    let probe = parent;
    while (!fs.existsSync(probe)) {
      missing.unshift(probe);
      const up = path.dirname(probe);
      if (up === probe) break;
      probe = up;
    }
    for (const dir of missing) {
      if (!within(dir, rawRoot)) throw Object.assign(new Error("escape"), { code: "EACCES" });
      try {
        call("mkdir", fs.mkdirSync, dir, 0o700);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      call("syncdir", syncDirectory, path.dirname(dir));
    }
  }

  function openInternal(bytes, flags) {
    const decoded = decodeFlatsqlIoPath(bytes);
    if (typeof decoded !== "string") return decoded;
    const components = splitFlatsqlIoPath(decoded);
    if (!Array.isArray(components)) return components;
    const relative = components.join("/");
    const relativeBytes = encoder.encode(relative);
    if (relativeBytes.length > layout.maxPathBytes) return FLATSQL_IO_ERR_GENERIC;
    const full = resolvePath(relative);
    if (typeof full !== "string") return full;

    if (flags & FLATSQL_IO_PROBE) {
      try {
        call("stat", fs.statSync, full);
        return 0;
      } catch {
        return FLATSQL_IO_ERR_NOENT;
      }
    }
    if (flags & (FLATSQL_IO_UNLINK | FLATSQL_IO_UNLINK_IF_UNUSED)) {
      if (flags & FLATSQL_IO_UNLINK_IF_UNUSED && pathInUse(relativeBytes)) {
        return FLATSQL_IO_ERR_BUSY;
      }
      try {
        call("unlink", fs.unlinkSync, full);
        call("syncdir", syncDirectory, path.dirname(full));
        return 0;
      } catch (error) {
        return flatsqlIoStatusOf(error);
      }
    }

    // Close this thread's fds for slots other threads have closed since.
    sweep();
    let createdFile = false;
    try {
      if (flags & FLATSQL_IO_CREATE && flags & FLATSQL_IO_CREATE_PARENTS) {
        ensureParents(full);
      }
      if (flags & FLATSQL_IO_CREATE && flags & FLATSQL_IO_CREATE_PARENTS) {
        createdFile = !fs.existsSync(full);
      }
    } catch (error) {
      return flatsqlIoStatusOf(error);
    }
    const claimed = claimSlot(relativeBytes, flags);
    if (!claimed) return FLATSQL_IO_ERR_GENERIC; // handle table exhausted
    let fd;
    try {
      fd = call("open", fs.openSync, full, openFlagsFor(flags, false), 0o600);
      if (createdFile) call("syncdir", syncDirectory, path.dirname(full));
    } catch (error) {
      if (fd !== undefined) fs.closeSync(fd);
      Atomics.store(layout.slots, slotBase(claimed.slot) + S_STATE, SLOT_FREE);
      return flatsqlIoStatusOf(error);
    }
    localFds.set(claimed.slot, { gen: claimed.gen, fd });
    Atomics.store(layout.slots, slotBase(claimed.slot) + S_STATE, SLOT_LIVE);
    return (claimed.slot << 8) | claimed.gen;
  }

  function guarded(fn) {
    if (!enter()) return FLATSQL_IO_ERR_ACCESS;
    try {
      return fn();
    } catch (error) {
      return flatsqlIoStatusOf(error);
    } finally {
      leave();
    }
  }

  function memoryView(ptr, len) {
    const memory = getMemory();
    const buffer = memory?.buffer ?? memory;
    if (!buffer || ptr < 0 || len < 0 || ptr + len > buffer.byteLength) return null;
    return new Uint8Array(buffer, ptr, len);
  }

  function readView(handle, view, offset) {
    const fd = fdFor(handle);
    if (fd < 0) return fd;
    let done = 0;
    while (done < view.length) {
      const n = call("read", fs.readSync, fd, view, done, view.length - done, offset + done);
      if (n === 0) break;
      done += n;
    }
    return done;
  }

  function writeView(handle, view, offset) {
    const fd = fdFor(handle);
    if (fd < 0) return fd;
    if (!(slotFlags(handle) & FLATSQL_IO_WRITE)) return FLATSQL_IO_ERR_IO;
    let done = 0;
    while (done < view.length) {
      done += call("write", fs.writeSync, fd, view, done, view.length - done, offset + done);
    }
    return done;
  }

  return {
    kind: "node-sync-fs",
    instanceId,
    root: rawRoot,
    open(pathBytes, flags) {
      const bytes = typeof pathBytes === "string" ? encoder.encode(pathBytes) : pathBytes;
      return guarded(() => openInternal(bytes, flags | 0));
    },
    read(handle, ptr, len, offset) {
      return guarded(() => {
        if (len === 0) return 0;
        const view = memoryView(ptr, len);
        return view ? readView(handle, view, offset) : FLATSQL_IO_ERR_GENERIC;
      });
    },
    write(handle, ptr, len, offset) {
      return guarded(() => {
        if (len === 0) return 0;
        const view = memoryView(ptr, len);
        return view ? writeView(handle, view, offset) : FLATSQL_IO_ERR_GENERIC;
      });
    },
    readInto(handle, view, offset) {
      return guarded(() => readView(handle, view, offset));
    },
    writeFrom(handle, view, offset) {
      return guarded(() => writeView(handle, view, offset));
    },
    truncate(handle, size) {
      return guarded(() => {
        const fd = fdFor(handle);
        if (fd < 0) return fd;
        if (!(slotFlags(handle) & FLATSQL_IO_WRITE)) return FLATSQL_IO_ERR_IO;
        call("truncate", fs.ftruncateSync, fd, size);
        return 0;
      });
    },
    sync(handle) {
      return guarded(() => {
        const fd = fdFor(handle);
        if (fd < 0) return fd;
        call("sync", fs.fdatasyncSync, fd);
        return 0;
      });
    },
    size(handle) {
      return guarded(() => {
        const fd = fdFor(handle);
        if (fd < 0) return fd;
        return call("size", fs.fstatSync, fd).size;
      });
    },
    close(handle) {
      // Close is allowed for a revoked instance's handles too, so a supervisor
      // can release them; it writes nothing.
      try {
        if (!Number.isInteger(handle) || handle < 0) return FLATSQL_IO_ERR_BADHANDLE;
        const slot = handle >>> 8;
        const gen = handle & 0xff;
        if (slot >= layout.maxHandles) return FLATSQL_IO_ERR_BADHANDLE;
        const base = slotBase(slot);
        if (Atomics.load(layout.slots, base + S_GEN) !== gen) return FLATSQL_IO_ERR_BADHANDLE;
        if (
          Atomics.compareExchange(layout.slots, base + S_STATE, SLOT_LIVE, SLOT_CLOSING) !==
          SLOT_LIVE
        ) {
          return FLATSQL_IO_ERR_BADHANDLE;
        }
        const flags = Atomics.load(layout.slots, base + S_FLAGS);
        const relative = slotPath(slot);
        const cached = localFds.get(slot);
        if (cached) {
          localFds.delete(slot);
          try {
            call("close", fs.closeSync, cached.fd);
          } catch {
            // already closed
          }
        }
        Atomics.store(layout.slots, base + S_STATE, SLOT_FREE);
        if (flags & FLATSQL_IO_DELETE_ON_CLOSE) {
          try {
            call("unlink", fs.unlinkSync, path.join(rawRoot, relative));
          } catch {
            // advisory
          }
        }
        return 0;
      } catch (error) {
        return flatsqlIoStatusOf(error);
      }
    },
    /** Close this thread's cached fds (thread exit). Handles stay valid. */
    closeLocalFds() {
      for (const cached of localFds.values()) {
        try {
          fs.closeSync(cached.fd);
        } catch {
          // ignore
        }
      }
      localFds.clear();
    },
    /** Live handles in the shared table (diagnostics, tests). */
    liveHandles() {
      let live = 0;
      for (let slot = 0; slot < layout.maxHandles; slot += 1) {
        if (Atomics.load(layout.slots, slotBase(slot) + S_STATE) === SLOT_LIVE) live += 1;
      }
      return live;
    },
    localFdCount() {
      return localFds.size;
    },
  };
}

/**
 * Replace `{ provider: "flatsql-io-node", root, table, instanceId, mirror?,
 * trace? }` extraImports descriptors with factories, for Node pool workers.
 * Other entries pass through.
 */
export function resolveNodeFlatsqlIoDescriptors(entries) {
  return (entries ?? []).map((entry) => {
    if (!entry || entry.provider !== NODE_SYNC_FS_PROVIDER_DESCRIPTOR) return entry;
    return (ctx) => {
      const provider = createNodeSyncFsIo({
        root: entry.root,
        table: entry.table,
        instanceId: entry.instanceId,
        getMemory: ctx.getMemory,
      });
      return {
        imports: createFlatsqlIoImports({
          getMemory: ctx.getMemory,
          provider,
          mirror: entry.mirror,
          trace: entry.trace,
        }),
        close: () => provider.closeLocalFds(),
      };
    };
  });
}
