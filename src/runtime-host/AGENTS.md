# AGENTS

Apply the root and `src/AGENTS.md` files first. This directory contains generic
binary persistence, arena/descriptor, registry, and ingest adapters available
to module authors. It must not own FlatSQL or application semantics.

## What Authors Should Take From This Directory

- FlatSQL row/table/query identity belongs to the pluggable FlatSQL WASM node.
- Hosts may own opaque blob keys and ephemeral arena handles only; neither is a
  schema-aware module ABI.
- The canonical ingest path is direct FlatBuffer bytes, not JSON.
- Use these helpers only as generic adapters. Keep state and query semantics in
  the resident WASM node and use the pump path from `src/testing`.

## Storage And Streaming Rules

- Keep FlatSQL row identity and aligned layout interpretation inside the
  FlatSQL WASM node.
- Keep host persistence opaque: byte operations may not expose tables, rows,
  schemas, SQL, queries, or application record types.
- The canonical ingest path is binary FlatBuffer bytes, not JSON.
- Use size-prefixed FlatBuffer frames for streaming transport.
- Do not coerce row payloads through JSON serialization.
- Every module port must declare both canonical FlatBuffer and aligned-binary
  representations for the same SDS type.
- Keep the stream binary and push it into the resident module through the
  harness/pump path rather than inventing JSON wrappers.

## Key Files To Read

- `flatbufferStreamIngestor.js`
- `flatsqlRuntimeStore.js` (legacy migration surface; not the target FlatSQL
  ownership model)
- `index.js`

## Note

Do not edit this directory just to store data for one module. Use the exported
helpers unless you are intentionally changing the runtime-host contract.
