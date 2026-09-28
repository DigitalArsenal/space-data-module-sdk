// The wasi-threads pool: one SharedArrayBuffer that every thread of a guest
// process shares, so spawning, dispatching and recycling a thread never needs
// an event loop.
//
// A guest runs pthread_create ... pthread_join without yielding its thread's
// event loop, often for a whole invoke that spawns wave after wave of threads,
// and any guest thread may call pthread_create. So a pool thread is never told
// to run by a message, and never reports back by one:
//
//   - every pool worker owns a slot and blocks on it (Atomics.wait) while idle;
//   - a spawner, on any thread, claims an IDLE slot with a compare-exchange,
//     writes the tid and start argument, marks it ASSIGNED and notifies it;
//   - the worker runs wasi_thread_start(tid, arg), marks its slot IDLE again,
//     bumps the release generation and notifies it, so a spawner waiting for a
//     free worker wakes.
//
// Layout (Int32 words):
//
//   header  0 generation   bumped whenever a slot may have become claimable
//           1 next tid     wasi-threads tids, 1 .. 2^29 - 1, from every thread
//           2 spawned      3 waited      4 declined (no worker came free)
//           5 slots        slots in service (Node grows it; the browser fixes it)
//           6 capacity
//   slot i  at HEADER + STRIDE * i: state, tid, start argument, flags, OS
//           thread id of its worker (Node), 3 spare words
//
// Slot states: PENDING (no worker yet), IDLE, CLAIMED (a spawner is writing),
// ASSIGNED (tid and argument written), RUNNING, RETIRED (never serves again).
//
// A spawn that finds no idle worker waits on the generation for up to
// spawnWaitMs: a thread the guest has just joined is a few instructions from
// returning when its joiner wakes, so a wave spawned right after a join can
// find every worker busy for a moment. When the wait runs out the spawn is
// declined (pthread_create -> EAGAIN), and later spawns on that thread are
// declined at once until some worker comes free. Where the pool can grow
// (Node), a spawn that finds no idle worker waits only GROW_AFTER_MS for one
// before it starts a new worker.
//
// A slot flagged MESSAGE_DISPATCH belongs to a browser worker script from an
// SDK before 0.8.25: only the owning thread dispatches to it, by {t:"run"},
// and it comes back through {t:"exit"} on the owner's event loop.

export const WASI_THREAD_POOL_PROTOCOL = 2;

export const WASI_THREAD_POOL_SLOT = Object.freeze({
  PENDING: 0,
  IDLE: 1,
  CLAIMED: 2,
  ASSIGNED: 3,
  RUNNING: 4,
  RETIRED: 5,
});

const { PENDING, IDLE, CLAIMED, ASSIGNED, RUNNING, RETIRED } = WASI_THREAD_POOL_SLOT;

const H_GENERATION = 0;
const H_NEXT_TID = 1;
const H_SPAWNED = 2;
const H_WAITED = 3;
const H_DECLINED = 4;
const H_SLOTS = 5;
const H_CAPACITY = 6;
const HEADER = 8;
const STRIDE = 8;
const S_STATE = 0;
const S_TID = 1;
const S_ARG = 2;
const S_FLAGS = 3;
const S_THREAD = 4;
const FLAG_MESSAGE_DISPATCH = 1;
// wasi-libc keeps a thread id in the low 29 bits of a mutex word.
const MAX_TID = 0x1fffffff;
// With room to grow, how long a spawn waits for a busy worker to come free
// before it starts another one.
const GROW_AFTER_MS = 2;

/** How long a spawn waits for a busy pool thread to finish, by default. */
export const DEFAULT_WASI_THREAD_SPAWN_WAIT_MS = 250;

const at = (slot) => HEADER + STRIDE * slot;

function monotonicNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function resolveSpawnWaitMs(spawnWaitMs) {
  if (spawnWaitMs === undefined || spawnWaitMs === null) {
    return DEFAULT_WASI_THREAD_SPAWN_WAIT_MS;
  }
  if (typeof spawnWaitMs !== "number" || !(spawnWaitMs >= 0) || spawnWaitMs === Infinity) {
    throw new RangeError("spawnWaitMs must be a finite, non-negative number of milliseconds.");
  }
  return spawnWaitMs;
}

/**
 * A new pool with room for `capacity` workers, none in service. The returned
 * descriptor is structured-cloneable: post it to every thread of the process.
 */
export function createWasiThreadPool({ capacity, spawnWaitMs }) {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError("pool capacity must be a non-negative integer.");
  }
  const control = new Int32Array(
    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * (HEADER + STRIDE * capacity)),
  );
  control[H_NEXT_TID] = 1;
  control[H_CAPACITY] = capacity;
  return { control, spawnWaitMs: resolveSpawnWaitMs(spawnWaitMs) };
}

function bumpGeneration(control) {
  Atomics.add(control, H_GENERATION, 1);
  Atomics.notify(control, H_GENERATION);
}

function setState(control, slot, state) {
  Atomics.store(control, at(slot) + S_STATE, state);
  Atomics.notify(control, at(slot) + S_STATE);
  bumpGeneration(control);
}

/** Put `count` slots in service, all PENDING until their workers are armed. */
export function openWasiThreadPoolSlots(pool, count) {
  Atomics.store(pool.control, H_SLOTS, count);
}

/** A worker is ready: its slot takes threads. */
export function armWasiThreadPoolSlot(pool, slot, { messageDispatch = false } = {}) {
  if (messageDispatch) {
    Atomics.store(pool.control, at(slot) + S_FLAGS, FLAG_MESSAGE_DISPATCH);
  }
  setState(pool.control, slot, IDLE);
}

/** The slot never serves again; a worker blocked on it returns. */
export function retireWasiThreadPoolSlot(pool, slot) {
  setState(pool.control, slot, RETIRED);
}

export function wasiThreadPoolSlotState(pool, slot) {
  return Atomics.load(pool.control, at(slot) + S_STATE);
}

/** The tid last assigned to a slot (0 before its first), in any state. */
export function wasiThreadPoolLastTid(pool, slot) {
  return Atomics.load(pool.control, at(slot) + S_TID);
}

/** The tid a slot is running (assigned or running), else null. */
export function wasiThreadPoolRunningTid(pool, slot) {
  const state = Atomics.load(pool.control, at(slot) + S_STATE);
  return state === ASSIGNED || state === RUNNING
    ? Atomics.load(pool.control, at(slot) + S_TID)
    : null;
}

/**
 * Free a slot from the owner's side, only while it still runs `tid`: the
 * {t:"exit"} of a MESSAGE_DISPATCH worker, or a worker that died mid-thread.
 */
export function releaseWasiThreadPoolSlotIfRunning(pool, slot, tid) {
  const { control } = pool;
  const index = at(slot);
  for (;;) {
    const state = Atomics.load(control, index + S_STATE);
    if ((state !== ASSIGNED && state !== RUNNING) || Atomics.load(control, index + S_TID) !== tid) {
      return false;
    }
    if (Atomics.compareExchange(control, index + S_STATE, state, IDLE) === state) {
      bumpGeneration(control);
      return true;
    }
  }
}

/**
 * Worker side: take the slot's assignment, if there is one.
 * @returns {{ tid: number, startArg: number } | null}
 */
export function takeWasiThreadPoolAssignment(pool, slot) {
  const { control } = pool;
  const index = at(slot);
  if (Atomics.compareExchange(control, index + S_STATE, ASSIGNED, RUNNING) !== ASSIGNED) {
    return null;
  }
  return {
    tid: Atomics.load(control, index + S_TID),
    startArg: Atomics.load(control, index + S_ARG),
  };
}

