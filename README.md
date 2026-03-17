# Space Data Module SDK

A unified SDK for building, validating, signing, and deploying **WebAssembly plugin modules** that run anywhere on the [Space Data Network](https://digitalarsenal.github.io/space-data-network/) — from [OrbPro](https://orbpro.ai) desktops to SDN peer nodes, ground stations, and browsers.

The space domain has a fragmentation problem: every platform ships its own plugin format, its own manifest schema, its own packaging conventions. A propagator written for one system can't run on another without a rewrite. This SDK solves that by defining a **single canonical module format** — a WebAssembly binary with an embedded [FlatBuffers](https://digitalarsenal.github.io/flatbuffers/) manifest — that every runtime in the ecosystem understands.

Modules declare **typed streaming ports** that accept data conforming to [spacedatastandards.org](https://spacedatastandards.org) schemas (OMM, CAT, EPM, CDM, and 40+ others). A propagator that consumes OMM messages and emits state vectors works identically whether it's running inside OrbPro's 3D scene, processing data on an SDN relay node, or executing at the edge on a ground station.

<p align="center">
  <img src="docs/architecture.svg" alt="Architecture overview" width="820" />
</p>

## How It Works

The SDK handles the full module lifecycle — from source code to a signed, encrypted, deployment-ready package:

<p align="center">
  <img src="docs/module-lifecycle.svg" alt="Module lifecycle" width="820" />
</p>

1. **Author** a JSON manifest declaring your module's identity, methods, typed I/O ports, host capabilities, and the [spacedatastandards.org](https://spacedatastandards.org) schemas it consumes and produces.
2. **Compile** your C/C++ source (via Emscripten) into a `.wasm` binary with the manifest automatically embedded as a FlatBuffers blob that runtimes can read at load time.
3. **Validate** the manifest and artifact against compliance rules — correct port declarations, canonical capability IDs, required WASM ABI exports (`plugin_get_manifest_flatbuffer`, `plugin_get_manifest_flatbuffer_size`), and schema resolution against the standards catalog.
4. **Sign** the package with an HD-wallet-derived secp256k1 key, producing a deployment authorization that binds the manifest hash, WASM hash, target, and granted capabilities.
5. **Protect** the signed package by encrypting it for a specific recipient using X25519 key agreement + AES-256-GCM, so modules can be transported securely across the network.

## Manifest & Typed Ports

Every module carries a manifest that declares **what data it can process**. Methods expose typed input and output ports, and each port declares the FlatBuffer schemas it accepts — referencing standards by schema name and file identifier:

<p align="center">
  <img src="docs/manifest-structure.svg" alt="Manifest structure" width="820" />
</p>

This means runtimes can **automatically wire modules together** — connecting a propagator's `CAT` output to a conjunction screener's `CAT` input — without any glue code. The type system ensures only compatible modules get connected.

## Ecosystem

This SDK is one piece of the Space Data Network stack:

| Project | Role |
|---|---|
| [Space Data Network](https://digitalarsenal.github.io/space-data-network/) | Peer-to-peer network for space data exchange |
| [spacedatastandards.org](https://spacedatastandards.org) | 40+ canonical FlatBuffer schemas for space operations data (OMM, EPM, CAT, CDM, etc.) |
| [FlatBuffers schemas](https://digitalarsenal.github.io/flatbuffers/) | Binary serialization layer used across the entire network |
| [OrbPro](https://orbpro.ai) | Space domain awareness platform — one of the runtimes that hosts these modules |
| [hd-wallet-wasm](https://github.com/nicktj-dev/hd-wallet-wasm) | HD wallet primitives for module signing and identity |

## Install

```bash
npm install space-data-module-sdk
```

## Quick Start

```js
import {
  encodeManifest, decodeManifest,   // FlatBuffers manifest codec
  checkCompliance,                   // validate against standards
  signManifest, verifyManifest,      // HD wallet auth
  encryptPayload, decryptPayload,    // X25519 + AES-256-GCM transport
  compileModule,                     // source-to-wasm compilation
} from "space-data-module-sdk";
```

### Subpath Exports

Each subsystem is available as a standalone import:

```js
import { encodeManifest } from "space-data-module-sdk/manifest";
import { checkCompliance } from "space-data-module-sdk/compliance";
import { signManifest }    from "space-data-module-sdk/auth";
import { encryptPayload }  from "space-data-module-sdk/transport";
import { compileModule }   from "space-data-module-sdk/compiler";
import { resolveStandard } from "space-data-module-sdk/standards";
```

## CLI

Every SDK operation is also available from the command line:

```bash
# Validate a manifest + wasm pair against compliance rules
npx space-data-module check --manifest ./manifest.json --wasm ./dist/module.wasm

# Compile C/C++ source to a wasm module with embedded manifest
npx space-data-module compile --manifest ./manifest.json --source ./src/module.c --out ./dist/module.wasm

# Sign and encrypt a module package for transport
npx space-data-module protect --manifest ./manifest.json --wasm ./dist/module.wasm --json
```

## Module Lab

An interactive browser tool for compiling, validating, and packaging modules — useful for exploring the manifest format and testing modules without touching the CLI.

```bash
npm run start:lab
# http://localhost:4318
```

## Plugin Families

Modules declare a `pluginFamily` that tells runtimes what role they serve:

| Family | Purpose |
|---|---|
| `sensor` | Ingest raw data feeds (radar, optical, RF) |
| `propagator` | Orbit propagation and state prediction |
| `renderer` | 3D visualization and scene rendering |
| `analysis` | Data processing, filtering, aggregation |
| `data_source` | External data connectors |
| `comms` | Communications link modeling |
| `shader` | GPU shader programs |
| `sdf` | Signed distance field geometry |
| `infrastructure` | Network and platform services |
| `flow` | Multi-module data flow orchestration |
| `bridge` | Cross-runtime adapters |

## Host Capabilities

Modules request host capabilities by name. The runtime grants or denies them at load time based on the deployment authorization:

`clock` `random` `timers` `http` `network` `filesystem` `pipe` `pubsub` `protocol_handle` `protocol_dial` `database` `storage_adapter` `storage_query` `storage_write` `wallet_sign` `ipfs` `scene_access` `render_hooks`

## Development

```bash
npm install
npm test
```

Requires Node.js >= 20. Compilation requires [Emscripten](https://emscripten.org/) (`emcc`/`em++`) on `PATH`.

## License

See [LICENSE](LICENSE).
