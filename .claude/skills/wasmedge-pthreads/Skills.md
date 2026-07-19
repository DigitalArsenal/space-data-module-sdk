# WasmEdge Pthreads

Use this skill when touching module compilation for `runtimeTargets: ["wasmedge"]`.

## Rules

- `space-data-module-sdk` is the source of truth for module compile semantics.
- Prefer explicit `threadModel` handling over hidden toolchain heuristics.
- Default `wasmedge` targets to `emscripten-pthreads` unless the caller
  explicitly overrides the thread model.
- **Route pthread builds through the wasi-threads toolchain, NOT Emscripten.**
  Emscripten `-pthread` (even with `-s STANDALONE_WASM=1`) emits a browser-only
  Web-Worker build (`env.__pthread_create_js` + `env._emscripten_*`
  mailbox/postMessage imports, no wasi thread-spawn) that CANNOT thread under
  WasmEdge. The pthreads model compiles with
  `clang --target=wasm32-wasip1-threads -pthread` (see
  `src/compiler/wasiThreadsToolchain.js`).
- **Final pthreads artifacts are enforced AND validated.** The pthreads final
  link is non-bypassable: it always carries the wasi-threads flags
  `-pthread -matomics -mbulk-memory -Wl,--import-memory -Wl,--shared-memory -Wl,--max-memory=…`
  (assembled once as `PTHREAD_FINAL_LINK_FLAGS` in
  `src/compiler/pthreadArtifactGuard.js` / `buildCompilerArgs`). NO Emscripten
  `-s` settings; NEVER `-mthreads` (invalid for the wasm target). Objects are
  compiled `-fno-exceptions` (the wasi-threads libc++ is built without
  exceptions).
- **Validate the emitted wasm, not just the flags.** After emit, the SDK parses
  the `.wasm` and REJECTS the compile unless it: declares a shared memory (limits
  shared flag `0x02`) AND uses atomics (real code-section instruction decode —
  never a `0xFE` byte scan) AND imports `wasi.thread-spawn` AND exports
  `wasi_thread_start` AND imports NONE of Emscripten's browser worker hooks.
  Shared memory + atomics ALONE are necessary-but-insufficient (a browser-only
  Emscripten build has both). Use `assertPthreadArtifact` /
  `analyzeWasmThreadFeatures`.
- **Do not claim WasmEdge thread support until a real runtime invocation spawns
  threads and runs.** Compile-time validation (wasi-threads contract + shared
  memory + atomics) is necessary but not sufficient. A validated artifact that
  only compiles — and does not actually spawn and run guest threads under the
  target WasmEdge build — is NOT proof of thread support. Runtime thread-spawn
  verification is owned by the deploy/benchmark node, not this SDK.
- Do not substitute Cesium `TaskProcessor`, ad hoc JS worker pools, or host-side
  worker orchestration for guest pthread support.

## Checklist

1. Confirm whether `threadModel` is explicit or inferred from `runtimeTargets`.
2. Verify the selected toolchain matches the thread model.
3. Preserve `threadModel` in `CompilationResult`, guest-link metadata, and any
   protected/bundled artifact output.
4. Confirm the emitted pthreads `.wasm` passes `assertPthreadArtifact`
   (shared memory + atomics). If it does not, the compile MUST fail — never
   downgrade the assertion to a warning or skip it.
5. Never re-introduce `-mthreads`; keep the enforced flag list in
   `PTHREAD_FINAL_LINK_FLAGS` intact and let `assertPthreadFlagsPresent` guard it.
6. Run focused compile tests plus repo-wide verification before publishing,
   including `test/pthreads-artifact-guardrail.test.js`.
7. For npm release work in this repo, do not treat `npm whoami` as the publish
   gate. Trusted publishing uses OIDC here, so tagging/publishing may still work
   without an interactive npm login.
8. GitHub Actions must install a real emsdk toolchain before running `npm test`
   for WasmEdge pthread coverage. The stock runner environment is not enough.
9. Record any WasmEdge runtime limitation honestly if the artifact only compiles
   but does not instantiate.

## See also

- Canonical rules: [`docs/isomorphic-pthreads.md`](../../../docs/isomorphic-pthreads.md)
- One-artifact loading profile:
  [`docs/browser-wasmedge-isomorphic.md`](../../../docs/browser-wasmedge-isomorphic.md)
