# Space Data Module SDK

`space-data-module-sdk` defines the canonical Space Data module architecture for
WebAssembly artifacts: an embedded FlatBuffer manifest, canonical ABI exports,
a stable capability vocabulary, single-file packaging, and the signing and
transport records used to move modules between hosts.

This repository is the source of truth for module-level concerns:

- `PluginManifest.fbs` and manifest codecs
- embedded manifest exports inside `.wasm` modules
- standards-aware compliance and capability validation
- module compilation and protection
- the `sds.bundle` single-file container
- deployment authorization plus SDS publication records (`REC`, `PNM`, `ENC`)
- the first canonical module hostcall/import ABI surface
- the canonical runtime-host model for append-only standards rows, host-managed
  runtime regions, and dynamic module installation/loading
- shared module-level testing/runtime harnesses, including the WasmEdge
  process runner used by package-level validation suites

<p align="center">
  <img src="docs/architecture.svg" alt="Module architecture overview" width="820" />
</p>

## Shared Harness Ownership

This repo owns the generic module-side runtime harnesses used across the stack:

- `createModuleHarness(...)` for process and WasmEdge-backed module invocation
- `resolveModuleHarnessLaunchPlan(...)` for portable launch planning
- `buildWasmEdgeEmscriptenPthreadRunner(...)` plus the shared native runner
  source and runner-level pthread smoke test

Flow-specific standalone harnessing lives in `sdn-flow`, which layers flow
enqueue/drain behavior on top of its compiled standalone runtime host. Package-
specific validation suites, including conjunction replay/V&V, are expected to
sit on top of these shared harnesses instead of defining their own runtime
process model.

## Canonical Runtime Host

The SDK now owns the durable runtime identity model used by OrbPro, browser and
server SDN hosts, and the evolving WasmEdge harness:

- standards rows are addressed only by `($SCHEMA_FILE_ID, rowId)`
- `rowId` is append-only and never reused
- aligned-binary runtime state is addressed only by `(regionId, recordIndex)`
- raw pointers remain internal execution details and are not durable APIs

The minimal host surface lives under `src/runtime-host/` and covers three
responsibilities:

- `createFlatSqlRuntimeStore()` for append-only row handles and row resolution
- `createFlatBufferStreamIngestor()` for little-endian size-prefixed FlatBuffer
  transport ingest into host-owned row storage without JSON transcoding
- `createModuleFlatBufferStreamPump()` for feeding those same FlatBuffer stream
  chunks into a resident stateful module instance without JSON envelopes
- `createRuntimeRegionStore()` for host-allocated aligned-binary regions and
  externally backed record-view descriptors
- `createModuleRegistry()` for dynamic install/load/unload/invoke

`createRuntimeHost()` composes those stores into the canonical SDK host model.
OrbPro layers entity/view helpers on top of that host instead of inventing a
separate durable identity model.

The canonical FlatBuffer-to-FlatSQL streaming contract is documented in
[`docs/flatsql-streaming-standard.md`](./docs/flatsql-streaming-standard.md).

## Module Artifact Model

A compliant module built with this SDK is always a valid `.wasm` artifact with:

- an embedded `PluginManifest.fbs`
- exported manifest accessors:
  - `plugin_get_manifest_flatbuffer`
  - `plugin_get_manifest_flatbuffer_size`
- canonical invoke exports when the artifact supports direct in-memory calls:
  - `plugin_invoke_stream`
  - `plugin_alloc`
  - `plugin_free`
- an exported `_start` entry when the artifact supports WASI command mode
- optional `sds.bundle` custom-section payloads for:
  - manifest bytes
  - resolved deployment plans and input bindings
  - deployment authorization
  - auxiliary FlatBuffer or raw payloads
- optional appended SDS FlatBuffer publication records in a trailing `REC`
  container carrying:
  - `PNM` digital-signature/publication metadata
  - `ENC` encrypted-delivery metadata

Single-file bundling does not append arbitrary bytes to the end of the wasm
module. The one-file module container is `sds.bundle`, stored as a standard
wasm custom section. Appended bytes are reserved for SDS publication records
such as `PNM` and `ENC`, wrapped in a trailing `REC` FlatBuffer collection.

The module contract stays the same whether the artifact is loaded directly,
wrapped in a deployment envelope, or shipped as one bundled `.wasm` file.

## Canonical Invoke ABI

Modules can now declare one or both canonical invoke surfaces in
`manifest.invokeSurfaces`:

- `direct`: in-memory invocation through `plugin_invoke_stream`
- `command`: WASI command-mode invocation through `_start`

