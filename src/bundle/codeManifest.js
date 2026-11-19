// The manifest a module's SIGNED CODE carries, and the rule that binds the
// trailer's copy to it.
//
// The one signature form (SDN-MODULE-PUBLICATION-V1) covers the bytes before
// the `$REC` trailer. The SDK's bundle writer moves the `sds.manifest` custom
// section out of the wasm and into the trailer's MBL `manifest` entry, so in a
// signed file that copy is NOT covered by the signature. The code carries its
// own copy: the manifest the export `plugin_get_manifest_flatbuffer` returns
// (with `plugin_get_manifest_flatbuffer_size`), which lives in the module's
// data and is covered. A reader that needs a module's manifest takes it from
// the code, and an artifact whose trailer copy is not byte for byte the code's
// copy is refused by name.
//
// Browser-safe: no Node imports.

import {
  DEFAULT_MANIFEST_EXPORT_SYMBOL,
  DEFAULT_MANIFEST_SIZE_SYMBOL,
  SDS_MANIFEST_SECTION_NAME,
} from "./constants.js";
import { ModuleSignatureError } from "./signing.js";
import {
  decodeUnsignedLeb128,
  getWasmCustomSections,
  parseWasmModuleSections,
} from "./wasm.js";
import { extractPublicationRecordCollection } from "../transport/records.js";

const textDecoder = new TextDecoder();

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value ?? []);
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * The trailer's (unsigned) manifest entry, or null. Reported, never trusted.
 * @param {Uint8Array|ArrayBuffer} artifactBytes
 * @returns {Uint8Array|null}
 */
export function readTrailerManifestBytes(artifactBytes) {
  const publication = extractPublicationRecordCollection(asBytes(artifactBytes));
  for (const entry of publication?.mbl?.entries ?? []) {
    if (
      entry?.entryId === "manifest" ||
      entry?.sectionName === SDS_MANIFEST_SECTION_NAME
    ) {
      return asBytes(entry.payload).slice();
    }
  }
  return null;
}

/**
 * The manifest a running instance returns from its manifest exports, or null
 * when it has none.
 * @param {WebAssembly.Instance} instance
 * @param {WebAssembly.Memory} [memory] the instance's memory, when imported
 * @returns {Uint8Array|null}
 */
export function readInstanceManifestBytes(instance, memory) {
  const exports = instance?.exports ?? {};
  const getBytes = exports[DEFAULT_MANIFEST_EXPORT_SYMBOL];
  const getSize = exports[DEFAULT_MANIFEST_SIZE_SYMBOL];
  if (typeof getBytes !== "function" || typeof getSize !== "function") {
    return null;
  }
  const mem =
    exports.memory instanceof WebAssembly.Memory ? exports.memory : memory;
  if (!(mem instanceof WebAssembly.Memory)) return null;
  const ptr = Number(getBytes()) >>> 0;
  const size = Number(getSize()) >>> 0;
  if (!ptr || !size || ptr + size > mem.buffer.byteLength) return null;
  return new Uint8Array(mem.buffer, ptr, size).slice();
}

// ---- a minimal instantiation of the signed code, to ask it for its manifest --
//
// Every import is a stand-in: a function that throws if called, and a memory,
// table or global of the declared shape. Nothing the module does here reaches
// a host. The manifest exports return a pointer into the module's own data,
// which instantiation (including the start function that copies passive data
// segments into memory) has already written.

const VALUE_TYPES = {
  0x7f: ["i32", 0],
  0x7e: ["i64", 0n],
  0x7d: ["f32", 0],
  0x7c: ["f64", 0],
  0x70: ["anyfunc", null],
  0x6f: ["externref", null],
};

function readName(bytes, offset) {
  const length = decodeUnsignedLeb128(bytes, offset);
  const start = length.nextOffset;
  const end = start + length.value;
  return { value: textDecoder.decode(bytes.subarray(start, end)), nextOffset: end };
}

