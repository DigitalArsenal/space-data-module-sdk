# Runtime Wrapper Audit

Use this skill when reviewing runtime-target claims, wrapper boundaries, or
cross-runtime hosting guidance.

## Rules

- Keep the guest contract stable across runtimes.
- A direct host can load or interoperate with the guest contract without an
  alternate guest artifact.
- A wrapper is only justified when the runtime cannot host or interoperate with
  the guest contract directly.
- Browser support is a compatibility wrapper over native browser WebAssembly,
  not literal WasmEdge.
- Do not create wrapper stories to hide missing runtime verification.
- Do not create a Go wrapper.

## Review Questions

1. Is this runtime truly direct-host, or is there an adapter/wrapper layer?
2. If it is a wrapper, is the wrapped guest contract still the same artifact?
3. Are compile metadata and docs honest about toolchain, flags, and runtime
   support?
4. Is any “standalone direct” claim backed by a real runtime invocation?
5. If a release task is part of the work, remember that this repo publishes to
   npm through OIDC trusted publishing. Do not use `npm whoami` as a hard stop.
