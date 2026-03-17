# Single-File Module Bundle Runtime Plan

This document turns the single-file deployment idea into a concrete runtime plan for this SDK, using the actual host runtimes already documented or exercised in `../flatbuffers/wasm`.

## Goal

Deploy one loadable `.wasm` file that carries:

- executable code
- the canonical plugin manifest
- deployment authorization and signature metadata
- optional transport metadata

The file must still compile and instantiate as WebAssembly, so metadata must live in valid custom sections rather than as raw trailing bytes.

## Runtime Target Matrix

The target set below comes from the local `../flatbuffers/wasm` checkout.

| Host target | WASM runtime | Local reference |
| --- | --- | --- |
| Node.js / TypeScript | native V8 | `../flatbuffers/wasm/docs/docs/nodejs.md` |
| Browser / TypeScript | native browser engine | `../flatbuffers/wasm/docs/docs/browser.md` |
| Go | wazero | `../flatbuffers/wasm/docs/docs/go.md` |
| Python | wasmer or wasmtime | `../flatbuffers/wasm/docs/docs/python.md` |
| Rust | wasmer | `../flatbuffers/wasm/docs/docs/rust.md` |
| Java | Chicory | `../flatbuffers/wasm/docs/docs/java.md` |
| Kotlin | Chicory | `../flatbuffers/wasm/examples/e2e-crypto-test/runners/kotlin/README.md` |
| C# | Wasmtime | `../flatbuffers/wasm/docs/docs/csharp.md` |
| Swift | WasmKit | `../flatbuffers/wasm/docs/docs/swift.md` |

This plan focuses on those runtime targets, not every `flatc` code generation language.

## Proposed On-Disk Format

### Required wasm custom section

- `sds.bundle`

`schemas/ModuleBundle.fbs` defines the bytes stored in `sds.bundle`.

### Optional compatibility path

Keep the existing embedded-manifest ABI exports for now:

- `plugin_get_manifest_flatbuffer`
- `plugin_get_manifest_flatbuffer_size`

Those exports are generated today in `src/embeddedManifest.js`, and compilation wires them in from `src/compiler/compileModule.js`.

### Payload model

`sds.bundle` is the typed index for every metadata payload embedded in the file.

Each `ModuleBundleEntry` carries:

- a semantic role such as manifest, authorization, signature, or transport
- a `FlatBufferTypeRef` when the payload is a FlatBuffer
- an encoding discriminator so the repo can migrate from current JSON envelopes to SDS FlatBuffers without changing the outer format
- a payload hash for integrity checks

This transition field matters because the repo currently emits JSON authorization and encrypted envelopes in `src/auth/permissions.js` and `src/transport/pki.js`, while the manifest already has a canonical FlatBuffer representation.

## Canonicalization Rule

Signatures must not cover their own container bytes.

Use this rule everywhere:

1. Parse the wasm module.
2. Remove every custom section whose name starts with `sds.`.
3. Re-encode the remaining module bytes without changing the order of non-`sds` sections.
4. Hash the stripped bytes with SHA-256.
5. Store that digest as `canonical_module_hash`.
6. Verify detached signatures against that digest, not against the raw file bytes.

This makes the module stable even if `sds.bundle` is regenerated or re-signed.

## Recommended Entry Set

The first implementation should standardize these logical entries inside `sds.bundle`.

| Entry id | Role | Encoding | Type reference |
| --- | --- | --- | --- |
| `manifest` | `MANIFEST` | `FLATBUFFER` | `PluginManifest.fbs` / `PMAN` |
| `authorization` | `AUTHORIZATION` | `JSON_UTF8` first, later `FLATBUFFER` | new SDS auth schema |
| `signature` | `SIGNATURE` | `FLATBUFFER` when available | `DetachedSignature.fbs` / `SIGD` |
| `transport` | `TRANSPORT` | `JSON_UTF8` first, later `FLATBUFFER` | new SDS transport schema |

Notes:

- `DetachedSignature.fbs` is already recognized in `src/standards/sharedCatalog.js`.
- `ProtectedCatalogEntry.fbs` is also in the shared catalog and may be useful later for richer bundle metadata.
- Full-module encryption is intentionally out of scope for a loadable `.wasm`; encrypting the whole file produces a non-wasm blob. Only metadata payloads can be encrypted while keeping the artifact directly loadable.

## Common Client Surface

Every runtime client should expose the same high-level operations:

