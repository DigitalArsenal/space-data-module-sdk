# Single-File Bundle Demo

This example shows the JavaScript reference path for:

1. compiling a wasm module
2. creating a single-file bundle by appending `sds.bundle`
3. parsing the bundle back out of the wasm file
4. generating deterministic conformance vectors for other runtimes

Run it from the repo root:

```bash
node ./examples/single-file-bundle/demo.mjs
```

The resulting output is the reference behavior that the non-JS runtimes should match.

To regenerate the checked-in vectors under `examples/single-file-bundle/vectors/`:

```bash
node ./examples/single-file-bundle/generate-vectors.mjs
```
