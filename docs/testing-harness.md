# Testing Harness

This repo now includes two related testing/runtime surfaces in
`space-data-module-sdk/testing`:

- the manifest-driven harness generator for contract smoke tests
- the canonical dynamic runtime-host harness for multi-module process and
  WasmEdge execution

The runtime-host harness is the new baseline for paid-module/server/browser-node
execution. Single-module invoke is still supported, but it now sits on top of
the same host-controlled process model as a compatibility profile.

## Public API

Use the generator when you want contract-level smoke coverage for an arbitrary
module or flow manifest:

```js
import {
  generateManifestHarnessPlan,
  materializeHarnessScenario,
} from "space-data-module-sdk/testing";

const plan = generateManifestHarnessPlan({
  manifest,
  preferredWireFormat: "aligned-binary",
  payloadForPort({ methodId, portId, typeRef }) {
    if (methodId === "echo" && portId === "in") {
      console.log("selected wire format:", typeRef?.wireFormat ?? "flatbuffer");
      return "hello";
    }
    return null;
  },
});

const commandCase = materializeHarnessScenario(
  plan.scenarios.find((scenario) => scenario.id === "command:echo"),
);
```

For actual runtime-host execution, use `createModuleHarness(...)` or the lower
level process clients:

```js
import {
  createModuleHarness,
  createPluginInvokeProcessClient,
  resolveWasmEdgePluginLaunchPlan,
} from "space-data-module-sdk";

const harness = await createModuleHarness({
  runtime: {
    kind: "process",
    hostProfile: "runtime-host",
    command: process.execPath,
    args: ["--input-type=module", "--eval", runtimeHostServerScript],
    modules: [
      { moduleId: "alpha", metadata: { tier: "paid" } },
      { moduleId: "beta", metadata: { tier: "paid" } },
    ],
    defaultModuleId: "alpha",
  },
});

await harness.installModule({ moduleId: "gamma", metadata: { tier: "trial" } });
const modules = await harness.listModules();
const rowHandle = await harness.appendRow({
  schemaFileId: "OMM",
  payload: { noradCatId: 25544 },
});
const region = await harness.allocateRegion({
  layoutId: "propagator-state",
  recordByteLength: 64,
  alignment: 16,
  initialRecords: [new Uint8Array(64)],
});
const response = await harness.invokeModule("beta", {
  methodId: "echo",
  inputs: [{ portId: "request", payload: new TextEncoder().encode("hello") }],
});
```

The same host control surface is available from `createPluginInvokeProcessClient`
and `createWasmEdgeStreamProcessClient`:

- `installModule(definition)`
- `listModules()`
- `unloadModule(moduleId)`
- `invokeModule(moduleId, request)`
- `appendRow({ schemaFileId, payload })`
- `listRows(schemaFileId?)`
- `resolveRow({ schemaFileId, rowId })`
- `allocateRegion({ layoutId, recordByteLength, alignment, initialRecords })`
- `describeRegion(regionId)`
- `resolveRecord({ regionId, recordIndex })`

In-process `createRuntimeHost()` also exposes `registerExternalRegion(...)`,
`setRegionRecordCount(...)`, and `resolveRecordView(...)` for hosts that already
own resident buffers and need transient region descriptors without turning raw
addresses into durable harness identity. Those helpers are not part of the
current process/WasmEdge control protocol, which remains copy-based.

For outer transport ingest, the runtime-host surface also exposes
`createFlatBufferStreamIngestor(...)`. That helper is intentionally outside the
module invoke ABI. It accepts little-endian size-prefixed FlatBuffer stream
chunks and appends durable rows through `createFlatSqlRuntimeStore()`.

Identity rules remain:

- standards rows are addressed by `($SCHEMA_FILE_ID, rowId)`
- aligned runtime records are addressed by `(regionId, recordIndex)`
- raw pointers remain internal execution details, not durable harness identity

The generator does two things:

1. It derives smoke cases from the manifest shape and invoke surfaces.
2. It classifies declared capabilities by runtime surface:
   - WASI-native
   - sync hostcall
   - async host API

When a port advertises multiple payload wire formats, pass
`preferredWireFormat` to select which declared type ref the generated smoke
cases should use. This is useful for contracts that accept regular FlatBuffer
inputs but also expose aligned-binary ports or dual-format test fixtures.
Aligned-binary entries are expected to ship with a regular FlatBuffer fallback
for the same schema in the same accepted type set, and the harness will choose
between those declared type refs rather than inventing one.

## Flows

