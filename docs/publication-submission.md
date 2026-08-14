# Publication and listing

The last step of the integrator path: turn a signed artifact into something a
consumer can discover, fetch and load. Part of this is implemented and part of
it is still being built, and this page separates the two explicitly.

## What is implemented today

**The published artifact layout.** A protected artifact carries its records in a
trailer:

```
protected-payload-bytes || REC-flatbuffer-bytes || uint32le(REC length) || "$REC"
```

`REC`, `MBL`, `PNM` and `ENC` are Space Data Standards FlatBuffer record types.
The SDK consumes the generated message classes; the schemas are ratified at
`spacedatastandards.org`. The full contract — which record carries the manifest,
which carries the bundle metadata, which carries the publication notice, and
which carries the encryption envelope — is the
[module publication standard](module-publication-standard.html).

**The artifact primitives.** `protect`, `sign` and `verify` are real commands
with real flags. See [Protect and sign](protect-and-sign.html).

**Post-publication loadability is gated.** The tri-runtime parity gate carries a
fixture for the *published* form of a module — the same artifact after its
signature and manifest records have been appended as a trailing custom section —
so the record-stripping and instantiation path is exercised by the gate, not
assumed. See the [parity gate](tri-runtime-parity-gate.html).

**Package distribution.** The publication standard also covers delivery through
conventional package ecosystems (npm, PyPI, Maven Central, NuGet, Go modules,
crates.io, Swift Package Manager) for the language bindings that accompany a
module.

## What is still being built

These are checked absences in the SDK today, not roadmap decoration:

- **No listing-submission command.** There is no `publish`, `submit` or `list`
  subcommand. The CLI offers artifact-level primitives only.
- **No storefront or marketplace workflow in this repository.** A module
  marketplace is a program in the wider stack; no listing code lives here.
- **No manifest injection for foreign-compiled binaries.** A BYO vendor's
  artifact cannot yet be stamped with a manifest by a tool. See the
  [BYO-wasm quickstart](byo-wasm-quickstart.html).

## The escorted path, which works now

Until self-serve submission lands, a vendor can complete the whole path with
help:

1. The vendor builds `module.wasm` on the pinned toolchain and supplies the
   manifest JSON alongside it.
2. Conformance and the parity gate are run against the artifact — the vendor can
   run both themselves and attach the output, or hand over the artifact and have
   them run.
3. The artifact is protected and signed, and `verify` is run against the
   published bytes with the intended trusted key set.
4. The publication records are attached and the module is listed by hand.

Nothing in that sequence requires the vendor to have access to a private
repository, and every gate in it is a real command whose output is the evidence.

## Submission checklist

Before handing over an artifact, confirm each of these:

| Check | Command or evidence |
| --- | --- |
| Built on the pinned toolchain | Link flags include `-Wl,--shared-memory` and `-Wl,--max-memory=2147483648` |
| No Emscripten anywhere in the build | Build log; the parity gate's import classifier will catch it |
| Family ABI conformance passes | `space-data-module conformance <family> --artifact <path>` |
| Tri-runtime parity passes | `space-data-module parity --wasm <path> --fixture <path> --lanes browser,wasmedge,docker-wasmedge` |
| Manifest declares family, invoke surface, runtime targets, record types | The manifest JSON |
| Signed with the intended key | `space-data-module verify --wasm <path> --trusted <hex> --require-signature` |
| Teardown does not leak | The conformance leak cycles reach steady state |
