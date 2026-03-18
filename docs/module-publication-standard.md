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
metadata are embedded in the module file or shipped as sidecar FlatBuffers.

## Scope

This publication standard covers two release modes:

- `standalone`: the package's primary deliverable is the SDN module itself
- `attached`: the package primarily exists for another language runtime, but it
  also ships one compliant SDN module build artifact

In both cases the module artifact remains the same canonical format already
defined by this repo:

- valid WebAssembly bytes
- embedded `PluginManifest.fbs`
- manifest accessors
  - `plugin_get_manifest_flatbuffer`
  - `plugin_get_manifest_flatbuffer_size`
- optional `sds.bundle` custom-section metadata

## Core Rules

1. The published module artifact MUST remain valid `.wasm`.
2. If signatures, authorization metadata, transport metadata, or attestations
   are carried in the same file, they MUST be embedded as `sds.bundle` entries.
3. Raw trailer bytes appended after the end of the WebAssembly binary are not
   part of this standard.
4. Sidecar FlatBuffers are allowed when a package chooses not to embed those
   metadata payloads into `sds.bundle`.
5. Paths in publication metadata are package-relative, never absolute.

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
      "storage": "embedded",
      "bundleEntryId": "signature.primary",
      "schemaName": "DetachedSignature.fbs",
      "fileIdentifier": "SIGD"
    },
    "transport": {
      "storage": "embedded",
      "bundleEntryId": "transport.primary",
      "schemaName": "EncryptedTransportEnvelope.fbs",
      "fileIdentifier": "ETRN"
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
  "storage": "embedded",
  "bundleEntryId": "signature.primary",
  "path": "./dist/orbit-lib.signature.fb",
  "schemaName": "DetachedSignature.fbs",
  "fileIdentifier": "SIGD"
}
```

Rules:

- `storage` MUST be `embedded` or `package-file`
- `bundleEntryId` MUST be present when `storage` is `embedded`
- `path` MUST be present when `storage` is `package-file`
- `schemaName` SHOULD name the SDS FlatBuffer schema
- `fileIdentifier` SHOULD name the FlatBuffer file identifier

## Minimal Shorthand

Package manifests that support arbitrary metadata MAY use a shorthand string
when all of the following are true:

- the package only needs to point to one module file
- the module uses the default manifest accessor exports
- all signature and transport metadata are either absent or embedded in
  `sds.bundle`

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
      "storage": "embedded",
      "bundleEntryId": "signature.primary",
      "schemaName": "DetachedSignature.fbs",
      "fileIdentifier": "SIGD"
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
      "schemaName": "DetachedSignature.fbs",
      "fileIdentifier": "SIGD"
    },
    "transport": {
      "storage": "package-file",
      "path": "./dist/orbit-lib.transport.fb",
      "schemaName": "EncryptedTransportEnvelope.fbs",
      "fileIdentifier": "ETRN"
    }
  }
}
```

## Loader Expectations

A loader consuming this standard SHOULD:

1. locate the publication descriptor
2. read `module.path`
3. inspect the wasm for `sds.bundle`
4. resolve any `embedded` metadata through bundle entries
5. resolve any `package-file` metadata through relative paths
6. validate manifest exports and any declared integrity hashes

If `module.packaging` is `sds-bundled-wasm`, loaders SHOULD prefer embedded
entries over sidecar files.

## Relationship To Existing Bundle Format

This standard does not replace `sds.bundle`. It explains how a package publishes
and points to the module artifact.

- `sds.bundle` stays the single-file in-wasm container
- `sdn-module` is the package-discovery descriptor

Use `sds.bundle` when you want one deployable `.wasm` file. Use `sdn-module`
when you want package managers and loaders to discover that file reliably.
