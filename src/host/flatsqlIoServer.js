// The server half of the SAB I/O channel: the loop an I/O worker runs
// (docs/architecture/flatsql-partition-store.md §5.5, A7, A36, A38).
//
// It holds every file handle, so guest threads never touch a handle and an
// open that must `await` (OPFS getFileHandle / createSyncAccessHandle) never
// blocks anything but its own caller. The loop:
//
//   1. waits for the doorbell (Atomics.waitAsync, or a BroadcastChannel
//      message where waitAsync is missing);
//   2. applies revocations published in the channel header;
//   3. claims every PENDING slot (-> SERVICING) as a job;
//   4. runs jobs round-robin. Reads and writes run in steps of at most
//      `chunkBytes` (256 KiB, A7), and the slots are rescanned between steps,
//      so a small read never queues behind a large write. An open is started
//      and parked; it re-enters the ready queue when its promise settles.
//
// Backend-agnostic: a backend opens files and answers namespace questions; the
// files it returns follow FileSystemSyncAccessHandle's synchronous shape
// (read/write with {at}, truncate, flush, getSize, close). The OPFS backend
// (opfsIoBackend.js) returns real sync access handles; the memory backend
// (flatsqlIoMemoryBackend.js) returns in-memory files for the dashboard window
// store (§5.5, 22.3a-8).
//
// One file object per path, shared by every virtual handle on that path
// (22.3a-6): OPFS allows one sync handle per file per context by default.

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
  decodeFlatsqlIoPath,
  splitFlatsqlIoPath,
  flatsqlIoStatusOf,
} from "./flatsqlIoContract.js";
import {
  SAB_IO_DATA_SLOT,
  SAB_IO_DOORBELL_ATOMICS,
  SAB_IO_DOORBELL_MESSAGE,
  SAB_IO_H_DOORBELL,
  SAB_IO_H_DOORBELL_MODE,
  SAB_IO_H_SERVED,
  SAB_IO_H_SERVER_EPOCH,
  SAB_IO_H_SERVER_STATE,
  SAB_IO_INSTANCE_ATTACHED,
  SAB_IO_INSTANCE_NONE,
  SAB_IO_INSTANCE_REVOKED,
  SAB_IO_INSTANCE_REVOKING,
  SAB_IO_OP_CLOSE,
  SAB_IO_OP_OPEN,
  SAB_IO_OP_READ,
  SAB_IO_OP_SIZE,
  SAB_IO_OP_SYNC,
  SAB_IO_OP_TRUNCATE,
  SAB_IO_OP_WRITE,
  SAB_IO_SCRATCH_INSTANCE,
  SAB_IO_SERVER_RUNNING,
  SAB_IO_SERVER_STOPPED,
  SAB_IO_SLOT_PENDING,
  SAB_IO_SLOT_SERVICING,
  SAB_IO_S_DATA_MODE,
  SAB_IO_S_F64_OFFSET,
  SAB_IO_S_FLAGS,
  SAB_IO_S_HANDLE,
  SAB_IO_S_INSTANCE,
  SAB_IO_S_LEN,
  SAB_IO_S_OP,
  SAB_IO_S_PATH_LEN,
  SAB_IO_S_PTR,
  SAB_IO_S_STATE,
  completeSabIoSlot,
  describeSabIoChannel,
  sabIoDoorbellChannelName,
} from "./sabIoChannel.js";
import {
  clearSabIoMirror,
  sabIoMirrorEntryBytes,
  updateSabIoMirror,
} from "./sabIoMirror.js";

/** A7: writer I/O workers split writes into chunks of 256 KiB or less. */
export const DEFAULT_FLATSQL_IO_CHUNK_BYTES = 256 * 1024;
/** How long an idle server polls for the next request before it sleeps. */
export const DEFAULT_FLATSQL_IO_SPIN_MICROS = 50;
/** Longest the loop runs jobs before yielding to its event loop (messages). */
const RUN_BUDGET_MS = 8;
/** Bound on one idle wait, so a lost message can never stall the loop. */
const IDLE_WAIT_MS = 250;
/** Virtual handle ids are positive i32 below 2^24 (room for routing bits). */
const MAX_HANDLE_ID = 0xffffff;

