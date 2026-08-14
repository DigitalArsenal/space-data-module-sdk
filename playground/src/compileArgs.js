/**
 * The em++ argument sets the playground's browser lane uses.
 *
 * These MIRROR the emception branch of the SDK's own compiler
 * (src/compiler/compileModule.js — buildCompilerArgs, the "Single-thread /
 * Emscripten-shared-memory-browser path" at line 272; and
 * buildSourceCompilerArgs at line 303) for `threadModel: "single-thread"`.
 * Those two functions are module-private there, so they cannot be imported;
 * they are reproduced here in full, with their reasons. The reproduction is
 * held honest end-to-end rather than by string comparison: the real-browser
 * gate compiles with exactly these flags and requires the result to pass the
 * SDK's shipped conformance suite, which a wrong flag set does not.
 *
 * NOT reproduced, deliberately: every pthreads branch. The playground's
 * browser lane is single-thread only. The isomorphic wasm32-wasip1-threads
 * artifact is built by compileWithWasiThreads, which shells out to a system
 * clang and is therefore structurally unavailable in a browser — the UI names
 * that as the server-deferred lane rather than faking it here.
 */

/** Link-step args: em++ objects... -> module.wasm */
export function buildLinkArgs(exportedSymbols, { noEntry = false } = {}) {
  const args = ["-O3"];
  if (noEntry === true) {
    args.push("--no-entry");
  }
  // Bulk-memory ops: memcpy/memset in module code lower to native
  // memory.copy/memory.fill instead of byte loops. Baseline wasm feature.
  args.push("-mbulk-memory");
  args.push("-s", "STANDALONE_WASM=1");
  args.push("-s", "ALLOW_MEMORY_GROWTH=1");
  for (const symbol of exportedSymbols) {
    args.push(`-Wl,--export=${symbol}`);
  }
  return args;
}

/** Object-compile args: em++ -c source.cpp -> source.o */
export function buildSourceArgs() {
  return ["-O3", "-mbulk-memory", "-DNDEBUG"];
}
