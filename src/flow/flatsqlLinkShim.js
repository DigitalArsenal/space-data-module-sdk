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
