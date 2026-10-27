# Binary FlatSQL example

Compile the canonical SDS GJN schema to BFBS and convert source records into a
size-prefixed GJN stream with `flatc-wasm` separately. Then run:

```sh
node examples/flatsql-store-local/query.mjs GJN.bfbs records.gjn > result.qrp
```

The example registers the binary schema, ingests the original FlatBuffers, and
writes size-prefixed SDS QRP pages to stdout. An optional third argument supplies
SQL. Decode QRP with the canonical SDS bindings in the consuming application.
The engine does not parse JSON, GeoJSON text, or WKT.

`npm test` exercises this same binary schema, ingest, geometry query, and durable
reopen path through the installed SDK tarball.
