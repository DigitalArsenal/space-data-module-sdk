# Module Publication Standard

This document defines how a compliant Space Data module is published through the
language package ecosystems used around the SDK runtime surface:

- npm
- PyPI
- Maven Central
- NuGet
- Go modules
- crates.io
- Swift Package Manager

The goal is simple: a loader should be able to inspect a package, locate the
module artifact, and determine whether signatures or encrypted transport
metadata are appended as SDS publication records after the module bytes or
shipped as sidecar FlatBuffers.

## Scope

This publication standard covers two release modes:

- `standalone`: the package's primary deliverable is the SDN module itself
- `attached`: the package primarily exists for another language runtime, but it
  also ships one compliant SDN module build artifact

In both cases the module artifact remains the same canonical format already
defined by this repo:

- a runtime payload that is valid WebAssembly bytes once any SDS publication
  trailer has been stripped
- embedded `PluginManifest.fbs`
- manifest accessors
  - `plugin_get_manifest_flatbuffer`
  - `plugin_get_manifest_flatbuffer_size`
- optional `sds.bundle` custom-section metadata
- optional appended SDS `REC` trailer carrying `PNM` and optional `ENC`

## Core Rules

1. The runtime payload before any publication trailer MUST remain valid `.wasm`.
2. If signatures or encrypted-delivery metadata are carried in the same file,
   they MUST be appended after the wasm bytes as an SDS `REC` trailer.
3. `REC` trailers MUST carry standards-sourced `PNM` and optional `ENC`
   records.
4. `sds.bundle` remains the in-wasm container for bundle metadata and does not
   replace the `REC` trailer for publication protection records.
5. Sidecar FlatBuffers are allowed when a package chooses not to append those
   metadata payloads to the module artifact.
6. Paths in publication metadata are package-relative, never absolute.

## Publication Record Extensions

Publication protection metadata is expressed as standards-backed FlatBuffer
extensions layered on top of the canonical module artifact.

- `REC.fbs` is the trailing collection wrapper with file identifier `$REC`
- `PNM.fbs` is the signature/publication notice record
- `ENC.fbs` is the encrypted-delivery record

These records are not arbitrary bytes. Loaders and publishers are expected to
use the generated message classes from `spacedatastandards.org` and preserve the
standard file identifiers:

- `REC` => `$REC`
- `PNM` => `$PNM`
- `ENC` => `$ENC`

The runtime-facing rule stays strict:

1. Strip or decrypt the publication layer first.
2. Instantiate the remaining raw wasm module.
3. Read the embedded `PluginManifest.fbs`.

`PNM` and `ENC` extend publication and transport handling only. They do not
change the canonical module ABI, manifest exports, or `sds.bundle` layout.

### `PNM` digital-signature extension

`PNM` carries the publication notice for the module:

- file identity (`FILE_NAME`, `FILE_ID`)
- content identity (`CID`)
- publish timestamp
- signature and signature-type metadata

In practice this is the record a host inspects to determine what artifact was
published and which signer attested to it.

### `ENC` encrypted-delivery extension

`ENC` carries the decryption parameters for a transport-protected module:

- key exchange algorithm
- symmetric algorithm
- key-derivation function
- ephemeral public key
- nonce start
- optional context and root type

It describes how to decrypt the protected delivery payload. It does not imply a
different module file format after decryption.

## Aligned-Binary Type Refs

Aligned-binary payloads use the same schema identity as the canonical
FlatBuffer payload. They are advertised through the `FlatBufferTypeRef`
extension fields:

- `wireFormat: "aligned-binary"`
- `rootTypeName`
- `byteLength`
- `requiredAlignment`

Every aligned-binary declaration must be paired with the regular
`wireFormat: "flatbuffer"` type for the same schema and file identifier in the
same accepted type set. Publication protection applies to the artifact as a
whole; aligned-binary is an invoke/payload optimization layered inside the
manifest contract.

## Canonical Descriptor

The canonical publication descriptor is named `sdn-module`.

When represented as a standalone JSON file, the filename is
`sdn-module.json`.

The full object form is:

```json
{
  "specVersion": 1,
  "publicationMode": "attached",
  "module": {
    "path": "./dist/orbit-lib.module.wasm",
    "packaging": "sds-bundled-wasm",
    "mediaType": "application/wasm",
    "manifestExportSymbol": "plugin_get_manifest_flatbuffer",
    "manifestSizeSymbol": "plugin_get_manifest_flatbuffer_size",
    "pluginId": "com.example.orbit-lib",
    "version": "1.2.3"
  },
  "artifacts": {
    "signature": {
      "storage": "module-trailer",
      "schemaName": "PNM.fbs",
      "fileIdentifier": "$PNM"
    },
    "transport": {
      "storage": "module-trailer",
      "schemaName": "ENC.fbs",
      "fileIdentifier": "$ENC"
    }
  },
  "integrity": {
    "moduleSha256": "2bff0d3d8f4f5aa1d0c7be3e54e15f9f8c9f3a62d5f0a4e8a8d80de28f4f0b31"
  }
}
```

### Required Fields

- `specVersion`: publication spec version, currently `1`
- `publicationMode`: `standalone` or `attached`
- `module.path`: relative path to the `.wasm` artifact

### Recommended Module Repo Build Layout

When authoring a module repo before publication packaging, keep the shared
compiled artifact at a stable runtime path:

- required: `dist/isomorphic/module.wasm`

If the repo also ships a browser-specific adapter or wrapper, place it beside
the browser runtime path:

- optional: `dist/browser/module.js`
- optional: `dist/browser/module.wasm`

The publication descriptor can still point anywhere, but the SDK standard for
checked-in module repos is that the exact shared browser/WasmEdge build lands at
`dist/isomorphic/module.wasm`.

### Recommended Fields

- `module.packaging`: `plain-wasm` or `sds-bundled-wasm`
- `module.mediaType`: normally `application/wasm`
- `module.manifestExportSymbol`
- `module.manifestSizeSymbol`
- `module.pluginId`
- `module.version`
- `integrity.moduleSha256`

### Artifact Descriptors

Each optional entry inside `artifacts` describes one metadata payload related to
the module:

- `authorization`
- `signature`
- `transport`
- `attestation`

An artifact descriptor has this shape:

```json
{
  "storage": "module-trailer",
  "path": "./dist/orbit-lib.signature.fb",
  "schemaName": "PNM.fbs",
  "fileIdentifier": "$PNM"
}
```

Rules:

- `storage` MUST be `module-trailer` or `package-file`
- `module-trailer` means the loader scans the end of `module.path` for an
  appended `REC` trailer and resolves the matching record from there
- `path` MUST be present when `storage` is `package-file`
- `schemaName` SHOULD name the SDS FlatBuffer schema
- `fileIdentifier` SHOULD name the FlatBuffer file identifier

## Minimal Shorthand

Package manifests that support arbitrary metadata MAY use a shorthand string
when all of the following are true:

- the package only needs to point to one module file
- the module uses the default manifest accessor exports
- all signature and transport metadata are either absent or appended through a
  `REC` trailer

Example:

```json
{
  "name": "@example/orbit-lib",
  "version": "1.2.3",
  "sdn-module": "./dist/orbit-lib.module.wasm"
}
```

`sdn-module.json` files MUST use the full object form, not the string
shorthand.

## Resolution Rules

A package consumer resolves publication metadata in this order:

1. Read the ecosystem-specific `sdn-module` carrier if one exists.
2. If that carrier is a string, treat it as `module.path`.
3. If that carrier is an object, use it directly.
4. If the package has no inline carrier, look for `sdn-module.json`.
5. For JVM artifacts, also look for `META-INF/sdn-module.json`.
6. Resolve `module.path` and any `package-file` sidecars relative to the
   package root or archive root.

## Packaging By Ecosystem

| Ecosystem | Recommended carrier |
|---|---|
| npm | `package.json["sdn-module"]` |
| PyPI | `pyproject.toml [tool."sdn-module"]` |
| crates.io | `Cargo.toml [package.metadata."sdn-module"]` |
| Maven Central | `META-INF/sdn-module.json` inside the JAR, optionally mirrored by a POM property |
| NuGet | `sdn-module.json` at package root, optionally surfaced through build metadata |
| Go modules | `sdn-module.json` at module root |
| Swift Package Manager | `sdn-module.json` at package root |

### npm

Minimal attached example:

```json
{
  "name": "@example/orbit-lib",
  "version": "1.2.3",
  "sdn-module": "./dist/orbit-lib.module.wasm"
}
```

Full example:

```json
{
  "name": "@example/orbit-lib",
  "version": "1.2.3",
  "sdn-module": {
    "specVersion": 1,
    "publicationMode": "attached",
    "module": {
      "path": "./dist/orbit-lib.module.wasm",
      "packaging": "sds-bundled-wasm",
      "mediaType": "application/wasm",
      "manifestExportSymbol": "plugin_get_manifest_flatbuffer",
      "manifestSizeSymbol": "plugin_get_manifest_flatbuffer_size"
    }
  }
}
```