function readLimits(bytes, offset) {
  const flags = bytes[offset];
  let cursor = offset + 1;
  if (flags & 0x04) {
    throw new Error("64-bit memory limits are not read here");
  }
  const initial = decodeUnsignedLeb128(bytes, cursor);
  cursor = initial.nextOffset;
  let maximum;
  if (flags & 0x01) {
    const max = decodeUnsignedLeb128(bytes, cursor);
    maximum = max.value;
    cursor = max.nextOffset;
  }
  return {
    initial: initial.value,
    maximum,
    shared: Boolean(flags & 0x02),
    nextOffset: cursor,
  };
}

function stubImports(portableBytes) {
  const parsed = parseWasmModuleSections(portableBytes);
  const imports = {};
  let importedMemory = null;
  const trap = (moduleName, fieldName) => () => {
    throw new Error(
      `manifest read: import ${moduleName}.${fieldName} is not available while reading the code's manifest`,
    );
  };
  for (const section of parsed.sections) {
    if (section.id !== 2) continue;
    const bytes = parsed.bytes.subarray(section.payloadStart, section.payloadEnd);
    const count = decodeUnsignedLeb128(bytes, 0);
    let cursor = count.nextOffset;
    for (let index = 0; index < count.value; index += 1) {
      const moduleName = readName(bytes, cursor);
      const fieldName = readName(bytes, moduleName.nextOffset);
      cursor = fieldName.nextOffset;
      const kind = bytes[cursor++];
      const target = (imports[moduleName.value] ??= {});
      if (kind === 0x00) {
        cursor = decodeUnsignedLeb128(bytes, cursor).nextOffset;
        target[fieldName.value] = trap(moduleName.value, fieldName.value);
      } else if (kind === 0x01) {
        const refType = bytes[cursor++];
        const limits = readLimits(bytes, cursor);
        cursor = limits.nextOffset;
        target[fieldName.value] = new WebAssembly.Table({
          element: refType === 0x70 ? "anyfunc" : "externref",
          initial: limits.initial,
          ...(limits.maximum !== undefined ? { maximum: limits.maximum } : {}),
        });
      } else if (kind === 0x02) {
        const limits = readLimits(bytes, cursor);
        cursor = limits.nextOffset;
        const memory = new WebAssembly.Memory({
          initial: limits.initial,
          ...(limits.maximum !== undefined ? { maximum: limits.maximum } : {}),
          ...(limits.shared ? { shared: true } : {}),
        });
        importedMemory ??= memory;
        target[fieldName.value] = memory;
      } else if (kind === 0x03) {
        const valueType = VALUE_TYPES[bytes[cursor++]];
        const mutable = bytes[cursor++] === 0x01;
        if (!valueType) throw new Error("unknown global import type");
        target[fieldName.value] = new WebAssembly.Global(
          { value: valueType[0], mutable },
          valueType[1],
        );
      } else {
        throw new Error(`import kind ${kind} is not read here`);
      }
    }
  }
  return { imports, importedMemory };
}

// ---- the manifest exports answered WITHOUT running the code ----------------
//
// An SDK-built module's two manifest exports are constants: each body is
// `i32.const N; end` (no locals). Their answer is then read from the module's
// data image: the active data segments at their constant offsets, and the
// passive segments that the start function copies with the linker's
// `i32.const dst; i32.const 0; i32.const len; memory.init seg 0` sequence (a
// shared-memory build's `__wasm_init_memory`). Nothing is instantiated, no
// memory is allocated beyond the answer, no start function runs.

const STATIC_MANIFEST_MAX_BYTES = 16 * 1024 * 1024;

