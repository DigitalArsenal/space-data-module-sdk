# OrbPro Aligned-Binary + WASM Integration Plan

## Goal

Make the current `space-data-module-sdk` release interoperable with `../OrbPro`
for aligned-binary FlatBuffer payloads and the OrbPro wasm backend, especially
for the SGP4 and HPOP propagator paths.

## Current Assessment

### This repo is already ahead on the aligned-binary ABI

The canonical SDK already carries the aligned-binary metadata that OrbPro needs:

- `src/generated/orbpro/stream/flat-buffer-type-ref.js`
  - includes `wireFormat`
  - includes `rootTypeName`
  - includes `fixedStringLength`
  - includes `byteLength`
  - includes `requiredAlignment`
- `src/compiler/invokeGlue.js`
  - preserves typed output metadata through `plugin_push_output_typed(...)`
  - preserves `byte_length` instead of collapsing to payload size
- `src/compliance/pluginCompliance.js`
  - validates aligned-binary constraints such as `rootTypeName` and
    `requiredAlignment`

### OrbPro is the main compatibility gap

OrbPro is not consuming this package directly for the SGP4/HPOP path. It has
its own internal SDK at `../OrbPro/packages/plugin-sdk`, and that internal SDK
is behind the canonical aligned-binary model:

- `../OrbPro/packages/plugin-sdk/src/generated/orbpro/stream/flat-buffer-type-ref.js`
  - still only models `schemaName`, `fileIdentifier`, `schemaHash`, and
    `acceptsAnyFlatbuffer`
- `../OrbPro/packages/plugin-sdk/src/runtime/streamBridge.js`
  - `normalizeTypeRef()` rebuilds type refs without aligned-binary metadata
- `../OrbPro/packages/plugin-sdk/schemas/PluginManifest.fbs`
  - is also behind the canonical schema in this repo
- `../OrbPro/packages/orbpro-plugins/sgp4/index.js`
  - already expects aligned binary input bytes and a wasm memory-backed module
- `../OrbPro/packages/engine/Source/DataSources/PropagatedPositionProperty.js`
  - already has shared-buffer wasm-engine integration

## Decision

The mandatory work is in `../OrbPro`.

No additional SDK change in this repo is required to support the aligned-binary
ABI itself. Optional follow-up here is only needed if OrbPro should reuse this
repo's emception runtime/session implementation directly.

## Phase 1: Sync OrbPro's Internal SDK With The Canonical ABI

Repo: `../OrbPro`

### Files to update

- `packages/plugin-sdk/schemas/PluginManifest.fbs`
- `packages/plugin-sdk/schemas/TypedArenaBuffer.fbs`
- `packages/plugin-sdk/src/generated/orbpro/stream/*`
- `packages/plugin-sdk/src/generated/orbpro/manifest*`
- `packages/plugin-sdk/src/runtime/streamBridge.js`
- any schema/codegen scripts that rebuild generated FlatBuffer bindings

### Required changes

1. Copy the canonical stream/type schema shape from this repo into OrbPro's
   internal SDK.
2. Ensure OrbPro's `FlatBufferTypeRef` includes:
   - `wireFormat`
   - `rootTypeName`
   - `fixedStringLength`
   - `byteLength`
   - `requiredAlignment`
3. Bring OrbPro's manifest schema up to the same contract level where needed,
   especially `invoke_surfaces` and the broader capability vocabulary.
4. Regenerate OrbPro's JS/TS FlatBuffer bindings after the schema update.

### Why this is first

Until OrbPro's internal SDK can represent aligned-binary type metadata, the
SGP4/HPOP code can only say "aligned" informally while the actual type refs are
still flattened back to generic FlatBuffer metadata.

## Phase 2: Preserve Aligned Metadata Through OrbPro's Runtime Bridge

Repo: `../OrbPro`

### Primary file

- `packages/plugin-sdk/src/runtime/streamBridge.js`

### Required changes

1. Expand `normalizeTypeRef()` to preserve every aligned-binary field instead of
   reconstructing only the older 4-field shape.
2. Ensure staged input frames carry the intended `typeRef.byteLength` and
   `typeRef.requiredAlignment`.
3. Ensure decoded output frames return the aligned metadata unchanged to plugin
   callers.
