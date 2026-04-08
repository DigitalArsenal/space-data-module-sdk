# FlatBuffer Streaming Into FlatSQL

This document defines the recommended standard for getting streamed
FlatBuffer payloads into FlatSQL-backed storage while keeping the same model
portable across browser, server, OrbPro, and WasmEdge.

## Short Version

Use three layers, not one:

1. Transport stream:
   little-endian `u32` size prefix + one FlatBuffer payload per frame
2. Module invoke ABI:
   `PluginInvokeRequest` / `PluginInvokeResponse` with `TypedArenaBuffer`
3. Durable storage identity:
   host-owned append-only row handles and host-owned runtime regions

Do not treat a module-owned mutable FlatSQL database as the canonical ABI.
That can exist as an adapter or example, but it is not the durable cross-host
contract.

## Canonical Transport

The canonical transport for streamed FlatBuffers is:

- `4-byte little-endian payload length`
- followed by one FlatBuffer payload
- repeated until end of stream
- payload bytes stay binary end-to-end; the canonical ingest path does not
  transcode frames through JSON

Each payload must carry a readable FlatBuffer file identifier. The runtime uses
that identifier to derive the durable `schemaFileId`.

This transport is intentionally separate from module invocation. It is the
right shape for:

- WebSocket feeds
- HTTP chunk/file ingestion
- local file replay
- browser worker or server-side stream processing

It is not the same thing as `PluginInvokeRequest`.

## Canonical Durable Storage

The durable storage model is host-owned.

Standards records are addressed by:

- `($SCHEMA_FILE_ID, rowId)`

Rules:

- `rowId` is append-only
- `rowId` is never reused
- logical updates create new rows
- "latest" or "upsert" views are host-side projections or indexes
- row payloads remain raw binary or native in-memory values; the canonical
  runtime-host row path does not stringify payloads

High-performance derived runtime state is addressed by:

- `(regionId, recordIndex)`

Rules:

- the host allocates or registers regions
- regions are fixed-layout aligned-binary buffers
- regions are not indexed in FlatSQL
- raw pointers remain internal execution details only

The stable storage ABI lives in [`schemas/HostStorageAbi.fbs`](../schemas/HostStorageAbi.fbs).

## Canonical Module ABI

When streamed payloads must cross into a module, use the invoke ABI:

- `PluginInvokeRequest`
- `PluginInvokeResponse`
- `TypedArenaBuffer`

Each input frame should preserve:

- `portId`
- `typeRef`
- `streamId`
- `sequence`
- `endOfStream`
- alignment metadata when required

This is the correct way to tell a module "these frames belong to the same
logical stream."

It is not a byte-streaming transport. The current invoke ABI is still
buffer-oriented:

- the full request is materialized before `plugin_invoke_stream(...)`
- the full response is materialized before it is returned

So a single 1 GiB `PluginInvokeRequest` is not the intended path.

## FlatSQL-Specific Rules

If the goal is "stream FlatBuffers into FlatSQL", standardize the host-side
behavior first:

1. split the outer size-prefixed transport stream into payload frames
2. derive `schemaFileId` from the FlatBuffer file identifier
3. append immutable host-owned rows
4. maintain host-side logical indexes or latest-record projections as needed
5. expose query and row-resolution APIs on top of that store

That means the durable primitive is `append`, not `upsert`.

`upsert_records` is allowed as a higher-level adapter surface, but only if it
is defined as:

- append new immutable row(s)
- update a logical index/view
- never rewrite an existing durable `rowId`

If a module or flow needs fast numeric state, keep that data in runtime regions,
not in FlatSQL tables.

## Browser and WasmEdge

The same transport/storage model should be used in both:

- browser: host-side stream ingest + host-owned rows/regions
- WasmEdge: host-side stream ingest + host-owned rows/regions

Use module invocation for:

- compute batches
- typed transformation steps
- stateful direct-surface module sessions

Use host-side stream ingest for:

- large continuous feeds
- catalog replay
- ingestion into host-owned FlatSQL-backed stores
- any workload that should not be forced through one contiguous invoke buffer

