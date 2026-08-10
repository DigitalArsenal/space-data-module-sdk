# __MODULE_NAME__

Scaffolded by `space-data-module init --family propagator --name __MODULE_NAME__`
from space-data-module-sdk's `templates/propagator-module/` template.

This is a **minimal but building** skeleton of an SDN propagator module: every
ABI obligation is already implemented — exports, wire layout, units, frames,
identity, threading discipline, error codes, lifetime — and the orbital
mechanics are a placeholder. It compiles and passes the SDK's own compliance
checks as-is; it just doesn't propagate anything real yet.

## Files

- `plugin-manifest.json` — the module manifest. `pluginId` defaults to
  `com.orbpro.<name-with-dots>`; `pluginFamily` is `propagator`; declares one
  invoke method (`ingest_omm`) plus the propagator ABI exports below.
- `src/__MODULE_NAME_SNAKE__.cpp` — the module source. Search for
  `TODO: your propagation goes here` — there are two spots (element adoption
  in `adopt_omm()`, and the actual propagation in `propagate_entity()`).
  Everything else in the file is ABI plumbing; you should not need to touch
  export names, signatures, error codes, or the state-vector write pattern.
- `build.js` — compiles through `compileModuleFromSource` (the SDK compiler
  lane). Inlines the generated `orbpro_propagator_abi.h` from your pinned
  `space-data-module-sdk` dependency — never hand-copy that header.
- `tests/module.build.test.mjs` — manifest shape check (always runs) plus
  compliance/export checks that skip until you've built the module.
- `package.json` — `"sdn-module"` points at the canonical isomorphic
  artifact; `space-data-module-sdk` is a normal npm dependency.

## Naming

This module was scaffolded with `--name __MODULE_NAME__`. `space-data-module
init` substituted four spellings of that name into this tree; if you need to
introduce your own file or identifier later, reuse the same shapes rather
than inventing a fifth:

| Spelling             | This module's value | Used for                                  |
| --------------------- | -------------------- | ------------------------------------------ |
| kebab-case             | `__MODULE_NAME__`       | display text, kebab-case filenames          |
| reverse-DNS plugin id  | `__PLUGIN_ID__`         | `plugin-manifest.json`'s `pluginId`         |
| snake_case              | `__MODULE_NAME_SNAKE__` | C/C++ file and symbol names                 |
| camelCase                | `__MODULE_NAME_CAMEL__` | a JS-safe identifier (e.g. a bindings key) |

## Next steps

1. `npm install` (pulls `space-data-module-sdk` and its `spacedatastandards.org`
   dependency).
2. Fill in the physics: replace the two `TODO: your propagation goes here`
   blocks in `src/__MODULE_NAME_SNAKE__.cpp`. Keep every export, error code,
   and the "zero the struct, set frame explicitly, set VALID last" write
   pattern — those are the ABI contract, not style.
3. `npm run build` — writes `dist/isomorphic/module.wasm` +
   `dist/plugin-manifest.json`. The build fails loudly if the compiled
   artifact does not pass the SDK's own manifest/artifact validation.
4. `npm test` — the manifest-shape test always runs; the compliance and
   export-surface tests turn on once step 3 has produced a wasm artifact.
5. Replace the TODO test at the bottom of `tests/module.build.test.mjs` with
   a real assertion once you have physics to check (ingest a known OMM,
   propagate to a known epoch, compare against an independent reference —
   e.g. another propagator or published ephemeris).
6. Update `description` in `plugin-manifest.json` and `package.json` — both
   still say "TODO" / a generic scaffold description.

## The ABI, in one paragraph

A propagator module exports `plugin_init`, `plugin_init_omm`,
`plugin_ingest_omm_one`, `plugin_propagate`, `plugin_propagate_batch`,
`plugin_entity_count`, and `plugin_destroy` against the generated
`OrbProStateVector` / `OrbProOMMRecord` / `OrbProOrbitalElements` structs
(`orbpro/orbpro_propagator_abi.h` in your pinned `space-data-module-sdk`,
generated from `schemas/orbpro/Propagator.fbs` — never hand-retype these
structs, that is the exact drift this generated header exists to end).
Position/velocity output is always METERS / METERS-PER-SECOND with an
explicit `reference_frame`; identity is carried by `NORAD_CAT_ID`, never
derived from array position; every failure returns a named negative code;
`plugin_destroy` must actually free, not no-op.

**Threading.** This module declares `threadModel: "wasi-sequential"` — it
never spawns a thread of its own, which is the *strong default* for a
propagator: propagation is embarrassingly parallel across entities but
sequential within one, and the ABI puts the sharding decision on the HOST
(e.g. a frame-worker pool), not the module. `build.js` passes
`threadModel: manifest.threadModel` to the compiler EXPLICITLY — do not
remove that. `resolveThreadModel` reads the compile option, not
`manifest.threadModel`, and otherwise infers the model from
`runtimeTargets`, where `"wasmedge"` infers the OTHER model
(`emscripten-pthreads`, which in this SDK means the clang
`wasm32-wasip1-threads` / wasi-threads contract — never `emcc -pthread`,
which cannot thread under WasmEdge at all). Passing `threadModel` in
`build.js` sidesteps that inference and is what keeps this manifest's
declared model and the compiled artifact in agreement — `build.js` also
asserts they agree after compiling. See `docs/propagator-abi.md`
"Threading" if you ever need the other model.

The one SDN invoke method, `ingest_omm`, is separate from the propagator ABI
exports above: it is how a flow graph feeds this module SDS `$OMM` records
over the generic invoke surface, while `plugin_propagate` /
`plugin_propagate_batch` are called directly by a host that has already
linked this module as a propagator.
