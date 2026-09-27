/**
 * SharedArrayBuffer I/O request ring: the multi-slot extension of
 * sabHostcallChannel.js for FlatSQL's seven `flatsql_io_*` imports
 * (docs/architecture/flatsql-partition-store.md §5.5, A7, A36, A38).
 *
 * sabHostcallChannel.js serves ONE blocking guest against an async host, one
 * request at a time, over postMessage. This channel serves MANY guest threads
 * at once against one I/O worker, which holds every OPFS handle and never
 * blocks:
 *
 *   guest thread (pool worker)                   I/O worker (flatsqlIoServer.js)
 *   ──────────────────────────                   ──────────────────────────────
 *   claim a slot once (CAS FREE -> IDLE)
 *   write {op, handle, ptr, len, offset, flags}
 *   state <- PENDING; doorbell += 1; notify ───▶ waitAsync(doorbell) or message
 *                                               scan slots: PENDING -> SERVICING
 *                                               sync ops run at once, async opens
 *                                               are awaited without blocking others
 *   Atomics.wait(state) in bounded slices  ◀─── status; state <- DONE; notify(state)
 *   state <- IDLE
 *
 * Properties the design requires:
 * - Each request owns its slot until its result is read, so a guest thread
 *   never queues behind another guest's request; a slow open blocks only its
 *   caller. Size the ring to the guest threads plus async callers.
 * - No timeout and no throw (A36). A client waits in bounded slices forever;
 *   a dead I/O worker is handled by its supervisor, which completes pending
 *   slots with an error status (failPendingSabIoRequests).
 * - Doorbell: `Atomics.waitAsync` where the server has it; otherwise the
 *   client also posts a message on a BroadcastChannel (22.3a-5). The mode is
 *   chosen by the server and published in the header.
 * - Data moves directly between the guest's shared memory and the file when
 *   the instance's memory is attached to the I/O worker; otherwise through
 *   the slot's own data area ("scratch"). Both paths give the same bytes.
 * - Revocation (A36): the supervisor marks an instance REVOKING in the
 *   header; the server fails that instance's requests with ACCESS, closes its
 *   handles, and acknowledges with REVOKED. revokeSabIoInstance() resolves
 *   only after the acknowledgement, so no byte is written after it returns.
 */

import {
  FLATSQL_IO_ERR_ACCESS,
  FLATSQL_IO_ERR_GENERIC,
  FLATSQL_IO_ERR_IO,
  FLATSQL_IO_MAX_PATH_BYTES,
} from "./flatsqlIoContract.js";

export const SAB_IO_MAGIC = 0x4f494453; // "SDIO" little-endian
export const SAB_IO_VERSION = 1;

// ---- header words (Int32 index) ------------------------------------------
export const SAB_IO_H_MAGIC = 0;
export const SAB_IO_H_VERSION = 1;
export const SAB_IO_H_SLOT_COUNT = 2;
export const SAB_IO_H_SLOT_BYTES = 3;
export const SAB_IO_H_MAX_INSTANCES = 4;
export const SAB_IO_H_DOORBELL = 5;
export const SAB_IO_H_SERVER_STATE = 6;
export const SAB_IO_H_DOORBELL_MODE = 7;
export const SAB_IO_H_SERVER_EPOCH = 8;
export const SAB_IO_H_CLAIM_HINT = 9;
export const SAB_IO_H_SLOT_RELEASES = 10;
export const SAB_IO_H_DATA_BYTES = 11;
export const SAB_IO_H_SERVED = 12;
export const SAB_IO_H_CHANNEL_ID = 13;
const HEADER_WORDS = 64;
const HEADER_BYTES = HEADER_WORDS * 4;

export const SAB_IO_SERVER_NOT_STARTED = 0;
export const SAB_IO_SERVER_RUNNING = 1;
export const SAB_IO_SERVER_STOPPED = 2;
export const SAB_IO_SERVER_DEAD = 3;

export const SAB_IO_DOORBELL_ATOMICS = 0;
export const SAB_IO_DOORBELL_MESSAGE = 1;

// ---- instance table (one Int32 per instance id) ----------------------------
export const SAB_IO_INSTANCE_NONE = 0;
export const SAB_IO_INSTANCE_ATTACHED = 1;
export const SAB_IO_INSTANCE_REVOKING = 2;
export const SAB_IO_INSTANCE_REVOKED = 3;
/**
 * Instance id of callers that are not a wasm instance (tests, the engine
 * worker's own bookkeeping). It has no attached memory and is never revoked;
 * its data always moves through the slot data area.
 */
export const SAB_IO_SCRATCH_INSTANCE = 0x7fff;

