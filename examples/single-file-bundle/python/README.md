# Python Reference Bundle Runner

This reference client uses Python plus the FlatBuffers runtime to:

- parse `sds.bundle` from a bundled wasm module
- recreate semantically equivalent bundle artifacts from the checked-in vectors

Run from the repo root:

```bash
python3 ./examples/single-file-bundle/python/reference_bundle.py parse ./examples/single-file-bundle/vectors/single-file-module.wasm
python3 ./examples/single-file-bundle/python/reference_bundle.py create /tmp/sdm-python-bundle
```

The JSON output is intended to match `examples/single-file-bundle/vectors/expected.json`.