/** Worker side: the thread returned; the worker takes threads again. */
export function finishWasiThreadPoolRun(pool, slot) {
  const { control } = pool;
  // A slot retired while its thread ran stays retired.
  if (Atomics.compareExchange(control, at(slot) + S_STATE, RUNNING, IDLE) === RUNNING) {
    bumpGeneration(control);
  }
}

/**
 * Worker side: serve the slot until it is retired. Blocks between threads.
 * `runThread(tid, startArg)` returns false when the worker must stop (a guest
 * fault); the slot is then retired.
 */
export function serveWasiThreadPoolSlot(pool, slot, { runThread, osThreadId = 0 }) {
  const { control } = pool;
  const index = at(slot) + S_STATE;
  if (osThreadId) Atomics.store(control, at(slot) + S_THREAD, osThreadId);
  for (;;) {
    const state = Atomics.load(control, index);
    if (state === RETIRED) return;
    if (state !== ASSIGNED) {
      Atomics.wait(control, index, state);
      continue;
    }
    const assignment = takeWasiThreadPoolAssignment(pool, slot);
    if (!assignment) continue;
    if (runThread(assignment.tid, assignment.startArg) === false) {
      retireWasiThreadPoolSlot(pool, slot);
      return;
    }
    finishWasiThreadPoolRun(pool, slot);
  }
}

/** Counts across every thread of the process. */
export function readWasiThreadPoolReport(pool) {
  const { control } = pool;
  const slots = Math.min(Atomics.load(control, H_SLOTS), Atomics.load(control, H_CAPACITY));
  let active = 0;
  let idle = 0;
  let workers = 0;
  for (let slot = 0; slot < slots; slot += 1) {
    const state = Atomics.load(control, at(slot) + S_STATE);
    if (state === CLAIMED || state === ASSIGNED || state === RUNNING) active += 1;
    else if (state === IDLE) idle += 1;
    if (Atomics.load(control, at(slot) + S_THREAD) !== 0) workers += 1;
  }
  return {
    spawned: Atomics.load(control, H_SPAWNED),
    waited: Atomics.load(control, H_WAITED),
    declined: Atomics.load(control, H_DECLINED),
    slots,
    active,
    idle,
    workers,
  };
}

/**
 * The wasi.thread-spawn of one thread over the pool. Any thread may hold one.
 *
 * @param {object} pool the descriptor from createWasiThreadPool
 * @param {object} [options]
 * @param {boolean} [options.owner] the owning thread: the only one that may
 *   dispatch to MESSAGE_DISPATCH slots
 * @param {(slot: number) => void} [options.grow] start a worker for a newly
 *   reserved slot (Node); throws when it cannot
 * @param {(slot: number, tid: number, startArg: number) => void} [options.dispatchMessage]
 *   post {t:"run"} to a MESSAGE_DISPATCH slot's worker
 * @returns {(startArg: number) => { tid: number, slot: number, reason: string | null }}
 */
