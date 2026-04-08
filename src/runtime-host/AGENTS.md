# AGENTS

Apply the root and `src/AGENTS.md` files first.

## Area Ownership

This directory owns the canonical runtime-host storage model: row handles,
region handles, FlatSQL-backed storage, and binary FlatBuffer ingest on the host
side.

## Storage And Streaming Rules

- Keep durable row identity host-owned as `(schemaFileId, rowId)`.
- Keep runtime aligned-binary identity host-owned as `(regionId, recordIndex)`.
- The canonical ingest path is binary FlatBuffer bytes, not JSON.
- Use size-prefixed FlatBuffer frames for streaming transport.
- Do not coerce row payloads through JSON serialization.
- If the host owns persistence, use runtime-host ingest helpers.
- If a resident module owns state, keep the stream binary and push into the
  module through the harness/pump path rather than inventing JSON wrappers.

## Key Files

- `flatbufferStreamIngestor.js`
- `flatsqlRuntimeStore.js`
- `index.js`

## Verification

- `npm run test:stream-ingest`
- `node --test test/flatsql-local-node.test.js`
- `npm run benchmark:stream-1gib` for large-stream changes
