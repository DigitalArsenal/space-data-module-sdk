// WebAssembly SIMD guardrail: the opt-in flag and the emitted-artifact validator.
//
// SIMD is OPT-IN per module: `compileModuleFromSource({ simd128: true })` compiles
// the module's own code (and its `libraries`) with -msimd128. The guard then holds
// the emitted artifact to that declaration:
//
//   * a module that DID opt in must declare `simd128` in target_features (the flag
//     reached the objects);
//   * a module that did NOT opt in but whose artifact carries SIMD anyway (a
//     per-function `__attribute__((target("simd128")))`, or a module built by its own
//     clang driver with -msimd128) is NOT refused yet: the SIMD is recorded as if the
//     module had declared it, and a warning tells the module to pass
//     `simd128: true`. Undeclared SIMD will become an error in a later release;
//   * relaxed-SIMD is refused either way. Its instructions are implementation-defined
//     (whether an FMA fuses, which lane a select takes), so the same module would
//     return different bytes in the browser and under WasmEdge. Fixed-width simd128
//     is deterministic and is the only SIMD the SDK admits;
//   * an artifact with a function body the scanner cannot decode is refused: SIMD
//     inside that body would go uncounted, so its use cannot be ruled out.
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

/** The process warning code for an artifact that carries SIMD its build did not declare. */
export const SIMD128_UNDECLARED_WARNING_CODE = "SDM_SIMD128_UNDECLARED";

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
 *     instructions are not counted).
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
 * Hold a compiled wasm artifact's SIMD use to the build's declaration (see the file
 * header). Returns the analysis plus `requested` (the module opted in) and
 * `undeclared` (SIMD without the opt-in; `warning` then says what to do) on success;
 * throws a clear, actionable error otherwise.
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
  if (analysis.undecodableFunctions > 0) {
    failures.push(
      `${analysis.undecodableFunctions} function body(ies) could not be decoded, so SIMD ` +
        "inside them would go uncounted and the artifact's SIMD use cannot be ruled out",
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

  const undeclared = !optedIn && (analysis.instructionCount > 0 || analysis.declared === true);
  const result = { requested: optedIn, undeclared, ...analysis };
  if (undeclared) {
    result.warning =
      `${source} uses WebAssembly SIMD (${analysis.instructionCount} v128 instruction(s); ` +
      `target_features ${analysis.declared ? "declares" : "does not declare"} simd128) but the build did ` +
      "not declare it. Pass compileModuleFromSource({ simd128: true }) so the module declares that it " +
      "needs SIMD (a module built by its own clang driver with -msimd128, or a per-function " +
      'target("simd128") attribute, is the usual cause). The SDK records the use as if declared ' +
      "and does not refuse the artifact yet; undeclared SIMD will become an error in a later release.";
  }
  return result;
}
