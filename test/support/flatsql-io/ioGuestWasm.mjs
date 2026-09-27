// A tiny wasi-threads guest that drives FlatSQL's seven `env.flatsql_io_*`
// imports from a program in shared memory. Assembled here byte by byte (no
// toolchain), so the same deterministic artifact runs in Node worker_threads and
// in every browser.
//
// Imports: env.memory (shared, max 65536 pages) and the seven flatsql_io
// functions with their exact i32/f64 signatures (flatsql_io.h).
// Export:  wasi_thread_start(tid, arg) runs the program at `arg`, then stores 1
//          at the program's done word and notifies it.
//
// Program header (32 B at arg, little-endian u32):
//   +0 nOps  +4 opsPtr  +8 regsPtr  +12 resultsPtr  +16 donePtr  +20 loops
//   +24 errorCount (atomically incremented per negative result)
// Op (32 B): +0 kind +4 reg +8 a +12 b +16 f64 off +24 c
//   kind 0 open(a=pathPtr, b=pathLen, c=flags) -> regs[reg]
//        1 read(regs[reg], a=dst, b=len, off)   2 write(regs[reg], a=src, b=len, off)
//        3 truncate(regs[reg], off)  4 sync(regs[reg])  5 size(regs[reg])
//        6 close(regs[reg])
// Each result is stored at results[i] (size truncated to i32).

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

