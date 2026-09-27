/**
 * FlatSQL link shim (loop C.7 direct linkage) — a tiny, fixed wasm module
 * whose ONLY memory is the FlatSQL engine's exported linear memory
 * (`(import "flatsql" "memory")`). It is the B-iv "engine-import component"
 * from sdn-server/docs/flatsql-component-linkage.md in its minimal form: no
 * data segments, no globals, no stack — pure code — so it is position
 * independent by construction and instantiates against ANY live engine
 * instance (WasmEdge named-module registration server-side,
 * `WebAssembly.instantiate(bytes, { flatsql: engineExports })` in the
 * browser).
 *
 * A linked flow artifact owns its own linear memory (the emscripten heap the
 * flow runtime needs) and imports the engine's *functions* directly
 * (`flatsql.malloc/free/flatsql_*` — scalars cross fine). What core wasm
 * cannot do is LOAD/STORE another instance's memory: this shim closes that
 * gap. Its loads/stores address the ENGINE memory, so the flow crosses the
 * memory boundary with direct in-wasm calls (zero hostcalls, zero host
 * copies):
 *
 *   peek8/peek32/peek64  read engine memory (query results, error strings)
 *   poke8/poke32         write engine memory (SQL text, TLV param blobs)
 *   fnv1a64              word-folded FNV-1a 64 over an engine-memory range —
 *                        bit-identical to decision-gate's fnv1a64_etag, the
 *                        SDK's fnv1a64Hex, and sdn-server's
 *                        FNV1a64WordFolded (the canonical stream/etag hash)
 *   count_frames         size-prefixed frame count of an aligned stream in
 *                        engine memory (the x-sdn-record-count rule:
 *                        zero-length prefixes are padding; malformed = -1)
 *
 * The module bytes are deterministic (assembled below, no toolchain), so the
 * SAME artifact ships in the SDK, in compiled flow bundles
 * (dist/flatsql-link-shim.wasm), and embedded in sdn-server's flowrt —
 * pinned by sha256 in each host's tests.
 */

// ---------------------------------------------------------------------------
// Minimal wasm binary emitter (LEB128 + sections) — enough for this module.
// ---------------------------------------------------------------------------

function lebU(value) {
  const out = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return out;
}

