# space-data-module-sdk

Canonical shared module SDK for OrbPro and the Space Data Network.

This repo is the consolidation point for the pieces that are supposed to be the same thing across both systems:

- canonical embedded module manifest ABI
- standards-aware manifest validation against `spacedatastandards.org`
- wasm ABI compliance checks
- source-to-wasm compile harnesses
- deployment signature and transport encryption helpers
- a browser lab that can compile source or verify uploaded wasm modules

## Workspace Layout

- `packages/module-sdk`
  Shared contracts, manifest codec, compliance checks, standards integration, compiler harness, and signature/encryption helpers.
- `apps/module-lab`
  Browser-facing verification lab for compile, compliance, and packaging workflows.

## Quick Start

```bash
npm install
npm test
npm run start:lab
```

The lab serves on `http://localhost:4318` by default.

## CLI

```bash
npx space-data-module check --manifest ./manifest.json --wasm ./dist/module.wasm
npx space-data-module compile --manifest ./manifest.json --source ./src/module.c --out ./dist/module.wasm
npx space-data-module protect --manifest ./manifest.json --wasm ./dist/module.wasm --json
```

## Current Boundary

The first commit extracts the canonical manifest/types from the current OrbPro plugin SDK and the compliance plus crypto helpers from `sdn-flow`, then layers a single SDK and lab on top.

This is intentionally the canonical shared surface, not another compatibility package.

One current limitation is explicit: the embedded FlatBuffer manifest schema is still narrower than the richer JSON compliance surface. In particular, `externalInterfaces` and some coarse capability IDs are validated in JSON today but are not yet fully representable in the embedded binary manifest. The SDK reports when those fields are omitted during embedding so the remaining schema work stays visible.
