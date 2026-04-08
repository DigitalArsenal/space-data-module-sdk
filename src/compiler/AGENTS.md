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

## Compiler Rules Authors Should Follow

- Preserve the canonical manifest accessor exports and validate them together
  with compiled wasm.
- For shared browser/WasmEdge modules, emit the standalone artifact at
  `dist/isomorphic/module.wasm`.
- Optional browser adapters belong under `dist/browser/`.
- Do not make browser/WasmEdge shared artifacts depend on pthread-style `env.*`
  imports.
- Prefer repo-local Emscripten or `sdn-emception`. Do not assume Homebrew
  toolchains.

## Key Files To Read

- `compileModule.js`
- `compileModuleFromSource.js`
- `emception*.js`
- `invokeGlue.js`

## Note

Do not edit compiler internals just to build one module. Only change this
directory when you are intentionally changing the repo-wide compile contract.