Both surfaces consume and produce the same FlatBuffer envelopes:

- `PluginInvokeRequest`
- `PluginInvokeResponse`

Those envelopes route SDS payload frames by `portId` using
`TypedArenaBuffer.fbs` and a shared payload arena. Command mode reads one
request from `stdin` and writes one response to `stdout`. Direct mode takes the
same request bytes from guest memory and returns response bytes in guest
memory.

For simple single-input / single-output methods, command mode also supports a
raw shortcut:

```bash
wasmedge module.wasm --method echo < input.fb > output.fb
```

That shortcut is only valid when the method declares exactly one input port and
at most one output port.

Source-built modules can include `space_data_module_invoke.h` and use the
generated helper functions to read the active invocation inputs and emit SDS
outputs. The reference invoke examples live in
[`examples/invoke-echo`](./examples/invoke-echo):

- `manifest.direct.json`
- `manifest.command.json`
- `manifest.hybrid.json`
- `module.c`

Input and output ports can independently declare regular `flatbuffer` payloads
or `aligned-binary` layouts. Mixed contracts are valid. When a port advertises
an `aligned-binary` layout, it must also advertise a regular `flatbuffer`
fallback for the same schema in the same accepted type set. A module can accept
a regular `OMM.fbs` request and emit an aligned-binary `StateVector.fbs`
response, provided the output port also declares the regular `StateVector.fbs`
fallback and the aligned type ref carries the correct layout metadata.

## Runtime Portability

The module format is language-neutral. A host can load modules from this SDK
anywhere it can:

- instantiate WebAssembly
- read FlatBuffers
- honor the module capability and host ABI contract

That architecture is intended to stay portable across the common WebAssembly
and FlatBuffer host environments:

- browser
- Node.js
- C#
- Go
- Java
- Kotlin
- Python
- Rust
- Swift

This repo currently includes:

- the JavaScript reference implementation for manifest, compliance, auth,
  transport, bundle handling, and compilation
- deterministic `sds.bundle` conformance vectors under
  [`examples/single-file-bundle/vectors`](./examples/single-file-bundle/vectors)
- non-JS bundle reference clients in
  [`examples/single-file-bundle/go`](./examples/single-file-bundle/go) and
  [`examples/single-file-bundle/python`](./examples/single-file-bundle/python)
- reference Node and browser hosts plus the legacy sync `sdn_host` bridge for
  sync-safe guest hostcalls

The current host/runtime contract is two-tiered:

- raw guest `sdn_host` imports stay sync-only
- generic async capabilities such as filesystem, network, IPFS, and protocol
  adapters are exposed through `NodeHost`, `BrowserHost`, and the browser/module
  harness APIs

## Runtime Targets

Manifests can declare coarse runtime targets in `manifest.runtimeTargets`.

If a manifest declares `runtimeTargets: ["wasi"]`, this SDK treats that as
"standalone WASI, no host wrapper required." In practice that currently means:

- the artifact must declare the `command` invoke surface
- declared capabilities must stay within the pure WASI subset:
  `logging`, `clock`, `random`, `filesystem`, `pipe`
- hosted protocols may only use `wasi-pipe` transport

If a manifest declares `runtimeTargets: ["wasmedge"]`, this SDK treats that as
the preferred server-side target when the guest needs network-oriented runtime
features such as sockets or TLS. Plain `wasi` remains the strict portability
baseline; `wasmedge` is the practical higher-capability target.

If a manifest declares `runtimeTargets: ["browser", "wasmedge"]`, this SDK
treats that as the explicit "one binary for both" profile. That pair now
defaults to a shared `single-thread` artifact so the compiled wasm can be loaded
unchanged by the browser harness and the WasmEdge harness.

## WasmEdge Pthreads

`space-data-module-sdk` is also the source of truth for module thread-model
selection.

- `compileModuleFromSource({ threadModel })` accepts an explicit thread model.
- If `threadModel` is omitted, the SDK resolves it from `manifest.runtimeTargets`.
- `runtimeTargets: ["wasmedge"]` defaults to `emscripten-pthreads`.
- `runtimeTargets: ["browser", "wasmedge"]` defaults to `single-thread`.
- Other targets currently default to `single-thread`.

WasmEdge-targeted pthread builds do not use the embedded `sdn-emception`
toolchain. They require a real system Emscripten installation on `PATH`, and
the compiler result plus guest-link bundle metadata preserve the selected
`threadModel`.