// ---- slot words (Int32 index relative to the slot) ------------------------
export const SAB_IO_S_STATE = 0;
export const SAB_IO_S_OWNER = 1;
export const SAB_IO_S_SEQ = 2;
export const SAB_IO_S_DONE_SEQ = 3;
export const SAB_IO_S_OP = 4;
export const SAB_IO_S_INSTANCE = 5;
export const SAB_IO_S_HANDLE = 6;
export const SAB_IO_S_FLAGS = 7;
export const SAB_IO_S_PTR = 8;
export const SAB_IO_S_LEN = 9;
export const SAB_IO_S_PATH_LEN = 10;
export const SAB_IO_S_STATUS = 11;
export const SAB_IO_S_NOTIFY = 12;
export const SAB_IO_S_DATA_MODE = 13;
// Float64 index relative to the slot.
export const SAB_IO_S_F64_OFFSET = 8;
export const SAB_IO_S_F64_RESULT = 9;
const SLOT_HEADER_BYTES = 128;

export const SAB_IO_SLOT_FREE = 0;
export const SAB_IO_SLOT_IDLE = 1;
export const SAB_IO_SLOT_PENDING = 2;
export const SAB_IO_SLOT_SERVICING = 3;
export const SAB_IO_SLOT_DONE = 4;

export const SAB_IO_NOTIFY_ATOMICS = 0;
export const SAB_IO_NOTIFY_MESSAGE = 1;

/** `ptr` addresses the instance's attached memory. */
export const SAB_IO_DATA_MEMORY = 0;
/** `ptr` addresses the slot's own data area (the scratch path). */
export const SAB_IO_DATA_SLOT = 1;

// ---- operations -----------------------------------------------------------
export const SAB_IO_OP_OPEN = 1;
export const SAB_IO_OP_READ = 2;
export const SAB_IO_OP_WRITE = 3;
export const SAB_IO_OP_TRUNCATE = 4;
export const SAB_IO_OP_SYNC = 5;
export const SAB_IO_OP_SIZE = 6;
export const SAB_IO_OP_CLOSE = 7;

export const DEFAULT_SAB_IO_SLOTS = 64;
export const DEFAULT_SAB_IO_DATA_BYTES = 64 * 1024;
export const DEFAULT_SAB_IO_MAX_INSTANCES = 64;

