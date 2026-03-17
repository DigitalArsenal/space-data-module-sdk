# Space Data Module SDK

Shared module SDK for building, validating, signing, and deploying WebAssembly modules on the [Space Data Network](https://digitalarsenal.github.io/space-data-network/).

Part of the Space Data Network ecosystem:

- [Space Data Network](https://digitalarsenal.github.io/space-data-network/) — peer-to-peer network for space data exchange
- [spacedatastandards.org](https://spacedatastandards.org) — canonical data standards for space operations
- [FlatBuffers schemas](https://digitalarsenal.github.io/flatbuffers/) — binary serialization schemas used across the network
- [OrbPro](https://orbpro.ai) — space domain awareness platform

## Packages

- [`@digitalarsenal/module-sdk`](packages/module-sdk) — Core SDK: manifest codec, compliance validation, compiler harness, auth, transport, and standards integration
- [`@digitalarsenal/module-lab`](apps/module-lab) — Browser-based verification lab for compiling, validating, and packaging modules

## Install

```bash
npm install @digitalarsenal/module-sdk
```

## Usage

```js
import {
  encodeManifest, decodeManifest,   // manifest codec
  checkCompliance,                   // validate against spacedatastandards.org
  signManifest, verifyManifest,      // auth / signatures
  encryptPayload, decryptPayload,    // transport encryption
  compileModule,                     // source-to-wasm compilation
} from "@digitalarsenal/module-sdk";
```

### Subpath exports

```js
import { encodeManifest } from "@digitalarsenal/module-sdk/manifest";
import { checkCompliance } from "@digitalarsenal/module-sdk/compliance";
import { signManifest }    from "@digitalarsenal/module-sdk/auth";
import { encryptPayload }  from "@digitalarsenal/module-sdk/transport";
import { compileModule }   from "@digitalarsenal/module-sdk/compiler";
import { resolveStandard } from "@digitalarsenal/module-sdk/standards";
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
npm install   # install all workspace dependencies
npm test      # run tests across all packages
npm run build # build all packages
```

Requires Node.js >= 20.

## Architecture

Modules carry an embedded binary manifest encoded with [FlatBuffers](https://digitalarsenal.github.io/flatbuffers/) (schemas in [`packages/module-sdk/schemas/`](packages/module-sdk/schemas)). The SDK validates modules against data standards published at [spacedatastandards.org](https://spacedatastandards.org) and uses HD-wallet-derived keys via [`hd-wallet-wasm`](https://github.com/nicktj-dev/hd-wallet-wasm) for manifest signing and transport encryption.

## License

See [LICENSE](LICENSE).