As emitted by current Emscripten, these pthread artifacts still import
Emscripten `env.*` host functions plus imported shared memory. That means a
bare `wasmedge` CLI invocation is not yet the direct execution path for them;
they currently require a WasmEdge-side host shim that satisfies the Emscripten
pthread contract.

If a runtime cannot interoperate with the guest pthread contract directly,
document that as a wrapper requirement instead of changing the guest artifact
semantics.

## Browser + WasmEdge Isomorphism

The supported isomorphic profile and browser edge shims are documented in
[`docs/browser-wasmedge-isomorphic.md`](./docs/browser-wasmedge-isomorphic.md).

The checked-in same-artifact demo lives in
[`examples/isomorphic-loader`](./examples/isomorphic-loader):

- [`build-demo.mjs`](./examples/isomorphic-loader/build-demo.mjs) compiles the
  shared artifact
- [`browser-demo.html`](./examples/isomorphic-loader/browser-demo.html) and
  [`browser-demo.mjs`](./examples/isomorphic-loader/browser-demo.mjs) load that
  artifact in the browser harness with browser edge shims
- [`wasmedge-demo.mjs`](./examples/isomorphic-loader/wasmedge-demo.mjs) loads
  that same artifact in WasmEdge

Large streamed FlatBuffer ingest should use either the runtime-host transport
path or the resident-module stream pump, not one giant invoke envelope. See
[`docs/flatsql-streaming-standard.md`](./docs/flatsql-streaming-standard.md)
for the recommended browser/WasmEdge/FlatSQL split and the canonical
direct-binary ingest contract.

## Testing

This repo now exposes a manifest-driven harness generator from
`space-data-module-sdk/testing` and two complementary integration suites:

- browser/isomorphic helpers:
  - `createBrowserModuleHarness(...)`
  - `detectArtifactProfile(...)`
  - `loadModule(...)`

- shared process-level helpers for command-surface runtimes:
  - `createPluginInvokeProcessClient(...)`
  - `resolveWasmEdgePluginLaunchPlan(...)`
  - `buildWasmEdgeEmscriptenPthreadRunner(...)`

- `npm run test:runtime-matrix`
  - cross-language runtime smoke across the same WASM in Node.js, Go, Python,
    Rust, Java, C#, and Swift
  - covers method calling, aligned-binary envelope metadata preservation,
    stdin/stdout/stderr, args, env, preopened filesystem access, and basic WASI
    clock/time smoke
- `npm run test:host-surfaces`
  - authoritative Node-host coverage for HTTP, TCP, UDP, TLS, WebSocket, MQTT,
    process execution, timers, filesystem, and the sync `sdn_host` ABI
- `npm run test:stream-ingest`
  - correctness coverage for chunked size-prefixed FlatBuffer ingest into the
    runtime-host row store
- `npm run test:module-stream`
  - correctness coverage for chunked FlatBuffer streaming into a resident
    direct-surface module instance
- `npm run benchmark:stream-1gib`
  - env-gated local stress benchmark for 1 GiB total FlatBuffer transport ingest
- `npm run benchmark:module-stream-1gib`
  - env-gated local stress benchmark for 1 GiB total chunked module stream-pump
    ingest

The detailed edge cases and the current WASI-vs-host portability boundary are
documented in
[`docs/testing-harness.md`](./docs/testing-harness.md). The canonical
FlatBuffer-to-FlatSQL ingest contract is documented in
[`docs/flatsql-streaming-standard.md`](./docs/flatsql-streaming-standard.md).

## Install

```bash
npm install space-data-module-sdk
```

## Quick Start

```js
import {
  compileModuleFromSource,
  createSingleFileBundle,
  encodePluginManifest,
  parseSingleFileBundle,
  validateManifestWithStandards,
} from "space-data-module-sdk";

manifest.runtimeTargets = ["wasmedge"];

const manifestBytes = encodePluginManifest(manifest);
const validation = await validateManifestWithStandards(manifest);
if (!validation.ok) {
  throw new Error("Manifest validation failed.");
}

const compilation = await compileModuleFromSource({
  manifest,
  sourceCode,
  language: "c",
  // Optional. Defaults from manifest.runtimeTargets.
  // threadModel: "emscripten-pthreads",
});

const bundle = await createSingleFileBundle({
  wasmBytes: compilation.wasmBytes,
  manifest,
});

const parsed = await parseSingleFileBundle(bundle.wasmBytes);
```

Each subsystem is also available as a subpath export:

