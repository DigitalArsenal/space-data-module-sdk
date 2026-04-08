# Browser + WasmEdge Isomorphic Artifacts

Use this profile when you want one compiled `.wasm` artifact that can be loaded
unchanged in:

- the browser harness
- the WasmEdge command/runtime harness

## Canonical Build Rule

Declare:

```json
{
  "runtimeTargets": ["browser", "wasmedge"]
}
```

That target pair now defaults to the shared `single-thread` artifact profile.

The compiler logic lives in
[`src/compiler/compileModule.js`](/Users/tj/software/space-data-module-sdk/src/compiler/compileModule.js).

The practical effect is:

- `["wasmedge"]` keeps the higher-capability WasmEdge pthread default
- `["browser", "wasmedge"]` chooses the portable single-thread artifact instead

Use the pure `["wasmedge"]` target when you want maximum WasmEdge-native guest
capability and do not need browser loading from the same binary.

## Canonical Module Repo Layout

Module repos should publish the shared compiled artifact under a stable runtime
path, not a plugin-named filename:

- required: `dist/isomorphic/module.wasm`

If a repo also ships a browser-specific adapter, place it under:

- optional: `dist/browser/module.js`
- optional: `dist/browser/module.wasm`

That keeps the artifact name stable across repos and lets runtime intent live in
the path rather than in the filename.

## Toolchain Options

The recommended browser-side build selector for module repos is:

- `SDN_WASM_TOOLCHAIN=local-emsdk`: default. Build with a repo-local
  `deps/emsdk` checkout and avoid Homebrew or any other machine-global
  Emscripten install.
- `SDN_WASM_TOOLCHAIN=sdn-emception`: optional SDK-first path for repos that use
  `compileModuleFromSource(...)` or an SDK-driven build script to emit the
  shared `dist/isomorphic/module.wasm` artifact.
- `SDN_WASM_TOOLCHAIN=path`: explicit escape hatch when a repo intentionally
  wants to use a preinstalled Emscripten toolchain from `PATH`.

The isomorphic contract is the compiled wasm path, not the browser wrapper. A
repo can publish only `dist/isomorphic/module.wasm` and still satisfy the
browser/WasmEdge shared-artifact requirement when it loads through the SDK
harnesses.

## Loader Entry Points

The supported browser/WasmEdge entry points are:

- browser entry bundle: [`src/browser.js`](/Users/tj/software/space-data-module-sdk/src/browser.js)
- isomorphic loader: [`src/host/isomorphicLoader.js`](/Users/tj/software/space-data-module-sdk/src/host/isomorphicLoader.js)
- browser harness: [`src/testing/browserModuleHarness.js`](/Users/tj/software/space-data-module-sdk/src/testing/browserModuleHarness.js)
- browser WASI shim: [`src/host/wasiShim.js`](/Users/tj/software/space-data-module-sdk/src/host/wasiShim.js)
- browser edge shims: [`src/host/browserEdgeShims.js`](/Users/tj/software/space-data-module-sdk/src/host/browserEdgeShims.js)
- browser host adapter: [`src/host/browserHost.js`](/Users/tj/software/space-data-module-sdk/src/host/browserHost.js)

On the server path, [`loadModule(...)`](/Users/tj/software/space-data-module-sdk/src/host/isomorphicLoader.js)
now chooses the raw WasmEdge command harness automatically for standalone
artifacts with `_start`. The `--serve-plugin-invoke` runner protocol remains
available for explicit runtime-host / runner-backed flows.

## What The Browser Shims Cover

The browser edge shims map host capabilities onto browser-native surfaces:

- `filesystem`: in-memory virtual filesystem with `resolvePath`, `readFile`,
  `writeFile`, `appendFile`, `deleteFile`, `mkdir`, `readdir`, `stat`, `rename`
- `http`: `fetch`
- `websocket`: browser `WebSocket`
- `clock`, `random`, `timers`, `schedule_cron`, `context_*`, `crypto_*`:
  browser-native implementations in the browser host adapter

These are host shims, not raw WasmEdge socket imports.

## Current Boundary

One binary can load in both browser and WasmEdge today when it stays within the
shared profile:

- standalone WASI imports
- optional sync `sdn_host` imports
- command invoke surfaces through `_start` on WasmEdge and direct or command
  invoke surfaces in the browser harness
- no Emscripten pthread imports

Not browser-portable from the same raw guest binary:

- WasmEdge-native socket/TLS extension imports
- pthread-oriented `env.*` imports
- async guest hostcalls that need a broader ABI than the current sync
  `sdn_host` bridge

For browser-hosted networking, use the browser edge shims or host-delegated
services instead of relying on raw WasmEdge socket extensions.

## Checked-In Demo

The canonical example is:

- [`examples/isomorphic-loader/README.md`](/Users/tj/software/space-data-module-sdk/examples/isomorphic-loader/README.md)

That example includes:

- manifest: [`examples/isomorphic-loader/manifest.json`](/Users/tj/software/space-data-module-sdk/examples/isomorphic-loader/manifest.json)
- guest source: [`examples/isomorphic-loader/module.c`](/Users/tj/software/space-data-module-sdk/examples/isomorphic-loader/module.c)
- build script: [`examples/isomorphic-loader/build-demo.mjs`](/Users/tj/software/space-data-module-sdk/examples/isomorphic-loader/build-demo.mjs)
- browser loader: [`examples/isomorphic-loader/browser-demo.mjs`](/Users/tj/software/space-data-module-sdk/examples/isomorphic-loader/browser-demo.mjs)
- browser page: [`examples/isomorphic-loader/browser-demo.html`](/Users/tj/software/space-data-module-sdk/examples/isomorphic-loader/browser-demo.html)
- WasmEdge loader: [`examples/isomorphic-loader/wasmedge-demo.mjs`](/Users/tj/software/space-data-module-sdk/examples/isomorphic-loader/wasmedge-demo.mjs)

Both demos load the same generated artifact:

- `examples/isomorphic-loader/generated/dist/isomorphic/module.wasm`

## Streaming Into The Same Artifact

If that shared artifact owns resident state, such as an SDN module that imports
`flatsql` internally, stream raw FlatBuffer frames into the live instance with
`createModuleFlatBufferStreamPump(...)`.

Use:

- a persistent `direct` browser harness for browser-resident state
- a persistent runtime-backed harness on the server/WasmEdge side
- chunked size-prefixed FlatBuffer stream input
- many small invokes, not one monolithic invoke envelope

That path is documented in
[`docs/flatsql-streaming-standard.md`](/Users/tj/software/space-data-module-sdk/docs/flatsql-streaming-standard.md).
