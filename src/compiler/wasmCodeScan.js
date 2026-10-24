// Instruction scanner for the code section of a wasm module.
//
// This is a real instruction decoder - NOT a byte scan - so bytes that happen to
// equal a prefix opcode inside i32.const / LEB128 / memarg immediates are never
// miscounted. It answers "which instruction classes does this module's code
// contain"; what to DO about the answer (thread-model policy, SIMD policy) lives
// in the guards that import it, so the decoder has one reason to change: the
// wasm instruction encoding.
//
// A function body is decoded to its closing `end`: block depth is tracked, and a
// body whose last instruction does not close the function block exactly at the
// body's final byte was mis-decoded, so it is reported as undecodable instead of
// contributing a count. A caller that needs a proof (the SIMD guard) therefore
// sees `undecodableFunctions`, never a silent miss.

import { decodeUnsignedLeb128 } from "../bundle/wasm.js";

/**
 * Skip a LEB128-encoded integer (signedness is irrelevant for skipping — only
 * the continuation bits matter). Bounds-checked.
 */
function skipLeb(bytes, cursor, end) {
  let position = cursor;
  while (position < end) {
    const byte = bytes[position++];
    if ((byte & 0x80) === 0) {
      return position;
    }
  }
  throw new Error("LEB128 immediate ran past end of function body.");
}

/** Decode a LEB128 value AND return the next offset (bounds-checked). */
function readLeb(bytes, cursor, end) {
  if (cursor >= end) {
    throw new Error("LEB128 immediate ran past end of function body.");
  }
  const info = decodeUnsignedLeb128(bytes, cursor);
  if (info.nextOffset > end) {
    throw new Error("LEB128 immediate ran past end of function body.");
  }
  return info;
}

function skipBlockType(bytes, cursor, end) {
  if (cursor >= end) {
    throw new Error("Block type ran past end of function body.");
  }
  const byte = bytes[cursor];
  // 0x40 (empty), single-byte value types, and single-byte type indices all
  // consume exactly one byte; only a multi-byte (continuation-bit) type index
  // needs a full LEB skip.
  if ((byte & 0x80) !== 0) {
    return skipLeb(bytes, cursor, end);
  }
  return cursor + 1;
}

function skipMemArg(bytes, cursor, end) {
  const alignInfo = readLeb(bytes, cursor, end);
  let position = alignInfo.nextOffset;
  // Multi-memory / memory64: align bit 6 flags a following memory index.
  if ((alignInfo.value & 0x40) !== 0) {
    position = skipLeb(bytes, position, end);
  }
  return skipLeb(bytes, position, end);
}

function skipVec(bytes, cursor, end, bytesPerElement) {
  const countInfo = readLeb(bytes, cursor, end);
  let position = countInfo.nextOffset;
  for (let i = 0; i < countInfo.value; i += 1) {
    if (bytesPerElement === "leb") {
      position = skipLeb(bytes, position, end);
    } else {
      position += bytesPerElement;
    }
  }
  if (position > end) {
    throw new Error("Vector immediate ran past end of function body.");
  }
  return position;
}

// The fixed-width SIMD proposal occupies 0xFD sub-opcodes 0x00..0xFF. Every
// sub-opcode from 0x100 up belongs to a later proposal: relaxed-SIMD
// (0x100..0x113, results implementation-defined) and whatever follows it.
const FIXED_WIDTH_SIMD_LIMIT = 0x100;

/**
 * Walk one function body to its closing `end` and count, by class, the
 * instructions it holds. Throws when the body does not decode to exactly its
 * own bytes.
 *
 * @returns {{ atomic: number, simd: number, relaxedSimd: number, exceptionHandling: number }}
 *   atomic             0xFE-prefixed threads instructions
 *   simd               0xFD-prefixed fixed-width SIMD instructions (sub-opcode < 0x100)
 *   relaxedSimd        0xFD-prefixed instructions at sub-opcode 0x100 and above
 *   exceptionHandling  try / catch / throw / rethrow / delegate / try_table / throw_ref
 */