const STEP_DONE = 0;
const STEP_AGAIN = 1;
const STEP_PARKED = 2;

function now() {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

function makeMacrotaskYield() {
  if (typeof MessageChannel === "function") {
    const channel = new MessageChannel();
    const queue = [];
    channel.port1.onmessage = () => queue.shift()?.();
    // Node: keep the port from holding the worker open on its own.
    channel.port1.unref?.();
    channel.port2.unref?.();
    return () =>
      new Promise((resolve) => {
        queue.push(resolve);
        channel.port2.postMessage(0);
      });
  }
  return () => new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Create the server loop over one channel buffer.
 *
 * @param {object} options
 * @param {SharedArrayBuffer} options.buffer the channel (sabIoChannel.js).
 * @param {object} options.backend `{ kind, openFile(path, components, flags),
 *   exists(path, components), remove(path, components) }`; each may return a
 *   value or a promise, and throw DOMExceptions / Node errors / status errors.
 * @param {number} [options.chunkBytes=262144] largest read or write step.
 * @param {"auto"|"atomics"|"message"} [options.doorbell="auto"] how clients
 *   wake the loop. "auto" uses Atomics.waitAsync when present.
 * @param {object} [options.mirror] `{ buffer, match(path), write }` small-file
 *   mirror (sabIoMirror.js, the A7 head mirror). When `write` is not false,
 *   writes to matching paths are copied into it; a writer I/O worker writes,
 *   reader I/O workers only share the buffer.
 * @param {number} [options.spinMicros=50] poll the doorbell this long before
 *   sleeping (0 disables).
 * @param {(event: object) => void} [options.onEvent] diagnostics (never throws).
 */
export function createFlatsqlIoServer(options = {}) {
  const layout = describeSabIoChannel(options.buffer);
  const backend = options.backend;
  if (!backend || typeof backend.openFile !== "function") {
    throw new TypeError("createFlatsqlIoServer requires a backend with openFile().");
  }
  const chunkBytes =
    Number.isInteger(options.chunkBytes) && options.chunkBytes > 0
      ? options.chunkBytes
      : DEFAULT_FLATSQL_IO_CHUNK_BYTES;
  const requestedDoorbell = options.doorbell ?? "auto";
  const doorbellMode =
    requestedDoorbell === "message" ||
    (requestedDoorbell === "auto" && typeof Atomics.waitAsync !== "function")
      ? SAB_IO_DOORBELL_MESSAGE
      : SAB_IO_DOORBELL_ATOMICS;
  const mirror = options.mirror ?? null;
  const spinMicros = Number.isFinite(options.spinMicros)
    ? Math.max(0, options.spinMicros)
    : DEFAULT_FLATSQL_IO_SPIN_MICROS;
  const onEvent = typeof options.onEvent === "function" ? options.onEvent : null;
  const yieldMacrotask = makeMacrotaskYield();

  const memories = new Map();
  const entries = new Map();
  const handles = new Map();
  const handlesByInstance = new Map();
  const pathChains = new Map();
  const ready = [];
  const claimedSlots = new Set();
  let nextHandleId = 1;
  let running = false;
  let loopPromise = null;
  let messageWake = null;
  let doorbellChannel = null;
  let scratch = null;
  let sharedViewsRejected = false;

  const stats = {
    served: 0,
    opens: 0,
    deferredOpens: 0,
    parked: 0,
    chunks: 0,
    busy: 0,
    revoked: 0,
    sharedViewsRejected: false,
    maxReady: 0,
  };

  function emit(event) {
    if (!onEvent) return;
    try {
      onEvent(event);
    } catch {
      // diagnostics never break the loop
    }
  }

  // ---- waking -------------------------------------------------------------

  function wake() {
    if (doorbellMode === SAB_IO_DOORBELL_ATOMICS) {
      Atomics.add(layout.header, SAB_IO_H_DOORBELL, 1);
      Atomics.notify(layout.header, SAB_IO_H_DOORBELL);
    } else {
      const resolve = messageWake;
      messageWake = null;
      resolve?.();
    }
  }

  async function waitForWork(observed) {
    if (doorbellMode === SAB_IO_DOORBELL_ATOMICS) {
      const waited = Atomics.waitAsync(layout.header, SAB_IO_H_DOORBELL, observed, IDLE_WAIT_MS);
      if (waited.async) await waited.value;
      return;
    }
    if (Atomics.load(layout.header, SAB_IO_H_DOORBELL) !== observed) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (messageWake === done) messageWake = null;
        resolve();
      }, IDLE_WAIT_MS);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      messageWake = done;
    });
  }

  // ---- per-path serialization of namespace operations ----------------------

  function chainPath(path, task) {
    const previous = pathChains.get(path) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    pathChains.set(path, tail);
    tail.then(() => {
      if (pathChains.get(path) === tail) pathChains.delete(path);
    });
    return next;
  }

  // ---- handles ------------------------------------------------------------

  function allocateHandleId() {
    for (let attempts = 0; attempts < MAX_HANDLE_ID; attempts += 1) {
      const id = nextHandleId;
      nextHandleId = nextHandleId >= MAX_HANDLE_ID ? 1 : nextHandleId + 1;
      if (!handles.has(id)) return id;
    }
    return -1;
  }

  function addHandle(entry, instanceId, flags) {
    const id = allocateHandleId();
    if (id < 0) return FLATSQL_IO_ERR_GENERIC;
    const writeFlag = (flags & FLATSQL_IO_WRITE) !== 0;
    const handle = {
      id,
      entry,
      instanceId,
      canWrite: writeFlag,
      // The Go host opens O_WRONLY for WRITE without READ; everything else
      // can read. Every SDK host matches that.
      canRead: !writeFlag || (flags & FLATSQL_IO_READ) !== 0,
    };
    handles.set(id, handle);
    entry.refs += 1;
    if (flags & FLATSQL_IO_DELETE_ON_CLOSE) entry.deleteOnClose = true;
    let set = handlesByInstance.get(instanceId);
    if (!set) {
      set = new Set();
      handlesByInstance.set(instanceId, set);
    }
    set.add(id);
    return id;
  }

  function releaseEntry(entry) {
    if (entry.refs > 0 || entry.pins > 0) return;
    if (entries.get(entry.path) === entry) entries.delete(entry.path);
    if (entry.file) {
      try {
        entry.file.close();
      } catch {
        // closing a handle whose context is gone is not an error here
      }
      entry.file = null;
    }
    if (entry.deleteOnClose && entry.openStatus === 0) {
      chainPath(entry.path, async () => {
        try {
          await backend.remove(entry.path, entry.components);
        } catch {
          // advisory
        }
        if (mirror && mirror.write !== false) clearSabIoMirror(mirror.buffer, entry.path);
      });
    }
  }

  function closeHandle(handle) {
    if (!handles.delete(handle.id)) return;
    handlesByInstance.get(handle.instanceId)?.delete(handle.id);
    handle.entry.refs -= 1;
    releaseEntry(handle.entry);
  }

  // ---- memory -------------------------------------------------------------

  function instanceState(instanceId) {
    if (instanceId === SAB_IO_SCRATCH_INSTANCE) return SAB_IO_INSTANCE_ATTACHED;
    if (instanceId < 0 || instanceId >= layout.maxInstances) return -1;
    return Atomics.load(layout.instances, instanceId);
  }

  function isRevoked(instanceId) {
    const state = instanceState(instanceId);
    return state === SAB_IO_INSTANCE_REVOKING || state === SAB_IO_INSTANCE_REVOKED;
  }

  function resolveView(job) {
    const { slot, ptr, len } = job;
    if (len < 0 || ptr < 0) return null;
    if (job.dataMode === SAB_IO_DATA_SLOT) {
      if (ptr + len > slot.data.length) return null;
      return slot.data.subarray(ptr, ptr + len);
    }
    const memory = memories.get(job.instanceId);
    // Re-read memory.buffer on every request: a grown memory has a new buffer.
    const buffer = memory?.buffer ?? memory;
    if (!buffer || ptr + len > buffer.byteLength) return null;
    return new Uint8Array(buffer, ptr, len);
  }

  function scratchFor(length) {
    if (!scratch || scratch.length < length) {
      scratch = new Uint8Array(Math.max(length, chunkBytes));
    }
    return scratch.subarray(0, length);
  }

  // Some user agents reject views over a SharedArrayBuffer in sync-handle
  // read/write. Detect that once and move bytes through a private scratch.
  function fileRead(file, view, at) {
    if (!sharedViewsRejected) {
      try {
        return file.read(view, { at });
      } catch (error) {
        if (!(error instanceof TypeError) || !(view.buffer instanceof SharedArrayBuffer)) {
          throw error;
        }
        sharedViewsRejected = true;
        stats.sharedViewsRejected = true;
        emit({ type: "shared-views-rejected" });
      }
    }
    const temp = scratchFor(view.length);
    const n = file.read(temp, { at });
    view.set(temp.subarray(0, n), 0);
    return n;
  }

  function fileWrite(file, view, at) {
    if (!sharedViewsRejected) {
      try {
        return file.write(view, { at });
      } catch (error) {
        if (!(error instanceof TypeError) || !(view.buffer instanceof SharedArrayBuffer)) {
          throw error;
        }
        sharedViewsRejected = true;
        stats.sharedViewsRejected = true;
        emit({ type: "shared-views-rejected" });
      }
    }
    const temp = scratchFor(view.length);
    temp.set(view, 0);
    return file.write(temp, { at });
  }

  // ---- jobs ---------------------------------------------------------------

  function complete(job, status, f64 = 0) {
    claimedSlots.delete(job.slot.index);
    stats.served += 1;
    Atomics.add(layout.header, SAB_IO_H_SERVED, 1);
    completeSabIoSlot(layout, job.slot, status, f64);
  }

  function makeJob(slot) {
    const i32 = slot.i32;
    return {
      slot,
      op: i32[SAB_IO_S_OP],
      instanceId: i32[SAB_IO_S_INSTANCE],
      handleId: i32[SAB_IO_S_HANDLE],
      flags: i32[SAB_IO_S_FLAGS],
      ptr: i32[SAB_IO_S_PTR],
      len: i32[SAB_IO_S_LEN],
      dataMode: i32[SAB_IO_S_DATA_MODE],
      pathLen: i32[SAB_IO_S_PATH_LEN],
      offset: slot.f64[SAB_IO_S_F64_OFFSET],
      done: 0,
      phase: 0,
    };
  }

  function scanSlots() {
    let found = 0;
    for (const slot of layout.slots) {
      if (claimedSlots.has(slot.index)) continue;
      if (Atomics.load(slot.i32, SAB_IO_S_STATE) !== SAB_IO_SLOT_PENDING) continue;
      if (
        Atomics.compareExchange(
          slot.i32,
          SAB_IO_S_STATE,
          SAB_IO_SLOT_PENDING,
          SAB_IO_SLOT_SERVICING,
        ) !== SAB_IO_SLOT_PENDING
      ) {
        continue;
      }
      claimedSlots.add(slot.index);
      ready.push(makeJob(slot));
      found += 1;
    }
    if (ready.length > stats.maxReady) stats.maxReady = ready.length;
    return found;
  }

  function applyRevocations() {
    for (let id = 0; id < layout.maxInstances; id += 1) {
      if (Atomics.load(layout.instances, id) !== SAB_IO_INSTANCE_REVOKING) continue;
      const owned = handlesByInstance.get(id);
      if (owned) {
        for (const handleId of Array.from(owned)) {
          const handle = handles.get(handleId);
          if (handle) closeHandle(handle);
        }
        handlesByInstance.delete(id);
      }
      memories.delete(id);
      // Requests of the instance still queued or parked fail at their next
      // step (every step checks isRevoked), so nothing of it runs after this.
      stats.revoked += 1;
      Atomics.store(layout.instances, id, SAB_IO_INSTANCE_REVOKED);
      Atomics.notify(layout.instances, id);
      emit({ type: "revoked", instanceId: id });
    }
  }

  function parkOnEntry(job, entry) {
    stats.parked += 1;
    entry.waiters.push(job);
    return STEP_PARKED;
  }

  function settleEntry(entry, status, file) {
    entry.opening = null;
    entry.openStatus = status;
    entry.file = file ?? null;
    if (status === 0 && mirror && mirror.write !== false && mirror.match(entry.path) && entry.file) {
      // Seed the mirror with the file's current bytes, so a reader that
      // consults it sees exactly what a read of the file would return.
      try {
        const size = entry.file.getSize();
        const seed = new Uint8Array(Math.min(size, sabIoMirrorEntryBytes(mirror.buffer)));
        if (seed.length > 0) fileRead(entry.file, seed, 0);
        updateSabIoMirror(mirror.buffer, entry.path, 0, seed, { truncateTo: size });
      } catch {
        // a mirror that cannot be seeded stays absent; readers use the file
      }
    }
    const waiters = entry.waiters;
    entry.waiters = [];
    for (const job of waiters) {
      if (job.op === SAB_IO_OP_OPEN && job.phase === 1 && job.entry === entry) {
        // The opener that created this entry: hand out its handle now, so no
        // namespace operation can slip between the open and the handle.
        if (status < 0) job.result = status;
        else if (isRevoked(job.instanceId)) job.result = FLATSQL_IO_ERR_ACCESS;
        else job.result = addHandle(entry, job.instanceId, job.flags);
        job.phase = 2;
      }
      ready.push(job);
    }
    if (status < 0 && entry.refs === 0 && entry.pins === 0 && entries.get(entry.path) === entry) {
      entries.delete(entry.path);
    } else if (status === 0 && entry.refs === 0 && entry.pins === 0) {
      // Nobody took a handle (its opener was revoked meanwhile): close the
      // file, or it would pin the path against UNLINK_IF_UNUSED forever.
      // Openers still in the ready queue simply open it again.
      releaseEntry(entry);
    }
    wake();
  }

  function startOpen(entry, flags) {
    stats.opens += 1;
    entry.opening = chainPath(entry.path, async () => {
      try {
        const file = await backend.openFile(entry.path, entry.components, flags);
        settleEntry(entry, 0, file);
      } catch (error) {
        settleEntry(entry, flatsqlIoStatusOf(error, { during: "open" }), null);
      }
    });
  }

  function stepOpen(job) {
    if (job.phase === 2) {
      // Parked on a namespace operation that has now settled.
      complete(job, job.result);
      return STEP_DONE;
    }
    if (isRevoked(job.instanceId)) {
      complete(job, FLATSQL_IO_ERR_ACCESS);
      return STEP_DONE;
    }
    if (job.path === undefined) {
      const bytes = job.slot.data.slice(0, Math.max(0, job.pathLen));
      const path = decodeFlatsqlIoPath(bytes);
      if (typeof path !== "string") {
        complete(job, path);
        return STEP_DONE;
      }
      const components = splitFlatsqlIoPath(path);
      if (!Array.isArray(components)) {
        complete(job, components);
        return STEP_DONE;
      }
      job.path = components.join("/");
      job.components = components;
    }
    const { path, components, flags } = job;
    const entry = entries.get(path);

    if (flags & (FLATSQL_IO_PROBE | FLATSQL_IO_UNLINK | FLATSQL_IO_UNLINK_IF_UNUSED)) {
      if (entry?.opening) return parkOnEntry(job, entry);
      if (flags & FLATSQL_IO_PROBE) {
        if (entry && entry.openStatus === 0) {
          complete(job, 0);
          return STEP_DONE;
        }
        return runNamespace(job, async () => {
          const exists = await backend.exists(path, components);
          return exists ? 0 : FLATSQL_IO_ERR_NOENT;
        });
      }
      // UNLINK / UNLINK_IF_UNUSED
      if (entry && entry.refs > 0) {
        // OPFS cannot remove a file with an open sync handle, so a plain
        // UNLINK of an in-use path is BUSY here too (POSIX hosts allow it).
        stats.busy += 1;
        complete(job, FLATSQL_IO_ERR_BUSY);
        return STEP_DONE;
      }
      if (entry && entry.pins > 0) {
        entry.pins = 0;
        releaseEntry(entry);
      }
      return runNamespace(job, async () => {
        await backend.remove(path, components);
        if (mirror && mirror.write !== false) clearSabIoMirror(mirror.buffer, path);
        return 0;
      });
    }

    if (entry) {
      if (entry.opening) {
        if (flags & FLATSQL_IO_OPEN_DEFERRED) {
          stats.deferredOpens += 1;
          const id = addHandle(entry, job.instanceId, flags);
          complete(job, id);
          return STEP_DONE;
        }
        return parkOnEntry(job, entry);
      }
      if (entry.openStatus === 0) {
        if (flags & FLATSQL_IO_EXCL) {
          complete(job, FLATSQL_IO_ERR_GENERIC);
          return STEP_DONE;
        }
        if (flags & FLATSQL_IO_TRUNC && flags & FLATSQL_IO_WRITE) {
          try {
            entry.file.truncate(0);
            if (mirror && mirror.write !== false && mirror.match(path)) {
              updateSabIoMirror(mirror.buffer, path, 0, new Uint8Array(0), { truncateTo: 0 });
            }
          } catch (error) {
            complete(job, flatsqlIoStatusOf(error));
            return STEP_DONE;
          }
        }
        const id = addHandle(entry, job.instanceId, flags);
        complete(job, id);
        return STEP_DONE;
      }
      // A failed deferred open still referenced by handles: start afresh.
      if (entries.get(path) === entry) entries.delete(path);
    }

    const fresh = {
      path,
      components,
      file: null,
      opening: null,
      openStatus: 0,
      refs: 0,
      pins: 0,
      deleteOnClose: false,
      waiters: [],
    };
    entries.set(path, fresh);
    startOpen(fresh, flags);
    if (flags & FLATSQL_IO_OPEN_DEFERRED) {
      stats.deferredOpens += 1;
      const id = addHandle(fresh, job.instanceId, flags);
      complete(job, id);
      return STEP_DONE;
    }
    job.phase = 1;
    job.entry = fresh;
    return parkOnEntry(job, fresh);
  }

  function runNamespace(job, task) {
    job.phase = 2;
    chainPath(job.path, async () => {
      try {
        job.result = await task();
      } catch (error) {
        job.result = flatsqlIoStatusOf(error);
      }
      ready.push(job);
      wake();
    });
    stats.parked += 1;
    return STEP_PARKED;
  }

  function stepHandleOp(job) {
    if (isRevoked(job.instanceId)) {
      complete(job, FLATSQL_IO_ERR_ACCESS);
      return STEP_DONE;
    }
    const handle = handles.get(job.handleId);
    if (!handle) {
      complete(job, FLATSQL_IO_ERR_BADHANDLE);
      return STEP_DONE;
    }
    const entry = handle.entry;
    if (entry.opening) return parkOnEntry(job, entry);
    if (job.op === SAB_IO_OP_CLOSE) {
      closeHandle(handle);
      complete(job, 0);
      return STEP_DONE;
    }
    if (entry.openStatus < 0 || !entry.file) {
      complete(job, entry.openStatus < 0 ? entry.openStatus : FLATSQL_IO_ERR_BADHANDLE);
      return STEP_DONE;
    }
    const file = entry.file;
    try {
      switch (job.op) {
        case SAB_IO_OP_READ: {
          if (!handle.canRead) {
            complete(job, FLATSQL_IO_ERR_IO);
            return STEP_DONE;
          }
          const view = resolveView(job);
          if (!view) {
            complete(job, FLATSQL_IO_ERR_GENERIC);
            return STEP_DONE;
          }
          const piece = Math.min(chunkBytes, job.len - job.done);
          const n = fileRead(file, view.subarray(job.done, job.done + piece), job.offset + job.done);
          stats.chunks += 1;
          job.done += n;
          if (n < piece || job.done >= job.len) {
            complete(job, job.done);
            return STEP_DONE;
          }
          return STEP_AGAIN;
        }
        case SAB_IO_OP_WRITE: {
          if (!handle.canWrite) {
            complete(job, FLATSQL_IO_ERR_IO);
            return STEP_DONE;
          }
          const view = resolveView(job);
          if (!view) {
            complete(job, FLATSQL_IO_ERR_GENERIC);
            return STEP_DONE;
          }
          const piece = Math.min(chunkBytes, job.len - job.done);
          const chunk = view.subarray(job.done, job.done + piece);
          const at = job.offset + job.done;
          const n = fileWrite(file, chunk, at);
          stats.chunks += 1;
          if (mirror && mirror.write !== false && mirror.match(entry.path)) {
            updateSabIoMirror(mirror.buffer, entry.path, at, chunk.subarray(0, n));
          }
          job.done += n;
          if (n < piece || job.done >= job.len) {
            complete(job, job.done);
            return STEP_DONE;
          }
          return STEP_AGAIN;
        }
        case SAB_IO_OP_TRUNCATE: {
          if (!handle.canWrite) {
            complete(job, FLATSQL_IO_ERR_IO);
            return STEP_DONE;
          }
          file.truncate(job.offset);
          if (mirror && mirror.write !== false && mirror.match(entry.path)) {
            updateSabIoMirror(mirror.buffer, entry.path, 0, new Uint8Array(0), {
              truncateTo: job.offset,
            });
          }
          complete(job, 0);
          return STEP_DONE;
        }
        case SAB_IO_OP_SYNC:
          file.flush();
          complete(job, 0);
          return STEP_DONE;
        case SAB_IO_OP_SIZE:
          complete(job, 0, file.getSize());
          return STEP_DONE;
        default:
          complete(job, FLATSQL_IO_ERR_GENERIC);
          return STEP_DONE;
      }
    } catch (error) {
      const status = flatsqlIoStatusOf(error);
      complete(job, job.done > 0 && job.op === SAB_IO_OP_READ ? job.done : status);
      return STEP_DONE;
    }
  }

  function step(job) {
    try {
      if (job.op === SAB_IO_OP_OPEN) {
        return stepOpen(job);
      }
      if (
        job.op === SAB_IO_OP_READ ||
        job.op === SAB_IO_OP_WRITE ||
        job.op === SAB_IO_OP_TRUNCATE ||
        job.op === SAB_IO_OP_SYNC ||
        job.op === SAB_IO_OP_SIZE ||
        job.op === SAB_IO_OP_CLOSE
      ) {
        return stepHandleOp(job);
      }
      complete(job, FLATSQL_IO_ERR_GENERIC);
      return STEP_DONE;
    } catch (error) {
      // A host bug must never leave a guest blocked.
      emit({ type: "step-error", error });
      complete(job, FLATSQL_IO_ERR_IO);
      return STEP_DONE;
    }
  }

  function runReady() {
    const started = now();
    while (ready.length > 0) {
      const job = ready.shift();
      const outcome = step(job);
      if (outcome === STEP_AGAIN) ready.push(job);
      applyRevocations();
      scanSlots();
      if (now() - started > RUN_BUDGET_MS) return false;
    }
    return true;
  }

  async function loop() {
    Atomics.store(layout.header, SAB_IO_H_DOORBELL_MODE, doorbellMode);
    Atomics.add(layout.header, SAB_IO_H_SERVER_EPOCH, 1);
    Atomics.store(layout.header, SAB_IO_H_SERVER_STATE, SAB_IO_SERVER_RUNNING);
    while (running) {
      const observed = Atomics.load(layout.header, SAB_IO_H_DOORBELL);
      applyRevocations();
      scanSlots();
      const drained = runReady();
      if (!running) break;
      if (!drained || ready.length > 0) {
        await yieldMacrotask();
        continue;
      }
      // Adaptive wait: poll the doorbell briefly before sleeping. Back-to-back
      // requests (a lane reading index blocks) are then served without a
      // thread wake-up, which on a busy machine costs far more than the spin.
      if (spinMicros > 0) {
        const until = now() + spinMicros / 1000;
        while (now() < until && Atomics.load(layout.header, SAB_IO_H_DOORBELL) === observed) {
          // spin
        }
        if (Atomics.load(layout.header, SAB_IO_H_DOORBELL) !== observed) continue;
      }
      await waitForWork(observed);
    }
  }

  return {
    doorbellMode,
    stats,
    /** Start the loop. Resolves when it stops. */
    start() {
      if (running) return loopPromise;
      running = true;
      if (doorbellMode === SAB_IO_DOORBELL_MESSAGE && typeof BroadcastChannel === "function") {
        doorbellChannel = new BroadcastChannel(sabIoDoorbellChannelName(layout.channelId));
        doorbellChannel.onmessage = () => {
          const resolve = messageWake;
          messageWake = null;
          resolve?.();
        };
      }
      loopPromise = loop().catch((error) => {
        emit({ type: "loop-error", error });
        throw error;
      });
      return loopPromise;
    },
    /** Stop the loop and close every file. */
    async stop() {
      running = false;
      wake();
      try {
        await loopPromise;
      } catch {
        // already reported
      }
      doorbellChannel?.close();
      doorbellChannel = null;
      for (const entry of entries.values()) {
        try {
          entry.file?.close();
        } catch {
          // ignore
        }
      }
      entries.clear();
      handles.clear();
      handlesByInstance.clear();
      Atomics.store(layout.header, SAB_IO_H_SERVER_STATE, SAB_IO_SERVER_STOPPED);
    },
    /**
     * Attach an instance's shared memory, so its requests move bytes directly
     * between that memory and the file. Refused for a revoked id (reset it
     * first with resetSabIoInstance).
     */
    attachMemory(instanceId, memory) {
      if (!Number.isInteger(instanceId) || instanceId < 0 || instanceId >= layout.maxInstances) {
        return false;
      }
      const state = Atomics.load(layout.instances, instanceId);
      if (state === SAB_IO_INSTANCE_REVOKING || state === SAB_IO_INSTANCE_REVOKED) return false;
      memories.set(instanceId, memory);
      Atomics.store(layout.instances, instanceId, SAB_IO_INSTANCE_ATTACHED);
      return true;
    },
    detachMemory(instanceId) {
      memories.delete(instanceId);
      if (Atomics.load(layout.instances, instanceId) === SAB_IO_INSTANCE_ATTACHED) {
        Atomics.store(layout.instances, instanceId, SAB_IO_INSTANCE_NONE);
      }
    },
    /**
     * Pre-open paths (A38 "at start, the I/O workers open every active file
     * the registry names in parallel"; §5.5 next-segment pre-open). The files
     * stay open, pinned, until releasePreopen or an UNLINK; a guest open of a
     * pre-opened path returns at once. Resolves to one status per path.
     */
    async preopen(paths, flags = FLATSQL_IO_READ | FLATSQL_IO_WRITE | FLATSQL_IO_CREATE) {
      const results = await Promise.all(
        paths.map(async (rawPath) => {
          const components = splitFlatsqlIoPath(String(rawPath));
          if (!Array.isArray(components)) return components;
          const path = components.join("/");
          let entry = entries.get(path);
          if (!entry) {
            entry = {
              path,
              components,
              file: null,
              opening: null,
              openStatus: 0,
              refs: 0,
              pins: 0,
              deleteOnClose: false,
              waiters: [],
            };
            entries.set(path, entry);
            startOpen(entry, flags & ~FLATSQL_IO_OPEN_DEFERRED);
          }
          entry.pins += 1;
          if (entry.opening) await entry.opening;
          if (entry.openStatus < 0) {
            entry.pins = Math.max(0, entry.pins - 1);
            return entry.openStatus;
          }
          return 0;
        }),
      );
      wake();
      return results;
    },
    /** Drop pre-open pins; files with no handle close. */
    releasePreopen(paths) {
      for (const rawPath of paths) {
        const components = splitFlatsqlIoPath(String(rawPath));
        if (!Array.isArray(components)) continue;
        const entry = entries.get(components.join("/"));
        if (entry && entry.pins > 0) {
          entry.pins -= 1;
          releaseEntry(entry);
        }
      }
    },
    /** Open files and handles, for diagnostics and tests. */
    inventory() {
      return {
        files: Array.from(entries.values()).map((entry) => ({
          path: entry.path,
          refs: entry.refs,
          pins: entry.pins,
          opening: !!entry.opening,
          openStatus: entry.openStatus,
        })),
        handles: handles.size,
      };
    },
  };
}

export const FLATSQL_IO_SERVER_CREATE_FLAGS =
  FLATSQL_IO_READ | FLATSQL_IO_WRITE | FLATSQL_IO_CREATE | FLATSQL_IO_CREATE_PARENTS;
