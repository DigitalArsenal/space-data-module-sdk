# FlatBuffer Streaming Through the FlatSQL WASM Node

This document defines the canonical way to stream SDS FlatBuffers through a
pluggable FlatSQL module while keeping one flow artifact portable across the
browser/JavaScript harness and WasmEdge.

## Short Version

Use four layers with explicit ownership:

1. Stream transport: little-endian `u32` size prefix followed by one canonical
   FlatBuffer payload per frame.
2. Module invoke ABI: SDS `$PIV` request/response envelopes containing `TAB`
   descriptors.
3. Inter-module representation: every port supports both canonical FlatBuffer
   and aligned-binary forms for the same SDS identity; `TAB.WIRE_FORMAT`
   selects per frame.
4. Database behavior: a signed FlatSQL WASM node owns table, row, query, index,
   compaction, and snapshot semantics.

The host is not the database. It may provide opaque byte persistence, shared
arenas, networking, clocks, and module lifecycle adapters, but it must not
implement FlatSQL or interpret application records.

## Canonical Stream Transport

The portable transport for streamed records is:

- a 4-byte little-endian payload length;
- one canonical FlatBuffer payload of that length;
- repeated until end of stream; and
- binary bytes end-to-end, without JSON or base64 transcoding.

Each payload carries its SDS FlatBuffer file identifier. The FlatSQL WASM node,
not the host, validates that identity against the connected method port and
derives its table/index behavior.

Use this framing for:

- WebSocket or HTTP response streams;
- local file replay;
- browser worker messages that cannot share memory;
- process and network boundaries;
- snapshots, publication, and durable records; and
- fallback between modules whose arenas cannot be shared safely.

This outer stream is not itself a `$PIV` envelope. A stream pump incrementally
turns frames into bounded module invocations.

## Canonical Invoke ABI

Module calls use:

- SDS `$PIV` `REQUEST` and `RESPONSE` envelopes;
- SDS `TAB` descriptors for every input and output frame; and
- a `PAYLOAD_ARENA` or a validated external guest-memory arena.

A `TAB` preserves:

- `PORT_ID`;
- `TYPE_REF` and canonical SDS schema identity;
- `OFFSET` and `SIZE`;
- `ALIGNMENT`;
- `WIRE_FORMAT`;
- `OWNERSHIP` and `MUTABILITY`; and
- `FRAME_ID` for stream/exchange bookkeeping.

The invoke surface is batch-oriented. Feed a long stream through many bounded
invocations rather than constructing one monolithic request.

## Required Dual Representation

Every input and output port must accept both representations of every logical
SDS type it declares:

- `FLATBUFFER`: canonical DA/SDS FlatBuffer bytes; and
- `ALIGNED_BINARY`: the fixed-layout, alignment-described execution form.

The two entries live in the same `PLG` accepted type set and must have the same
schema name, file identifier, root type, version, and schema hash when those
fields are present. The aligned entry additionally declares its byte length,
fixed-string constraints when applicable, and required alignment.

Aligned-binary is never a different logical schema. It is a transient routing
optimization layered on the canonical FlatBuffer contract.

The flow compiler must reject:

- a port with only one representation;
- paired entries with different SDS identity;
- incomplete or contradictory aligned layout metadata;
- an edge whose producer and consumer have no compatible pair; or
- a route that requires host-language schema conversion.

## Wire-Format Selection

The flow runtime selects a representation for each edge and frame:

1. Match the producer and consumer by canonical SDS identity.
2. Confirm that both advertise the canonical and aligned forms.
3. Select aligned-binary only when both nodes use a compatible live arena and
   the declared layout, start alignment, ownership, mutability, and lifetime
   can be enforced.
4. Otherwise select canonical FlatBuffer bytes.

Canonical FlatBuffer is mandatory for network, process, publication,
persistence, and other non-shared-memory boundaries. It is also the required
fallback whenever aligned compatibility is uncertain.

The host may validate and route descriptors, but it must not decode or
transcode the application schema. The producing module, consuming module, or
compiler-generated WASM glue emits the representation selected by the route.

## Aligned-Frame Safety

An aligned frame is valid only inside its declared arena and exchange:

- `OFFSET + SIZE` must be overflow-safe and within the active arena or
  validated guest memory;
- `ALIGNMENT` and `TYPE_REF.REQUIRED_ALIGNMENT` must both hold;
- ownership and mutability must be compatible with the receiving method;
- a borrowed or plugin-owned buffer must not be freed by the host;
- transferred buffers must have a single, explicit owner after transfer; and
- `FRAME_ID` is stream/exchange identity, not a persistent address.

Raw pointers must never be stored, published, or sent over the network. Data
that must survive the current frame lifetime is materialized as canonical
FlatBuffer bytes or moved through a separately declared generic arena
lifecycle.

## FlatSQL Is a Pluggable WASM Module

A flow that needs a database declares the canonical signed FlatSQL WASM
artifact as a dependency and instantiates it as a node. The graph connects
typed record, query, result, maintenance, and state ports to that node.

The FlatSQL node owns:

- schema/file-identifier validation;
- table and row identity;
- append, query, index, and logical upsert-view semantics;
- retention and compaction behavior exposed by typed methods;
- canonical snapshot and write-ahead serialization;
- reload/rebuild behavior; and
- canonical/aligned representation handling at its ports.

FlatSQL is not:

- a Go `hostcap` store;
- a JavaScript database implementation;
- a WasmEdge extension or built-in WASI service;
- a host-owned row or region registry; or
- an implicit `storage_engine_link` service.

FlatSQL remains an independently signed and instantiated WASM node. A flow
bundle may carry its exact artifact bytes, but static flow compilation must not
fold FlatSQL guest code into a consuming module or erase the node boundary.
Its identity, version, manifest, and artifact hash remain independently
verifiable and pluggable.

## Durable State

Durable FlatSQL records remain canonical size-prefixed FlatBuffer bytes.
Aligned-binary records are transient views and cannot be the only persisted
form.

The FlatSQL node may request an opaque persistence namespace from the host. The
generic byte adapter may expose operations equivalent to:

- read a named blob;
- append bytes;
- atomically replace a blob;
- list opaque keys within the module's namespace;
- sync; and
- delete an opaque key when capability policy permits it.

The adapter must not expose SQL, table names, row IDs, schema IDs, query
operators, indexes, application types, or compaction policy. Those remain
inside the node. Browser and WasmEdge adapters must preserve the same byte and
atomicity contract even if their native backing stores differ.

On restart, a fresh FlatSQL WASM instance reloads its opaque snapshot/WAL bytes
and must reproduce the same query-visible state. Persist/reload parity is a
cross-host conformance requirement.

## Browser and WasmEdge

The exact same signed FlatSQL artifact and composed flow artifact run in both
hosts.

The browser host may map generic persistence to IndexedDB or another approved
opaque byte store, shared arenas to `SharedArrayBuffer`, networking to `fetch`
or browser transports, and thread spawn to workers.

The WasmEdge host may map those same contracts to filesystem/object storage,
native shared memory, approved network adapters, and canonical
`wasi.thread-spawn` support.

These are equivalent adapters, not alternate database implementations. A
capability absent from either target causes compile/load negotiation to fail;
it must not cause a host-specific module binary or host-owned substitute.

## Streaming Helper Shape

`createModuleFlatBufferStreamPump(...)` is the canonical outer-stream adapter
for a resident node. It:

- accepts size-prefixed canonical FlatBuffer chunks;
- decodes framing incrementally without decoding application records;
- emits small `$PIV` request batches into the live module;
- preserves stream sequence and end-of-stream state through `TAB.FRAME_ID`;
- never routes payloads through JSON; and
- allows the flow runtime to negotiate aligned routing after a frame is inside
  a compatible shared arena.

Conceptual use:

```js
const harness = await createBrowserModuleHarness({
  wasmSource: signedFlowBytes,
  surface: "direct",
});

const pump = createModuleFlatBufferStreamPump({
  harness,
  methodId: "ingest",
  portId: "records",
  maxFramesPerInvoke: 64,
});

await pump.pushBytes(chunkA);
await pump.pushBytes(chunkB);
await pump.finish();
```

The JavaScript shown here drives a generic invoke surface; it does not own
FlatSQL state or query behavior.

## Timer-Driven Maintenance

Periodic FlatSQL maintenance is connected through a timer WASM node. The host
provides a clock and generic wakeup only. Cron parsing, timezones, retry,
misfire behavior, and the typed maintenance trigger remain inside WASM nodes so
browser and WasmEdge execution is deterministic.

## Performance Guidance

Measure these paths separately:

1. outer canonical stream framing and ingestion;
2. regular FlatBuffer inter-module routing;
3. aligned-binary shared-arena routing;
4. FlatSQL append/query work inside the WASM node; and
5. snapshot/WAL persistence and reload through the opaque byte adapter.

Use bounded batches for all measurements. Recommended regular totals are 1,
8, 32, and 128 MiB; local stress may use 256 MiB or more as a chunked total.
Do not create one 1 GiB `$PIV` request.

Report both throughput and peak memory. For aligned routing, also report the
fallback rate and the reason for each fallback category. Browser and WasmEdge
benchmarks must record the exact signed artifact hash.

## Required Conformance Tests

The SDK and every flow that uses FlatSQL must cover:

- compiler rejection of regular-only and aligned-only ports;
- compiler rejection of mismatched paired identities/layouts;
- canonical-only routing;
- compatible aligned routing;
- mixed topology with canonical fallback;
- bounds, alignment, ownership, mutability, and stale-frame failures;
- byte-identical canonical outputs in browser and WasmEdge;
- semantic equivalence of canonical and aligned executions;
- FlatSQL ingest, query, snapshot, restart, and reload in both hosts; and
- proof that host code contains no FlatSQL table/query/schema behavior.

## Legacy Surfaces

`createFlatSqlRuntimeStore()`, host-owned row/region stores,
`storage_engine_link`, and host-side FlatSQL query capabilities are migration
surfaces. They do not define the target architecture and must not be used by
new flow designs. The local FlatSQL store example is useful only as historical
test coverage until it is replaced by a signed FlatSQL WASM-node example.