/** Bound on one blocking wait. Waits loop forever in slices; they never time out. */
export const SAB_IO_WAIT_SLICE_MS = 250;
/** How long a blocking client polls for its answer before it sleeps. */
export const DEFAULT_SAB_IO_CLIENT_SPIN_MICROS = 20;

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function alignUp(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function assertSharedArrayBuffer(buffer) {
  if (
    typeof SharedArrayBuffer !== "function" ||
    !(buffer instanceof SharedArrayBuffer)
  ) {
    throw new TypeError(
      "The SAB I/O channel requires a SharedArrayBuffer (cross-origin isolation in browsers).",
    );
  }
}

/**
 * Allocate the shared buffer of one I/O channel.
 *
 * @param {object} [options]
 * @param {number} [options.slots=64] concurrent requests; size it to at least
 *   the number of guest threads plus async callers using this channel.
 * @param {number} [options.dataBytes=65536] per-slot data area: paths, and the
 *   scratch path for unattached callers. Must hold the longest path (4096).
 * @param {number} [options.maxInstances=64] instance ids 0..maxInstances-1.
 */
export function createSabIoChannelBuffer(options = {}) {
  if (typeof SharedArrayBuffer !== "function") {
    throw new Error(
      "SharedArrayBuffer is unavailable; the I/O channel requires it " +
        "(browsers additionally require cross-origin isolation: COOP+COEP).",
    );
  }
  const slots = Number.isInteger(options.slots) ? options.slots : DEFAULT_SAB_IO_SLOTS;
  const dataBytes = Number.isInteger(options.dataBytes)
    ? options.dataBytes
    : DEFAULT_SAB_IO_DATA_BYTES;
  const maxInstances = Number.isInteger(options.maxInstances)
    ? options.maxInstances
    : DEFAULT_SAB_IO_MAX_INSTANCES;
  if (slots < 1 || slots > 4096) {
    throw new RangeError("slots must be an integer in 1..4096.");
  }
  if (dataBytes < FLATSQL_IO_MAX_PATH_BYTES || dataBytes % 8 !== 0) {
    throw new RangeError(
      `dataBytes must be a multiple of 8 and at least ${FLATSQL_IO_MAX_PATH_BYTES}.`,
    );
  }
  if (maxInstances < 1 || maxInstances > SAB_IO_SCRATCH_INSTANCE) {
    throw new RangeError(`maxInstances must be in 1..${SAB_IO_SCRATCH_INSTANCE}.`);
  }
  const slotBytes = alignUp(SLOT_HEADER_BYTES + dataBytes, 64);
  const slotsOffset = alignUp(HEADER_BYTES + maxInstances * 4, 64);
  const buffer = new SharedArrayBuffer(slotsOffset + slots * slotBytes);
  const header = new Int32Array(buffer, 0, HEADER_WORDS);
  header[SAB_IO_H_MAGIC] = SAB_IO_MAGIC;
  header[SAB_IO_H_VERSION] = SAB_IO_VERSION;
  header[SAB_IO_H_SLOT_COUNT] = slots;
  header[SAB_IO_H_SLOT_BYTES] = slotBytes;
  header[SAB_IO_H_MAX_INSTANCES] = maxInstances;
  header[SAB_IO_H_DATA_BYTES] = dataBytes;
  // A random channel id names the BroadcastChannels of message-mode doorbells.
  header[SAB_IO_H_CHANNEL_ID] = (Math.random() * 0x7fffffff) | 0 || 1;
  return buffer;
}

/** Views and geometry of a channel buffer. */
export function describeSabIoChannel(buffer) {
  assertSharedArrayBuffer(buffer);
  const header = new Int32Array(buffer, 0, HEADER_WORDS);
  if (header[SAB_IO_H_MAGIC] !== SAB_IO_MAGIC || header[SAB_IO_H_VERSION] !== SAB_IO_VERSION) {
    throw new TypeError("Not a SAB I/O channel buffer (bad magic or version).");
  }
  const slotCount = header[SAB_IO_H_SLOT_COUNT];
  const slotBytes = header[SAB_IO_H_SLOT_BYTES];
  const maxInstances = header[SAB_IO_H_MAX_INSTANCES];
  const dataBytes = header[SAB_IO_H_DATA_BYTES];
  const slotsOffset = alignUp(HEADER_BYTES + maxInstances * 4, 64);
  const instances = new Int32Array(buffer, HEADER_BYTES, maxInstances);
  const slots = [];
  for (let index = 0; index < slotCount; index += 1) {
    const base = slotsOffset + index * slotBytes;
    slots.push({
      index,
      base,
      i32: new Int32Array(buffer, base, SLOT_HEADER_BYTES / 4),
      f64: new Float64Array(buffer, base, SLOT_HEADER_BYTES / 8),
      data: new Uint8Array(buffer, base + SLOT_HEADER_BYTES, dataBytes),
    });
  }
  return {
    buffer,
    header,
    instances,
    slots,
    slotCount,
    slotBytes,
    dataBytes,
    maxInstances,
    channelId: header[SAB_IO_H_CHANNEL_ID],
  };
}

/** BroadcastChannel names used by message-mode doorbells and completions. */
export function sabIoDoorbellChannelName(channelId) {
  return `sdm-sab-io-doorbell-${channelId}`;
}
export function sabIoCompletionChannelName(channelId) {
  return `sdm-sab-io-done-${channelId}`;
}

function ringDoorbell(layout, messenger) {
  Atomics.add(layout.header, SAB_IO_H_DOORBELL, 1);
  Atomics.notify(layout.header, SAB_IO_H_DOORBELL);
  if (Atomics.load(layout.header, SAB_IO_H_DOORBELL_MODE) === SAB_IO_DOORBELL_MESSAGE) {
    messenger()?.postMessage(0);
  }
}

function lazyBroadcast(name) {
  let channel = null;
  return {
    get() {
      if (!channel && typeof BroadcastChannel === "function") {
        channel = new BroadcastChannel(name);
      }
      return channel;
    },
    close() {
      channel?.close();
      channel = null;
    },
  };
}

const pathEncoder = typeof TextEncoder === "function" ? new TextEncoder() : null;

function randomOwnerToken() {
  return ((Math.random() * 0x7ffffffe) | 0) + 1;
}

/** Claim a FREE slot. Returns the slot or null. Never blocks. */
function tryClaimSlot(layout, owner) {
  const start = (Atomics.add(layout.header, SAB_IO_H_CLAIM_HINT, 1) >>> 0) % layout.slotCount;
  for (let step = 0; step < layout.slotCount; step += 1) {
    const slot = layout.slots[(start + step) % layout.slotCount];
    if (
      Atomics.compareExchange(slot.i32, SAB_IO_S_STATE, SAB_IO_SLOT_FREE, SAB_IO_SLOT_IDLE) ===
      SAB_IO_SLOT_FREE
    ) {
      Atomics.store(slot.i32, SAB_IO_S_OWNER, owner);
      return slot;
    }
  }
  return null;
}

function releaseSlot(layout, slot) {
  Atomics.store(slot.i32, SAB_IO_S_OWNER, 0);
  Atomics.store(slot.i32, SAB_IO_S_STATE, SAB_IO_SLOT_FREE);
  Atomics.add(layout.header, SAB_IO_H_SLOT_RELEASES, 1);
  Atomics.notify(layout.header, SAB_IO_H_SLOT_RELEASES);
}

/**
 * Fill a slot's request fields. `fields.path` (bytes) is copied into the slot
 * data area, so the server never decodes a view over guest memory.
 */
function writeRequest(slot, op, fields) {
  const i32 = slot.i32;
  i32[SAB_IO_S_OP] = op;
  i32[SAB_IO_S_INSTANCE] = fields.instanceId ?? SAB_IO_SCRATCH_INSTANCE;
  i32[SAB_IO_S_HANDLE] = fields.handle ?? -1;
  i32[SAB_IO_S_FLAGS] = fields.flags ?? 0;
  i32[SAB_IO_S_PTR] = fields.ptr ?? 0;
  i32[SAB_IO_S_LEN] = fields.len ?? 0;
  i32[SAB_IO_S_DATA_MODE] = fields.dataInSlot ? SAB_IO_DATA_SLOT : SAB_IO_DATA_MEMORY;
  i32[SAB_IO_S_STATUS] = 0;
  slot.f64[SAB_IO_S_F64_OFFSET] = fields.offset ?? 0;
  slot.f64[SAB_IO_S_F64_RESULT] = 0;
  if (fields.path) {
    slot.data.set(fields.path, 0);
    i32[SAB_IO_S_PATH_LEN] = fields.path.length;
  } else {
    i32[SAB_IO_S_PATH_LEN] = 0;
  }
}

/** Status of a request, as the server returns it (i32 ops). */
function statusOf(slot) {
  return Atomics.load(slot.i32, SAB_IO_S_STATUS);
}

/**
 * Blocking client for one guest thread (or any Worker that may block). Every
 * method returns a status or a count; none throws. Each request claims a free
 * slot and releases it once its result is read.
 *
 * Pointers (`ptr`) address the attached memory of `instanceId` when that
 * instance is ATTACHED; otherwise the client moves the bytes through the slot
 * data area itself using `getMemory()` (the scratch path). Callers without a
 * wasm memory use readInto/writeFrom with plain Uint8Arrays.
 *
 * @param {object} options
 * @param {SharedArrayBuffer} options.buffer channel buffer
 * @param {number} [options.instanceId] the calling instance (revocation and
 *   memory resolution). Defaults to the scratch instance.
 * @param {() => (WebAssembly.Memory|null)} [options.getMemory] the caller's
 *   memory, for the scratch path of pointer-based requests.
 * @param {number} [options.spinMicros=20] poll for the answer this long before
 *   sleeping (0 disables).
 */
export function createSabIoClient(options = {}) {
  assertSharedArrayBuffer(options.buffer);
  const layout = describeSabIoChannel(options.buffer);
  const instanceId = Number.isInteger(options.instanceId)
    ? options.instanceId
    : SAB_IO_SCRATCH_INSTANCE;
  if (
    instanceId !== SAB_IO_SCRATCH_INSTANCE &&
    (instanceId < 0 || instanceId >= layout.maxInstances)
  ) {
    throw new RangeError(`instanceId ${instanceId} is outside 0..${layout.maxInstances - 1}.`);
  }
  const getMemory = typeof options.getMemory === "function" ? options.getMemory : () => null;
  const spinMicros = Number.isFinite(options.spinMicros)
    ? Math.max(0, options.spinMicros)
    : DEFAULT_SAB_IO_CLIENT_SPIN_MICROS;
  const owner = randomOwnerToken();
  const doorbell = lazyBroadcast(sabIoDoorbellChannelName(layout.channelId));
  let requests = 0;

  // A slot is claimed per request and released as soon as its result is read.
  // A client therefore holds no slot while idle, and a terminated worker leaks
  // none (only a request in flight at termination, which the server still
  // completes; reclaimSabIoSlots frees those).
  function claim() {
    for (;;) {
      const releases = Atomics.load(layout.header, SAB_IO_H_SLOT_RELEASES);
      const slot = tryClaimSlot(layout, owner);
      if (slot) return slot;
      // Every slot is busy. Wait for a release, in bounded slices.
      Atomics.wait(layout.header, SAB_IO_H_SLOT_RELEASES, releases, SAB_IO_WAIT_SLICE_MS);
    }
  }

  function roundTrip(slot, op, fields) {
    const seq = (Atomics.load(slot.i32, SAB_IO_S_SEQ) + 1) | 0 || 1;
    writeRequest(slot, op, fields);
    Atomics.store(slot.i32, SAB_IO_S_NOTIFY, SAB_IO_NOTIFY_ATOMICS);
    Atomics.store(slot.i32, SAB_IO_S_SEQ, seq);
    Atomics.store(slot.i32, SAB_IO_S_STATE, SAB_IO_SLOT_PENDING);
    ringDoorbell(layout, doorbell.get);
    // Spin briefly first: a fast answer then costs no sleep and wake-up.
    const spinUntil = spinMicros > 0 ? nowMs() + spinMicros / 1000 : 0;
    for (;;) {
      const state = Atomics.load(slot.i32, SAB_IO_S_STATE);
      if (state === SAB_IO_SLOT_DONE && Atomics.load(slot.i32, SAB_IO_S_DONE_SEQ) === seq) {
        break;
      }
      if (spinUntil > 0 && nowMs() < spinUntil) continue;
      Atomics.wait(slot.i32, SAB_IO_S_STATE, state, SAB_IO_WAIT_SLICE_MS);
    }
    requests += 1;
    return { status: statusOf(slot), result: slot.f64[SAB_IO_S_F64_RESULT] };
  }

  function request(op, fields) {
    const slot = claim();
    try {
      return roundTrip(slot, op, fields);
    } finally {
      releaseSlot(layout, slot);
    }
  }

  function attached() {
    return (
      instanceId !== SAB_IO_SCRATCH_INSTANCE &&
      Atomics.load(layout.instances, instanceId) === SAB_IO_INSTANCE_ATTACHED
    );
  }

  function revoked() {
    if (instanceId === SAB_IO_SCRATCH_INSTANCE) return false;
    const state = Atomics.load(layout.instances, instanceId);
    return state === SAB_IO_INSTANCE_REVOKING || state === SAB_IO_INSTANCE_REVOKED;
  }

  // Move bytes between a caller view and the file through the slot data area,
  // in data-area-sized pieces. `op` is SAB_IO_OP_READ or SAB_IO_OP_WRITE.
  function scratchTransfer(op, handle, view, offset) {
    let done = 0;
    while (done < view.length) {
      const piece = Math.min(layout.dataBytes, view.length - done);
      const slot = claim();
      let status;
      try {
        if (op === SAB_IO_OP_WRITE) {
          slot.data.set(view.subarray(done, done + piece), 0);
        }
        status = roundTrip(slot, op, {
          instanceId,
          dataInSlot: true,
          handle,
          ptr: 0,
          len: piece,
          offset: offset + done,
        }).status;
        if (op === SAB_IO_OP_READ && status > 0) {
          view.set(slot.data.subarray(0, status), done);
        }
      } finally {
        releaseSlot(layout, slot);
      }
      if (status < 0) {
        return done > 0 && op === SAB_IO_OP_READ ? done : status;
      }
      done += status;
      if (status < piece) {
        break; // short read at EOF (or a short write the host reported)
      }
    }
    return done;
  }

  function memoryView(ptr, len) {
    const memory = getMemory();
    const buffer = memory?.buffer ?? memory;
    if (!buffer || ptr < 0 || len < 0 || ptr + len > buffer.byteLength) {
      return null;
    }
    return new Uint8Array(buffer, ptr, len);
  }

  return {
    instanceId,
    get requests() {
      return requests;
    },
    /** Open (or probe/unlink) `path` (UTF-8 bytes, or a string). */
    open(path, flags) {
      const pathBytes = typeof path === "string" ? pathEncoder.encode(path) : path;
      if (!(pathBytes instanceof Uint8Array) || pathBytes.length === 0) {
        return FLATSQL_IO_ERR_GENERIC;
      }
      if (pathBytes.length > Math.min(layout.dataBytes, FLATSQL_IO_MAX_PATH_BYTES)) {
        return FLATSQL_IO_ERR_GENERIC;
      }
      return request(SAB_IO_OP_OPEN, { instanceId, flags: flags | 0, path: pathBytes })
        .status;
    },
    /** Read into the caller's memory at `ptr`. */
    read(handle, ptr, len, offset) {
      if (len === 0) return 0;
      if (attached()) {
        return request(SAB_IO_OP_READ, { instanceId, handle, ptr, len, offset }).status;
      }
      const view = memoryView(ptr, len);
      if (!view) return revoked() ? FLATSQL_IO_ERR_ACCESS : FLATSQL_IO_ERR_GENERIC;
      return scratchTransfer(SAB_IO_OP_READ, handle, view, offset);
    },
    /** Write from the caller's memory at `ptr`. */
    write(handle, ptr, len, offset) {
      if (len === 0) return 0;
      if (attached()) {
        return request(SAB_IO_OP_WRITE, { instanceId, handle, ptr, len, offset }).status;
      }
      const view = memoryView(ptr, len);
      if (!view) return revoked() ? FLATSQL_IO_ERR_ACCESS : FLATSQL_IO_ERR_GENERIC;
      return scratchTransfer(SAB_IO_OP_WRITE, handle, view, offset);
    },
    /** Read into a plain Uint8Array (scratch path). */
    readInto(handle, view, offset) {
      if (view.length === 0) return 0;
      return scratchTransfer(SAB_IO_OP_READ, handle, view, offset);
    },
    /** Write a plain Uint8Array (scratch path). */
    writeFrom(handle, view, offset) {
      if (view.length === 0) return 0;
      return scratchTransfer(SAB_IO_OP_WRITE, handle, view, offset);
    },
    truncate(handle, size) {
      return request(SAB_IO_OP_TRUNCATE, { instanceId, handle, offset: size }).status;
    },
    sync(handle) {
      return request(SAB_IO_OP_SYNC, { instanceId, handle }).status;
    },
    size(handle) {
      const { status, result } = request(SAB_IO_OP_SIZE, { instanceId, handle });
      return status < 0 ? status : result;
    },
    close(handle) {
      return request(SAB_IO_OP_CLOSE, { instanceId, handle }).status;
    },
    /** The thread is exiting: close the doorbell channel. */
    release() {
      doorbell.close();
    },
  };
}

/**
 * Non-blocking client for contexts that must not block: a page, the engine
 * worker's event loop, or one I/O worker forwarding to another. Each request
 * claims a slot, waits with `Atomics.waitAsync` (or a completion message where
 * waitAsync is missing, 22.3a-5), and releases it. Data always moves through
 * the slot data area.
 *
 * Methods resolve to a status or count; `read` resolves to a Uint8Array or a
 * negative status. Nothing rejects.
 */
export function createSabIoAsyncClient(options = {}) {
  assertSharedArrayBuffer(options.buffer);
  const layout = describeSabIoChannel(options.buffer);
  const instanceId = Number.isInteger(options.instanceId)
    ? options.instanceId
    : SAB_IO_SCRATCH_INSTANCE;
  const owner = randomOwnerToken();
  const hasWaitAsync = typeof Atomics.waitAsync === "function" && options.forceMessages !== true;
  const doorbell = lazyBroadcast(sabIoDoorbellChannelName(layout.channelId));
  const completion = hasWaitAsync
    ? null
    : lazyBroadcast(sabIoCompletionChannelName(layout.channelId));
  const completionWaiters = new Set();
  let completionListening = false;

  function listenForCompletions() {
    if (completionListening || !completion) return;
    const channel = completion.get();
    if (!channel) return;
    completionListening = true;
    channel.onmessage = () => {
      for (const wake of Array.from(completionWaiters)) wake();
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function claim() {
    for (;;) {
      const releases = Atomics.load(layout.header, SAB_IO_H_SLOT_RELEASES);
      const slot = tryClaimSlot(layout, owner);
      if (slot) return slot;
      if (hasWaitAsync) {
        const waited = Atomics.waitAsync(
          layout.header,
          SAB_IO_H_SLOT_RELEASES,
          releases,
          SAB_IO_WAIT_SLICE_MS,
        );
        if (waited.async) await waited.value;
      } else {
        await sleep(1);
      }
    }
  }

  async function waitDone(slot, seq) {
    for (;;) {
      const state = Atomics.load(slot.i32, SAB_IO_S_STATE);
      if (state === SAB_IO_SLOT_DONE && Atomics.load(slot.i32, SAB_IO_S_DONE_SEQ) === seq) {
        return;
      }
      if (hasWaitAsync) {
        const waited = Atomics.waitAsync(slot.i32, SAB_IO_S_STATE, state, SAB_IO_WAIT_SLICE_MS);
        if (waited.async) await waited.value;
      } else {
        listenForCompletions();
        await new Promise((resolve) => {
          const wake = () => {
            completionWaiters.delete(wake);
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(wake, SAB_IO_WAIT_SLICE_MS);
          completionWaiters.add(wake);
        });
      }
    }
  }

  let seqCounter = 0;
  async function roundTrip(op, fields, before, after) {
    const slot = await claim();
    try {
      const seq = (seqCounter = (seqCounter + 1) | 0 || 1);
      writeRequest(slot, op, fields);
      before?.(slot);
      Atomics.store(
        slot.i32,
        SAB_IO_S_NOTIFY,
        hasWaitAsync ? SAB_IO_NOTIFY_ATOMICS : SAB_IO_NOTIFY_MESSAGE,
      );
      Atomics.store(slot.i32, SAB_IO_S_SEQ, seq);
      Atomics.store(slot.i32, SAB_IO_S_STATE, SAB_IO_SLOT_PENDING);
      ringDoorbell(layout, doorbell.get);
      await waitDone(slot, seq);
      const status = statusOf(slot);
      const result = slot.f64[SAB_IO_S_F64_RESULT];
      const extra = after ? after(slot, status) : undefined;
      return { status, result, extra };
    } finally {
      releaseSlot(layout, slot);
    }
  }

  const encoder = new TextEncoder();

  return {
    instanceId,
    async open(path, flags) {
      const bytes = typeof path === "string" ? encoder.encode(path) : path;
      if (!(bytes instanceof Uint8Array) || bytes.length === 0) return FLATSQL_IO_ERR_GENERIC;
      if (bytes.length > Math.min(layout.dataBytes, FLATSQL_IO_MAX_PATH_BYTES)) {
        return FLATSQL_IO_ERR_GENERIC;
      }
      return (await roundTrip(SAB_IO_OP_OPEN, { instanceId, flags: flags | 0, path: bytes }))
        .status;
    },
    /** Resolves to the bytes read (possibly short at EOF) or a negative status. */
    async read(handle, length, offset) {
      const out = new Uint8Array(length);
      let done = 0;
      while (done < length) {
        const piece = Math.min(layout.dataBytes, length - done);
        const { status } = await roundTrip(
          SAB_IO_OP_READ,
          { instanceId, dataInSlot: true, handle, ptr: 0, len: piece, offset: offset + done },
          null,
          (slot, st) => {
            if (st > 0) out.set(slot.data.subarray(0, st), done);
          },
        );
        if (status < 0) return done > 0 ? out.subarray(0, done) : status;
        done += status;
        if (status < piece) break;
      }
      return out.subarray(0, done);
    },
    async write(handle, bytes, offset) {
      let done = 0;
      while (done < bytes.length) {
        const piece = Math.min(layout.dataBytes, bytes.length - done);
        const { status } = await roundTrip(
          SAB_IO_OP_WRITE,
          { instanceId, dataInSlot: true, handle, ptr: 0, len: piece, offset: offset + done },
          (slot) => slot.data.set(bytes.subarray(done, done + piece), 0),
        );
        if (status < 0) return status;
        done += status;
        if (status < piece) break;
      }
      return done;
    },
    async truncate(handle, size) {
      return (await roundTrip(SAB_IO_OP_TRUNCATE, { instanceId, handle, offset: size })).status;
    },
    async sync(handle) {
      return (await roundTrip(SAB_IO_OP_SYNC, { instanceId, handle })).status;
    },
    async size(handle) {
      const { status, result } = await roundTrip(SAB_IO_OP_SIZE, { instanceId, handle });
      return status < 0 ? status : result;
    },
    async close(handle) {
      return (await roundTrip(SAB_IO_OP_CLOSE, { instanceId, handle })).status;
    },
    close$() {
      doorbell.close();
      completion?.close();
    },
  };
}

/** Instance state as published in the channel header. */
export function sabIoInstanceState(buffer, instanceId) {
  const layout = describeSabIoChannel(buffer);
  return Atomics.load(layout.instances, instanceId);
}

/**
 * Revoke an instance (A36). Requests from it then complete with ACCESS, and
 * the server closes its handles. Resolves once the server has acknowledged, so
 * no byte of that instance is written after it resolves. If the server is not
 * running (dead or never started), the acknowledgement is immediate: there is
 * nobody left to write.
 */
export async function revokeSabIoInstance(buffer, instanceId, { pollMs = 5 } = {}) {
  const layout = describeSabIoChannel(buffer);
  if (instanceId < 0 || instanceId >= layout.maxInstances) {
    throw new RangeError(`instanceId ${instanceId} is outside 0..${layout.maxInstances - 1}.`);
  }
  Atomics.store(layout.instances, instanceId, SAB_IO_INSTANCE_REVOKING);
  Atomics.add(layout.header, SAB_IO_H_DOORBELL, 1);
  Atomics.notify(layout.header, SAB_IO_H_DOORBELL);
  if (Atomics.load(layout.header, SAB_IO_H_DOORBELL_MODE) === SAB_IO_DOORBELL_MESSAGE) {
    const channel =
      typeof BroadcastChannel === "function"
        ? new BroadcastChannel(sabIoDoorbellChannelName(layout.channelId))
        : null;
    channel?.postMessage(0);
    channel?.close();
  }
  for (;;) {
    const state = Atomics.load(layout.instances, instanceId);
    if (state === SAB_IO_INSTANCE_REVOKED) return;
    if (Atomics.load(layout.header, SAB_IO_H_SERVER_STATE) !== SAB_IO_SERVER_RUNNING) {
      Atomics.store(layout.instances, instanceId, SAB_IO_INSTANCE_REVOKED);
      return;
    }
    if (typeof Atomics.waitAsync === "function") {
      const waited = Atomics.waitAsync(layout.instances, instanceId, state, SAB_IO_WAIT_SLICE_MS);
      if (waited.async) await waited.value;
    } else {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

/** Clear a revoked instance id so it can be reused by a replacement instance. */
export function resetSabIoInstance(buffer, instanceId) {
  const layout = describeSabIoChannel(buffer);
  Atomics.store(layout.instances, instanceId, SAB_IO_INSTANCE_NONE);
}

/**
 * Free the slots an instance left behind when its threads were terminated
 * mid-request (A36 step 3). Only DONE (completed, never read) and IDLE
 * (claimed, never submitted) slots are freed: a PENDING or SERVICING slot is
 * still owned by the server, which completes it; call again afterwards.
 * Call only after every thread of the instance is gone. Returns the count.
 */
export function reclaimSabIoSlots(buffer, instanceId) {
  const layout = describeSabIoChannel(buffer);
  let freed = 0;
  for (const slot of layout.slots) {
    if (Atomics.load(slot.i32, SAB_IO_S_INSTANCE) !== instanceId) continue;
    for (const state of [SAB_IO_SLOT_DONE, SAB_IO_SLOT_IDLE]) {
      if (Atomics.compareExchange(slot.i32, SAB_IO_S_STATE, state, SAB_IO_SLOT_FREE) === state) {
        Atomics.store(slot.i32, SAB_IO_S_OWNER, 0);
        freed += 1;
        break;
      }
    }
  }
  if (freed > 0) {
    Atomics.add(layout.header, SAB_IO_H_SLOT_RELEASES, freed);
    Atomics.notify(layout.header, SAB_IO_H_SLOT_RELEASES);
  }
  return freed;
}

/**
 * Supervisor half of A36: the I/O worker died (its `onerror` fired, or it was
 * terminated). Mark the server DEAD and complete every PENDING or SERVICING
 * slot with `status`, so no guest thread stays blocked. Returns the number of
 * requests failed. A replacement server resets the state to RUNNING.
 */
export function failPendingSabIoRequests(buffer, status = FLATSQL_IO_ERR_IO) {
  const layout = describeSabIoChannel(buffer);
  Atomics.store(layout.header, SAB_IO_H_SERVER_STATE, SAB_IO_SERVER_DEAD);
  let failed = 0;
  for (const slot of layout.slots) {
    const state = Atomics.load(slot.i32, SAB_IO_S_STATE);
    if (state === SAB_IO_SLOT_PENDING || state === SAB_IO_SLOT_SERVICING) {
      completeSabIoSlot(layout, slot, status, 0);
      failed += 1;
    }
  }
  return failed;
}

let completionMessenger = null;
function completionChannelFor(layout) {
  if (typeof BroadcastChannel !== "function") return null;
  if (!completionMessenger || completionMessenger.id !== layout.channelId) {
    completionMessenger?.channel.close();
    completionMessenger = {
      id: layout.channelId,
      channel: new BroadcastChannel(sabIoCompletionChannelName(layout.channelId)),
    };
  }
  return completionMessenger.channel;
}

/**
 * Complete one slot: publish the status (and an f64 result for SIZE), mark it
 * DONE for the request's sequence number, and wake its client.
 */
export function completeSabIoSlot(layout, slot, status, f64Result = 0) {
  slot.f64[SAB_IO_S_F64_RESULT] = f64Result;
  Atomics.store(slot.i32, SAB_IO_S_STATUS, status | 0);
  Atomics.store(slot.i32, SAB_IO_S_DONE_SEQ, Atomics.load(slot.i32, SAB_IO_S_SEQ));
  Atomics.store(slot.i32, SAB_IO_S_STATE, SAB_IO_SLOT_DONE);
  Atomics.notify(slot.i32, SAB_IO_S_STATE);
  if (Atomics.load(slot.i32, SAB_IO_S_NOTIFY) === SAB_IO_NOTIFY_MESSAGE) {
    completionChannelFor(layout)?.postMessage(slot.index);
  }
}

export const SAB_IO_STATUS_REVOKED = FLATSQL_IO_ERR_ACCESS;
export const SAB_IO_STATUS_DEAD = FLATSQL_IO_ERR_IO;
