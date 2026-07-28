# AGENTS

Apply the root and `src/AGENTS.md` files first. This directory tells module
authors how the compiler behaves.

## What Authors Should Take From This Directory

- `compileModuleFromSource(...)` and the CLI are the canonical ways to produce a
  compliant artifact.
- Manifest embedding and required exports are generated together with the wasm
  bytes.
- Shared browser/WasmEdge artifacts should land at
  `dist/isomorphic/module.wasm`.
- Every input and output accepted type set must contain canonical FlatBuffer and
  aligned-binary entries for the same SDS identity.

## Compiler Rules Authors Should Follow

- Preserve the canonical manifest accessor exports and validate them together
  with compiled wasm.
- For shared browser/WasmEdge modules, emit the standalone artifact at
  `dist/isomorphic/module.wasm`.
- Bind one signed artifact hash for both targets; do not emit a host-specific
  flow binary under the isomorphic profile.
- Optional browser adapters belong under `dist/browser/`.
- Do not make browser/WasmEdge shared artifacts depend on pthread-style `env.*`
  imports.
- Prefer repo-local Emscripten or `sdn-emception`. Do not assume Homebrew
  toolchains.
- Reject regular-only, aligned-only, identity-mismatched, or layout-incomplete
  port pairs and edges without canonical fallback.
- Treat FlatSQL and timer/cron behavior as signed WASM node dependencies. Do not
  compile a request for a host-owned database or cron implementation, and do
  not statically fold those nodes into a consuming application module.

## Key Files To Read

- `compileModule.js`
- `compileModuleFromSource.js`
- `emception*.js`
- `invokeGlue.js`

## Note

Do not edit compiler internals just to build one module. Only change this
directory when you are intentionally changing the repo-wide compile contract.