function scanFunctionBody(bytes, bodyStart, bodyEnd) {
  let cursor = bodyStart;
  // Local declarations: vec of (count, valtype).
  const localVecCount = readLeb(bytes, cursor, bodyEnd);
  cursor = localVecCount.nextOffset;
  for (let i = 0; i < localVecCount.value; i += 1) {
    cursor = skipLeb(bytes, cursor, bodyEnd); // count
    if (cursor >= bodyEnd) {
      throw new Error("Local declaration ran past end of function body.");
    }
    // valtype: usually one byte; concrete heap types are a LEB.
    if ((bytes[cursor] & 0x80) !== 0) {
      cursor = skipLeb(bytes, cursor, bodyEnd);
    } else {
      cursor += 1;
    }
  }

  const counts = { atomic: 0, simd: 0, relaxedSimd: 0, exceptionHandling: 0 };
  // The function body is itself a block; its closing `end` brings depth to 0.
  let depth = 1;
  while (cursor < bodyEnd) {
    if (depth === 0) {
      throw new Error("Instructions follow the function's closing end.");
    }
    const opcode = bytes[cursor++];
    switch (opcode) {
      // Control / parametric with no immediates.
      case 0x00: // unreachable
      case 0x01: // nop
      case 0x05: // else (stays inside the open if block)
      case 0x0f: // return
      case 0x1a: // drop
      case 0x1b: // select
        break;
      case 0x0b: // end
        depth -= 1;
        break;
      case 0x02: // block
      case 0x03: // loop
      case 0x04: // if
        cursor = skipBlockType(bytes, cursor, bodyEnd);
        depth += 1;
        break;
      case 0x06: // try (legacy exception handling)
        counts.exceptionHandling += 1;
        cursor = skipBlockType(bytes, cursor, bodyEnd);
        depth += 1;
        break;
      case 0x07: // catch tagidx
      case 0x08: // throw tagidx
      case 0x09: // rethrow labelidx
        counts.exceptionHandling += 1;
        cursor = skipLeb(bytes, cursor, bodyEnd);
        break;
      case 0x0a: // throw_ref
      case 0x19: // catch_all
        counts.exceptionHandling += 1;
        break;
      case 0x18: // delegate labelidx: closes the try block like an end
        counts.exceptionHandling += 1;
        cursor = skipLeb(bytes, cursor, bodyEnd);
        depth -= 1;
        break;
      case 0x1f: { // try_table blocktype vec(catch clause)
        counts.exceptionHandling += 1;
        cursor = skipBlockType(bytes, cursor, bodyEnd);
        const clauses = readLeb(bytes, cursor, bodyEnd);
        cursor = clauses.nextOffset;
        for (let i = 0; i < clauses.value; i += 1) {
          if (cursor >= bodyEnd) {
            throw new Error("Catch clause ran past end of function body.");
          }
          const kind = bytes[cursor++];
          if (kind === 0x00 || kind === 0x01) {
            cursor = skipLeb(bytes, cursor, bodyEnd); // tagidx
          } else if (kind !== 0x02 && kind !== 0x03) {
            throw new Error(`Unknown catch clause kind 0x${kind.toString(16)}.`);
          }
          cursor = skipLeb(bytes, cursor, bodyEnd); // labelidx
        }
        depth += 1;
        break;
      }
      case 0x0c: // br
      case 0x0d: // br_if
        cursor = skipLeb(bytes, cursor, bodyEnd);
        break;
      case 0x0e: {
        // br_table: vec<labelidx> + default labelidx
        cursor = skipVec(bytes, cursor, bodyEnd, "leb");
        cursor = skipLeb(bytes, cursor, bodyEnd);
        break;
      }
      case 0x10: // call
      case 0x12: // return_call
      case 0x14: // call_ref typeidx
      case 0x15: // return_call_ref typeidx
        cursor = skipLeb(bytes, cursor, bodyEnd);
        break;
      case 0x11: // call_indirect
      case 0x13: // return_call_indirect
        cursor = skipLeb(bytes, cursor, bodyEnd); // typeidx
        cursor = skipLeb(bytes, cursor, bodyEnd); // tableidx
        break;
      case 0x1c: // select t*
        cursor = skipVec(bytes, cursor, bodyEnd, 1);
        break;
      case 0x20: // local.get
      case 0x21: // local.set
      case 0x22: // local.tee
      case 0x23: // global.get
      case 0x24: // global.set
      case 0x25: // table.get
      case 0x26: // table.set
        cursor = skipLeb(bytes, cursor, bodyEnd);
        break;
      case 0x3f: // memory.size
      case 0x40: // memory.grow
        cursor = skipLeb(bytes, cursor, bodyEnd); // memidx (reserved)
        break;
      case 0x41: // i32.const
      case 0x42: // i64.const
        cursor = skipLeb(bytes, cursor, bodyEnd);
        break;
      case 0x43: // f32.const
        cursor += 4;
        break;
      case 0x44: // f64.const
        cursor += 8;
        break;
      case 0xd0: // ref.null
        if (cursor < bodyEnd && (bytes[cursor] & 0x80) !== 0) {
          cursor = skipLeb(bytes, cursor, bodyEnd);
        } else {
          cursor += 1;
        }
        break;
      case 0xd1: // ref.is_null
      case 0xd3: // ref.eq
      case 0xd4: // ref.as_non_null
        break;
      case 0xd2: // ref.func
      case 0xd5: // br_on_null labelidx
      case 0xd6: // br_on_non_null labelidx
        cursor = skipLeb(bytes, cursor, bodyEnd);
        break;
      case 0xfc: {
        // Bulk-memory / saturating-truncation / table ops.
        const sub = readLeb(bytes, cursor, bodyEnd);
        cursor = sub.nextOffset;
        switch (sub.value) {
          case 0: case 1: case 2: case 3:
          case 4: case 5: case 6: case 7:
            break; // trunc_sat: no immediates
          case 8: // memory.init dataidx memidx
            cursor = skipLeb(bytes, cursor, bodyEnd);
            cursor = skipLeb(bytes, cursor, bodyEnd);
            break;
          case 9: // data.drop
            cursor = skipLeb(bytes, cursor, bodyEnd);
            break;
          case 10: // memory.copy memidx memidx
            cursor = skipLeb(bytes, cursor, bodyEnd);
            cursor = skipLeb(bytes, cursor, bodyEnd);
            break;
          case 11: // memory.fill memidx
            cursor = skipLeb(bytes, cursor, bodyEnd);
            break;
          case 12: // table.init elemidx tableidx
          case 14: // table.copy tableidx tableidx
            cursor = skipLeb(bytes, cursor, bodyEnd);
            cursor = skipLeb(bytes, cursor, bodyEnd);
            break;
          case 13: // elem.drop
          case 15: // table.grow
          case 16: // table.size
          case 17: // table.fill
            cursor = skipLeb(bytes, cursor, bodyEnd);
            break;
          case 19: // i64.add128
          case 20: // i64.sub128
          case 21: // i64.mul_wide_s
          case 22: // i64.mul_wide_u
            break; // wide arithmetic: no immediates
          default:
            // An unknown sub-opcode's immediates cannot be skipped: the body is
            // undecodable rather than guessed at (as an unknown opcode is, below).
            throw new Error(`Unsupported 0xFC sub-opcode ${sub.value}.`);
        }
        break;
      }
      case 0xfd: {
        // SIMD.
        const sub = readLeb(bytes, cursor, bodyEnd);
        cursor = sub.nextOffset;
        const op = sub.value;
        if (op >= FIXED_WIDTH_SIMD_LIMIT) {
          counts.relaxedSimd += 1;
        } else {
          counts.simd += 1;
        }
        if (op <= 0x0b) {
          cursor = skipMemArg(bytes, cursor, bodyEnd); // v128 load/store
        } else if (op === 0x0c || op === 0x0d) {
          cursor += 16; // v128.const / i8x16.shuffle
        } else if (op >= 0x15 && op <= 0x22) {
          cursor += 1; // extract/replace lane
        } else if (op >= 0x54 && op <= 0x5b) {
          cursor = skipMemArg(bytes, cursor, bodyEnd);
          cursor += 1; // load/store lane
        } else if (op === 0x5c || op === 0x5d) {
          cursor = skipMemArg(bytes, cursor, bodyEnd); // load32/64_zero
        }
        break;
      }
      case 0xfe: {
        // Atomics / threads.
        const sub = readLeb(bytes, cursor, bodyEnd);
        cursor = sub.nextOffset;
        counts.atomic += 1;
        if (sub.value === 0x03) {
          cursor += 1; // atomic.fence: one reserved byte, no memarg
        } else {
          cursor = skipMemArg(bytes, cursor, bodyEnd);
        }
        break;
      }
      default:
        if (opcode >= 0x28 && opcode <= 0x3e) {
          // Memory load/store family (i32.load .. i64.store32): each carries a
          // memarg (align + offset). Skipping this is what prevents 0xFE bytes
          // inside memory-offset immediates from being miscounted as atomics.
          cursor = skipMemArg(bytes, cursor, bodyEnd);
          break;
        }
        if (opcode >= 0x45 && opcode <= 0xc4) {
          // MVP numeric / comparison / conversion opcodes and the sign-extension
          // operators take no immediates.
          break;
        }
        // Reserved opcodes and prefixes this decoder does not know (the GC
        // prefix 0xFB): their immediates cannot be skipped, so the body is
        // undecodable rather than guessed at.
        throw new Error(`Unsupported opcode 0x${opcode.toString(16)}.`);
    }
    if (cursor > bodyEnd) {
      throw new Error("Instruction immediate ran past end of function body.");
    }
  }
  if (depth !== 0) {
    throw new Error("Function body does not close its block at its final byte.");
  }
  return counts;
}