### PyPI

```toml
[tool."sdn-module"]
specVersion = 1
publicationMode = "attached"

[tool."sdn-module".module]
path = "./dist/orbit-lib.module.wasm"
packaging = "sds-bundled-wasm"
mediaType = "application/wasm"
manifestExportSymbol = "plugin_get_manifest_flatbuffer"
manifestSizeSymbol = "plugin_get_manifest_flatbuffer_size"
```

### crates.io

```toml
[package.metadata."sdn-module"]
specVersion = 1
publicationMode = "attached"

[package.metadata."sdn-module".module]
path = "./dist/orbit-lib.module.wasm"
packaging = "sds-bundled-wasm"
mediaType = "application/wasm"
manifestExportSymbol = "plugin_get_manifest_flatbuffer"
manifestSizeSymbol = "plugin_get_manifest_flatbuffer_size"
```

### Maven Central And Kotlin

Ship a JSON descriptor in the archive:

```text
src/main/resources/META-INF/sdn-module.json
```

Optional POM property:

```xml
<properties>
  <sdn.module.descriptor>META-INF/sdn-module.json</sdn.module.descriptor>
</properties>
```

### NuGet

Ship the descriptor at package root:

```text
sdn-module.json
```

The `.nupkg` should also contain the module artifact at the relative path named
by `module.path`.

### Go Modules

Ship `sdn-module.json` at the module root next to `go.mod`.

### Swift Package Manager

Ship `sdn-module.json` at the package root. If the module artifact must be
available through a target at runtime, include the `.wasm` and sidecar files as
resources or through a binary-target wrapper.

## Standalone Publication Example

`sdn-module.json`

```json
{
  "specVersion": 1,
  "publicationMode": "standalone",
  "module": {
    "path": "./dist/catalog-query.bundle.wasm",
    "packaging": "sds-bundled-wasm",
    "mediaType": "application/wasm",
    "manifestExportSymbol": "plugin_get_manifest_flatbuffer",
    "manifestSizeSymbol": "plugin_get_manifest_flatbuffer_size",
    "pluginId": "org.example.catalog-query",
    "version": "0.2.0"
  },
  "artifacts": {
    "signature": {
      "storage": "module-trailer",
      "schemaName": "PNM.fbs",
      "fileIdentifier": "$PNM"
    }
  }
}
```

## Attached Publication Example

`sdn-module.json`

```json
{
  "specVersion": 1,
  "publicationMode": "attached",
  "module": {
    "path": "./dist/orbit-lib.module.wasm",
    "packaging": "plain-wasm",
    "mediaType": "application/wasm",
    "manifestExportSymbol": "plugin_get_manifest_flatbuffer",
    "manifestSizeSymbol": "plugin_get_manifest_flatbuffer_size",
    "pluginId": "com.example.orbit-lib",
    "version": "1.2.3"
  },
  "artifacts": {
    "signature": {
      "storage": "package-file",
      "path": "./dist/orbit-lib.signature.fb",
      "schemaName": "PNM.fbs",
      "fileIdentifier": "$PNM"
    },
    "transport": {
      "storage": "package-file",
      "path": "./dist/orbit-lib.transport.fb",
      "schemaName": "ENC.fbs",
      "fileIdentifier": "$ENC"
    }
  }
}
```

## Loader Expectations

A loader consuming this standard SHOULD:

1. locate the publication descriptor
2. read `module.path`
3. scan the artifact from the end for an appended SDS `REC` trailer
4. resolve `PNM` / `ENC` from that trailer before runtime startup
5. if `ENC` is present, decrypt and strip the trailer before passing bytes to
   WasmEdge or any other runtime
6. inspect the stripped wasm for `sds.bundle`
7. resolve any `package-file` metadata through relative paths
8. validate manifest exports and any declared integrity hashes

If `module.packaging` is `sds-bundled-wasm`, loaders SHOULD treat the stripped
wasm payload as the artifact to inspect for `sds.bundle`.

## Relationship To Existing Bundle Format

This standard does not replace `sds.bundle`. It explains how a package publishes
and points to the module artifact plus any appended SDS publication trailer.

- `sds.bundle` stays the single-file in-wasm container
- `REC` stays the appended publication record container for `PNM` / `ENC`
- `sdn-module` is the package-discovery descriptor

Use `sds.bundle` when you want one self-describing wasm payload. Use the
appended `REC` trailer when you need sign/encrypt publication metadata. Use
`sdn-module` when you want package managers and loaders to discover that file
reliably.