```js
import { encodePluginManifest } from "space-data-module-sdk/manifest";
import { validateManifestWithStandards } from "space-data-module-sdk/compliance";
import { createDeploymentAuthorization } from "space-data-module-sdk/auth";
import { encryptJsonForRecipient } from "space-data-module-sdk/transport";
import { compileModuleFromSource } from "space-data-module-sdk/compiler";
import { createSingleFileBundle } from "space-data-module-sdk/bundle";
import { validateDeploymentPlan } from "space-data-module-sdk/deployment";
import { generateManifestHarnessPlan } from "space-data-module-sdk/testing";
```

## Protocol Installation

Modules can declare hosted protocol contracts in `manifest.protocols`.

Those declarations are for stable artifact identity:

- `wireId`
- `transportKind`
- `role`
- `specUri`
- hosting hints like `defaultPort` and `requireSecureTransport`

Concrete multiaddrs, peer IDs, and producer routing do not belong in the
canonical manifest. They belong in deployment metadata attached to the final
package or bundle.

Deployment plans should key resolved protocol installations by `protocolId`.
They may include `wireId` as optional legacy metadata when a concrete transport
still needs it.

This repo exposes that deployment surface from
`space-data-module-sdk/deployment`. Use it to:

- validate resolved protocol installations
- describe input and publication bindings by declared `interfaceId`
- attach a deployment plan to `sds.bundle`

The full contract split is documented in
[`docs/protocol-installation.md`](./docs/protocol-installation.md).

## Single-File Bundles

`sds.bundle` keeps module delivery to one file without changing WebAssembly
loadability for the runtime payload itself. The SDK writes the bundle as a
standard custom section inside the wasm module. When the artifact is signed or
encrypted for publication, SDS appends FlatBuffer publication records after the
wasm bytes in a trailing `REC` container. Loaders must scan from the end,
resolve `PNM` / `ENC`, strip or decrypt as needed, and only then hand the
remaining raw wasm bytes to a runtime such as WasmEdge.

The reference path lives in
[`examples/single-file-bundle`](./examples/single-file-bundle):

- [`demo.mjs`](./examples/single-file-bundle/demo.mjs) builds and parses a
  bundled module
- [`generate-vectors.mjs`](./examples/single-file-bundle/generate-vectors.mjs)
  regenerates the checked-in conformance vectors
- the `go` and `python` directories show non-JS readers against the same
  bundle contract

Standard bundle payloads now include the optional `deployment-plan` JSON entry
for resolved protocol installations and producer input bindings.

## Publication Protection Extensions

Digital signature and encrypted-delivery metadata are publication-layer
extensions, not a second module format. The canonical module is still:

- valid `.wasm`
- optionally carrying `sds.bundle` as a wasm custom section
- optionally carrying one appended SDS `REC` trailer after the wasm bytes

That trailing `REC` FlatBuffer is the standards-backed container for
publication records:

- `PNM` is the publication notice / digital-signature record
  - identifies the artifact
  - carries the CID and publish timestamp
  - carries signature metadata so a loader can verify who published the module
- `ENC` is the encrypted-delivery record
  - carries the X25519 / AES-CTR / HKDF parameters needed to decrypt the
    protected transport payload
  - does not change the canonical module ABI or manifest shape

The loader contract is always:

1. Start with the protected blob.
2. Scan backward for the trailing `REC` footer.
3. Parse `REC` using the standards-generated `REC`, `PNM`, and `ENC`
   FlatBuffers from `spacedatastandards.org`.
4. Resolve `PNM` for signature/publication metadata.
5. Resolve `ENC` if the delivery was encrypted.
6. Strip the trailer or decrypt the protected payload.
7. Hand the remaining raw wasm bytes to the runtime.

Aligned-binary payloads are a separate invoke-ABI optimization. They do not
replace the canonical FlatBuffer schema. If a port advertises
`wireFormat: "aligned-binary"`, it must also advertise the regular
`wireFormat: "flatbuffer"` fallback for the same schema and file identifier in
the same accepted type set. The publication demo in the local lab uses a
regular `OMM.fbs` request and a `StateVector.fbs` response that advertises both
the canonical FlatBuffer fallback and the aligned-binary layout metadata.

## Module Publication

Packages that publish Space Data modules use the canonical `sdn-module`
publication descriptor. That descriptor covers:

- standalone module packages
- attached module artifacts shipped inside another language library
- discovery of bundled wasm
- appended `REC` trailers carrying `PNM` and optional `ENC`
- sidecar `PNM` / `ENC` FlatBuffers when a package does not embed the trailer

The full standard is in
[`docs/module-publication-standard.md`](./docs/module-publication-standard.md),
with concrete examples under [`examples/publishing`](./examples/publishing).

