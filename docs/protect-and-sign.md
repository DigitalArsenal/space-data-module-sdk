# Protect and sign

Once a module passes conformance and the parity gate, it is protected
(optionally encrypted, with its manifest attached), signed, and verified. All
three verbs are implemented today in `space-data-module`.

## Artifact layout

A protected, published artifact is a single file:

```
protected-payload-bytes || REC-flatbuffer-bytes || uint32le(REC length) || "$REC"
```

The trailer is appended after the payload, so a consumer reads the last four
bytes for the `$REC` magic, then the preceding little-endian `uint32` length,
then the record. The record types themselves (`REC`, `MBL`, `PNM`, `ENC`) are
Space Data Standards messages; this SDK consumes the generated classes, it does
not define them. See the
[module publication standard](module-publication-standard.html).

## Protect

`protect` attaches the manifest to the artifact and, when a recipient key is
supplied, encrypts the payload for that recipient.

```sh
space-data-module protect \
  --manifest ./manifest.json \
  --wasm ./dist/module.wasm \
  --json
```

```sh
# encrypted for a specific recipient
space-data-module protect \
  --manifest ./manifest.json \
  --wasm ./dist/module.wasm \
  --recipient-public-key <hex> \
  --out ./dist/module.wasm.enc
```

```sh
# single-file bundle
space-data-module protect \
  --manifest ./manifest.json \
  --wasm ./dist/module.wasm \
  --single-file-bundle \
  --out ./dist/module.bundle.wasm
```

| Flag | Required | Meaning |
| --- | --- | --- |
| `--manifest <path>` | yes | Module manifest JSON |
| `--wasm <path>` | yes | The compiled artifact |
| `--recipient-public-key <hex>` | no | Encrypt the payload for this recipient |
| `--mnemonic <words>` | no | Key material for the protecting identity |
| `--single-file-bundle` | no | Emit one self-contained bundle artifact |
| `--out <path>` | no | Output path; otherwise reported on stdout |
| `--json` | no | Machine-readable result |

Non-JSON output reports `artifactId`, `signingPublicKeyHex`, `encrypted`,
`wasmBase64Length`, and `protectedArtifactBytes`.

## Sign

```sh
space-data-module sign \
  --wasm ./dist/module.wasm \
  --key ./keys/module-signing-keypair.json \
  --out ./dist/module.signed.wasm
```

| Flag | Required | Meaning |
| --- | --- | --- |
| `--wasm <path>` | yes | Artifact to sign |
| `--key <path>` | yes | Keypair JSON; must contain `privateKeySeedHex` |
| `--out <path>` | no | Output path; otherwise the input is signed in place |

The key file must carry `privateKeySeedHex` or the command refuses. Output
reports `signed`, `keyId`, `publicKeyHex`, and `canonicalModuleHashHex` — the
canonical hash is what a verifier recomputes, so it is stable across the
appended trailer.

## Verify

```sh
space-data-module verify \
  --wasm ./dist/module.wasm \
  --trusted <pubKeyHex>[,<pubKeyHex>...] \
  --require-signature
```

```sh
space-data-module verify \
  --wasm ./dist/module.wasm \
  --key ./keys/module-signing-keypair.json
```

`--trusted` takes a comma-separated list of trusted public keys; `--key` reads
`publicKeyHex` out of a keypair JSON instead. Signature requirement defaults to
true. Output reports `verified`, `signed`, `keyId`, `publicKeyHex`, and the
process exits non-zero unless verification succeeded.

## Key custody

Signing keys are HD-derived from a node's root identity by default; supplying an
external key is an explicit opt-in. Never commit a private key or a mnemonic to
a repository, and never paste one into a build log. The dev keypairs that appear
in the SDK's own test fixtures are test material and are not valid for a
published module.

## Honest gaps

- There is no `license` CLI verb. A `src/licensing/` module exists in the tree
  and is used programmatically, but it is not wired to a `space-data-module`
  subcommand.
- `protect`, `sign` and `verify` are artifact-level primitives. There is no
  single end-to-end "release this module" command; see
  [Publication and listing](publication-submission.html).
