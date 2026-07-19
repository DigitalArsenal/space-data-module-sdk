# WasmEdge Pthreads

Use this skill when touching module compilation for `runtimeTargets: ["wasmedge"]`.

## Rules

- `space-data-module-sdk` is the source of truth for module compile semantics.
- Prefer explicit `threadModel` handling over hidden toolchain heuristics.
- Default `wasmedge` targets to `emscripten-pthreads` unless the caller
  explicitly overrides the thread model.
- Route pthread builds through a real system Emscripten toolchain.
- **Final pthreads artifacts are enforced AND validated.** The pthreads final
  link is non-bypassable: it always carries
  `-pthread -matomics -mbulk-memory -s STANDALONE_WASM=1 -s IMPORTED_MEMORY=1 -s ALLOW_MEMORY_GROWTH=1`
  (assembled once in `src/compiler/pthreadArtifactGuard.js` /
  `buildCompilerArgs`). Do NOT add `-mthreads` — it is invalid for the
  `wasm32-unknown-emscripten` target and breaks the compile; `-pthread` already
  selects the threads model.
- **Validate the emitted wasm, not just the flags.** After emit, the SDK parses
  the `.wasm` and asserts it declares a shared memory (limits shared flag
  `0x02`, imported or declared) AND uses atomics (real code-section instruction
  decode — never a `0xFE` byte scan; `target_features` is stripped at `-O3`). A
  module that claims pthreads but emits a non-shared-memory wasm MUST fail the
  compile, not ship. Use `assertPthreadArtifact` / `analyzeWasmThreadFeatures`.
- **Do not claim WasmEdge thread support until a real runtime invocation spawns
  threads and runs.** Compile-time shared-memory/atomics validation is necessary
  but not sufficient. A validated artifact that only compiles — and does not
  actually spawn and run guest threads under the target WasmEdge build — is NOT
  proof of thread support. Runtime thread-spawn verification is owned by the
  deploy/benchmark node, not this SDK.
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
