# Isomorphic Browser + WasmEdge Demo

This example builds one command-surface wasm artifact and loads that exact file
in both environments:

- browser harness: [`browser-demo.html`](./browser-demo.html)
- WasmEdge harness: [`wasmedge-demo.mjs`](./wasmedge-demo.mjs)

The source artifact definition lives in:

- [`manifest.json`](./manifest.json)
- [`module.c`](./module.c)

The build step writes the shared artifact to:

- `examples/isomorphic-loader/generated/dist/isomorphic/module.wasm`

## Build The Shared Artifact

Run from the repo root:

```bash
node ./examples/isomorphic-loader/build-demo.mjs
```

That compiles `runtimeTargets: ["browser", "wasmedge"]`, which now defaults to
the shared `single-thread` artifact profile rather than the WasmEdge pthread
profile.

## Run In The Browser

Start a static file server from the repo root after the build step:

```bash
python3 -m http.server 4173
```

Then open:

- `http://127.0.0.1:4173/examples/isomorphic-loader/browser-demo.html`

The browser demo uses:

- `loadModule(...)` from [`src/host/isomorphicLoader.js`](/Users/tj/software/space-data-module-sdk/src/host/isomorphicLoader.js)
- browser edge shims from [`src/host/browserEdgeShims.js`](/Users/tj/software/space-data-module-sdk/src/host/browserEdgeShims.js)
- browser host adapter from [`src/host/browserHost.js`](/Users/tj/software/space-data-module-sdk/src/host/browserHost.js)

## Run In WasmEdge

Install the `wasmedge` CLI and run:

```bash
node ./examples/isomorphic-loader/wasmedge-demo.mjs
```

That script uses the same `generated/dist/isomorphic/module.wasm` artifact the browser
page loads. `loadModule(...)` detects that the artifact is a standalone
command-surface module and drives WasmEdge through raw stdin/stdout command
execution rather than the runner protocol.

## Optional Parity Test

To run the live same-artifact browser/WasmEdge parity test:

```bash
SPACE_DATA_MODULE_SDK_ENABLE_WASMEDGE_PARITY=1 node --test ./test/browser-harness.test.js
```
