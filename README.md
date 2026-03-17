# Space Data Module SDK

SDK for building, validating, signing, and deploying WebAssembly modules on the [Space Data Network](https://digitalarsenal.github.io/space-data-network/).

Part of the Space Data Network ecosystem:

- [Space Data Network](https://digitalarsenal.github.io/space-data-network/) — peer-to-peer network for space data exchange
- [spacedatastandards.org](https://spacedatastandards.org) — canonical data standards for space operations
- [FlatBuffers schemas](https://digitalarsenal.github.io/flatbuffers/) — binary serialization schemas used across the network
- [OrbPro](https://orbpro.ai) — space domain awareness platform

## Install

```bash
npm install space-data-module-sdk
```

## Usage

```js
import {
  encodeManifest, decodeManifest,   // manifest codec
  checkCompliance,                   // validate against spacedatastandards.org
  signManifest, verifyManifest,      // auth / signatures
  encryptPayload, decryptPayload,    // transport encryption
  compileModule,                     // source-to-wasm compilation
} from "space-data-module-sdk";
```

### Subpath exports

```js
import { encodeManifest } from "space-data-module-sdk/manifest";
import { checkCompliance } from "space-data-module-sdk/compliance";
import { signManifest }    from "space-data-module-sdk/auth";
import { encryptPayload }  from "space-data-module-sdk/transport";
import { compileModule }   from "space-data-module-sdk/compiler";
import { resolveStandard } from "space-data-module-sdk/standards";
```

## CLI

```bash
# Validate a manifest + wasm pair against compliance rules
npx space-data-module check --manifest ./manifest.json --wasm ./dist/module.wasm

# Compile source to a wasm module
npx space-data-module compile --manifest ./manifest.json --source ./src/module.c --out ./dist/module.wasm

# Sign and encrypt a module for transport
npx space-data-module protect --manifest ./manifest.json --wasm ./dist/module.wasm --json
```

## Module Lab

A browser-based tool for compiling, validating, and packaging modules interactively.

```bash
npm run start:lab
# http://localhost:4318
```

## Development

```bash
npm install
npm test
```

Requires Node.js >= 20.

## Architecture

Modules carry an embedded binary manifest encoded with [FlatBuffers](https://digitalarsenal.github.io/flatbuffers/) (schemas in [`schemas/`](schemas/)). The SDK validates modules against data standards published at [spacedatastandards.org](https://spacedatastandards.org) and uses HD-wallet-derived keys via [`hd-wallet-wasm`](https://github.com/nicktj-dev/hd-wallet-wasm) for manifest signing and transport encryption.

## License

See [LICENSE](LICENSE).