function lebS32(value) {
  const out = [];
  let v = value | 0;
  for (;;) {
    const byte = v & 0x7f;
    v >>= 7;
    const sign = (byte & 0x40) !== 0;
    if ((v === 0 && !sign) || (v === -1 && sign)) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

const utf8 = (text) => Array.from(new TextEncoder().encode(text));
const section = (id, payload) => [id, ...lebU(payload.length), ...payload];
const vec = (entries) => [...lebU(entries.length), ...entries.flat()];

const I32 = 0x7f;
const F64 = 0x7c;
const funcType = (params, results) => [0x60, ...vec(params.map((p) => [p])), ...vec(results.map((r) => [r]))];
const mem = (align, offset) => [...lebU(align), ...lebU(offset)];

const OP = {
  block: 0x02,
  loop: 0x03,
  if: 0x04,
  end: 0x0b,
  br: 0x0c,
  br_if: 0x0d,
  br_table: 0x0e,
  call: 0x10,
  drop: 0x1a,
  get: 0x20,
  set: 0x21,
  i32_load: 0x28,
  f64_load: 0x2b,
  i32_store: 0x36,
  i32_const: 0x41,
  i32_lt_s: 0x48,
  i32_ge_u: 0x4f,
  i32_add: 0x6a,
  i32_shl: 0x74,
  void: 0x40,
};
const ATOMIC_NOTIFY = [0xfe, 0x00];
const ATOMIC_I32_STORE = [0xfe, 0x17];
const ATOMIC_I32_ADD = [0xfe, 0x1e];
const I32_TRUNC_SAT_F64_S = [0xfc, 0x02];

// Locals: 0 tid, 1 arg | 2 n, 3 ops, 4 regs, 5 res, 6 op, 7 kind, 8 r, 9 i, 10 loop, 11 loops
const L = { arg: 1, n: 2, ops: 3, regs: 4, res: 5, op: 6, kind: 7, r: 8, i: 9, loop: 10, loops: 11 };

const opField = (offset) => [OP.get, L.op, OP.i32_load, ...mem(2, offset)];
const handleReg = [
  OP.get, L.regs, ...opField(4), OP.i32_const, 2, OP.i32_shl, OP.i32_add,
  OP.i32_load, ...mem(2, 0),
];
const opOffset = [OP.get, L.op, OP.f64_load, ...mem(3, 16)];

export function buildIoGuestWasm() {
  const types = [
    funcType([I32, I32, I32], [I32]), // 0 open
    funcType([I32, I32, I32, F64], [I32]), // 1 read / write
    funcType([I32, F64], [I32]), // 2 truncate
    funcType([I32], [I32]), // 3 sync / close
    funcType([I32], [F64]), // 4 size
    funcType([I32, I32], []), // 5 wasi_thread_start
  ];
  const importFunc = (name, type) => [
    ...lebU(3), ...utf8("env"), ...lebU(name.length), ...utf8(name), 0x00, ...lebU(type),
  ];
  const imports = [
    [
      ...lebU(3), ...utf8("env"), ...lebU(6), ...utf8("memory"),
      0x02, 0x03, ...lebU(1), ...lebU(65536), // shared, min 1, max 65536 pages
    ],
    importFunc("flatsql_io_open", 0), // f0
    importFunc("flatsql_io_read", 1), // f1
    importFunc("flatsql_io_write", 1), // f2
    importFunc("flatsql_io_truncate", 2), // f3
    importFunc("flatsql_io_sync", 3), // f4
    importFunc("flatsql_io_size", 4), // f5
    importFunc("flatsql_io_close", 3), // f6
  ];

  const body = [
    OP.get, L.arg, OP.i32_load, ...mem(2, 0), OP.set, L.n,
    OP.get, L.arg, OP.i32_load, ...mem(2, 4), OP.set, L.ops,
    OP.get, L.arg, OP.i32_load, ...mem(2, 8), OP.set, L.regs,
    OP.get, L.arg, OP.i32_load, ...mem(2, 12), OP.set, L.res,
    OP.get, L.arg, OP.i32_load, ...mem(2, 20), OP.set, L.loops,
    OP.i32_const, 0, OP.set, L.loop,
    OP.block, OP.void, // outer_exit
    OP.loop, OP.void, // outer
    OP.get, L.loop, OP.get, L.loops, OP.i32_ge_u, OP.br_if, 1,
    OP.i32_const, 0, OP.set, L.i,
    OP.block, OP.void, // inner_exit
    OP.loop, OP.void, // inner
    OP.get, L.i, OP.get, L.n, OP.i32_ge_u, OP.br_if, 1,
    OP.get, L.ops, OP.get, L.i, OP.i32_const, 5, OP.i32_shl, OP.i32_add, OP.set, L.op,
    ...opField(0), OP.set, L.kind,
    OP.i32_const, 0, OP.set, L.r,
    OP.block, OP.void, // $end
    OP.block, OP.void, // $k6
    OP.block, OP.void, // $k5
    OP.block, OP.void, // $k4
    OP.block, OP.void, // $k3
    OP.block, OP.void, // $k2
    OP.block, OP.void, // $k1
    OP.block, OP.void, // $k0
    OP.get, L.kind,
    OP.br_table, ...vec([[0], [1], [2], [3], [4], [5], [6]]), 7,
    OP.end,
    // kind 0: open(a, b, c) -> regs[reg]
    ...opField(8), ...opField(12), ...opField(24), OP.call, 0, OP.set, L.r,
    OP.get, L.regs, ...opField(4), OP.i32_const, 2, OP.i32_shl, OP.i32_add,
    OP.get, L.r, OP.i32_store, ...mem(2, 0),
    OP.br, 6,
    OP.end,
    // kind 1: read
    ...handleReg, ...opField(8), ...opField(12), ...opOffset, OP.call, 1, OP.set, L.r, OP.br, 5,
    OP.end,
    // kind 2: write
    ...handleReg, ...opField(8), ...opField(12), ...opOffset, OP.call, 2, OP.set, L.r, OP.br, 4,
    OP.end,
    // kind 3: truncate
    ...handleReg, ...opOffset, OP.call, 3, OP.set, L.r, OP.br, 3,
    OP.end,
    // kind 4: sync
    ...handleReg, OP.call, 4, OP.set, L.r, OP.br, 2,
    OP.end,
    // kind 5: size
    ...handleReg, OP.call, 5, ...I32_TRUNC_SAT_F64_S, OP.set, L.r, OP.br, 1,
    OP.end,
    // kind 6: close
    ...handleReg, OP.call, 6, OP.set, L.r,
    OP.end, // $end
    // results[i] = r; negative -> errorCount++
    OP.get, L.res, OP.get, L.i, OP.i32_const, 2, OP.i32_shl, OP.i32_add,
    OP.get, L.r, OP.i32_store, ...mem(2, 0),
    OP.get, L.r, OP.i32_const, 0, OP.i32_lt_s,
    OP.if, OP.void,
    OP.get, L.arg, OP.i32_const, 1, ...ATOMIC_I32_ADD, ...mem(2, 24), OP.drop,
    OP.end,
    OP.get, L.i, OP.i32_const, 1, OP.i32_add, OP.set, L.i,
    OP.br, 0,
    OP.end, // inner loop
    OP.end, // inner_exit
    OP.get, L.loop, OP.i32_const, 1, OP.i32_add, OP.set, L.loop,
    OP.br, 0,
    OP.end, // outer loop
    OP.end, // outer_exit
    OP.get, L.arg, OP.i32_load, ...mem(2, 16), OP.i32_const, 1, ...ATOMIC_I32_STORE, ...mem(2, 0),
    OP.get, L.arg, OP.i32_load, ...mem(2, 16), OP.i32_const, 1, ...ATOMIC_NOTIFY, ...mem(2, 0), OP.drop,
  ];
  const locals = vec([[...lebU(10), I32]]);
  const fnBody = [...locals, ...body, OP.end];
  const code = [...lebU(fnBody.length), ...fnBody];

  const bytes = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec(types)),
    ...section(2, vec(imports)),
    ...section(3, vec([lebU(5)])),
    ...section(7, vec([[...lebU(17), ...utf8("wasi_thread_start"), 0x00, ...lebU(7)]])),
    ...section(10, vec([code])),
  ];
  return new Uint8Array(bytes);
}

