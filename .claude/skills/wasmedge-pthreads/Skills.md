# WasmEdge Pthreads

Use this skill when touching module compilation for `runtimeTargets: ["wasmedge"]`.

## Rules

- `space-data-module-sdk` is the source of truth for module compile semantics.
- Prefer explicit `threadModel` handling over hidden toolchain heuristics.
- Default `wasmedge` targets to `emscripten-pthreads` unless the caller
  explicitly overrides the thread model.
- Route pthread builds through a real system Emscripten toolchain.
- Do not claim pthread-capable WasmEdge support unless a real runtime invocation
  succeeds.
- Do not substitute Cesium `TaskProcessor`, ad hoc JS worker pools, or host-side
  worker orchestration for guest pthread support.

## Checklist

1. Confirm whether `threadModel` is explicit or inferred from `runtimeTargets`.
2. Verify the selected toolchain matches the thread model.
3. Preserve `threadModel` in `CompilationResult`, guest-link metadata, and any
   protected/bundled artifact output.
4. Run focused compile tests plus repo-wide verification before publishing.
5. For npm release work in this repo, do not treat `npm whoami` as the publish
   gate. Trusted publishing uses OIDC here, so tagging/publishing may still work
   without an interactive npm login.
6. GitHub Actions must install a real emsdk toolchain before running `npm test`
   for WasmEdge pthread coverage. The stock runner environment is not enough.
7. Record any WasmEdge runtime limitation honestly if the artifact only compiles
   but does not instantiate.
