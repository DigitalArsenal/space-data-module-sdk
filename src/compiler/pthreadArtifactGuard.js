// Isomorphic-pthreads guardrail: the enforced flag set + the emitted-artifact
// validator. `space-data-module-sdk` is the source of truth for isomorphic
// pthreads module artifacts, so a build that claims pthreads but does not emit a
// shared-memory/atomics wasm must FAIL the compile here rather than ship.
//
// See docs/isomorphic-pthreads.md.

import {
  decodeUnsignedLeb128,
  listWasmCustomSections,
  parseWasmModuleSections,
} from "../bundle/wasm.js";

// Mirrors ModuleThreadModel.EMSCRIPTEN_PTHREADS in compileModule.js. Kept as a
// local literal to avoid an import cycle (compileModule imports this module).
const EMSCRIPTEN_PTHREADS = "emscripten-pthreads";

// The non-bypassable final-link flag set for the emscripten-pthreads model.
//
// `-mthreads` from an earlier spec is intentionally OMITTED: it is invalid for
// the wasm32-unknown-emscripten target and breaks the compile
//   clang: error: unsupported option '-mthreads' for target 'wasm32-unknown-emscripten'
// `-mthreads` is a MinGW/Windows driver flag, not a WebAssembly target feature.
// Emscripten's `-pthread` already selects the threads model (it defines
// __EMSCRIPTEN_SHARED_MEMORY__=1 and enables the atomics/bulk-memory/shared
// features); `-matomics -mbulk-memory` make those features explicit. The thread
// guarantee is delivered by these flags AND validated at the artifact level by
// assertPthreadArtifact() below.
export const PTHREAD_FINAL_LINK_FLAGS = Object.freeze([
  "-pthread",
  "-matomics",
  "-mbulk-memory",
  "-s",
  "STANDALONE_WASM=1",
  "-s",
  "IMPORTED_MEMORY=1",
  "-s",
  "ALLOW_MEMORY_GROWTH=1",
]);

// The `-s KEY=VALUE` settings that must be present as adjacent (`-s`, value)
// pairs in the assembled final-link args for the pthreads model.
const PTHREAD_REQUIRED_SETTINGS = Object.freeze([
  "STANDALONE_WASM=1",
  "IMPORTED_MEMORY=1",
  "ALLOW_MEMORY_GROWTH=1",
]);

// The bare (non `-s`) flags that must be present for the pthreads model.
const PTHREAD_REQUIRED_BARE_FLAGS = Object.freeze([
  "-pthread",
  "-matomics",
  "-mbulk-memory",
]);

/**
 * Defensive invariant: after the final-link args are assembled, confirm that the
 * pthreads model still carries every mandated flag. This makes it impossible for
 * a future edit to silently drop a thread-enabling flag — the compile fails loud
 * instead.
 *
 * @param {string[]} args assembled final-link argument list.
 * @param {{ threadModel?: string }} [context]
 */
