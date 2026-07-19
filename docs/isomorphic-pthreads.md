# Isomorphic Pthreads: Enforced, Validated wasi-threads Artifacts

`space-data-module-sdk` is the **enforced source of truth** for isomorphic
pthreads module artifacts. When a module is compiled for the pthreads thread
model, the SDK guarantees two things that used to be optional and unchecked:

1. The final link **cannot omit** the thread-enabling flags, and it targets the
   **wasi-threads** toolchain (not Emscripten's browser Web-Worker model).
2. The emitted `.wasm` is **parsed and validated** to be a real wasi-threads
   artifact. A module that claims pthreads but does not emit the wasi-threads
   contract **fails the compile** — it does not ship.

The goal is one compiled `.wasm` that threads in **both** the browser (via
`SharedArrayBuffer` + a wasi-threads Worker shim) and WasmEdge (via wasi-threads),
mirroring the `analysis/conjunction-assessment` module's `std::thread` workers.

## Why wasi-threads and NOT Emscripten `-pthread`

This is the load-bearing decision. Emscripten's `-pthread` — even with
`-s STANDALONE_WASM=1` — emits the **browser-only** thread model:

- it imports `env.__pthread_create_js` and `env._emscripten_*` mailbox /
  `postMessage` hooks (a JS Web Worker protocol), and
- it has **no** wasi thread-spawn contract.

That artifact **cannot spawn threads under WasmEdge** — there is no JS runtime to
satisfy those imports; instantiation fails on the unknown imports, and stubbing
them would require host-side thread orchestration (which is separately
forbidden). It has shared memory and atomics, but those are **necessary, not
sufficient**: a browser-only Emscripten build has them too.

WasmEdge's actual thread mechanism is **wasi-threads**: the guest imports
`wasi.thread-spawn` and exports `wasi_thread_start` over an imported shared
memory. Compiling with `clang --target=wasm32-wasip1-threads -pthread`
(wasi-sdk / wasi-libc + wasi-runtimes threads sysroot) produces exactly that
contract, which threads under WasmEdge and loads in the browser through a
wasi-threads shim.

`-mthreads` is likewise never used — it is a MinGW driver flag, invalid for the
wasm target.

## Thread Models

`ModuleThreadModel` (see `src/compiler/compileModule.js`):

- `single-thread` — portable, no shared memory, no atomics. Default for
  `runtimeTargets: ["browser"]` and `["browser", "wasmedge"]`. Built with
  Emscripten (emception, in-process).
- `emscripten-pthreads` — the isomorphic threaded model (the enum value string
  is historical; it now compiles to a **wasi-threads** artifact, not an
  Emscripten Web-Worker build). Default for `runtimeTargets: ["wasmedge"]`.
  Built with the wasi-threads toolchain.

`resolveThreadModel({ manifest, threadModel })` resolves the model; an explicit
`threadModel` option always wins over `runtimeTargets` inference.

## 1. Enforced Flags (non-bypassable)

The pthreads final link routes through one flag-assembler (`buildCompilerArgs` in
`src/compiler/compileModule.js`, backed by `PTHREAD_FINAL_LINK_FLAGS` in
`src/compiler/pthreadArtifactGuard.js`). For the pthreads model it **always**
carries the wasm-ld / clang flags:

```
-pthread -matomics -mbulk-memory -Wl,--import-memory -Wl,--shared-memory -Wl,--max-memory=2147483648
```

plus the toolchain args resolved by `src/compiler/wasiThreadsToolchain.js`
(`--target=wasm32-wasip1-threads --sysroot=… -resource-dir=…`). Object files are
compiled `-matomics -fno-exceptions -pthread` (the wasi-threads libc++ is built
without exceptions, so throwing code otherwise fails to link).

`buildCompilerArgs` asserts its own output (`assertPthreadFlagsPresent`) so a
future edit that removes a mandated flag fails loudly. There are deliberately
**no** Emscripten `-s` settings here — those produce the browser-only build.

The toolchain is resolved with sensible defaults and env overrides
(`SDN_WASI_CLANG`, `SDN_WASI_CLANGXX`, `SDN_WASI_TARGET`, `SDN_WASI_SYSROOT`,
`SDN_WASI_RESOURCE_DIR`). If a wasi-threads sysroot is unavailable, the pthreads
compile fails with a clear, actionable error.

## 2. Validated Artifact (the part that matters most)

After the final `.wasm` is emitted, `compileModuleFromSource` calls
`assertPthreadArtifact(wasmBytes)` for the pthreads model. It parses the wasm and
REJECTS the compile unless ALL of the following hold:

- **Shared memory** — an imported or declared memory with the shared limits flag
  (`flags & 0x02`, i.e. `0x03`/`0x07`).
- **Atomics usage** — the code section is walked with a real instruction decoder
  that counts genuine `0xFE`-prefixed atomic instructions. This is **not** a byte
  scan: a naive scan for `0xFE` false-positives on `i32.const` / LEB128 /
  memory-offset immediates (memory load/store opcodes `0x28`–`0x3E` carry a
  memarg). `target_features` is honored when present.
- **wasi thread-spawn import** — `wasi.thread-spawn` (the host contract WasmEdge
  invokes to spawn a guest thread).
- **`wasi_thread_start` export** — the entry a host calls to run a spawned
  thread.
- **No Emscripten thread hooks** — the artifact must NOT import
  `env.__pthread_create_js` or the `env._emscripten_*` mailbox/postMessage hooks.
  Their presence means it is a browser-only Web-Worker build and it is rejected.

Shared memory + atomics **alone** are necessary but insufficient (the browser-only
Emscripten build has both), which is exactly why the wasi-threads contract check
exists. The analysis is returned on the compilation result as
`result.threadFeatures` (`{ hasSharedMemory, usesAtomics, atomicInstructionCount,
hasWasiThreadSpawnImport, hasWasiThreadStartExport, emscriptenThreadHooks,
isIsomorphicPthreads, … }`).

`analyzeWasmThreadFeatures(wasmBytes)` and `assertPthreadArtifact(wasmBytes)` are
exported from `src/compiler/index.js` (and the package root) for reuse by
downstream validators, deploy gates, and tests.

Note that the wasi-threads contract (thread-spawn import + `wasi_thread_start`
export) appears only when the module **actually spawns threads** — the linker
pulls in that machinery on demand. A module declared `emscripten-pthreads` that
never spawns a thread will therefore fail this guardrail; such a module should
use the `single-thread` model instead.

## Guest-link symbol namespacing (collision-proof, metadata-authoritative)

For monolithic flow composition, each module also emits a **guest-link** wasm
object whose exported method symbols are namespaced by a per-plugin prefix so
that independently-built modules can be linked together with `wasm-ld -r` without
symbol clashes. `guestLinkSymbolPrefix(pluginId)` in
`src/compiler/compileModule.js` produces that prefix as:

```
sdm_guest_<full-lowercase-hex-of-pluginId-UTF8-bytes>_
```

The prefix uses the **full** hex encoding of the pluginId — it is **not**
truncated. Hex encoding is injective, so distinct pluginIds always map to
distinct prefixes. (A prior `.slice(0, 24)` truncation to 12 bytes collided real
plugin ids that share a 12-byte stem — e.g. `com.orbpro.iss-source` and
`com.orbpro.intelsat-source` both collapsed to `hex("com.orbpro.i")`
`636f6d2e6f726270726f2e69`, which would silently merge/clash their symbols at
compose time.) Wasm symbol names have no meaningful length limit, so the full hex
is always safe.

The emitted `symbolPrefix` and the per-method `methodSymbols` map are recorded in
the guest-link **metadata** (`sds.guest-link`). **That metadata is the sole
authoritative source consumers read at compose time** — `generateFlowTables` in
`src/flow/flowCompiler.js` declares and calls
`dependency.guestLink.metadata.methodSymbols[methodId]` and never re-derives the
prefix from the pluginId. This keeps already-committed artifacts compatible: an
object that shipped with a legacy (e.g. truncated) prefix still composes, because
its own metadata carries the exact symbol names its object bytes define.

## 3. Compile-Time vs. Runtime: an honest boundary

Passing this guardrail proves the **artifact** is a valid wasi-threads
shared-memory/atomics wasm. It does **not** prove that a given WasmEdge build
actually spawns and runs guest threads.

> **Rule:** Do not claim WasmEdge thread support until a real runtime invocation
> spawns threads and runs. Compile-time validation (wasi-threads contract +
> shared memory + atomics) is necessary but not sufficient; runtime thread-spawn
> verification is owned by the deploy/benchmark node, not by this SDK.

Record any WasmEdge runtime limitation honestly. An artifact that validates here
but only compiles — and does not instantiate/spawn threads under the target
runtime — must be reported as such.

## Tests

- `test/pthreads-artifact-guardrail.test.js` — flag-assembler invariants; a
  positive compile that emits a validated wasi-threads shared-memory/atomics
  wasm; a single-thread artifact rejected; a **browser-only Emscripten `-pthread`
  artifact rejected** (has shared memory + atomics but no wasi-threads contract);
  a shared-flag-stripped artifact rejected; and a false-positive guard proving
  the atomics decoder ignores `0xFE` immediates.
- `test/guest-link-symbol-prefix.test.js` — the guest-link prefix is the full
  injective hex of the pluginId; two previously-colliding ids now get distinct
  prefixes; fresh prefixes match the committed modules-branch artifacts
  byte-for-byte; and the compose path treats the guest-link metadata's
  `symbolPrefix` / `methodSymbols` as authoritative (never re-derived), keeping a
  legacy truncated-prefix artifact compatible.

## See also

- [`docs/browser-wasmedge-isomorphic.md`](./browser-wasmedge-isomorphic.md) —
  the one-artifact browser + WasmEdge loading profile.
- `.claude/skills/wasmedge-pthreads/Skills.md` — the operating rules.
- `src/compiler/pthreadArtifactGuard.js` — the flag list + wasm validator.
- `src/compiler/wasiThreadsToolchain.js` — the wasi-threads toolchain resolver.
- `src/compiler/compileModule.js` — `ModuleThreadModel`, `buildCompilerArgs`,
  `compileWithWasiThreads`, `resolveThreadModel`, `compileModuleFromSource`.
