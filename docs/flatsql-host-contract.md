# The unified FlatSQL host contract

The SDK uses **FlatSQL 3.12.0**, one public API and one `flatsql/flatsql.wasm`
artifact across Node, browsers and native WASI hosts. The runtime store uses
`FlatSQL.open`, binary schema registration, native record ingestion and SDS QRP
queries. All operations are asynchronous.

## Binary boundary

Register canonical SDS BFBS schemas before ingesting records. Records are
size-prefixed FlatBuffers; queries and projected results use SDS QRP. Geometry
uses SDS GJN. Schema compilation, JSON/GeoJSON conversion and presentation run
outside the engine, using `flatc-wasm` or generated SDS bindings.

The SDK provides `encodeFlatSqlQuery` and `decodeFlatSqlResult` as caller-side
QRP helpers. `createFlatSqlRuntimeStore` owns native row identities, and
`createFlatBufferStreamIngestor` supplies ordered, backpressured ingestion.
Await `pushBytes`, `finish`, all row-store calls and `close`.

Root scalar/string/byte fields are SQL columns. Complex nested fields stay in
the original record returned by `_data`. Unsigned integers and FlatBuffer
schema defaults retain their canonical values; they are not coerced to the
retired engine's signed integers or missing-field nulls.

## Host capabilities

The identical WASM artifact requires shared memory, WASI preview1 threads and
these seven I/O imports on `env`:

```
i32 flatsql_io_open(ptr path, i32 pathLen, i32 flags)
i32 flatsql_io_read(i32 h, ptr dst, i32 len, f64 offset)
i32 flatsql_io_write(i32 h, ptr src, i32 len, f64 offset)
i32 flatsql_io_truncate(i32 h, f64 size)
i32 flatsql_io_sync(i32 h)
f64 flatsql_io_size(i32 h)
i32 flatsql_io_close(i32 h)
```

The FlatSQL package includes its private generic Node and browser host adapters.
Browser durable stores use OPFS with one origin-wide lock per root; memory-only
stores are independent. Native hosts supply the same imports and support the
engine's declared thread layout. No engine selector or alternative artifact is
part of the public API.

The SDK's ordinary modules keep their generic module host ABI. They do not gain
private FlatSQL imports. The application owns the database and passes binary
records through its existing host transport.

## Verification

`npm test` packs the SDK and exercises actual binary ingestion, typed QRP, GJN,
native row identities, deduplication, error propagation and durable reopening.
The parity gate resolves `flatsql/flatsql.wasm` through the published dependency
and checks the real browser and native WasmEdge lanes. SDN separately exercises
the same artifact through its native I/O host.
