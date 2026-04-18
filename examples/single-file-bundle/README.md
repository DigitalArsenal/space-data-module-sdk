# Single-File Bundle Demo

This example shows the JavaScript reference path for:

1. compiling a wasm module
2. creating a single-file bundle by appending one `REC` trailer carrying `MBL`
3. parsing the bundle back out of the protected artifact
4. generating deterministic REC+MBL conformance vectors

Run it from the repo root:

```bash
node ./examples/single-file-bundle/demo.mjs
```

The resulting output is the reference behavior for the SDK-owned REC+MBL path.

To regenerate the checked-in vectors under `examples/single-file-bundle/vectors/`:

```bash
node ./examples/single-file-bundle/generate-vectors.mjs
```