export const IO_OP = Object.freeze({
  open: 0,
  read: 1,
  write: 2,
  truncate: 3,
  sync: 4,
  size: 5,
  close: 6,
});

/**
 * Lay out a program in `memory` at `base`. `ops` entries: { kind, reg, a, b,
 * off, c } (numbers). Returns { arg, resultsPtr, donePtr, end }.
 */
export function writeIoProgram(memory, base, ops, { loops = 1 } = {}) {
  const buffer = memory.buffer ?? memory;
  const view = new DataView(buffer);
  const header = base;
  const opsPtr = base + 32;
  const regsPtr = opsPtr + ops.length * 32;
  const resultsPtr = regsPtr + 16 * 4;
  const donePtr = resultsPtr + ops.length * 4;
  const end = donePtr + 8;
  view.setUint32(header + 0, ops.length, true);
  view.setUint32(header + 4, opsPtr, true);
  view.setUint32(header + 8, regsPtr, true);
  view.setUint32(header + 12, resultsPtr, true);
  view.setUint32(header + 16, donePtr, true);
  view.setUint32(header + 20, loops, true);
  view.setUint32(header + 24, 0, true);
  ops.forEach((op, index) => {
    const at = opsPtr + index * 32;
    view.setUint32(at + 0, op.kind, true);
    view.setUint32(at + 4, op.reg ?? 0, true);
    view.setUint32(at + 8, op.a ?? 0, true);
    view.setUint32(at + 12, op.b ?? 0, true);
    view.setFloat64(at + 16, op.off ?? 0, true);
    view.setUint32(at + 24, op.c ?? 0, true);
  });
  new Int32Array(buffer, donePtr, 1)[0] = 0;
  return { arg: header, resultsPtr, donePtr, end, nOps: ops.length };
}

export function readIoProgramResults(memory, program) {
  const buffer = memory.buffer ?? memory;
  const results = Array.from(new Int32Array(buffer, program.resultsPtr, program.nOps));
  const errors = new DataView(buffer).getUint32(program.arg + 24, true);
  return { results, errors };
}

export function ioProgramDone(memory, program) {
  const buffer = memory.buffer ?? memory;
  return Atomics.load(new Int32Array(buffer, program.donePtr, 1), 0) === 1;
}