Flows are treated as degenerate modules for harness generation. The generator
does not require a separate flow-only code path. A flow manifest still produces
method-level invoke cases and capability classifications.

For runtime execution, flows should target the same dynamic runtime-host model.
Host runtime packages may still compile or bundle flows for deployment, but the harness
contract in this repo is now the canonical host surface for:

- installing multiple modules into one host
- wiring host-owned row and region services
- exercising the same control plane in process mode and WasmEdge mode

## Runtime Matrix

The runtime matrix lives in `test/runtime-matrix.test.js` and is intentionally a
separate integration script:

```bash
npm run test:runtime-matrix
```

### Languages covered

- Node.js: native WASI runner
- Go: native WASI runner via `wazero`
- Python: native WASI runner via `wasmtime`
- C#: fallback wrapper around the canonical Node runner
- Java: fallback wrapper around the canonical Node runner
- Rust: fallback wrapper around the canonical Node runner
- Swift: fallback wrapper around the canonical Node runner

### Why some languages are wrappers today

`../flatbuffers/wasm` documents a wider language/runtime ecosystem than this SDK
currently maintains natively. The SDK matrix therefore uses:

- native WASI execution where the runtime path is clean and stable in this repo
- a shared Node-based fallback where the language/runtime bridge is still in
  flux or would otherwise make the test suite fragile

That keeps every supported language in the matrix immediately while preserving a
single canonical execution baseline.

## Dynamic Runtime-Host Harness

The SDK now treats dynamic host composition as the default server/browser/WasmEdge
execution model. The harness supports two execution profiles:

1. Compatibility profile:
   - single module
   - plain `invoke(...)`
   - same shape as the earlier process harness

2. Runtime-host profile:
   - multiple installed modules in one host
   - explicit module install/list/unload/invoke controls
   - host-owned row services and aligned-binary region services

Process mode can emulate the runtime host with a normal Node child process. For
WasmEdge, the runner can start in standalone host mode with:

```js
const plan = resolveWasmEdgePluginLaunchPlan({
  hostProfile: "runtime-host",
  wasmEdgeRunnerBinary: process.env.WASMEDGE_RUNNER_BINARY,
});
```

That launches the runner with `--serve-runtime-host` and no preloaded guest
module. Modules are then installed over the host control channel.

## Covered Surfaces

The matrix and the existing Node host tests together cover:

- method calling through command-mode invoke envelopes
- aligned-binary metadata preservation on command-mode echoes
- stdin/stdout/stderr capture for WASI guests
- args and environment wiring
- filesystem path smoke through WASI/preopen setup
- WASI clock/time smoke
- sync `sdn_host` byte-envelope coverage for `random.bytes`
- host capability surface classification
- the Node host API suite for HTTP, TCP, UDP, TLS, WebSocket, MQTT, exec,
  context, crypto, timers, and filesystem semantics

Run the host-only suite directly with:

```bash
npm run test:host-surfaces
```

Run the streamed FlatBuffer ingest checks with:

```bash
npm run test:stream-ingest
npm run test:module-stream
npm run benchmark:stream-1gib
npm run benchmark:module-stream-1gib
```

The 1 GiB path is env-gated and intended for local stress/perf work. It
measures either outer transport ingest or chunked resident-module ingest, not
one giant `PluginInvokeRequest`.

## Important Edge Cases

### 1. Generated harnesses are contract smoke tests, not semantic proofs

The manifest can tell the harness how to invoke a method, but not what the
method should do. Generated cases therefore verify ABI compatibility and surface
shape. Any module-specific semantics still need scenario fixtures or custom
validators.

### 2. Command mode owns stdout

For command-surface plugin tests, stdout is the invoke response channel. A guest
method that writes arbitrary bytes to stdout can corrupt the response envelope.
Use stderr for diagnostics in command-mode methods.

### 3. Direct invoke is not the cross-language baseline today

The matrix uses command-mode invoke for broad portability. Direct invoke still
exists and is covered in the Node-based SDK tests, but it requires runtime-
specific memory management and export calling that is not yet normalized across
every language adapter.

For dynamic runtime-host tests, use the host-control APIs instead of assuming a
single command-surface guest is the whole runtime.

Direct invoke is also not the right path for multi-hundred-megabyte or 1 GiB
single-request benchmarks. The invoke ABI is still batch-oriented and fully
buffered.

If a module needs resident internal state, such as a FlatSQL instance imported
inside the SDN module itself, prefer `createModuleFlatBufferStreamPump(...)`
with a persistent direct-surface harness. That keeps the stream chunked and
binary while preserving guest state across many small invokes.