export function createWasiThreadPoolSpawn(pool, { owner = false, grow = null, dispatchMessage = null } = {}) {
  const { control, spawnWaitMs } = pool;
  const capacity = Atomics.load(control, H_CAPACITY);
  // The generation at which this thread's last wait ran out: while it is
  // current no worker has come free since, so waiting again cannot help.
  let starvedAt = null;
  // Atomics.wait throws where the agent may not block (a window's main thread).
  let canBlock = true;

  const claimable = (slot) =>
    owner || (Atomics.load(control, at(slot) + S_FLAGS) & FLAG_MESSAGE_DISPATCH) === 0;

  // Claim an IDLE slot. `live` counts the claimable slots that are not
  // RETIRED: RETIRED is final, so with none live no slot will ever come free,
  // whatever other spawners are doing meanwhile.
  const scan = () => {
    const slots = Math.min(Atomics.load(control, H_SLOTS), capacity);
    let live = 0;
    for (let slot = 0; slot < slots; slot += 1) {
      if (!claimable(slot)) continue;
      if (Atomics.compareExchange(control, at(slot) + S_STATE, IDLE, CLAIMED) === IDLE) {
        return { slot, live: live + 1 };
      }
      if (Atomics.load(control, at(slot) + S_STATE) !== RETIRED) live += 1;
    }
    return { slot: -1, live };
  };

  const reserve = () => {
    for (;;) {
      const slots = Atomics.load(control, H_SLOTS);
      if (slots >= capacity) return -1;
      if (Atomics.compareExchange(control, H_SLOTS, slots, slots + 1) === slots) {
        Atomics.store(control, at(slots) + S_STATE, CLAIMED);
        return slots;
      }
    }
  };

  const growOne = () => {
    const slot = reserve();
    if (slot < 0) return { slot: -1, reason: null };
    try {
      grow(slot);
      return { slot, reason: null };
    } catch {
      retireWasiThreadPoolSlot(pool, slot);
      return { slot: -1, reason: "worker-create-failed" };
    }
  };

  const claim = () => {
    let found = scan();
    if (found.slot >= 0) return { slot: found.slot, waited: false, reason: null };
    const growable = typeof grow === "function";
    const now = monotonicNow();
    const deadline = now + (canBlock ? spawnWaitMs : 0);
    let growAt = now + (canBlock ? Math.min(GROW_AFTER_MS, spawnWaitMs) : 0);
    let waited = false;
    for (;;) {
      const generation = Atomics.load(control, H_GENERATION);
      found = scan();
      if (found.slot >= 0) return { slot: found.slot, waited, reason: null };
      const room = growable && Math.min(Atomics.load(control, H_SLOTS), capacity) < capacity;
      if (room && (found.live === 0 || monotonicNow() >= growAt)) {
        const grown = growOne();
        if (grown.slot >= 0 || grown.reason) return { ...grown, waited };
        continue; // another thread took the last reservation
      }
      if (found.live === 0) return { slot: -1, waited, reason: "pool-exhausted" };
      if (generation === starvedAt && !room) return { slot: -1, waited, reason: "pool-exhausted" };
      const remaining = (room ? growAt : deadline) - monotonicNow();
      if (!room && remaining <= 0) {
        starvedAt = generation;
        return { slot: -1, waited, reason: "pool-exhausted" };
      }
      if (remaining > 0) {
        try {
          Atomics.wait(control, H_GENERATION, generation, remaining);
        } catch {
          canBlock = false;
          if (!room) return { slot: -1, waited, reason: "pool-exhausted" };
          growAt = 0;
          continue;
        }
        waited = true;
      }
    }
  };

  return (startArg) => {
    const claimed = claim();
    if (claimed.slot < 0) {
      if (claimed.reason === "pool-exhausted") Atomics.add(control, H_DECLINED, 1);
      return { tid: -1, slot: -1, reason: claimed.reason };
    }
    const { slot } = claimed;
    const index = at(slot);
    const tid = Atomics.add(control, H_NEXT_TID, 1);
    if (tid > MAX_TID) {
      Atomics.store(control, index + S_STATE, IDLE);
      bumpGeneration(control);
      return { tid: -1, slot: -1, reason: "tid-exhausted" };
    }
    Atomics.store(control, index + S_TID, tid);
    Atomics.store(control, index + S_ARG, startArg | 0);
    Atomics.store(control, index + S_STATE, ASSIGNED);
    const messageDispatch = (Atomics.load(control, index + S_FLAGS) & FLAG_MESSAGE_DISPATCH) !== 0;
    if (messageDispatch) {
      try {
        dispatchMessage(slot, tid, startArg);
      } catch {
        releaseWasiThreadPoolSlotIfRunning(pool, slot, tid);
        return { tid: -1, slot: -1, reason: "dispatch-failed" };
      }
    } else {
      Atomics.notify(control, index + S_STATE);
    }
    Atomics.add(control, H_SPAWNED, 1);
    if (claimed.waited) Atomics.add(control, H_WAITED, 1);
    return { tid, slot, reason: null };
  };
}
