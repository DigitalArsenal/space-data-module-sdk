# AGENTS

Apply the root and `src/AGENTS.md` files first.

## Area Ownership

This directory owns source-to-wasm compile behavior, manifest embedding, runtime
target inference, toolchain integration, and canonical artifact layout.

## Compiler Rules

- Preserve the canonical manifest accessor exports and validate them together
  with compiled wasm.
- For shared browser/WasmEdge modules, emit the standalone artifact at
  `dist/isomorphic/module.wasm`.
- Optional browser adapters belong under `dist/browser/`.
- Do not make browser/WasmEdge shared artifacts depend on pthread-style `env.*`
  imports.
- Prefer repo-local Emscripten or `sdn-emception`. Do not assume Homebrew
  toolchains.
- If you change runtime-target inference, keep the browser/WasmEdge shared path
  on the standalone profile unless the docs and tests are updated deliberately.

## Key Files

- `compileModule.js`
- `compileModuleFromSource.js`
- `emception*.js`
- `invokeGlue.js`

## Verification

- `node --test test/module-sdk.test.js test/compliance.test.js`
- `node --test test/browser-harness.test.js test/isomorphic-loader.test.js`
- `node --test test/compiler-emception-subpath-export.test.js`