/**
 * Scan the code section of a parsed wasm module (parseWasmModuleSections).
 *
 * @returns {{
 *   atomic: number, simd: number, relaxedSimd: number, exceptionHandling: number,
 *   undecodableFunctions: number,
 * }}
 *   Totals over every function that decodes; `undecodableFunctions` counts the
 *   bodies that did not (their instructions contribute nothing).
 */
export function scanWasmCode(parsed) {
  const totals = {
    atomic: 0,
    simd: 0,
    relaxedSimd: 0,
    exceptionHandling: 0,
    undecodableFunctions: 0,
  };
  const codeSection = parsed.sections.find((section) => section.id === 10);
  if (!codeSection) {
    return totals;
  }
  const bytes = parsed.bytes;
  try {
    let cursor = codeSection.payloadStart;
    const funcCount = readLeb(bytes, cursor, codeSection.payloadEnd);
    cursor = funcCount.nextOffset;
    for (let i = 0; i < funcCount.value; i += 1) {
      if (cursor >= codeSection.payloadEnd) {
        totals.undecodableFunctions += funcCount.value - i;
        break;
      }
      const sizeInfo = readLeb(bytes, cursor, codeSection.payloadEnd);
      const bodyStart = sizeInfo.nextOffset;
      const bodyEnd = bodyStart + sizeInfo.value;
      if (bodyEnd > codeSection.payloadEnd) {
        totals.undecodableFunctions += funcCount.value - i;
        break;
      }
      try {
        const counts = scanFunctionBody(bytes, bodyStart, bodyEnd);
        totals.atomic += counts.atomic;
        totals.simd += counts.simd;
        totals.relaxedSimd += counts.relaxedSimd;
        totals.exceptionHandling += counts.exceptionHandling;
      } catch {
        // A body that does not decode is counted, not trusted and not fatal.
        totals.undecodableFunctions += 1;
      }
      cursor = bodyEnd;
    }
  } catch {
    // Truncated / malformed code section: report what decoded.
    totals.undecodableFunctions += 1;
  }
  return totals;
}