The new helper for this outer transport path is
`createFlatBufferStreamIngestor(...)`, exported from
`space-data-module-sdk/runtime-host`.

## Streaming Into A Module-Owned FlatSQL Engine

If the goal is not a host-owned durable store, but a stateful SDN module that
imports `flatsql` internally and owns its own in-memory query state, use a
persistent direct-surface module instance plus chunked binary invokes.

Rules:

- do not change `flatsql` itself
- import `flatsql` inside the SDN module implementation
- keep the module instance resident across invokes
- feed it many small FlatBuffer frames, not one giant invoke envelope
- use command surface only for stateless one-shot work; use direct surface for
  resident FlatSQL state

The SDK helper for this path is `createModuleFlatBufferStreamPump(...)`,
exported from `space-data-module-sdk/testing` and the browser/root package
surfaces.

That helper:

- accepts the same outer size-prefixed FlatBuffer stream chunks
- decodes frames incrementally
- emits small `PluginInvokeRequest` batches into a live module instance
- preserves `streamId`, `sequence`, and final `endOfStream`
- never routes payloads through JSON

Example:

```js
import {
  createBrowserModuleHarness,
  createModuleFlatBufferStreamPump,
} from "space-data-module-sdk";

const harness = await createBrowserModuleHarness({
  wasmSource,
  surface: "direct",
});

const pump = createModuleFlatBufferStreamPump({
  harness,
  methodId: "upsert_records",
  portId: "records",
  maxFramesPerInvoke: 64,
  typeResolver(_payload, context) {
    return {
      acceptsAnyFlatbuffer: true,
      fileIdentifier: context.rawFileIdentifier,
    };
  },
});

await pump.pushBytes(chunkA);
await pump.pushBytes(chunkB);
await pump.finish();
```

This is the right shape for OrbPro-style browser ingest when:

- the raw FlatBuffer payloads are the source of truth
- the UI/runtime should not materialize JS record mirrors
- a resident module should own FlatSQL/query state directly

It is still batch-oriented per invoke, but it removes the architectural
anti-pattern of building one monolithic request envelope for a long-running
stream.

## Example Import Path

```js
import {
  createFlatBufferStreamIngestor,
  createRuntimeHost,
} from "space-data-module-sdk/runtime-host";

const host = createRuntimeHost();
const ingestor = createFlatBufferStreamIngestor({
  rows: host.rows,
});

ingestor.pushBytes(chunkA);
ingestor.pushBytes(chunkB);
ingestor.finish();

const rows = host.rows.listRows("OMM");
```

## Performance Guidance

There are two distinct performance questions:

1. Outer transport ingest throughput
2. Module invoke throughput

Do not mix them into one benchmark.

### Outer Transport Benchmark

Use the runtime-host stream ingestor.

Commands:

```bash
npm run test:stream-ingest
npm run benchmark:stream-1gib
```

Optional tuning:

- `SPACE_DATA_MODULE_SDK_STREAM_BENCH_BYTES`
- `SPACE_DATA_MODULE_SDK_STREAM_BENCH_PAYLOAD_BYTES`
- `SPACE_DATA_MODULE_SDK_STREAM_BENCH_CHUNK_BYTES`

The 1 GiB benchmark is env-gated on purpose. It is a local stress path, not a
default suite member.

### Module Invoke Benchmark

Benchmark direct invoke separately with many smaller requests and a tiny
response. Treat the current invoke ABI as batch-oriented, not as a raw stream
transport.

Recommended total sizes:

- CI / regular local: `1 MiB`, `8 MiB`, `32 MiB`, `128 MiB`
- local stress: `256 MiB` or higher in chunked totals

Avoid a single 1 GiB request envelope on the current codepath.

For the resident module-ingest shape, use:

```bash
npm run test:module-stream
npm run benchmark:module-stream-1gib
```

That benchmark exercises the chunked module stream-pump path, not a single huge
invoke buffer.

## Current Non-Canonical Example

[`examples/flatsql-store-local`](../examples/flatsql-store-local) is still
useful as an adapter example, but it is not the canonical durable identity
model. It exposes a module-owned mutable logical database. The canonical model
for cross-host durability is host-owned rows plus host-owned runtime regions.
