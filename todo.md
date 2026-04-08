# SDK Runtime Host TODO

This file is the checked-in summary of remaining work that matches the current
runtime direction.

Detailed working notes can live elsewhere, but this file should not compete
with the active architecture.

## Core Direction

- [ ] Ship the canonical dynamic runtime host from `space-data-module-sdk`
- [ ] Keep `sdn-flow` as compiler/editor/deployment tooling layered on that host
- [ ] Keep `emception` as an optional build tool, not the defining runtime model

## Runtime Host

- [ ] Add a canonical runtime-host package/export surface
- [ ] Add append-only FlatSQL row services addressed by `($SCHEMA_FILE_ID, rowId)`
- [ ] Add host-managed runtime regions addressed by `(regionId, recordIndex)`
- [ ] Add dynamic module install/load/unload/invoke
- [ ] Add browser, server, and WasmEdge host adapters over the same model
- [ ] Keep raw pointers internal-only and out of durable public contracts

## WasmEdge

- [ ] Upgrade the WasmEdge runner from single-module launch to dynamic multi-module host
- [ ] Keep Emscripten pthread compatibility intact
- [ ] Support paid-module install and runtime composition through the same host surface

## OrbPro

- [ ] Make the entity model a host-side view over FlatSQL-backed standards rows
- [ ] Preserve the existing fast shared-buffer WasmEngine path
- [ ] Route SGP4 and HPOP runtime state through host-managed aligned-binary regions
- [ ] Keep conjunction consuming generic propagator outputs only

## `sdn-flow`

- [ ] Re-scope `sdn-flow` docs and code so it clearly depends on the SDK runtime host
- [ ] Keep graph compilation, editor runtime, deployment planning, and flow packaging there
- [ ] Keep optional `emception` compile support there or re-export it cleanly from the SDK repo
- [ ] Stop describing `sdn-flow` as the owner of a separate runtime model

## Validation

- [ ] Aerospace V&V passes on the composed runtime-host path
- [ ] SOCRATES replay passes on the composed runtime-host path
- [ ] OrbPro browser runtime passes on the runtime-host path
- [ ] WasmEdge standalone harness passes on the runtime-host path
