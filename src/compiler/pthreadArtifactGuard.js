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
// NOTE: the enum value string is historical; this model now compiles to a
// wasi-threads artifact (NOT an Emscripten Web-Worker build). See
// docs/isomorphic-pthreads.md and wasiThreadsToolchain.js.
const EMSCRIPTEN_PTHREADS = "emscripten-pthreads";

// The non-bypassable final-LINK flag set for the isomorphic-pthreads model.
//
// These are the wasm-ld / clang flags that produce a wasi-threads artifact:
//   -pthread                  select the threads runtime (wasi-threads libc/libc++)
//   -matomics -mbulk-memory   enable the atomics + bulk-memory target features
//   -Wl,--import-memory       import the (shared) memory from the host (env.memory)
//   -Wl,--shared-memory       make that memory shared (SharedArrayBuffer / atomics)
//   -Wl,--max-memory=2GiB     required maximum for a shared, growable memory
//
// These deliberately do NOT use Emscripten `-s` settings. Emscripten `-pthread`
// (even with -s STANDALONE_WASM=1) emits the browser-only Web Worker model
// (env.__pthread_create_js + _emscripten_* mailbox/postMessage imports, no wasi
// thread-spawn) which CANNOT thread under WasmEdge. `-mthreads` is likewise not
// used (a MinGW driver flag, not a wasm target feature). The thread guarantee is
// delivered by these flags AND validated on the emitted artifact by
// assertPthreadArtifact() below (shared memory + atomics + wasi.thread-spawn
// import + wasi_thread_start export, and NO Emscripten thread hooks).
export const PTHREAD_FINAL_LINK_FLAGS = Object.freeze([
  "-pthread",
  "-matomics",
  "-mbulk-memory",
  "-Wl,--import-memory",
  "-Wl,--shared-memory",
  "-Wl,--max-memory=2147483648",
]);

// The bare flags that must be present in the assembled final-link args for the
// pthreads model.
const PTHREAD_REQUIRED_BARE_FLAGS = Object.freeze([
  "-pthread",
  "-matomics",
  "-mbulk-memory",
  "-Wl,--import-memory",
  "-Wl,--shared-memory",
]);

// A `-Wl,--max-memory=<n>` flag (any value) must also be present.
const PTHREAD_MAX_MEMORY_PREFIX = "-Wl,--max-memory=";

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
  if (!argList.some((value) => value.startsWith(PTHREAD_MAX_MEMORY_PREFIX))) {
    missing.push(`${PTHREAD_MAX_MEMORY_PREFIX}<bytes>`);
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

const IMPORT_KIND_NAMES = ["function", "table", "memory", "global"];

function collectAllImports(parsed) {
  const section = parsed.sections.find((s) => s.id === 2);
  if (!section) {
    return [];
  }
  const bytes = parsed.bytes;
  const imports = [];
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
    imports.push({ module: moduleName, name: importName, kind: IMPORT_KIND_NAMES[kind] ?? kind });
    if (kind === 0x00) {
      cursor = decodeUnsignedLeb128(bytes, cursor).nextOffset; // typeidx
    } else if (kind === 0x01) {
      cursor += 1; // reftype
      const limits = readLimits(bytes, cursor, section.payloadEnd);
      cursor = limits.nextOffset;
    } else if (kind === 0x02) {
      const limits = readLimits(bytes, cursor, section.payloadEnd);
      cursor = limits.nextOffset;
    } else if (kind === 0x03) {
      cursor += 2; // valtype + mutability
    } else {
      break;
    }
  }
  return imports;
}

function collectExportNames(parsed) {
  const section = parsed.sections.find((s) => s.id === 7);
  if (!section) {
    return [];
  }
  const bytes = parsed.bytes;
  const names = [];
  let cursor = section.payloadStart;
  const countInfo = decodeUnsignedLeb128(bytes, cursor);
  cursor = countInfo.nextOffset;
  for (let i = 0; i < countInfo.value; i += 1) {
    const nameLen = decodeUnsignedLeb128(bytes, cursor);
    cursor = nameLen.nextOffset;
    names.push(textDecoder.decode(bytes.subarray(cursor, cursor + nameLen.value)));
    cursor += nameLen.value;
    cursor += 1; // export kind
    cursor = decodeUnsignedLeb128(bytes, cursor).nextOffset; // index
  }
  return names;
}

