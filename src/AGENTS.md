# AGENTS

Apply the root `AGENTS.md` first. This file routes source edits to the correct
subsystem.

## Source Routing

- `src/manifest`, `src/compliance`, `src/standards`: manifest shape, type refs,
  standards validation, and compliance warnings/errors.
- `src/manifest/AGENTS.md`, `src/compliance/AGENTS.md`, `src/bundle/AGENTS.md`,
  and `src/auth/AGENTS.md` provide narrower rules for those owners.
- `src/compiler`: compile flow, manifest embedding, runtime targets, toolchains,
  and artifact layout.
- `src/bundle`: `sds.bundle`, wasm custom sections, and vector compatibility.
- `src/host`: Node host, browser shims, `sdn_host`, WasmEdge runners, and
  isomorphic loaders.
- `src/runtime-host`: FlatSQL-backed runtime host, row/region identity, and
  binary stream ingest.
- `src/testing`: harnesses, browser module loading, process invoke clients, and
  module-owned FlatBuffer stream pumps.
- `src/auth`, `src/transport`, `src/deployment`: signing, encryption, REC/PNM/
  ENC records, deployment plans, and publication protection.
- `src/generated`: generated code. Do not hand-edit unless regeneration is part
  of the task and you update the generation path or fixtures as needed.

## Working Rules

- Keep module contracts portable unless the task is explicitly runtime-specific.
- Prefer changes in the smallest subsystem that owns the behavior.
- If a change crosses compiler, host, and docs, update each owner explicitly
  rather than hiding policy in one layer.
- Add or update tests near the owning subsystem and then wire them into the
  repo-level verification set in `test/AGENTS.md`.
