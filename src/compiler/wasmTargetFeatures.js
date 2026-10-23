// The `target_features` custom section of a wasm module (tool-conventions
// "Feature section"): the features its objects were built with, as the linker
// merged them. It is the artifact's own statement of what a runtime must
// support, independent of any instruction the code section happens to contain.

import { decodeUnsignedLeb128, listWasmCustomSections } from "../bundle/wasm.js";

const textDecoder = new TextDecoder();

/**
 * Every entry of the target_features section.
 *
 * @param {Uint8Array} wasmBytes
 * @returns {{ prefix: string, name: string }[]|null} `prefix` is "+" (used),
 *   "=" (used and required of every object) or "-" (disallowed); null when the
 *   module has no target_features section (or it cannot be read at all).
 */
export function readTargetFeatureEntries(wasmBytes) {
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
  const entries = [];
  try {
    let cursor = 0;
    const countInfo = decodeUnsignedLeb128(bytes, cursor);
    cursor = countInfo.nextOffset;
    for (let i = 0; i < countInfo.value; i += 1) {
      const prefix = String.fromCharCode(bytes[cursor]);
      cursor += 1;
      const nameLen = decodeUnsignedLeb128(bytes, cursor);
      cursor = nameLen.nextOffset;
      entries.push({
        prefix,
        name: textDecoder.decode(bytes.subarray(cursor, cursor + nameLen.value)),
      });
      cursor += nameLen.value;
    }
  } catch {
    return entries.length > 0 ? entries : null;
  }
  return entries;
}

/**
 * The names in the target_features section, whatever their prefix.
 *
 * @param {Uint8Array} wasmBytes
 * @returns {string[]|null} null when there is no readable section.
 */
export function readDeclaredFeatures(wasmBytes) {
  const entries = readTargetFeatureEntries(wasmBytes);
  return entries === null ? null : entries.map((entry) => entry.name);
}
