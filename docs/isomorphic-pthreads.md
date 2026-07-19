# Isomorphic Pthreads: Enforced, Validated Shared-Memory Artifacts

`space-data-module-sdk` is the **enforced source of truth** for isomorphic
pthreads module artifacts. When a module is compiled for the pthreads thread
model, the SDK guarantees two things that used to be optional and unchecked:

1. The final `emcc`/`em++` link **cannot omit** the thread-enabling flags.
2. The emitted `.wasm` is **parsed and validated** to actually declare a shared
   memory and use atomics. A module that claims pthreads but emits a
   non-shared-memory wasm **fails the compile** — it does not ship.

This is the toolchain half of the isomorphic-pthreads architecture: one compiled
`.wasm` that threads in **both** the browser (via `SharedArrayBuffer` + worker
pthreads) and WasmEdge (via wasi-threads), mirroring the proven
`analysis/conjunction-assessment` module shape (`std::thread` workers over a
standalone pthread-enabled wasm).

## Thread Models

`ModuleThreadModel` (see `src/compiler/compileModule.js`):

- `single-thread` — portable, no shared memory, no atomics. Default for
  `runtimeTargets: ["browser"]` and `["browser", "wasmedge"]`.
- `emscripten-pthreads` — shared-memory + atomics standalone wasm. Default for
  `runtimeTargets: ["wasmedge"]`. This is the path this document governs.

`resolveThreadModel({ manifest, threadModel })` resolves the model; an explicit
`threadModel` option always wins over `runtimeTargets` inference.

## 1. Enforced Flags (non-bypassable)

The pthreads final link routes through one flag-assembler
(`buildCompilerArgs` in `src/compiler/compileModule.js`, backed by
`PTHREAD_FINAL_LINK_FLAGS` in `src/compiler/pthreadArtifactGuard.js`). For the
`emscripten-pthreads` model it **always** carries:

```
-pthread -matomics -mbulk-memory -s STANDALONE_WASM=1 -s IMPORTED_MEMORY=1 -s ALLOW_MEMORY_GROWTH=1
```

Both compile paths — the in-process `emception` path and the system-emscripten
path — assemble the final link through this same function, so no per-call option
can drop these flags. `buildCompilerArgs` asserts its own output
(`assertPthreadFlagsPresent`) so a future edit that removes a mandated flag fails
loudly instead of silently shipping a broken artifact.

### Why not `-mthreads`

An earlier spec listed `-mthreads`. That token is **invalid for the
`wasm32-unknown-emscripten` target** and breaks the compile:

```
clang: error: unsupported option '-mthreads' for target 'wasm32-unknown-emscripten'
```

`-mthreads` is a MinGW/Windows driver flag, not a WebAssembly target feature.
Emscripten's `-pthread` already selects the threads model — it defines
`__EMSCRIPTEN_SHARED_MEMORY__=1` and enables the `atomics`, `bulk-memory`, and
shared-memory features. `-matomics` and `-mbulk-memory` make those features
explicit. `-mthreads` is therefore **intentionally omitted**; the thread
guarantee is delivered by `-pthread` + `-matomics` and, critically, is
**validated at the artifact level** (below) rather than trusted from a flag.

## 2. Validated Artifact (the part that matters most)

After the final `.wasm` is emitted, `compileModuleFromSource` calls
`assertPthreadArtifact(wasmBytes)` for the pthreads model. That parses the wasm
binary and asserts:

- **Shared memory** — an imported memory (`env.memory`) or a declared memory
  whose limits flags have the shared bit set (`flags & 0x02`, i.e. `0x03`/`0x07`).
  This is the deterministic, false-positive-free proof that the module is a
  threads-enabled module: a WebAssembly shared memory is invalid without the
  threads feature.
- **Atomics usage** — the code section is walked with a real instruction decoder
  that counts genuine `0xFE`-prefixed atomic instructions. This is **not** a byte
  scan: a naive scan for `0xFE` false-positives on `i32.const` / LEB128
  immediates (a realistic single-thread module shows several stray `0xFE`
  bytes). The `target_features` custom section is honored when present, but it is
  **stripped at `-O3`**, so it cannot be the only signal.

If either check fails, the compile is **rejected** with a clear error naming the
artifact and the missing property. The analysis is also returned on the
compilation result as `result.threadFeatures`
(`{ hasSharedMemory, sharedMemory, usesAtomics, atomicInstructionCount, ... }`).

`analyzeWasmThreadFeatures(wasmBytes)` and `assertPthreadArtifact(wasmBytes)` are
exported from `src/compiler/index.js` (and the package root) for reuse by
downstream validators, deploy gates, and tests.

## 3. Compile-Time vs. Runtime: an honest boundary

Passing this guardrail proves the **artifact** is a valid shared-memory/atomics
wasm. It does **not** prove that a given WasmEdge build actually spawns and runs
guest threads. Those are different claims:

> **Rule:** Do not claim WasmEdge thread support until a real runtime invocation
> spawns threads and runs. Compile-time validation (shared memory + atomics) is
> necessary but not sufficient; runtime thread-spawn verification is owned by the
> deploy/benchmark node, not by this SDK.

Record any WasmEdge runtime limitation honestly. An artifact that validates here
but only compiles — and does not instantiate/spawn threads under the target
runtime — must be reported as such.

## Tests

- `test/pthreads-artifact-guardrail.test.js` — flag-assembler invariants, a
  positive compile that emits a validated shared-memory/atomics wasm, a negative
  test that a single-thread artifact is rejected as pthreads, a negative test
  that a shared-flag-stripped artifact is rejected, and a false-positive guard
  proving the atomics decoder ignores `0xFE` immediates.

## See also

- [`docs/browser-wasmedge-isomorphic.md`](./browser-wasmedge-isomorphic.md) —
  the one-artifact browser + WasmEdge loading profile.
- `.claude/skills/wasmedge-pthreads/Skills.md` — the operating rules for touching
  pthreads module compilation.
- `src/compiler/pthreadArtifactGuard.js` — the flag list + wasm validator.
- `src/compiler/compileModule.js` — `ModuleThreadModel`, `buildCompilerArgs`,
  `resolveThreadModel`, `compileModuleFromSource`.