export function assertPthreadFlagsPresent(args, context = {}) {
  if (context.threadModel !== EMSCRIPTEN_PTHREADS) {
    return;
  }
  const argList = Array.isArray(args) ? args.map((value) => String(value)) : [];
  const missing = [];
  for (const flag of PTHREAD_REQUIRED_BARE_FLAGS) {
    if (!argList.includes(flag)) {
      missing.push(flag);
    }
  }
  for (const setting of PTHREAD_REQUIRED_SETTINGS) {
    const present = argList.some(
      (value, index) => value === "-s" && argList[index + 1] === setting,
    );
    if (!present) {
      missing.push(`-s ${setting}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      "Pthreads final-link flag assembler dropped mandated flags: " +
        `${missing.join(", ")}. The emscripten-pthreads model must always link ` +
        `with ${PTHREAD_FINAL_LINK_FLAGS.join(" ")}.`,
    );
  }
}

const VALTYPE_BYTES = new Set([0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x70, 0x6f]);

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

function countAtomicInstructions(parsed) {
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

function readLimits(bytes, cursor, end) {
  const flags = bytes[cursor];
  let position = cursor + 1;
  const minInfo = decodeUnsignedLeb128(bytes, position);
  position = minInfo.nextOffset;
  let max = null;
  if ((flags & 0x01) !== 0) {
    const maxInfo = decodeUnsignedLeb128(bytes, position);
    position = maxInfo.nextOffset;
    max = maxInfo.value;
  }
  return {
    nextOffset: position,
    limits: {
      flags,
      min: minInfo.value,
      max,
      shared: (flags & 0x02) !== 0,
      growable: max === null || max > minInfo.value,
    },
  };
}

const textDecoder = new TextDecoder();

function collectImportedMemories(parsed) {
  const section = parsed.sections.find((s) => s.id === 2);
  if (!section) {
    return [];
  }
  const bytes = parsed.bytes;
  const memories = [];
  let cursor = section.payloadStart;
  const countInfo = decodeUnsignedLeb128(bytes, cursor);
  cursor = countInfo.nextOffset;
  for (let i = 0; i < countInfo.value; i += 1) {
    const modLen = decodeUnsignedLeb128(bytes, cursor);
    cursor = modLen.nextOffset;
    const moduleName = textDecoder.decode(bytes.subarray(cursor, cursor + modLen.value));
    cursor += modLen.value;
    const nameLen = decodeUnsignedLeb128(bytes, cursor);
    cursor = nameLen.nextOffset;
    const importName = textDecoder.decode(bytes.subarray(cursor, cursor + nameLen.value));
    cursor += nameLen.value;
    const kind = bytes[cursor++];
    if (kind === 0x00) {
      cursor = decodeUnsignedLeb128(bytes, cursor).nextOffset; // typeidx
    } else if (kind === 0x01) {
      cursor += 1; // reftype
      const limits = readLimits(bytes, cursor, section.payloadEnd);
      cursor = limits.nextOffset;
    } else if (kind === 0x02) {
      const limits = readLimits(bytes, cursor, section.payloadEnd);
      cursor = limits.nextOffset;
      memories.push({
        source: "import",
        module: moduleName,
        name: importName,
        ...limits.limits,
      });
    } else if (kind === 0x03) {
      cursor += 1; // valtype
      cursor += 1; // mutability
    } else {
      break;
    }
  }
  return memories;
}

function collectDeclaredMemories(parsed) {
  const section = parsed.sections.find((s) => s.id === 5);
  if (!section) {
    return [];
  }
  const bytes = parsed.bytes;
  const memories = [];
  let cursor = section.payloadStart;
  const countInfo = decodeUnsignedLeb128(bytes, cursor);
  cursor = countInfo.nextOffset;
  for (let i = 0; i < countInfo.value; i += 1) {
    const limits = readLimits(bytes, cursor, section.payloadEnd);
    cursor = limits.nextOffset;
    memories.push({ source: "declared", ...limits.limits });
  }
  return memories;
}

function readDeclaredFeatures(wasmBytes) {
  let customSections;
  try {
    customSections = listWasmCustomSections(wasmBytes);
  } catch {
    return null;
  }
  const featureSection = customSections.find(
    (section) => section.name === "target_features",
  );
  if (!featureSection) {
    return null;
  }
  const bytes = featureSection.dataBytes;
  const features = [];
  try {
    let cursor = 0;
    const countInfo = decodeUnsignedLeb128(bytes, cursor);
    cursor = countInfo.nextOffset;
    for (let i = 0; i < countInfo.value; i += 1) {
      cursor += 1; // prefix ('+', '-', '=')
      const nameLen = decodeUnsignedLeb128(bytes, cursor);
      cursor = nameLen.nextOffset;
      features.push(
        textDecoder.decode(bytes.subarray(cursor, cursor + nameLen.value)),
      );
      cursor += nameLen.value;
    }
  } catch {
    return features.length > 0 ? features : null;
  }
  return features;
}

/**
 * Parse a compiled wasm artifact and report its threading features.
 *
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} wasmBytes
 * @returns {{
 *   hasSharedMemory: boolean,
 *   sharedMemory: object|null,
 *   memories: object[],
 *   usesAtomics: boolean,
 *   atomicInstructionCount: number,
 *   declaredFeatures: string[]|null,
 *   isGrowableSharedMemory: boolean,
 * }}
 */
export function analyzeWasmThreadFeatures(wasmBytes) {
  const parsed = parseWasmModuleSections(wasmBytes);
  const memories = [
    ...collectImportedMemories(parsed),
    ...collectDeclaredMemories(parsed),
  ];
  const sharedMemory = memories.find((memory) => memory.shared) ?? null;
  const atomicInstructionCount = countAtomicInstructions(parsed);
  const declaredFeatures = readDeclaredFeatures(parsed.bytes);
  const usesAtomics =
    atomicInstructionCount > 0 ||
    (Array.isArray(declaredFeatures) && declaredFeatures.includes("atomics"));
  return {
    hasSharedMemory: sharedMemory !== null,
    sharedMemory,
    memories,
    usesAtomics,
    atomicInstructionCount,
    declaredFeatures,
    isGrowableSharedMemory: sharedMemory !== null && sharedMemory.growable === true,
  };
}

/**
 * Reject a compiled wasm artifact that claims the pthreads thread model but does
 * not actually declare a shared memory and use atomics. Returns the analysis on
 * success; throws with a clear, actionable message otherwise.
 *
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} wasmBytes
 * @param {{ source?: string }} [options]
 */
export function assertPthreadArtifact(wasmBytes, options = {}) {
  const source = options.source ? String(options.source) : "emitted wasm";
  let analysis;
  try {
    analysis = analyzeWasmThreadFeatures(wasmBytes);
  } catch (error) {
    throw new Error(
      `pthreads artifact validation failed for ${source}: could not parse the ` +
        `emitted wasm (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  const failures = [];
  if (!analysis.hasSharedMemory) {
    failures.push(
      "it declares no shared memory (a module that claims pthreads must import " +
        "or declare a memory with the shared limits flag)",
    );
  }
  if (!analysis.usesAtomics) {
    failures.push(
      "it uses no atomics (no atomic/threads instructions were found in the code section)",
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `pthreads artifact validation REJECTED ${source}: the build claims the ` +
        "emscripten-pthreads thread model but the emitted wasm is not a " +
        `shared-memory/atomics artifact — ${failures.join("; ")}. This build ` +
        "must not ship.",
    );
  }
  return analysis;
}