```text
readModule(bytes) -> ModuleBundleView
listEntries() -> [EntryView]
getManifestBytes() -> bytes | null
getAuthorizationBytes() -> bytes | null
getSignatureBytes() -> bytes | null
getTransportBytes() -> bytes | null
stripSdsSections() -> bytes
computeCanonicalModuleHash() -> bytes
verifyDetachedSignature(verifyFn) -> bool
```

Language-specific wrappers can then add typed helpers:

- `getManifest()` returning generated `PluginManifest` bindings
- `getBundle()` returning generated `ModuleBundle` bindings
- `getSignature()` returning generated `DetachedSignature` bindings when that schema is available

## Shared Parser Algorithm

Every runtime should use the same byte-level wasm parser. This avoids relying on host-specific custom-section APIs and keeps behavior identical across runtimes.

```text
read magic and version
while bytes remain:
  read section id
  read section length (ULEB128)
  if section id != 0:
    skip payload
    continue
  read custom section name length (ULEB128)
  read custom section name bytes
  remaining bytes in this section are the custom payload
  if name == "sds.bundle":
    decode payload as ModuleBundle FlatBuffer
  if name starts with "sds.":
    omit when building canonical bytes
```

Implementation details that must stay identical across languages:

- unsigned LEB128 decoding
- exact custom-section payload slicing
- exact reconstruction of stripped wasm bytes
- SHA-256 over the stripped bytes

## Per-Target Wrapper Shape

### Node.js and Browser

Use these as the reference clients.

- Provide a pure JS parser in this repo.
- Decode `ModuleBundle` and `PluginManifest` using generated JS/TS FlatBuffers bindings.
- In Node, optionally expose `WebAssembly.Module.customSections` as a fast path, but keep the byte parser as the canonical path.
- In browsers, keep the API async-friendly for `fetch()` and `ArrayBuffer`.

### Go

Match the style used by the local wazero guide in `../flatbuffers/wasm/docs/docs/go.md`.

- Pure Go parser over `[]byte`
- No need to instantiate the wasm module to read bundle metadata
- Generated FlatBuffers Go bindings for `ModuleBundle` and `PluginManifest`
- Separate optional loader path for actually instantiating the module with wazero

### Python

Match the documented wasmer/wasmtime host model in `../flatbuffers/wasm/docs/docs/python.md`.

- Pure Python parser over `bytes`
- FlatBuffers Python generated classes for bundle decoding
- Keep module parsing separate from any execution wrapper so bundle inspection works without WASI setup

### Rust

Match the local wasmer examples.

- Zero-copy parser over `&[u8]`
- `ModuleBundleView` should borrow from the original byte slice when practical
- Keep execution concerns separate from metadata extraction

### Java and Kotlin

Both should share one design because the local Kotlin runner also uses Chicory.

- Use a pure byte parser over `byte[]` or `ByteBuffer`
- Decode the FlatBuffer with generated Java classes
- Keep one common core library usable from Java and Kotlin

### C#

Match the Wasmtime integration style in `../flatbuffers/wasm/docs/docs/csharp.md`.

- Parser over `ReadOnlySpan<byte>` plus a convenience `byte[]` overload
- Decode with generated C# FlatBuffers bindings
- Separate metadata reader from execution wrapper

### Swift

Match the WasmKit-based local guide.

- Parser over `Data` or `[UInt8]`
- Decode with generated Swift FlatBuffers bindings
- Keep metadata extraction independent from WasmKit instantiation

## Implementation Order For This Repo

1. Add `ModuleBundle.fbs`.
2. Generate JS/TS bindings for `ModuleBundle`.
3. Add a reference JS parser for wasm sections and canonical stripping.
4. Update `protectModuleArtifact()` to emit `sds.bundle`.
5. Keep current manifest export symbols for backward compatibility.
6. Add conformance vectors:
   - bare wasm
   - wasm plus `sds.bundle`
   - wasm plus invalid trailing bytes
   - wasm plus signature entry
   - wasm plus encrypted transport entry
7. Mirror the parser in the runtime targets listed above.

## Immediate Follow-On Work

The outer container format can be implemented now, even before every metadata payload becomes a FlatBuffer.

That gives a clean migration path:

- phase 1: manifest as FlatBuffer, authorization and transport as JSON payload entries
- phase 2: add SDS auth and transport schemas
- phase 3: require FlatBuffer payloads for all standard entries

## Current Repo Touch Points

These files are the main integration points for the bundle work:

- `src/embeddedManifest.js`
- `src/compiler/compileModule.js`
- `src/auth/permissions.js`
- `src/transport/pki.js`
- `src/runtime/constants.js`
