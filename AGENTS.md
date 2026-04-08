# AGENTS

This is the canonical Space Data module repository. Use it to define and verify
module contracts, manifest encoding, compiled artifact layout, host ABI
surfaces, `sds.bundle`, signing records, encrypted transport envelopes, and the
portable browser/WasmEdge loading story.

Nearest-file wins: read this file first, then follow the most specific child
`AGENTS.md` in the directory you are editing.

## Layer Map

- Root: repo scope, task routing, global contract, required verification.
- `src/AGENTS.md`: subsystem routing inside `src/`.
- `src/manifest/AGENTS.md`: manifest schema codecs and normalization.
- `src/compliance/AGENTS.md`: compliance policy and artifact validation.
- `src/compiler/AGENTS.md`: source-to-wasm compile rules, toolchains, embedded
  manifests, and isomorphic artifact layout.
- `src/bundle/AGENTS.md`: `sds.bundle` and single-file wasm packaging.
- `src/auth/AGENTS.md`: signing, deployment authorization, and related record
  handling.
- `src/host/AGENTS.md`: Node host, browser shims, WasmEdge, `sdn_host`, and
  isomorphic loaders.
- `src/runtime-host/AGENTS.md`: FlatSQL-backed runtime-host storage, row/region
  identity, and binary FlatBuffer ingest.
- `src/testing/AGENTS.md`: harnesses, process invoke clients, browser harness,
  and module stream pumps.
- `test/AGENTS.md`: test matrix and env-gated suites.
- `docs/AGENTS.md`: normative docs and cross-link requirements.
- `examples/AGENTS.md`: checked-in demos and runnable example expectations.

## What Belongs Here

Change this repo when the task involves:

- `PluginManifest.fbs`, manifest encoding/normalization, or standards-aware
  validation.
- Canonical module exports such as
  `plugin_get_manifest_flatbuffer`,
  `plugin_get_manifest_flatbuffer_size`,
  `plugin_invoke_stream`,
  and `_start`.
- Compiler behavior, embedded manifest generation, runtime target inference, or
  portable artifact layout.
- `sds.bundle` encoding, parsing, or vector generation.
- Module signing records, encrypted delivery envelopes, deployment metadata, or
  transport protection helpers.
- Host capabilities, the `sdn_host` sync import ABI, Node reference host
  behavior, browser harnesses, WasmEdge launch behavior inside the SDK, or
  isomorphic browser/WasmEdge artifact loading.
- Runtime-host row/region storage and binary FlatBuffer streaming standards.

## What Does Not Belong Here

- Flow composition, runtime orchestration, flow launch plans, or workspace
  startup belong in `sdn-flow`.
- Application behavior, scene integration, UI flows, and standards ingestion in
  OrbPro belong in `OrbPro`, even when that work consumes helpers from this
  repo.
- Individual SDN module packages and their published `dist/` outputs belong in
  module repos such as `space-data-network-plugins`.
- SDS schema source content belongs in the standards/schema repos; this repo
  consumes canonical schema names and file identifiers.

## Canonical Module Contract

Every compliant module produced here should satisfy all of the following:

- The manifest round-trips through `encodePluginManifest(...)` and
  `decodePluginManifest(...)`.
- Manifest validation passes through `validateManifestWithStandards(...)`.
- The compiled artifact passes `validatePluginArtifact(...)`.
- The module exports the canonical manifest accessor symbols.
- Declared capability IDs come from this repo's vocabulary.
- Single-file delivery uses `sds.bundle`; do not append raw bytes after wasm.
- Sync hostcalls use the `sdn_host` import module and the bridge in `src/host`.

## Canonical Build And Publication Rules

- Start from `examples/basic-propagator/manifest.json` and
  `examples/basic-propagator/module.c` unless a closer example exists.
- Keep manifest methods aligned with runtime export names and `methodId`.
- Use canonical SDS `schemaName` and `fileIdentifier` pairs for ports and type
  refs. Do not invent repo-local aliases.
- Compile through `compileModuleFromSource(...)` or
  `npx space-data-module compile ...` so manifest embedding and validation happen
  together with wasm generation.
- For shared browser/WasmEdge builds, the canonical compiled artifact is
  `dist/isomorphic/module.wasm`. Optional browser adapters belong under
  `dist/browser/`.
- Prefer repo-local toolchains. Use a local `emsdk` or `sdn-emception`; do not
  hardcode or assume Homebrew-managed Emscripten paths.
- If signing or transport protection is required, create deployment metadata and
  wrap payloads through `src/auth` and `src/transport`.

## Streaming FlatBuffers

- The canonical streaming path is binary. Do not introduce JSON or base64 into
  the FlatBuffer ingest path.
- Use size-prefixed FlatBuffer frames for stream transport.
- Use host-owned ingest via `src/runtime-host` when the host owns durable
  storage.
- Use resident-module streaming via `src/testing/moduleFlatbufferStreamPump.js`
  when a module owns the state machine or embeds FlatSQL internally.
- Do not benchmark 1 GiB by constructing one giant invoke envelope. Benchmark
  chunked stream ingest instead.

## Required Verification

Run these before calling work complete:

- Always run:
  - `npm test`
  - `npm run check:compliance`
- If you changed manifest rules, compliance, compiler behavior, or standards
  validation:
  - `node --test test/module-sdk.test.js test/compliance.test.js`
- If you changed bundle or single-file packaging behavior:
  - `node --test test/module-bundle.test.js test/module-bundle-vectors.test.js test/module-bundle-cli.test.js test/module-bundle-go.test.js test/module-bundle-python.test.js`
  - `npm run generate:vectors` when bundle vectors change
- If you changed host capabilities, Node host behavior, browser/WasmEdge
  portability, or the sync host ABI:
  - `node --test test/node-host.test.js test/host-abi.test.js`
  - `node --test test/browser-harness.test.js test/isomorphic-loader.test.js`
- If you changed runtime-host storage or FlatBuffer streaming helpers:
  - `npm run test:stream-ingest`
  - `npm run test:module-stream`
  - `node --test test/flatsql-local-node.test.js`

## Practical Entry Points

- `src/manifest`: manifest schema codecs and normalization.
- `src/compliance`: module compliance and standards validation.
- `src/compiler`: source-to-wasm compile flow and target selection.
- `src/bundle`: `sds.bundle` encoding, parsing, and wasm custom sections.
- `src/host`: Node host, browser shims, `sdn_host`, and isomorphic loaders.
- `src/runtime-host`: FlatSQL-backed row/region storage and stream ingest.
- `src/testing`: browser harnesses, process invoke clients, and streaming pumps.
- `src/auth`, `src/transport`, `src/deployment`: signing, encryption, and
  deployment protection metadata.
- `docs/`: normative docs for publication, streaming, testing, and isomorphism.
- `examples/`: runnable demos that define the intended UX for consumers.
