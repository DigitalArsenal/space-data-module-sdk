# Go Reference Bundle Runner

This reference client uses Go plus the FlatBuffers runtime to:

- parse `sds.bundle` from a bundled wasm module
- recreate semantically equivalent bundle artifacts from the checked-in vectors

Run from `examples/single-file-bundle/go/generated`:

```bash
go run ./cmd/reference_bundle parse ../../vectors/single-file-module.wasm
go run ./cmd/reference_bundle create /tmp/sdm-go-bundle
```

The parsed JSON output is intended to match `examples/single-file-bundle/vectors/expected.json`.
