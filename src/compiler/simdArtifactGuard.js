// WebAssembly SIMD guardrail: the opt-in flag and the emitted-artifact validator.
//
// SIMD is OPT-IN per module: `compileModuleFromSource({ simd128: true })` compiles
// the module's own code (and its `libraries`) with -msimd128. The guard then holds
// the emitted artifact to that declaration in both directions:
//
//   * a module that did NOT opt in must carry no SIMD - no v128 instruction and no
//     `simd128` entry in its target_features section. A per-function
//     `__attribute__((target("simd128")))` or a stray -msimd128 would otherwise
//     slip SIMD past the SDK's flag set, and the build would record nothing;
//   * a module that DID opt in must declare `simd128` in target_features (the flag
//     reached the objects);
//   * relaxed-SIMD is refused either way. Its instructions are implementation-defined
//     (whether an FMA fuses, which lane a select takes), so the same module would
//     return different bytes in the browser and under WasmEdge. Fixed-width simd128
//     is deterministic and is the only SIMD the SDK admits.
//
// Both runtime lanes execute fixed-width SIMD: every current browser engine and
// WasmEdge 0.16.4 (interpreter and AOT). The analysis is recorded on the compile
// result and in the guest-link metadata so a build record says what the artifact
// needs.

import { parseWasmModuleSections } from "../bundle/wasm.js";
import { scanWasmCode } from "./wasmCodeScan.js";
import { readTargetFeatureEntries } from "./wasmTargetFeatures.js";

/** The clang flag the `simd128` compile option turns on for a module's own code. */
export const SIMD128_COMPILE_FLAG = "-msimd128";

/**
 * Parse a compiled wasm artifact and report how it uses SIMD.
 *
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} wasmBytes
 * @returns {{
 *   declared: boolean|null,
 *   declaredRelaxed: boolean|null,
 *   used: boolean,
 *   instructionCount: number,
 *   relaxedInstructionCount: number,
 *   undecodableFunctions: number,
 * }}
 *   declared / declaredRelaxed  whether target_features lists simd128 /
 *     relaxed-simd as used; null when the module has no target_features section.
 *   instructionCount            fixed-width SIMD instructions in the code section.
 *   relaxedInstructionCount     SIMD instructions beyond the fixed-width set
 *     (relaxed-simd and later proposals).
 *   undecodableFunctions        function bodies the scanner could not decode (their
 *     instructions are not counted; the target_features declaration still is).
 */
export function analyzeWasmSimdFeatures(wasmBytes) {
  const parsed = parseWasmModuleSections(wasmBytes);
  const code = scanWasmCode(parsed);
  const entries = readTargetFeatureEntries(parsed.bytes);
  const declares = (name) =>
    entries === null
      ? null
      : entries.some((entry) => entry.name === name && entry.prefix !== "-");
  return {
    declared: declares("simd128"),
    declaredRelaxed: declares("relaxed-simd"),
    used: code.simd > 0,
    instructionCount: code.simd,
    relaxedInstructionCount: code.relaxedSimd,
    undecodableFunctions: code.undecodableFunctions,
  };
}

/**
 * Reject a compiled wasm artifact whose SIMD use contradicts the build's
 * declaration (see the file header). Returns the analysis plus `requested` on
 * success; throws a clear, actionable error otherwise.
 *
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} wasmBytes
 * @param {{ optedIn?: boolean, source?: string }} [options]
 */
export function assertSimdArtifact(wasmBytes, options = {}) {
  const source = options.source ? String(options.source) : "emitted wasm";
  const optedIn = options.optedIn === true;
  let analysis;
  try {
    analysis = analyzeWasmSimdFeatures(wasmBytes);
  } catch (error) {
    throw new Error(
      `simd128 artifact validation failed for ${source}: could not parse the ` +
        `emitted wasm (${error instanceof Error ? error.message : String(error)}).`,
    );
  }

  const failures = [];
  if (analysis.relaxedInstructionCount > 0 || analysis.declaredRelaxed === true) {
    failures.push(
      "it uses relaxed-SIMD " +
        `(${analysis.relaxedInstructionCount} instruction(s); target_features ` +
        `${analysis.declaredRelaxed ? "declares" : "does not declare"} relaxed-simd) - ` +
        "relaxed-SIMD results are implementation-defined, so the same module would return " +
        "different bytes in the browser and under WasmEdge; only fixed-width simd128 is admitted",
    );
  }
  if (!optedIn && (analysis.instructionCount > 0 || analysis.declared === true)) {
    failures.push(
      `it uses WebAssembly SIMD (${analysis.instructionCount} v128 instruction(s); ` +
        `target_features ${analysis.declared ? "declares" : "does not declare"} simd128) ` +
        "but the build did not opt in - a per-function target(\"simd128\") attribute or a " +
        "-msimd128 in the source's own flags bypasses the SDK's flag set. Pass " +
        "compileModuleFromSource({ simd128: true }) so the build, the guard and the build " +
        "record know the module needs SIMD",
    );
  }
  if (optedIn && analysis.declared === false) {
    failures.push(
      `simd128 was requested (${SIMD128_COMPILE_FLAG}) but target_features does not ` +
        "declare simd128 - the flag did not reach the module's objects",
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `simd128 artifact validation REJECTED ${source}: ${failures.join("; ")}. ` +
        "This build must not ship.",
    );
  }
  return { requested: optedIn, ...analysis };
}
