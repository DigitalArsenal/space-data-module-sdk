# AGENTS

You are working in the canonical module repository. Use this repo to author or
change compliant Space Data modules, module manifests, module ABI exports,
single-file bundles, capability IDs, signing records, and transport envelopes.

## What To Build Here

Build or change module-level artifacts here when the task involves:

- `PluginManifest.fbs` or manifest encoding/normalization
- required module exports such as:
  - `plugin_get_manifest_flatbuffer`
  - `plugin_get_manifest_flatbuffer_size`
- standards-aware manifest or artifact compliance
- the `sds.bundle` single-file module format
- module signing or encrypted transport envelopes
- module host capabilities or the `sdn_host` import ABI

If the task is flow composition, runtime planning, workspace startup, or host
launch behavior, make that change in `sdn-flow` and keep this repo as the
source of truth for module rules.

## How To Create A Compliant Module

1. Start from the shape in `examples/basic-propagator/manifest.json` and
   `examples/basic-propagator/module.c`.
2. Give the module a stable `pluginId`, semantic `version`, `pluginFamily`,
   and an explicit list of required `capabilities`.
3. Define every callable method in the manifest and keep the runtime export
   names aligned with `methodId`.
4. Define typed ports with standards-aware `schemaName` and `fileIdentifier`
   pairs. Use the canonical SDS schema names; do not invent repo-local type
   aliases.
5. Compile the module through `compileModuleFromSource(...)` or
   `npx space-data-module compile ...` so the embedded manifest exports are
   generated and validated together with the wasm bytes.
6. If the artifact must ship as one file, publish it as a normal `.wasm` file
   with the `sds.bundle` custom section. Do not append raw bytes after the end
   of the wasm binary.
7. If the module needs signing or transport protection, create a deployment
   authorization and then wrap the payload with the transport helpers from
   `src/auth` and `src/transport`.

## Required Contract

Every compliant module produced here should satisfy all of the following:

- the manifest encodes and decodes through `encodePluginManifest(...)` and
  `decodePluginManifest(...)`
- manifest validation succeeds through `validateManifestWithStandards(...)`
- the compiled artifact passes `validatePluginArtifact(...)`
- the module exports the canonical manifest accessor symbols
- declared capability IDs come from the vocabulary in this repo
- single-file delivery uses `sds.bundle`
- sync hostcalls use the `sdn_host` import module and the bridge in `src/host`

## Integration Checks

Run these before you call the work complete:

- Always run:
  - `npm test`
  - `npm run check:compliance`
- If you changed manifest rules, compliance, standards, or compiler behavior:
  - `node --test test/module-sdk.test.js test/compliance.test.js`
- If you changed bundle or single-file packaging behavior:
  - `node --test test/module-bundle.test.js test/module-bundle-vectors.test.js test/module-bundle-cli.test.js test/module-bundle-go.test.js test/module-bundle-python.test.js`
  - `npm run generate:vectors` when the bundle contract or vector fixtures change
- If you changed host capabilities, the Node reference host, or the sync host
  ABI:
  - `node --test test/node-host.test.js test/host-abi.test.js`

## Practical Entry Points

- `src/manifest`: manifest schema codecs and normalization
- `src/compliance`: module compliance and standards validation
- `src/compiler`: source-to-wasm compile and protect flow
- `src/bundle`: `sds.bundle` encoding, parsing, and wasm custom-section helpers
- `src/host`: reference Node host and sync hostcall bridge
- `examples/single-file-bundle`: reference bundle demos and conformance vectors