For npm packages, the simplest form is:

```json
{
  "name": "@example/orbit-lib",
  "version": "1.2.3",
  "sdn-module": "./dist/orbit-lib.module.wasm"
}
```

For module repos themselves, the canonical compiled artifact should live at:

```text
dist/isomorphic/module.wasm
```

If the repo also ships a direct browser adapter, publish it under:

```text
dist/browser/module.js
dist/browser/module.wasm
```

That keeps the shared browser/WasmEdge artifact path stable across repos while
leaving the browser-specific adapter optional.

When publication metadata is published in the same file, it belongs in an
appended SDS `REC` trailer. Loaders scan from the end of the protected blob,
resolve `PNM` / `ENC`, strip or decrypt as needed, and only then instantiate
the remaining raw wasm bytes.

## Host ABI

This repo also defines the module-facing capability vocabulary and the first
synchronous hostcall bridge under the import module `sdn_host`.

The current sync import surface is:

- `call_json(operation_ptr, operation_len, payload_ptr, payload_len) -> i32`
- `response_len() -> i32`
- `read_response(dst_ptr, dst_len) -> i32`
- `last_status_code() -> i32`
- `clear_response() -> i32`

Use `createNodeHost(...)` and `createNodeHostSyncHostcallBridge(...)` to run
that contract against the reference Node host while keeping the ABI shape
portable for non-JS hosts.

## Host Capabilities

Modules request capabilities by stable ID. The current recommended vocabulary
includes:

`clock` `random` `logging` `timers` `schedule_cron` `http` `tls` `websocket`
`mqtt` `tcp` `udp` `network` `filesystem` `pipe` `pubsub` `protocol_handle`
`protocol_dial` `database` `storage_adapter` `storage_query` `storage_write`
`context_read` `context_write` `process_exec` `crypto_hash` `crypto_sign`
`crypto_verify` `crypto_encrypt` `crypto_decrypt` `crypto_key_agreement`
`crypto_kdf` `wallet_sign` `ipfs` `scene_access` `entity_access`
`render_hooks`

Manifests can also declare coarse runtime targets for planning and compliance:

`node` `browser` `wasi` `wasmedge` `server` `desktop` `edge`

## Environment Notes

| Surface | Node.js | Browser |
|---|---|---|
| `manifest` | Yes | Yes |
| `auth` | Yes | Yes |
| `transport` | Yes | Yes |
| `bundle` | Yes | Yes |
| `compliance` | Yes | No |
| `compiler` | Yes | No |
| `standards` | Yes | No |

## CLI

```bash
# Validate a manifest + wasm pair
npx space-data-module check --manifest ./manifest.json --wasm ./dist/isomorphic/module.wasm

# Compile C/C++ source and embed the manifest
npx space-data-module compile --manifest ./manifest.json --source ./src/module.c --out ./dist/isomorphic/module.wasm

# Sign and encrypt a deployment payload
npx space-data-module protect --manifest ./manifest.json --wasm ./dist/isomorphic/module.wasm --json

# Emit a single-file bundled wasm
npx space-data-module protect --manifest ./manifest.json --wasm ./dist/isomorphic/module.wasm --single-file-bundle --out ./dist/module.bundle.wasm
```

## Module Lab

The repo also includes a local browser lab for compiling, validating, and
packaging modules:

```bash
npm run start:lab
```

Then open `http://localhost:4318`.

Use the `Run Publication Demo` button to generate a protected demo artifact and
inspect the parsed `REC`, `PNM`, and `ENC` records produced by the real
`spacedatastandards.org` generated message classes.

## Related Projects

- [`spacedatastandards.org`](https://spacedatastandards.org)
- [`sdn-flow`](https://github.com/DigitalArsenal/sdn-flow)
- [`hd-wallet-wasm`](https://github.com/nicktj-dev/hd-wallet-wasm)

## Development

```bash
npm install
npm test
npm run check:compliance
```

Node.js `>=20` is required. The compiler uses `sdn-emception` and `flatc-wasm`
by default for the embedded toolchain path. For multi-repo module builds, use a
repo-local `deps/emsdk` checkout by default instead of Homebrew or any other
machine-global Emscripten install. Treat `PATH` Emscripten as an explicit escape
hatch, not the default. WasmEdge pthread builds still require a system
Emscripten toolchain on `PATH`.

If another repo needs the same compiler runtime, the package also exposes a
shared emception session at `space-data-module-sdk/compiler/emception` with
helpers for serialized command execution and virtual filesystem access.

## License

[MIT](./LICENSE)
