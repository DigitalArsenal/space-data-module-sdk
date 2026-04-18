# AGENTS

Apply the root `AGENTS.md` first. This file is a map for module authors reading
the SDK source, not a prompt to edit SDK internals by default.

## Use `src/` As A Reference Map

- `src/manifest`, `src/compliance`, `src/standards`: manifest shape, type refs,
  standards validation, and compliance warnings/errors.
- `src/manifest/AGENTS.md`, `src/compliance/AGENTS.md`, `src/bundle/AGENTS.md`,
  and `src/auth/AGENTS.md` provide narrower rules for those owners.
- `src/compiler`: compile flow, manifest embedding, runtime targets, toolchains,
  and artifact layout.
- `src/bundle`: REC+MBL single-file packaging, wasm section handling, and vector compatibility.
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

## Author Rules

- Prefer public APIs and examples over editing `src/*`.
- Read the nearest child `AGENTS.md` to understand which source files define the
  contract you are using.
- Only edit internals here when the task explicitly says to change the SDK
  standard for everyone.