function decodeSignedLeb128I32(bytes, offset) {
  let result = 0;
  let shift = 0;
  let cursor = offset;
  let byte;
  do {
    if (cursor >= bytes.length || shift > 35) return null;
    byte = bytes[cursor++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  if (shift < 32 && byte & 0x40) result |= -1 << shift;
  return { value: result | 0, nextOffset: cursor };
}

function skipLimits(bytes, cursor) {
  const flags = bytes[cursor++];
  cursor = decodeUnsignedLeb128(bytes, cursor).nextOffset;
  if (flags & 0x01) cursor = decodeUnsignedLeb128(bytes, cursor).nextOffset;
  return cursor;
}

function sectionVector(parsed, id) {
  const section = parsed.sections.find((entry) => entry.id === id);
  if (!section) return null;
  return parsed.bytes.subarray(section.payloadStart, section.payloadEnd);
}

function countImportedFunctions(bytes) {
  if (!bytes) return 0;
  const count = decodeUnsignedLeb128(bytes, 0);
  let cursor = count.nextOffset;
  let functions = 0;
  for (let index = 0; index < count.value; index += 1) {
    cursor = readName(bytes, readName(bytes, cursor).nextOffset).nextOffset;
    const kind = bytes[cursor++];
    if (kind === 0x00) {
      functions += 1;
      cursor = decodeUnsignedLeb128(bytes, cursor).nextOffset;
    } else if (kind === 0x01) {
      cursor = skipLimits(bytes, cursor + 1);
    } else if (kind === 0x02) {
      cursor = skipLimits(bytes, cursor);
    } else if (kind === 0x03) {
      cursor += 2;
    } else if (kind === 0x04) {
      cursor = decodeUnsignedLeb128(bytes, cursor + 1).nextOffset;
    } else {
      throw new Error(`import kind ${kind} is not read here`);
    }
  }
  return functions;
}

function exportedIndex(bytes, name, wantedKind) {
  if (!bytes) return null;
  const count = decodeUnsignedLeb128(bytes, 0);
  let cursor = count.nextOffset;
  for (let index = 0; index < count.value; index += 1) {
    const exportName = readName(bytes, cursor);
    const kind = bytes[exportName.nextOffset];
    const target = decodeUnsignedLeb128(bytes, exportName.nextOffset + 1);
    cursor = target.nextOffset;
    if (exportName.value === name) return kind === wantedKind ? target.value : null;
  }
  return null;
}

const exportedFunctionIndex = (bytes, name) => exportedIndex(bytes, name, 0x00);

function functionBody(codeBytes, definedIndex) {
  if (!codeBytes || definedIndex < 0) return null;
  const count = decodeUnsignedLeb128(codeBytes, 0);
  if (definedIndex >= count.value) return null;
  let cursor = count.nextOffset;
  for (let index = 0; index < count.value; index += 1) {
    const size = decodeUnsignedLeb128(codeBytes, cursor);
    const end = size.nextOffset + size.value;
    if (end > codeBytes.length) return null;
    if (index === definedIndex) return codeBytes.subarray(size.nextOffset, end);
    cursor = end;
  }
  return null;
}

// A body that is exactly `(no locals) i32.const N end`: its unsigned value.
function constantI32Body(body) {
  if (!body || body.length < 3 || body[0] !== 0x00 || body[1] !== 0x41) return null;
  const value = decodeSignedLeb128I32(body, 2);
  if (!value || value.nextOffset !== body.length - 1 || body[value.nextOffset] !== 0x0b) {
    return null;
  }
  return value.value >>> 0;
}

function constantI32Expression(bytes, cursor) {
  if (bytes[cursor] !== 0x41) return null;
  const value = decodeSignedLeb128I32(bytes, cursor + 1);
  if (!value || bytes[value.nextOffset] !== 0x0b) return null;
  return { value: value.value >>> 0, nextOffset: value.nextOffset + 1 };
}

// Each data segment with its constant placement (null when it has none).
function dataSegments(bytes) {
  if (!bytes) return [];
  const count = decodeUnsignedLeb128(bytes, 0);
  let cursor = count.nextOffset;
  const segments = [];
  for (let index = 0; index < count.value; index += 1) {
    const flags = decodeUnsignedLeb128(bytes, cursor);
    cursor = flags.nextOffset;
    let offset = null;
    let passive = false;
    let memory = 0;
    if (flags.value === 1) {
      passive = true;
    } else if (flags.value === 0 || flags.value === 2) {
      if (flags.value === 2) {
        const memoryIndex = decodeUnsignedLeb128(bytes, cursor);
        memory = memoryIndex.value;
        cursor = memoryIndex.nextOffset;
      }
      const expression = constantI32Expression(bytes, cursor);
      if (!expression) return null;
      offset = expression.value;
      cursor = expression.nextOffset;
    } else {
      return null;
    }
    const size = decodeUnsignedLeb128(bytes, cursor);
    const start = size.nextOffset;
    const end = start + size.value;
    if (end > bytes.length) return null;
    segments.push({ offset, passive, memory, bytes: bytes.subarray(start, end) });
    cursor = end;
  }
  return segments;
}

// The start function's linker sequences (a shared-memory build's
// `__wasm_init_memory`, after Binaryen's memory packing):
//   `i32.const dst; i32.const 0; i32.const len; memory.init seg 0` places a
//   passive segment, and
//   `i32.const dst; i32.const 0; i32.const len; memory.fill 0` writes the
//   zero runs the packing took out of the segments.
// Only copies into `memory` (the memory the manifest is read from) count.
// Returns the zero-filled ranges.
function placePassiveSegments(startBody, segments, memory) {
  const zeroRanges = [];
  if (!startBody) return zeroRanges;
  for (let cursor = 0; cursor < startBody.length; cursor += 1) {
    if (startBody[cursor] !== 0x41) continue;
    const dst = decodeSignedLeb128I32(startBody, cursor + 1);
    if (!dst || startBody[dst.nextOffset] !== 0x41) continue;
    const second = decodeSignedLeb128I32(startBody, dst.nextOffset + 1);
    if (!second || second.value !== 0 || startBody[second.nextOffset] !== 0x41) continue;
    const len = decodeSignedLeb128I32(startBody, second.nextOffset + 1);
    if (!len || startBody[len.nextOffset] !== 0xfc) continue;
    const op = startBody[len.nextOffset + 1];
    if (op === 0x0b) {
      if (decodeUnsignedLeb128(startBody, len.nextOffset + 2).value === memory) {
        zeroRanges.push({ offset: dst.value >>> 0, length: len.value >>> 0 });
      }
      continue;
    }
    if (op !== 0x08) continue;
    const segment = decodeUnsignedLeb128(startBody, len.nextOffset + 2);
    if (decodeUnsignedLeb128(startBody, segment.nextOffset).value !== memory) continue;
    const target = segments[segment.value];
    if (
      target?.passive &&
      target.offset === null &&
      len.value >>> 0 === target.bytes.length
    ) {
      target.offset = dst.value >>> 0;
    }
  }
  return zeroRanges;
}

/**
 * The manifest the code's two manifest exports would return, worked out from
 * the bytes alone, or a reason why it cannot be. Never instantiates.
 * @param {Uint8Array} portable - the bytes before the trailer
 * @returns {{bytes: Uint8Array}|{bytes: null, reason: string, exportsManifest: boolean}}
 */
export function readStaticManifestBytes(portable) {
  const parsed = parseWasmModuleSections(portable);
  const exportsBytes = sectionVector(parsed, 7);
  const getIndex = exportedFunctionIndex(exportsBytes, DEFAULT_MANIFEST_EXPORT_SYMBOL);
  const sizeIndex = exportedFunctionIndex(exportsBytes, DEFAULT_MANIFEST_SIZE_SYMBOL);
  if (getIndex === null || sizeIndex === null) {
    return { bytes: null, reason: "the code exports no manifest", exportsManifest: false };
  }
  const notStatic = (why) => ({
    bytes: null,
    reason: `the code's manifest exports cannot be answered from its bytes alone (${why})`,
    exportsManifest: true,
  });
  const importedFunctions = countImportedFunctions(sectionVector(parsed, 2));
  const code = sectionVector(parsed, 10);
  const ptr = constantI32Body(functionBody(code, getIndex - importedFunctions));
  const size = constantI32Body(functionBody(code, sizeIndex - importedFunctions));
  if (ptr === null || size === null) return notStatic("an export body is not a constant");
  if (!ptr || !size) return notStatic("an export returns zero");
  if (size > STATIC_MANIFEST_MAX_BYTES) return notStatic(`a ${size}-byte manifest`);
  const segments = dataSegments(sectionVector(parsed, 11));
  if (!segments) return notStatic("a data segment has no constant placement");
  // The memory the exports' pointer is read from: the exported `memory`
  // (readInstanceManifestBytes reads that one), else memory 0.
  const memory = exportedIndex(exportsBytes, "memory", 0x02) ?? 0;
  const start = sectionVector(parsed, 8);
  let zeroRanges = [];
  if (start) {
    const startIndex = decodeUnsignedLeb128(start, 0).value;
    zeroRanges = placePassiveSegments(
      functionBody(code, startIndex - importedFunctions),
      segments,
      memory,
    );
  }
  const out = new Uint8Array(size);
  const covered = new Uint8Array(size);
  const end = ptr + size;
  const cover = (offset, length, source) => {
    const from = Math.max(ptr, offset);
    const to = Math.min(end, offset + length);
    if (from >= to) return;
    if (source) out.set(source.subarray(from - offset, to - offset), from - ptr);
    covered.fill(1, from - ptr, to - ptr);
  };
  for (const range of zeroRanges) cover(range.offset, range.length, null);
  for (const segment of segments) {
    // A passive segment has a placement only when the start function copies
    // it into this memory; an active one counts only in this memory.
    if (segment.offset !== null && (segment.passive || segment.memory === memory)) {
      cover(segment.offset, segment.bytes.length, segment.bytes);
    }
  }
  // Without a start function nothing runs before the exports are called, and
  // a fresh memory is zero wherever no segment is placed. With one, every
  // byte of the answer must come from a placed segment or a zero fill it
  // recognizably does: no guess about memory that only running it would write.
  if (start && !covered.every((byte) => byte === 1)) {
    return notStatic("the manifest is not wholly in the data the start function places");
  }
  return { bytes: out };
}

/**
 * The manifest the SIGNED code carries: an `sds.manifest` custom section left
 * in the bytes before the trailer, else what the code's manifest exports
 * return. Never the trailer.
 *
 * The exports are asked of the caller's running instance when one is given;
 * else they are answered from the bytes alone when their bodies are
 * constants (readStaticManifestBytes; the SDK's builds are); else the code
 * is instantiated with stand-in imports ONLY when the caller says its
 * signature was already verified under a policy that requires one
 * (`verifiedSignature: true`). Code nobody verified is never run here: a
 * start function that loops, or a declared memory of 4 GiB, would hang or
 * load the caller's process. Such code is reported as not asked.
 *
 * @param {Uint8Array|ArrayBuffer} artifactBytes - a signed artifact or raw wasm
 * @param {{instance?: WebAssembly.Instance, memory?: WebAssembly.Memory, verifiedSignature?: boolean}} [options]
 *   a caller that already runs these bytes passes its instance, which is asked
 *   instead; `verifiedSignature: true` allows a stand-in instantiation
 * @returns {Promise<{bytes: Uint8Array, source: "custom-section"|"manifest-export"|"static-exports"}|{bytes: null, source: null, reason: string, notRun?: boolean}>}
 */
export async function readSignedCodeManifest(artifactBytes, options = {}) {
  const input = asBytes(artifactBytes);
  const publication = extractPublicationRecordCollection(input);
  const portable = publication?.payloadBytes
    ? asBytes(publication.payloadBytes)
    : input;
  let sections = [];
  try {
    sections = getWasmCustomSections(portable, SDS_MANIFEST_SECTION_NAME);
  } catch (error) {
    return { bytes: null, source: null, reason: `not a wasm module: ${error?.message ?? error}` };
  }
  if (sections.length > 0) {
    return { bytes: asBytes(sections[0]).slice(), source: "custom-section" };
  }
  if (options.instance) {
    const bytes = readInstanceManifestBytes(options.instance, options.memory);
    if (bytes) return { bytes, source: "manifest-export" };
    return { bytes: null, source: null, reason: "the code exports no manifest" };
  }
  let staticRead;
  try {
    staticRead = readStaticManifestBytes(portable);
  } catch (error) {
    staticRead = {
      bytes: null,
      reason: `the code's manifest exports cannot be answered from its bytes alone (${error?.message ?? error})`,
      exportsManifest: true,
    };
  }
  if (staticRead.bytes) return { bytes: staticRead.bytes, source: "static-exports" };
  if (!staticRead.exportsManifest) {
    return { bytes: null, source: null, reason: staticRead.reason };
  }
  if (options.verifiedSignature !== true) {
    return {
      bytes: null,
      source: null,
      notRun: true,
      reason: `${staticRead.reason}; the code was not run to ask it, because its signature was not verified under a policy that requires one`,
    };
  }
  try {
    const { imports, importedMemory } = stubImports(portable);
    const { instance } = await WebAssembly.instantiate(portable.slice(), imports);
    const bytes = readInstanceManifestBytes(instance, importedMemory);
    if (bytes) return { bytes, source: "manifest-export" };
    return { bytes: null, source: null, reason: "the code exports no manifest" };
  } catch (error) {
    return {
      bytes: null,
      source: null,
      reason: `the code could not be asked for its manifest: ${error?.message ?? error}`,
    };
  }
}

/**
 * Bind the trailer's manifest copy to the code's. Returns the code's manifest
 * bytes (null when the code carries none and the trailer carries none).
 *
 * Refused by name:
 *  - `trailer_manifest_mismatch`: the trailer's copy is not byte for byte the
 *    code's copy (the trailer was changed after signing, or never matched).
 *  - `trailer_manifest_unbound`: the trailer carries a manifest and the code
 *    carries none (or could not be read), so nothing signed vouches for it.
 *    `error.codeNotRun` is true when the code does export a manifest that
 *    only running it would give, and it was not run because its signature
 *    was not verified (`verifiedSignature` not set).
 *
 * A module with no manifest in its code and none in its trailer returns null:
 * it declares nothing, and each reader treats that as it treats an absent
 * manifest (the flow host refuses a flow without one; the WasmEdge gate then
 * judges by the caller's manifest alone).
 *
 * @param {Uint8Array|ArrayBuffer} artifactBytes
 * @param {{instance?: WebAssembly.Instance, memory?: WebAssembly.Memory, verifiedSignature?: boolean}} [options]
 *   as for readSignedCodeManifest
 * @returns {Promise<Uint8Array|null>}
 */
export async function readBoundManifestBytes(artifactBytes, options = {}) {
  const trailer = readTrailerManifestBytes(artifactBytes);
  const { bytes: code, reason, notRun } = await readSignedCodeManifest(
    artifactBytes,
    options,
  );
  if (trailer && !code) {
    const error = new ModuleSignatureError(
      "trailer_manifest_unbound",
      notRun
        ? `the artifact's trailer carries a manifest, and its signed code could not be asked for its own (${reason}); the trailer is not covered by the signature, so its manifest is refused`
        : `the artifact's trailer carries a manifest, but its signed code carries none to bind it to (${reason}); the trailer is not covered by the signature, so its manifest is refused`,
    );
    // True when the code does export a manifest that only running it would
    // give: the code was not run, because its signature was not verified.
    error.codeNotRun = notRun === true;
    throw error;
  }
  if (trailer && !equalBytes(trailer, code)) {
    throw new ModuleSignatureError(
      "trailer_manifest_mismatch",
      `the artifact's trailer manifest (${trailer.length} bytes) is not the manifest its signed code carries (${code.length} bytes); the trailer is not covered by the signature and was changed after signing`,
    );
  }
  return code;
}
