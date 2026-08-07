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

### Pthreads variant (shared-memory, isomorphic threading)

When a module needs real guest threads (the `emscripten-pthreads` thread model,
default for `["wasmedge"]`), the SDK compiles it through the **wasi-threads**
toolchain (`clang --target=wasm32-wasip1-threads -pthread`), **not** Emscripten
`-pthread` (which emits a browser-only Web-Worker build that cannot thread under
WasmEdge). It **enforces** the wasi-threads link flags and **validates the
emitted `.wasm`** — the artifact must import `wasi.thread-spawn`, export
`wasi_thread_start`, be a shared-memory/atomics wasm, and carry no Emscripten
worker hooks, or the compile is rejected. That guardrail is documented in
[`docs/isomorphic-pthreads.md`](./isomorphic-pthreads.md). This present document
covers the portable `single-thread` loading profile; read the pthreads doc
before shipping a threaded WasmEdge artifact.

## Cross-Origin Isolation Is Required For Any wasi-threads/wasi-sequential Guest

**Settled policy** (`module-sdk-target-forces-sab-coop-coep`, arbitrated
2026-07-28, closed 2026-08-06): a host serving a module built through the
`wasm32-wasip1-threads` toolchain — the `emscripten-pthreads` (real threading)
model **or** the `wasi-sequential` model — to a browser MUST serve that page
cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin` +
`Cross-Origin-Embedder-Policy: require-corp`, or the equivalent). There is no
build-flag escape hatch:

- `--target=wasm32-wasip1-threads` with **zero** feature flags still emits
  `+atomics` — the triple implies atomics.
- A driver-default link on that triple declares a **shared** memory (limits
  flags `0x03`) with no `--shared-memory`/`--import-memory` on the link line.
- `--no-shared-memory` is not a wasm-ld flag. Nothing in `compileModule.js`
  can produce an unshared artifact on this triple. See the guardrail chain in
  [`src/compiler/pthreadArtifactGuard.js`](/Users/tj/software/space-data-module-sdk/src/compiler/pthreadArtifactGuard.js)
  (`assertSequentialArtifact`) and [`docs/isomorphic-pthreads.md`](./isomorphic-pthreads.md).

This means an inherently-sequential guest (`wasi-sequential`, no real
threading) still needs a shared-memory instantiation — same as a real threaded
guest — because it shares the same compiled triple. The portable
**`single-thread`** profile this document otherwise covers (Emscripten/
emception, the `["browser"]` / `["browser","wasmedge"]` default: no shared
memory, no atomics) is the one exception and needs **no** cross-origin
isolation. Check which profile a guest actually uses — `runtimeTargets` alone
does not tell you; an explicit `threadModel` does — before assuming either
way.

**How production achieves it today** (both patterns are live and
`crossOriginIsolated`-verified, not hypothetical):

1. **Native headers**, when the host directly fronts the origin (e.g. a
   Caddy-fronted droplet): set `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: require-corp` at the web server, which
   survives a CDN in front of it.
2. **A COI service worker**, when the host is a static CDN that cannot set
   custom response headers (GitHub Pages is the concrete case: Pages sends no
   COOP/COEP at all). The worker intercepts navigation/asset fetches and
   re-serves them with the isolation headers injected, then the page does one
   capped self-heal reload. Reference implementation:
   `coi-serviceworker.js` + `coi-bootstrap.js` in the `spaceaware-ui`
   (`sdn-js`) and OrbPro Pages surfaces — verified live via
   `window.crossOriginIsolated === true` and `typeof SharedArrayBuffer !==
   "undefined"` in a real browser, per `deployment/topology.json`. Do not
   invent a second shim; port that one.

Either path additionally constrains **every other subresource** the page
loads to be CORP/CORS-clean under `require-corp` — third-party embeds, fonts,
tiles, imagery all have to cooperate. This is exactly the surface the
standing "node UIs load ZERO external-origin bytes" law removes as a concern
for the surfaces that already follow it; a new module-serving surface that
does NOT yet follow that law has to solve subresource compatibility
separately, before COI, not after.

**The guardrail, concretely**: verify `crossOriginIsolated`/`SharedArrayBuffer`
with a real browser (`live-verify.mjs`-style, not a raw `curl -I` — a
service-worker-injected header is invisible to a plain HTTP request) as part
of standing up ANY new surface that serves a `wasi-threads`/`wasi-sequential`
artifact, before assuming module instantiation works. A silent regression here
fails as an instantiation error in the browser console, not a build error —
there is currently no automated CI check for it; add one alongside the new
surface's own verify tooling rather than assuming this document is enough.

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
- browser harness: [`src/host/browserModuleHarness.js`](../src/host/browserModuleHarness.js)
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
- `network`: async browser-host dispatch that routes to the available transport
  adapters
- `ipfs`, `protocol_handle`, `protocol_dial`: async browser-host adapters that
  can be supplied by the embedding runtime
- `clock`, `random`, `timers`, `schedule_cron`, `context_*`, `crypto_*`:
  browser-native implementations in the browser host adapter

These are host shims, not raw WasmEdge socket imports. When an embedding host
needs to override the reference behavior, pass `capabilityAdapters` keyed by
the canonical capability ids. That same generic async capability boundary is
shared by `BrowserHost`, `NodeHost`, `createRuntimeHost()`, `loadModule(...)`,
and `createBrowserModuleHarness(...)`.

## Current Boundary

One binary can load in both browser and WasmEdge today when it stays within the
shared profile:

- standalone WASI imports
- optional sync `space_data_module_host` imports
- command invoke surfaces through `_start` on WasmEdge and direct or command
  invoke surfaces in the browser harness
- no Emscripten pthread imports

Not browser-portable from the same raw guest binary:

- WasmEdge-native socket/TLS extension imports
- pthread-oriented `env.*` imports
- raw guest async hostcalls that need a broader ABI than the current sync
  `space_data_module_host` bridge

Today’s portable split is:

- the guest-visible `space_data_module_host` import remains a sync-only subset for sync-safe
  operations
- the host and harness APIs can still await filesystem, network, IPFS, and
  protocol adapters through the generic async capability boundary in both
  browser and Node-hosted test/runtime flows

For browser-hosted networking and IPFS/protocol work, use the browser edge
shims or host-delegated adapters instead of relying on raw WasmEdge socket
extensions.

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