4. Add regression tests that prove:
   - aligned input metadata survives request encoding
   - aligned output metadata survives response decoding
   - `byteLength` is preserved independently from payload byte count

### Expected result

OrbPro's dependency stream bridge will stop silently degrading aligned-binary
frames back into generic FlatBuffer frames.

## Phase 3: Tighten SGP4 And HPOP Manifest Declarations

Repo: `../OrbPro`

### Files to update

- `packages/orbpro-plugins/sgp4/manifest.js`
- `packages/orbpro-plugins/hpop/manifest.js`

### Required changes

1. Replace vague "any aligned FlatBuffer" declarations with concrete aligned
   type refs where the payload contract is known.
2. For aligned payloads, populate:
   - `wireFormat: "aligned-binary"`
   - `rootTypeName`
   - `fixedStringLength`
   - `byteLength` when fixed-size payloads require it
   - `requiredAlignment`
3. Keep generic `acceptsAnyFlatbuffer` only where the plugin truly accepts
   arbitrary regular FlatBuffer payloads.
4. Populate `schemas_used` and `invoke_surfaces` after the internal SDK schema
   sync lands.

### Why this matters

The SGP4/HPOP plugins currently describe aligned inputs in prose, but their
actual `FlatBufferTypeRefT` instances still use the older schema shape. The
manifest should become machine-verifiable, not just descriptive.

## Phase 4: Verify The OrbPro WASM Backend Path End-To-End

Repo: `../OrbPro`

### Files to verify

- `packages/orbpro-plugins/sgp4/index.js`
- `packages/orbpro-plugins/hpop/index.js`
- `packages/engine/Source/DataSources/PropagatedPositionProperty.js`
- `packages/wasm-engine/index.mjs`

### Required checks

1. Confirm `streamInvoke` still accepts aligned binary frames without any JSON
   fallback path.
2. Confirm the dependency bridge uses the actual dependency wasm memory and
   does not strip aligned metadata while staging inputs.
3. Confirm SGP4 shared-buffer mode still works when the engine reads from the
   wasm-engine heap directly.
4. Confirm HPOP uses the same aligned-binary/runtime path and does not drift
   from SGP4.
5. Confirm string-length assumptions remain compatible with the fixed-size
   aligned format currently used by the SGP4 pipeline.

### Test cases to add in OrbPro

1. A stream round-trip where the same IDL schema can produce both:
   - regular FlatBuffer payloads
   - aligned-binary payloads
2. A regression proving both forms produce the same `fb->json` result when
   strings are under the fixed-length limit.
3. A wasm-backend test proving `PropagatedPositionProperty` can consume the
   aligned-binary output path without copying back into ad hoc JS objects.

## Phase 5: Optional SDK Follow-Ups In This Repo

Repo: `space-data-module-sdk`

These are optional and are not blockers for OrbPro alignment support.

### Optional work

1. Export a public emception runtime/session API from this repo so OrbPro can
   reuse the real Node emception implementation instead of carrying a parallel
   adapter.
2. Add a public compiler-facing adapter surface around
   `src/compiler/emceptionNode.js`.
3. If OrbPro later consumes compiled artifacts from this SDK directly, keep
   pushing embedded manifest fidelity so fields like `runtimeTargets` and
   `externalInterfaces` remain preserved in artifact metadata.

## Recommended Execution Order

1. Update OrbPro `packages/plugin-sdk` schemas and regenerate code.
2. Fix OrbPro `streamBridge.js` to preserve aligned metadata.
3. Tighten SGP4 and HPOP manifests to declare real aligned type refs.
4. Run OrbPro wasm-backend integration tests for SGP4/HPOP shared-memory mode.
5. Only then decide whether OrbPro should reuse the emception implementation
   from this repo.

## Acceptance Criteria

The integration is complete when all of the following are true:

1. OrbPro's internal `FlatBufferTypeRef` model matches the aligned-binary shape
   already used in this repo.
2. OrbPro `streamInvoke` request/response bridges preserve aligned metadata,
   including `byteLength`.
3. SGP4 and HPOP manifests declare aligned-binary payloads explicitly rather
   than only describing them in strings.
4. The OrbPro wasm backend consumes aligned-binary outputs without schema or
   buffer-layout drift.
5. The same logical schema can be emitted as regular FlatBuffer or
   aligned-binary payloads and both decode to equivalent JSON under the fixed
   string-size assumptions.