// The WasmEdge/wasi thread-spawn host contract: the guest imports a
// `thread-spawn` function and exports `wasi_thread_start`.
function isWasiThreadSpawnImport(entry) {
  return (
    (entry.module === "wasi" || entry.module === "wasi_snapshot_preview1") &&
    entry.name === "thread-spawn"
  );
}

// Emscripten's browser-only Web Worker thread hooks. Their presence means the
// artifact threads via JS postMessage workers and CANNOT spawn threads under
// WasmEdge — it must be rejected as an isomorphic-pthreads artifact.
function isEmscriptenThreadHook(entry) {
  if (entry.module !== "env") {
    return false;
  }
  return (
    entry.name === "__pthread_create_js" ||
    /pthread_create/.test(entry.name) ||
    /^_?emscripten_.*(thread|mailbox|main_thread|postmessage)/i.test(entry.name)
  );
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
 * Parse a compiled wasm artifact and report its threading features, including
 * the isomorphic wasi-threads host contract.
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
 *   hasWasiThreadSpawnImport: boolean,
 *   hasWasiThreadStartExport: boolean,
 *   emscriptenThreadHooks: string[],
 *   isIsomorphicPthreads: boolean,
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
  const imports = collectAllImports(parsed);
  const exportNames = collectExportNames(parsed);
  const hasWasiThreadSpawnImport = imports.some(isWasiThreadSpawnImport);
  const hasWasiThreadStartExport = exportNames.includes("wasi_thread_start");
  const emscriptenThreadHooks = imports
    .filter(isEmscriptenThreadHook)
    .map((entry) => `${entry.module}.${entry.name}`);
  const hasSharedMemory = sharedMemory !== null;
  return {
    hasSharedMemory,
    sharedMemory,
    memories,
    usesAtomics,
    atomicInstructionCount,
    declaredFeatures,
    isGrowableSharedMemory: hasSharedMemory && sharedMemory.growable === true,
    hasWasiThreadSpawnImport,
    hasWasiThreadStartExport,
    emscriptenThreadHooks,
    isIsomorphicPthreads:
      hasSharedMemory &&
      usesAtomics &&
      hasWasiThreadSpawnImport &&
      hasWasiThreadStartExport &&
      emscriptenThreadHooks.length === 0,
  };
}

/**
 * Reject a compiled wasm artifact that claims the isomorphic-pthreads thread
 * model but is not a real wasi-threads artifact. To pass, the emitted wasm MUST:
 *   - declare/import a shared memory (shared limits flag), and
 *   - use atomics (atomic instructions in the code section), and
 *   - import the wasi `thread-spawn` host function, and
 *   - export `wasi_thread_start`, and
 *   - NOT import Emscripten's browser-only Web Worker thread hooks
 *     (env.__pthread_create_js / env._emscripten_* mailbox/postMessage), which
 *     cannot spawn threads under WasmEdge.
 *
 * Shared memory + atomics alone are necessary but NOT sufficient — an Emscripten
 * `-pthread` browser build has both yet threads only via JS workers. Returns the
 * analysis on success; throws a clear, actionable error otherwise.
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
      "it declares no shared memory (a threaded module must import or declare a " +
        "memory with the shared limits flag)",
    );
  }
  if (!analysis.usesAtomics) {
    failures.push(
      "it uses no atomics (no atomic/threads instructions were found in the code section)",
    );
  }
  if (!analysis.hasWasiThreadSpawnImport) {
    failures.push(
      "it does not import the wasi `thread-spawn` host function (WasmEdge cannot " +
        "spawn guest threads without the wasi-threads contract)",
    );
  }
  if (!analysis.hasWasiThreadStartExport) {
    failures.push(
      "it does not export `wasi_thread_start` (the wasi-threads entry a host " +
        "invokes to run a spawned thread)",
    );
  }
  if (analysis.emscriptenThreadHooks.length > 0) {
    failures.push(
      "it imports Emscripten's browser-only Web Worker thread hooks " +
        `(${analysis.emscriptenThreadHooks.join(", ")}) — this is a JS-worker ` +
        "build that cannot thread under WasmEdge, not an isomorphic artifact",
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `isomorphic-pthreads artifact validation REJECTED ${source}: the build ` +
        "claims the pthreads thread model but the emitted wasm is not a valid " +
        `wasi-threads shared-memory/atomics artifact — ${failures.join("; ")}. ` +
        "This build must not ship.",
    );
  }
  return analysis;
}
