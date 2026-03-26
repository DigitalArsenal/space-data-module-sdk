# Testing Harness

This repo now includes a manifest-driven harness generator at
`space-data-module-sdk/testing` plus a cross-language runtime matrix suite.

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

The generator does two things:

1. It derives smoke cases from the manifest shape and invoke surfaces.
2. It classifies declared capabilities by runtime surface:
   - WASI-native
   - sync hostcall
   - Node host API only

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
surface here. Those capabilities exist today on the Node host API side, and the
repo already tests them in `test/node-host.test.js`. Treat the runtime matrix as
the portable guest suite and `npm run test:host-surfaces` as the authoritative
Node-host suite for the default Node-RED-style services.

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

These remain Node-host-only today from a guest execution perspective:

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

Portable-but-narrow today:

- `logging` via stdout/stderr
- `pipe` via stdio descriptors only

The harness generator exposes this distinction explicitly so module authors can
see which capabilities are portable today and which still require host-side or
future async ABI work.

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

Anything else still requires a host adapter, delegated service, or future async
ABI expansion and therefore should not claim the canonical `wasi` runtime
target yet.

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
