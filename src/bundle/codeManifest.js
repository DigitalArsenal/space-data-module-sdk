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

/**
 * The manifest the SIGNED code carries: an `sds.manifest` custom section left
 * in the bytes before the trailer, else what the code's manifest exports
 * return when the code is instantiated with stand-in imports. Never the
 * trailer.
 *
 * @param {Uint8Array|ArrayBuffer} artifactBytes - a signed artifact or raw wasm
 * @param {{instance?: WebAssembly.Instance, memory?: WebAssembly.Memory}} [options]
 *   a caller that already runs these bytes passes its instance, which is asked
 *   instead of a stand-in instantiation
 * @returns {Promise<{bytes: Uint8Array, source: "custom-section"|"manifest-export"}|{bytes: null, source: null, reason: string}>}
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
 *
 * A module with no manifest in its code and none in its trailer returns null:
 * it declares nothing, and each reader treats that as it treats an absent
 * manifest (the flow host refuses a flow without one; the WasmEdge gate then
 * judges by the caller's manifest alone).
 *
 * @param {Uint8Array|ArrayBuffer} artifactBytes
 * @param {{instance?: WebAssembly.Instance, memory?: WebAssembly.Memory}} [options]
 *   as for readSignedCodeManifest
 * @returns {Promise<Uint8Array|null>}
 */
export async function readBoundManifestBytes(artifactBytes, options = {}) {
  const trailer = readTrailerManifestBytes(artifactBytes);
  const { bytes: code, reason } = await readSignedCodeManifest(
    artifactBytes,
    options,
  );
  if (trailer && !code) {
    throw new ModuleSignatureError(
      "trailer_manifest_unbound",
      `the artifact's trailer carries a manifest, but its signed code carries none to bind it to (${reason}); the trailer is not covered by the signature, so its manifest is refused`,
    );
  }
  if (trailer && !equalBytes(trailer, code)) {
    throw new ModuleSignatureError(
      "trailer_manifest_mismatch",
      `the artifact's trailer manifest (${trailer.length} bytes) is not the manifest its signed code carries (${code.length} bytes); the trailer is not covered by the signature and was changed after signing`,
    );
  }
  return code;
}