### 4. WASI filesystem behavior is still only smoke-tested cross-runtime

Preopen path handling is not perfectly consistent across all runtimes used by
the matrix. The integration suite therefore asserts that filesystem wiring does
not crash and that path-based probes run, but the authoritative filesystem
semantics remain in the Node host tests.

### 5. Pipes are partially portable, not universally portable

The outer harness processes use normal OS pipes for subprocess communication.
Inside the guest, many runtimes are more reliable with file-backed stdin/stdout/
stderr descriptors than with arbitrary pipe wiring. The matrix currently uses
file-backed guest stdio for portability. That covers the portable stdio-style
pipe contract, but not arbitrary named-pipe services.

### 6. Network and most Node-RED-style host services are not WASI-native

Pure WASI does not provide a portable HTTP/TCP/UDP/WebSocket/MQTT/process-exec
surface here. Those capabilities exist today on the async host API side, and
the repo tests them through the Node host, browser host, and browser module
harness suites. Treat the runtime matrix as the portable guest suite and
`npm run test:host-surfaces` as the authoritative host-adapter suite for the
default Node-RED-style services.

### 7. Random entropy is not a stable libc-level cross-runtime assertion here

The capability matrix still marks `random` as WASI-native in principle, but the
libc entry points used by standalone C guests are not consistently portable
across every runtime in this matrix. The suite therefore classifies `random`
correctly but does not hard-fail the matrix on a specific libc randomness call.

### 8. The sync guest hostcall ABI is intentionally narrow

The current `sdn_host` sync ABI is JSON-over-memory and only supports
synchronous operations cleanly. That makes these capabilities practical for
WASM guests today:

- `clock`
- `schedule_cron`
- `filesystem.resolvePath`

These remain async host API capabilities today from a guest execution
perspective:

- `network`
- `http`
- `tcp`
- `udp`
- `tls`
- `websocket`
- `mqtt`
- `timers`
- `process_exec`
- `context_read`
- `context_write`
- `crypto_hash`
- `crypto_sign`
- `crypto_verify`
- `crypto_encrypt`
- `crypto_decrypt`
- `crypto_key_agreement`
- `crypto_kdf`
- `ipfs`
- `protocol_handle`
- `protocol_dial`

Portable-but-narrow today:

- `logging` via stdout/stderr
- `pipe` via stdio descriptors only

The harness generator exposes this distinction explicitly so module authors can
see which capabilities are portable in the raw guest ABI today and which
require the async host adapter path.

That async host adapter path is now a single generic capability boundary:

- `NodeHost.invoke(...)`
- `BrowserHost.invoke(...)`
- `createRuntimeHost().invoke(...)`
- `loadModule(...).callHost(...)`
- `createBrowserModuleHarness(...).callHost(...)`

Those entry points all dispatch the same awaited capability ids and operation
names. If you override reference behavior, do it with explicit
`capabilityAdapters` keyed by canonical capability id rather than inventing a
repo-local host API variant.

This JSON-over-memory note applies only to the current sync `sdn_host` guest
ABI. It is not the canonical FlatBuffer stream-ingest contract, which uses
direct size-prefixed FlatBuffer frames and keeps payload bytes binary end-to-end.

## Strict Standalone WASI Target

When a manifest declares `runtimeTargets: ["wasi"]`, the SDK should interpret
that as a stricter statement than "can run inside some wrapper-managed WASM
host." It means the artifact is expected to run as a standalone WASI program.

The current SDK enforcement for that target is:

- `invokeSurfaces` must include `command`
- capabilities must stay within the current standalone-WASI subset:
  - `logging`
  - `clock`
  - `random`
  - `filesystem`
  - `pipe`
- hosted protocols may only use `wasi-pipe`

Anything else still requires a host adapter, delegated service, or a future raw
guest async ABI expansion and therefore should not claim the canonical `wasi`
runtime target yet.

## WasmEdge Deployment Target

Use `runtimeTargets: ["wasmedge"]` for the standard server-side deployment
target when the goal is maximum WASI compatibility rather than strict
standalone-WASI purity.

That target assumes a WasmEdge environment with socket/TLS extensions
available. In this repo’s capability matrix, these families become reasonable
guest-side targets even though they are not plain standalone WASI:

- `network`
- `http`
- `tcp`
- `udp`
- `tls`

The full Node-RED parity map lives in
[`docs/node-red-default-node-parity.md`](./node-red-default-node-parity.md).
