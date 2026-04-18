# AGENTS

This repo is the source of truth for authors building compliant Space Data
modules. Use it to learn the contract, compile modules, validate artifacts,
package REC+MBL single-file artifacts, sign or encrypt delivery records, and verify
browser/WasmEdge portability.

Nearest-file wins: read this file first, then follow the most specific child
`AGENTS.md` in the directory you are editing.

## Layer Map

- Root: repo scope, task routing, global contract, required verification.
- `src/AGENTS.md`: subsystem routing inside `src/`.
- `src/manifest/AGENTS.md`: manifest schema codecs and normalization.
- `src/compliance/AGENTS.md`: compliance policy and artifact validation.
- `src/compiler/AGENTS.md`: source-to-wasm compile rules, toolchains, embedded
  manifests, and isomorphic artifact layout.
- `src/bundle/AGENTS.md`: REC+MBL single-file packaging.
- `src/auth/AGENTS.md`: signing, deployment authorization, and related record
  handling.
- `src/host/AGENTS.md`: Node host, browser shims, the legacy sync `sdn_host`
  subset, async host adapters, and isomorphic loaders.
- `src/runtime-host/AGENTS.md`: FlatSQL-backed runtime-host storage, row/region
  identity, and binary FlatBuffer ingest.
- `src/testing/AGENTS.md`: harnesses, process invoke clients, browser harness,
  and module stream pumps.
- `test/AGENTS.md`: test matrix and env-gated suites.
- `docs/AGENTS.md`: normative docs and cross-link requirements.
- `examples/AGENTS.md`: checked-in demos and runnable example expectations.

## Primary Audience

These `AGENTS.md` files are for module authors and downstream integrators, not
for ordinary SDK maintenance work. Treat the SDK internals as reference
implementation unless the task explicitly says to change the SDK standard
itself.

## Use This Repo To Build Modules

Use this repo when you need to:

- Start from a known-good module shape.
- Compile source into a compliant `.wasm` artifact.
- Validate a manifest or built artifact.
- Follow the canonical `dist/isomorphic/module.wasm` layout.
- Build one-file REC+MBL delivery artifacts.
- Use browser or WasmEdge harnesses to test the same artifact.
- Apply signing, deployment authorization, or encrypted transport helpers.
- Follow the binary FlatBuffer streaming contract.

## What Does Not Belong Here

- Ordinary module-authoring work should usually happen in your own module repo,
  using this repo’s examples, CLI, docs, and exported helpers.
- Do not edit `src/*` here just to build your own module. Prefer public APIs,
  examples, and the CLI.
- Only change SDK internals when you are explicitly changing the standard for
  all module authors.
- Flow composition, runtime orchestration, flow launch plans, or workspace
  startup belong in `sdn-flow`.
- Application behavior, scene integration, UI flows, and standards ingestion in
  OrbPro belong in `OrbPro`, even when that work consumes helpers from this
  repo.
- Individual SDN module packages and their published `dist/` outputs belong in
  module repos such as `space-data-network-plugins`.
- SDS schema source content belongs in the standards/schema repos; this repo
  consumes canonical schema names and file identifiers.

## Canonical Module Contract For Authors

Every compliant module produced here should satisfy all of the following:

- The manifest round-trips through `encodePluginManifest(...)` and
  `decodePluginManifest(...)`.
- Manifest validation passes through `validateManifestWithStandards(...)`.
- The compiled artifact passes `validatePluginArtifact(...)`.
- The module exports the canonical manifest accessor symbols.
- Declared capability IDs come from this repo's vocabulary.
- Single-file delivery appends one `REC` trailer carrying `MBL` and any
  publication metadata after the wasm payload.
- Sync guest hostcalls use the `sdn_host` import module and the bridge in
  `src/host` for sync-safe operations only.
- The raw `sdn_host` bridge remains fail-closed and sync-only.
- The generic async filesystem, network, IPFS, and protocol capability
  boundary lives in `NodeHost`, `BrowserHost`, `createRuntimeHost()`
  capability registries, and harness `callHost(...)` dispatch. Keep that
  boundary aligned across code, types, docs, and tests.

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

## Recommended Author Workflow

1. Start from the closest example under `examples/`.
2. Define a manifest that round-trips and validates.
3. Compile through `compileModuleFromSource(...)` or
   `npx space-data-module compile ...`.
4. Validate the artifact with the compliance tooling.
5. If needed, test the same artifact in browser and WasmEdge.
6. If needed, bundle, sign, or encrypt using the public helpers.

## Verification Recipes

Run these when you need confidence that your module or a deliberate SDK contract
change is correct:

- Always run:
  - `npm test`
  - `npm run check:compliance`
- If you changed manifest rules, compliance, compiler behavior, or standards
  validation:
  - `node --test test/module-sdk.test.js test/compliance.test.js`
- If you changed bundle or single-file packaging behavior:
  - `node --test test/module-bundle.test.js test/module-bundle-vectors.test.js test/module-bundle-cli.test.js test/deployment-plan.test.js test/transport-records.test.js`
  - `npm run generate:vectors` when bundle vectors change
- If you changed host capabilities, Node host behavior, browser/WasmEdge
  portability, or the sync host ABI:
  - `node --test test/node-host.test.js test/host-abi.test.js test/browser-host.test.js test/browser-module-harness.test.js test/testing-harness.test.js`
  - `node --test test/browser-harness.test.js test/isomorphic-loader.test.js`
- If you changed runtime-host storage or FlatBuffer streaming helpers:
  - `npm run test:stream-ingest`
  - `npm run test:module-stream`
  - `node --test test/flatsql-local-node.test.js`

## Practical Entry Points For Authors

- `src/manifest`: manifest schema codecs and normalization.
- `src/compliance`: module compliance and standards validation.
- `src/compiler`: source-to-wasm compile flow and target selection.
- `src/bundle`: REC trailer encoding/parsing, MBL bundle metadata, and wasm custom sections.
- `src/host`: Node host, browser shims, the legacy sync `sdn_host` subset,
  async host adapters, and isomorphic loaders.
- `src/runtime-host`: FlatSQL-backed row/region storage and stream ingest.
- `src/testing`: browser harnesses, process invoke clients, and streaming pumps.
- `src/auth`, `src/transport`, `src/deployment`: signing, encryption, and
  deployment protection metadata.
- `docs/`: normative docs for publication, streaming, testing, and isomorphism.
- `examples/`: runnable demos that define the intended UX for consumers.

If you are only building your own module, prefer reading these surfaces over
editing them.
