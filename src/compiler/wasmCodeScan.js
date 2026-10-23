// Instruction scanner for the code section of a wasm module.
//
// This is a real instruction decoder - NOT a byte scan - so bytes that happen to
// equal a prefix opcode inside i32.const / LEB128 / memarg immediates are never
// miscounted. It answers "which instruction classes does this module's code
// contain"; what to DO about the answer (thread-model policy, SIMD policy) lives
// in the guards that import it, so the decoder has one reason to change: the
// wasm instruction encoding.

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

/**
 * Walk one function body and count genuine 0xFE-prefixed atomic instructions.
 * This is a real instruction decoder — NOT a byte scan — so `0xFE` bytes that
 * appear inside i32.const / LEB128 / memarg immediates are never miscounted.
 */
function countAtomicsInFunctionBody(bytes, bodyStart, bodyEnd) {
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

  let atomics = 0;
  while (cursor < bodyEnd) {
    const opcode = bytes[cursor++];
    switch (opcode) {
      // Control / parametric with no immediates.
      case 0x00: // unreachable
      case 0x01: // nop
      case 0x05: // else
      case 0x0b: // end
      case 0x0f: // return
      case 0x1a: // drop
      case 0x1b: // select
        break;
      case 0x02: // block
      case 0x03: // loop
      case 0x04: // if
        cursor = skipBlockType(bytes, cursor, bodyEnd);
        break;
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
        break;
      case 0xd2: // ref.func
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
          default:
            break;
        }
        break;
      }
      case 0xfd: {
        // SIMD (not emitted by our pthreads builds, but decode defensively).
        const sub = readLeb(bytes, cursor, bodyEnd);
        cursor = sub.nextOffset;
        const op = sub.value;
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
        atomics += 1;
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
        // All remaining MVP numeric/comparison/conversion opcodes
        // (0x45..0xc4, sign-extension, etc.) take no immediates.
        break;
    }
    if (cursor > bodyEnd) {
      throw new Error("Instruction immediate ran past end of function body.");
    }
  }
  return atomics;
}

export function countAtomicInstructions(parsed) {
  const codeSection = parsed.sections.find((section) => section.id === 10);
  if (!codeSection) {
    return 0;
  }
  const bytes = parsed.bytes;
  let total = 0;
  try {
    let cursor = codeSection.payloadStart;
    const funcCount = readLeb(bytes, cursor, codeSection.payloadEnd);
    cursor = funcCount.nextOffset;
    for (let i = 0; i < funcCount.value && cursor < codeSection.payloadEnd; i += 1) {
      const sizeInfo = readLeb(bytes, cursor, codeSection.payloadEnd);
      const bodyStart = sizeInfo.nextOffset;
      const bodyEnd = bodyStart + sizeInfo.value;
      if (bodyEnd > codeSection.payloadEnd) {
        break;
      }
      try {
        total += countAtomicsInFunctionBody(bytes, bodyStart, bodyEnd);
      } catch {
        // Best-effort per function: skip an undecodable body rather than crash.
      }
      cursor = bodyEnd;
    }
  } catch {
    // Truncated / malformed code section: return best-effort count.
  }
  return total;
}
