/**
 * PLG-manifest injection for foreign-compiled wasm artifacts.
 *
 * The BYO-wasm lane (docs/byo-wasm-quickstart.md) accepts vendor-compiled
 * binaries at `check --wasm`, `parity-gate --artifact`, `conformance
 * --artifact`, `protect`, and `sign`. Every one of those verbs expects the
 * `sds.manifest` custom section (the encoded PLG manifest) to already be
 * embedded in the wasm bytes — but that section is otherwise generated only
 * inside `compileModuleFromSource` (src/compiler/compileModule.js). A vendor
 * who built with their own C++/Rust/Zig toolchain (never `compileModule`)
 * has no way to embed it. This module is that missing verb: it appends (or
 * replaces) the `sds.manifest` custom section on an already-compiled wasm
 * binary, using the exact same encoder and section name the compiler uses.
 */
import { encodePluginManifest } from "./codec.js";
import {
  appendWasmCustomSection,
  listWasmCustomSections,
  stripWasmCustomSections,
} from "../bundle/wasm.js";
import { SDS_MANIFEST_SECTION_NAME } from "../bundle/constants.js";
import { toUint8Array } from "../runtime/bufferLike.js";

/**
 * Inject (or replace) the PLG manifest custom section into a wasm artifact
 * that was NOT produced by compileModuleFromSource — e.g. a foreign-compiled
 * multi-TU C++/CMake/wasi-sdk binary from the BYO-wasm lane.
 *
 * @param {object} options
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} options.wasmBytes
 * @param {object} options.manifest - plain manifest object (same shape
 *   `compileModuleFromSource` and `check --manifest` accept).
 * @param {boolean} [options.replace=false] - if the artifact already carries
 *   an `sds.manifest` section, strip it before appending the new one. When
 *   `false` (the default), an existing section throws rather than silently
 *   stacking two manifests in one artifact.
 * @returns {{ wasmBytes: Uint8Array, replacedExisting: boolean }}
 */
export function injectPluginManifest(options = {}) {
  const inputBytes = toUint8Array(options.wasmBytes);
  if (!inputBytes) {
    throw new TypeError(
      "injectPluginManifest requires wasmBytes (Uint8Array, ArrayBuffer, or ArrayBufferView).",
    );
  }
  const manifest = options.manifest;
  if (!manifest || typeof manifest !== "object") {
    throw new TypeError("injectPluginManifest requires a manifest object.");
  }
  const replace = options.replace === true;

  const existing = listWasmCustomSections(inputBytes).filter(
    (section) => section.name === SDS_MANIFEST_SECTION_NAME,
  );
  if (existing.length > 0 && !replace) {
    throw new Error(
      `Artifact already carries an "${SDS_MANIFEST_SECTION_NAME}" custom section. ` +
        "Pass { replace: true } to overwrite it, or strip it first.",
    );
  }

  const baseBytes =
    existing.length > 0
      ? stripWasmCustomSections(
          inputBytes,
          (section) => section.name === SDS_MANIFEST_SECTION_NAME,
        )
      : inputBytes;

  const manifestBytes = encodePluginManifest(manifest);
  const wasmBytes = appendWasmCustomSection(
    baseBytes,
    SDS_MANIFEST_SECTION_NAME,
    manifestBytes,
  );

  return { wasmBytes, replacedExisting: existing.length > 0 };
}