function lebS64(value) {
  // Signed LEB128 for i64.const immediates (BigInt).
  const out = [];
  let v = BigInt.asIntN(64, BigInt(value));
  for (;;) {
    const byte = Number(v & 0x7fn);
    v >>= 7n;
    const signBit = (byte & 0x40) !== 0;
    if ((v === 0n && !signBit) || (v === -1n && signBit)) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

function lebS32(value) {
  const out = [];
  let v = value | 0;
  for (;;) {
    const byte = v & 0x7f;
    v >>= 7;
    const signBit = (byte & 0x40) !== 0;
    if ((v === 0 && !signBit) || (v === -1 && signBit)) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

function utf8(text) {
  return Array.from(new TextEncoder().encode(text));
}

function section(id, payload) {
  return [id, ...lebU(payload.length), ...payload];
}

function vec(entries) {
  return [...lebU(entries.length), ...entries.flat()];
}

// Opcodes used below.
const OP = {
  block: 0x02,
  loop: 0x03,
  if: 0x04,
  end: 0x0b,
  br: 0x0c,
  br_if: 0x0d,
  return: 0x0f,
  local_get: 0x20,
  local_set: 0x21,
  i32_load: 0x28,
  i64_load: 0x29,
  i32_load8_u: 0x2d,
  i64_load8_u: 0x31,
  i32_store: 0x36,
  i32_store8: 0x3a,
  i32_const: 0x41,
  i64_const: 0x42,
  i32_eqz: 0x45,
  i32_lt_u: 0x49,
  i32_gt_u: 0x4a,
  i32_ge_u: 0x4f,
  i32_add: 0x6a,
  i32_sub: 0x6b,
  i32_and: 0x71,
  i64_add: 0x7c,
  i64_mul: 0x7e,
  i64_xor: 0x85,
  void: 0x40,
  unreachable: 0x00,
  drop: 0x1a,
  i32_eq: 0x46,
  i32_ne: 0x47,
  i32_gt_s: 0x4a,
  i32_ge_s: 0x4e,
  i64_eqz: 0x50,
};

// Threads-proposal opcodes (0xFE prefix) used by shim v2.
const ATOMIC = {
  notify: [0xfe, 0x00],
  wait32: [0xfe, 0x01],
  i32_load: [0xfe, 0x10],
  i32_store: [0xfe, 0x17],
  i32_add: [0xfe, 0x1e],
  i32_cmpxchg: [0xfe, 0x48],
};

const FNV_OFFSET_BASIS = 1469598103934665603n; // deployed decision-gate basis
const FNV_PRIME = 1099511628211n;

function func(localDecls, body) {
  const locals = vec(localDecls.map(([count, type]) => [...lebU(count), type]));
  const payload = [...locals, ...body, OP.end];
  return [...lebU(payload.length), ...payload];
}

const I32 = 0x7f;
const I64 = 0x7e;

function memarg(align) {
  return [...lebU(align), ...lebU(0)];
}

/** Assemble the shim module bytes (deterministic). */
export function buildFlatsqlLinkShimWasm() {
  const types = [
    [0x60, ...vec([[I32]]), ...vec([[I32]])], // t0: (i32)->i32
    [0x60, ...vec([[I32]]), ...vec([[I64]])], // t1: (i32)->i64
    [0x60, ...vec([[I32], [I32]]), ...vec([])], // t2: (i32,i32)->()
    [0x60, ...vec([[I32], [I32]]), ...vec([[I64]])], // t3: (i32,i32)->i64
    [0x60, ...vec([[I32], [I32]]), ...vec([[I32]])], // t4: (i32,i32)->i32
  ];

  // Imports: (import "flatsql" "memory" (memory 0))
  const imports = [
    [
      ...lebU(7), ...utf8("flatsql"),
      ...lebU(6), ...utf8("memory"),
      0x02, // memory import
      0x00, ...lebU(0), // limits: min 0, no max
    ],
  ];

  // Function indexes (imports contribute none): 0..6
  const funcTypes = [0 /* peek8 */, 0 /* peek32 */, 1 /* peek64 */, 2 /* poke8 */, 2 /* poke32 */, 3 /* fnv1a64 */, 4 /* count_frames */];

  const exports = [
    [...lebU(5), ...utf8("peek8"), 0x00, ...lebU(0)],
    [...lebU(6), ...utf8("peek32"), 0x00, ...lebU(1)],
    [...lebU(6), ...utf8("peek64"), 0x00, ...lebU(2)],
    [...lebU(5), ...utf8("poke8"), 0x00, ...lebU(3)],
    [...lebU(6), ...utf8("poke32"), 0x00, ...lebU(4)],
    [...lebU(7), ...utf8("fnv1a64"), 0x00, ...lebU(5)],
    [...lebU(12), ...utf8("count_frames"), 0x00, ...lebU(6)],
  ];

  const peek8 = func([], [OP.local_get, 0, OP.i32_load8_u, ...memarg(0)]);
  const peek32 = func([], [OP.local_get, 0, OP.i32_load, ...memarg(0)]);
  const peek64 = func([], [OP.local_get, 0, OP.i64_load, ...memarg(0)]);
  const poke8 = func([], [OP.local_get, 0, OP.local_get, 1, OP.i32_store8, ...memarg(0)]);
  const poke32 = func([], [OP.local_get, 0, OP.local_get, 1, OP.i32_store, ...memarg(0)]);

  // fnv1a64(ptr, len) -> i64 : word-folded FNV-1a 64 (8-byte LE words, byte tail).
  // locals: 2 = hash (i64), 3 = end (i32), 4 = wend (i32)
  const fnv = func(
    [
      [1, I64],
      [2, I32],
    ],
    [
      OP.i64_const, ...lebS64(FNV_OFFSET_BASIS), OP.local_set, 2,
      OP.local_get, 0, OP.local_get, 1, OP.i32_add, OP.local_set, 3,
      OP.local_get, 1, OP.i32_const, ...lebS32(-8), OP.i32_and, OP.local_get, 0, OP.i32_add, OP.local_set, 4,
      // word loop
      OP.block, OP.void,
      OP.loop, OP.void,
      OP.local_get, 0, OP.local_get, 4, OP.i32_ge_u, OP.br_if, 1,
      OP.local_get, 2, OP.local_get, 0, OP.i64_load, ...memarg(0), OP.i64_xor,
      OP.i64_const, ...lebS64(FNV_PRIME), OP.i64_mul, OP.local_set, 2,
      OP.local_get, 0, OP.i32_const, 8, OP.i32_add, OP.local_set, 0,
      OP.br, 0,
      OP.end,
      OP.end,
      // byte tail loop
      OP.block, OP.void,
      OP.loop, OP.void,
      OP.local_get, 0, OP.local_get, 3, OP.i32_ge_u, OP.br_if, 1,
      OP.local_get, 2, OP.local_get, 0, OP.i64_load8_u, ...memarg(0), OP.i64_xor,
      OP.i64_const, ...lebS64(FNV_PRIME), OP.i64_mul, OP.local_set, 2,
      OP.local_get, 0, OP.i32_const, 1, OP.i32_add, OP.local_set, 0,
      OP.br, 0,
      OP.end,
      OP.end,
      OP.local_get, 2,
    ],
  );

  // count_frames(ptr, len) -> i32 : size-prefixed frame count; zero-length
  // prefixes skipped as padding; malformed framing returns -1.
  // locals: 2 = count (i32), 3 = end (i32), 4 = frameSize (i32)
  const countFrames = func(
    [[3, I32]],
    [
      OP.local_get, 0, OP.local_get, 1, OP.i32_add, OP.local_set, 3,
      OP.block, OP.void,
      OP.loop, OP.void,
      OP.local_get, 0, OP.local_get, 3, OP.i32_ge_u, OP.br_if, 1,
      // if (end - ptr < 4) return -1
      OP.local_get, 3, OP.local_get, 0, OP.i32_sub, OP.i32_const, 4, OP.i32_lt_u,
      OP.if, OP.void, OP.i32_const, ...lebS32(-1), OP.return, OP.end,
      OP.local_get, 0, OP.i32_load, ...memarg(0), OP.local_set, 4,
      OP.local_get, 0, OP.i32_const, 4, OP.i32_add, OP.local_set, 0,
      // if (frameSize == 0) continue
      OP.local_get, 4, OP.i32_eqz, OP.br_if, 0,
      // if (frameSize > end - ptr) return -1
      OP.local_get, 4, OP.local_get, 3, OP.local_get, 0, OP.i32_sub, OP.i32_gt_u,
      OP.if, OP.void, OP.i32_const, ...lebS32(-1), OP.return, OP.end,
      OP.local_get, 0, OP.local_get, 4, OP.i32_add, OP.local_set, 0,
      OP.local_get, 2, OP.i32_const, 1, OP.i32_add, OP.local_set, 2,
      OP.br, 0,
      OP.end,
      OP.end,
      OP.local_get, 2,
    ],
  );

  const bytes = [
    0x00, 0x61, 0x73, 0x6d, // \0asm
    0x01, 0x00, 0x00, 0x00, // version 1
    ...section(1, vec(types)),
    ...section(2, vec(imports)),
    ...section(3, vec(funcTypes.map((t) => lebU(t)))),
    ...section(7, vec(exports)),
    ...section(10, vec([peek8, peek32, peek64, poke8, poke32, fnv, countFrames])),
  ];
  return new Uint8Array(bytes);
}

/** The shim module bytes (assembled once at import). */
export const FLATSQL_LINK_SHIM_WASM = buildFlatsqlLinkShimWasm();

/** Import-module names the linked flow artifact resolves against. */
export const FLATSQL_ENGINE_IMPORT_MODULE = "flatsql";
export const FLATSQL_LINK_IMPORT_MODULE = "flatsql_link";

/**
 * Engine body-reference tokens minted by linked flow artifacts carry this
 * magic in their high 32 bits ("SDNE"); hostcall-bridge tokens are small
 * counters, so the namespaces can never collide.
 */
export const ENGINE_BODY_REF_TOKEN_MAGIC = 0x53444e45n << 32n;

export function isEngineBodyRefToken(token) {
  return (BigInt(token) & 0xffffffff00000000n) === ENGINE_BODY_REF_TOKEN_MAGIC;
}

/**
 * Instantiate the shim against a live engine's exports. `engineExports` must
 * expose the engine `memory`.
 */
export async function instantiateFlatsqlLinkShim(engineExports) {
  const { instance } = await WebAssembly.instantiate(FLATSQL_LINK_SHIM_WASM.slice().buffer, {
    [FLATSQL_ENGINE_IMPORT_MODULE]: { memory: engineExports.memory },
  });
  return instance;
}

/**
 * Byte layout of one engine body-reference table entry exported by linked
 * flow artifacts (sdn_flatsql_link_ref_table). Mirrors flow_runtime.cpp's
 * SdnEngineRefEntry exactly (little-endian).
 */
export const ENGINE_REF_ENTRY_SIZE = 40;

export function readEngineRefEntry(view, base) {
  return {
    token: view.getBigUint64(base + 0, true),
    generation: view.getBigUint64(base + 8, true),
    fnv1a64: view.getBigUint64(base + 16, true),
    enginePtr: view.getUint32(base + 24, true),
    size: view.getUint32(base + 28, true),
    frames: view.getUint32(base + 32, true),
    used: view.getUint32(base + 36, true),
  };
}


// ---------------------------------------------------------------------------
// Shim v2 (FlatSQL partition store T9, design §18 T9 and §20): a mailbox over
// IMPORTED LANE MEMORY.
//
// In the partition store a linked flow no longer calls engine functions: the
// engine is a set of multithreaded instances, and a query runs on a reader
// lane thread that serves a mailbox in the reader instance's shared memory.
// v2 imports that shared memory and gives the flow the mailbox protocol as
// direct in-wasm calls:
//
//   mb_submit(mailbox, op, req_ptr, req_len) -> seq | -1 (mailbox busy)
//   mb_poll(mailbox, seq)                    -> 1 when complete, else 0
//   mb_wait(mailbox, seq, poll_ns, max_polls) -> the lane's status, or
//                                              FLATSQL_LINK_PENDING (-110) after
//                                              max_polls bounded waits
//   mb_release(mailbox, seq)                 -> 0, or -1 when not complete
//   mb_cancel(mailbox, seq)                  -> 0 (the lane polls the cancel word)
//   load32_acquire(addr) / store32_release(addr, value)
// plus v1's peek8/peek32/peek64/poke8/poke32/fnv1a64/count_frames over the
// lane memory.
//
// POLLING-BOUNDED WAITS, NO RELIANCE ON CROSS-EXECUTOR NOTIFY. WasmEdge keeps
// atomic waiters per executor, and the flow and the reader instance run on
// different executors, so a lane's notify may never reach the flow's wait.
// mb_wait therefore never waits unboundedly: each wait is `poll_ns` long and
// every wake (notified or timed out) re-reads the mailbox, so a lost notify
// costs at most one poll interval and can never lose a completion. poll_ns = 0
// polls without executing memory.atomic.wait at all (contexts that may not
// block, such as a browser main thread). The shim still notifies the lane's
// doorbell on submit and cancel; that is only an accelerator.
//
// Mailbox (64 bytes, 8-aligned, in lane memory; little-endian):
//   +0 state (IDLE 0, SUBMITTED 1, CLAIMED 2, DONE 3, SUBMITTING 4)
//   +4 seq   +8 done_seq   +12 op   +16 req_ptr   +20 req_len
//   +24 status   +28 resp_ptr   +32 resp_len   +36 doorbell   +40 cancel
//   +44 flags    +48 generation (u64)   +56 reserved
// Client: IDLE -> SUBMITTING -> SUBMITTED (publishes the fields), waits for
// DONE with done_seq == seq, reads status/resp, then DONE -> IDLE (release).
// Lane: waits (bounded) on the doorbell, CAS SUBMITTED -> CLAIMED, runs the
// request, writes status/resp_ptr/resp_len/generation, stores done_seq = seq,
// stores DONE, and notifies the state word. A lane checks `cancel == seq`
// while it runs.

export const FLATSQL_LINK_MAILBOX_BYTES = 64;
export const FLATSQL_LINK_MAILBOX = Object.freeze({
  STATE: 0,
  SEQ: 4,
  DONE_SEQ: 8,
  OP: 12,
  REQ_PTR: 16,
  REQ_LEN: 20,
  STATUS: 24,
  RESP_PTR: 28,
  RESP_LEN: 32,
  DOORBELL: 36,
  CANCEL: 40,
  FLAGS: 44,
  GENERATION: 48,
});
export const FLATSQL_LINK_STATE = Object.freeze({
  IDLE: 0,
  SUBMITTED: 1,
  CLAIMED: 2,
  DONE: 3,
  SUBMITTING: 4,
});
/** mb_wait's "not complete yet" result: retryable, the request stays live. */
export const FLATSQL_LINK_PENDING = -110;
/** mb_submit's result when the mailbox holds another request. */
export const FLATSQL_LINK_BUSY = -1;

/** Assemble the v2 shim bytes (deterministic). */
export function buildFlatsqlLinkShimV2Wasm() {
  const types = [
    [0x60, ...vec([[I32]]), ...vec([[I32]])], // t0: (i32)->i32
    [0x60, ...vec([[I32]]), ...vec([[I64]])], // t1: (i32)->i64
    [0x60, ...vec([[I32], [I32]]), ...vec([])], // t2: (i32,i32)->()
    [0x60, ...vec([[I32], [I32]]), ...vec([[I64]])], // t3: (i32,i32)->i64
    [0x60, ...vec([[I32], [I32]]), ...vec([[I32]])], // t4: (i32,i32)->i32
    [0x60, ...vec([[I32], [I32], [I32], [I32]]), ...vec([[I32]])], // t5: submit
    [0x60, ...vec([[I32], [I32], [I64], [I32]]), ...vec([[I32]])], // t6: wait
  ];

  // (import "flatsql" "memory" (memory 0 65536 shared))
  const imports = [
    [
      ...lebU(7), ...utf8("flatsql"),
      ...lebU(6), ...utf8("memory"),
      0x02,
      0x03, ...lebU(0), ...lebU(65536),
    ],
  ];

  const names = [
    ["peek8", 0], ["peek32", 0], ["peek64", 1], ["poke8", 2], ["poke32", 2],
    ["fnv1a64", 3], ["count_frames", 4],
    ["mb_submit", 5], ["mb_poll", 4], ["mb_wait", 6], ["mb_release", 4],
    ["mb_cancel", 4], ["load32_acquire", 0], ["store32_release", 2],
  ];
  const funcTypes = names.map(([, type]) => type);
  const exports = names.map(([name], index) => [
    ...lebU(name.length), ...utf8(name), 0x00, ...lebU(index),
  ]);

  const m = FLATSQL_LINK_MAILBOX;
  const S = FLATSQL_LINK_STATE;
  const aload = (offset) => [...ATOMIC.i32_load, ...lebU(2), ...lebU(offset)];
  const astore = (offset) => [...ATOMIC.i32_store, ...lebU(2), ...lebU(offset)];
  const store = (offset) => [OP.i32_store, ...lebU(2), ...lebU(offset)];
  const load = (offset) => [OP.i32_load, ...lebU(2), ...lebU(offset)];

  const peek8 = func([], [OP.local_get, 0, OP.i32_load8_u, ...memarg(0)]);
  const peek32 = func([], [OP.local_get, 0, OP.i32_load, ...memarg(0)]);
  const peek64 = func([], [OP.local_get, 0, OP.i64_load, ...memarg(0)]);
  const poke8 = func([], [OP.local_get, 0, OP.local_get, 1, OP.i32_store8, ...memarg(0)]);
  const poke32 = func([], [OP.local_get, 0, OP.local_get, 1, OP.i32_store, ...memarg(0)]);
  const v1 = buildFlatsqlLinkShimWasm();
  // fnv1a64 and count_frames are byte-for-byte v1's bodies (same algorithm,
  // same code); lift them from the v1 code section.
  const v1Bodies = extractCodeBodies(v1);
  const fnv = v1Bodies[5];
  const countFrames = v1Bodies[6];

  // mb_submit(mb, op, req_ptr, req_len) -> seq | -1 ; local 4 = seq
  const submit = func(
    [[1, I32]],
    [
      OP.local_get, 0, OP.i32_const, S.IDLE, OP.i32_const, S.SUBMITTING,
      ...ATOMIC.i32_cmpxchg, ...lebU(2), ...lebU(m.STATE),
      OP.if, OP.void, OP.i32_const, ...lebS32(FLATSQL_LINK_BUSY), OP.return, OP.end,
      OP.local_get, 0, ...aload(m.SEQ), OP.i32_const, 1, OP.i32_add, OP.local_set, 4,
      OP.local_get, 4, OP.i32_eqz, OP.if, OP.void, OP.i32_const, 1, OP.local_set, 4, OP.end,
      OP.local_get, 0, OP.local_get, 1, ...store(m.OP),
      OP.local_get, 0, OP.local_get, 2, ...store(m.REQ_PTR),
      OP.local_get, 0, OP.local_get, 3, ...store(m.REQ_LEN),
      OP.local_get, 0, OP.i32_const, 0, ...store(m.STATUS),
      OP.local_get, 0, OP.i32_const, 0, ...store(m.RESP_PTR),
      OP.local_get, 0, OP.i32_const, 0, ...store(m.RESP_LEN),
      OP.local_get, 0, OP.i32_const, 0, ...astore(m.CANCEL),
      OP.local_get, 0, OP.local_get, 4, ...astore(m.SEQ),
      OP.local_get, 0, OP.i32_const, S.SUBMITTED, ...astore(m.STATE),
      OP.local_get, 0, OP.i32_const, 1, ...ATOMIC.i32_add, ...lebU(2), ...lebU(m.DOORBELL), OP.drop,
      OP.local_get, 0, OP.i32_const, 1, ...ATOMIC.notify, ...lebU(2), ...lebU(m.DOORBELL), OP.drop,
      OP.local_get, 4,
    ],
  );

  // mb_poll(mb, seq) -> 1 | 0
  const poll = func(
    [],
    [
      OP.local_get, 0, ...aload(m.STATE), OP.i32_const, S.DONE, OP.i32_eq,
      OP.local_get, 0, ...aload(m.DONE_SEQ), OP.local_get, 1, OP.i32_eq,
      OP.i32_and,
    ],
  );

  // mb_wait(mb, seq, poll_ns, max_polls) -> status | PENDING
  // locals: 4 polls, 5 state
  const wait = func(
    [[2, I32]],
    [
      OP.loop, OP.void,
      OP.local_get, 0, ...aload(m.STATE), OP.local_set, 5,
      OP.local_get, 5, OP.i32_const, S.DONE, OP.i32_eq,
      OP.local_get, 0, ...aload(m.DONE_SEQ), OP.local_get, 1, OP.i32_eq,
      OP.i32_and,
      OP.if, OP.void, OP.local_get, 0, ...load(m.STATUS), OP.return, OP.end,
      OP.local_get, 3, OP.i32_const, 0, OP.i32_gt_s,
      OP.local_get, 4, OP.local_get, 3, OP.i32_ge_s,
      OP.i32_and,
      OP.if, OP.void, OP.i32_const, ...lebS32(FLATSQL_LINK_PENDING), OP.return, OP.end,
      OP.local_get, 4, OP.i32_const, 1, OP.i32_add, OP.local_set, 4,
      OP.local_get, 2, OP.i64_eqz, OP.i32_eqz,
      OP.if, OP.void,
      OP.local_get, 0, OP.local_get, 5, OP.local_get, 2,
      ...ATOMIC.wait32, ...lebU(2), ...lebU(m.STATE), OP.drop,
      OP.end,
      OP.br, 0,
      OP.end,
      OP.unreachable,
    ],
  );

  // mb_release(mb, seq) -> 0 | -1
  const release = func(
    [],
    [
      OP.local_get, 0, ...aload(m.DONE_SEQ), OP.local_get, 1, OP.i32_ne,
      OP.if, OP.void, OP.i32_const, ...lebS32(-1), OP.return, OP.end,
      OP.local_get, 0, OP.i32_const, S.DONE, OP.i32_const, S.IDLE,
      ...ATOMIC.i32_cmpxchg, ...lebU(2), ...lebU(m.STATE),
      OP.i32_const, S.DONE, OP.i32_eq,
      OP.if, I32, OP.i32_const, 0, 0x05 /* else */, OP.i32_const, ...lebS32(-1), OP.end,
    ],
  );

  // mb_cancel(mb, seq) -> 0
  const cancel = func(
    [],
    [
      OP.local_get, 0, OP.local_get, 1, ...astore(m.CANCEL),
      OP.local_get, 0, OP.i32_const, 1, ...ATOMIC.i32_add, ...lebU(2), ...lebU(m.DOORBELL), OP.drop,
      OP.local_get, 0, OP.i32_const, 1, ...ATOMIC.notify, ...lebU(2), ...lebU(m.DOORBELL), OP.drop,
      OP.i32_const, 0,
    ],
  );

  const loadAcquire = func([], [OP.local_get, 0, ...aload(0)]);
  const storeRelease = func([], [OP.local_get, 0, OP.local_get, 1, ...astore(0)]);

  const bytes = [
    0x00, 0x61, 0x73, 0x6d,
    0x01, 0x00, 0x00, 0x00,
    ...section(1, vec(types)),
    ...section(2, vec(imports)),
    ...section(3, vec(funcTypes.map((t) => lebU(t)))),
    ...section(7, vec(exports)),
    ...section(
      10,
      vec([
        peek8, peek32, peek64, poke8, poke32, fnv, countFrames,
        submit, poll, wait, release, cancel, loadAcquire, storeRelease,
      ]),
    ),
  ];
  return new Uint8Array(bytes);
}

function readLebU(bytes, offset) {
  let result = 0;
  let shift = 0;
  let at = offset;
  for (;;) {
    const byte = bytes[at];
    at += 1;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result >>> 0, at];
    shift += 7;
  }
}

// The code section's function bodies, each as its size-prefixed byte array.
function extractCodeBodies(wasm) {
  let at = 8;
  while (at < wasm.length) {
    const id = wasm[at];
    const [size, payload] = readLebU(wasm, at + 1);
    if (id === 10) {
      let [count, cursor] = readLebU(wasm, payload);
      const bodies = [];
      for (let i = 0; i < count; i += 1) {
        const [bodySize, bodyStart] = readLebU(wasm, cursor);
        bodies.push(Array.from(wasm.subarray(cursor, bodyStart + bodySize)));
        cursor = bodyStart + bodySize;
      }
      return bodies;
    }
    at = payload + size;
  }
  throw new Error("no code section");
}

/** The v2 shim module bytes (assembled once at import). */
export const FLATSQL_LINK_SHIM_V2_WASM = buildFlatsqlLinkShimV2Wasm();

/**
 * Instantiate shim v2 against a lane's shared memory (the reader instance's
 * `WebAssembly.Memory`, shared).
 */
export async function instantiateFlatsqlLinkShimV2(laneMemory) {
  const { instance } = await WebAssembly.instantiate(FLATSQL_LINK_SHIM_V2_WASM.slice().buffer, {
    [FLATSQL_ENGINE_IMPORT_MODULE]: { memory: laneMemory },
  });
  return instance;
}
