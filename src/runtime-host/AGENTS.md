# AGENTS

Apply the root and `src/AGENTS.md` files first. This directory shows the
host-owned storage and ingest path available to module authors.

## What Authors Should Take From This Directory

- Host-owned durable identity is `(schemaFileId, rowId)` for rows and
  `(regionId, recordIndex)` for aligned-binary regions.
- The canonical ingest path is direct FlatBuffer bytes, not JSON.
- If the host owns persistence, use these helpers. If a module owns state, keep
  the stream binary and use the resident-module pump path from `src/testing`.

## Storage And Streaming Rules

- Keep durable row identity host-owned as `(schemaFileId, rowId)`.
- Keep runtime aligned-binary identity host-owned as `(regionId, recordIndex)`.
- The canonical ingest path is binary FlatBuffer bytes, not JSON.
- Use size-prefixed FlatBuffer frames for streaming transport.
- Do not coerce row payloads through JSON serialization.
- If the host owns persistence, use runtime-host ingest helpers.
- If a resident module owns state, keep the stream binary and push into the
  module through the harness/pump path rather than inventing JSON wrappers.

## Key Files To Read

- `flatbufferStreamIngestor.js`
- `flatsqlRuntimeStore.js`
- `index.js`

## Note

Do not edit this directory just to store data for one module. Use the exported
helpers unless you are intentionally changing the runtime-host contract.
