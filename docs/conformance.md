# Conformance runner

**Status:** v1 — W1.4 of `graph/tasks/official-harness-shapes-program.md`,
implementing `graph/findings/official-harness-shapes.md` §5. Family kits:
`propagator` (SHIP 1). Maneuver is Wave 2 (EXPERIMENTAL, fix-then-freeze); OD
is deferred by ruling. **A family with no kit can never be `CORE`.**

WASM artifacts ONLY (owner ruling 2026-08-10: "No JS propagator!!!! WASM
ONLY"). The runner instantiates a compiled `dist/isomorphic/module.wasm` and
drives the family's ABI directly; there is no path that certifies a JavaScript
object, because JS registries are internal engine plumbing, never a public
contract.

## Commands

```
space-data-module conformance propagator --artifact ./dist/isomorphic/module.wasm
space-data-module conformance propagator --artifact ./dist/isomorphic/module.wasm \
    --vectors ./vectors/vectors.json --json
space-data-module conformance propagator --self-test    # must exit 0 BY failing
```

- `--artifact` — the compiled module. Its sha256 goes in the report; a
  conformance claim binds to CONTENT, not to a name.
- `--vectors` — the module's corpus (`vectors.json` + `PROVENANCE.md`, the
  format proven by the reference module's `vectors/` suite). Default: the
  runner walks up from the artifact to the package root and takes
  `vectors/vectors.json`. **The corpus is the module's own**: Tier B anchors
  are model-specific, so a two-body corpus is never forced onto an SGP4
  module, and a missing corpus is a NAMED GAP, never a silent pass.
- `--leak-warmup / --leak-cycles / --leak-entities` — lifecycle-leak window
  overrides (defaults 20 / 200 / 256, the reference module's proven numbers).
- Exit codes: `PASS` and `PASS-WITH-GAPS` exit 0 (gaps are listed in the
  report); `FAIL` exits 1 with the offending check and case named.

Library surface: `space-data-module-sdk/conformance` exports
`runConformance`, `runPropagatorSuite`, `runPropagatorSelfTest`,
`computeVerdict`, the ABI driver and the error-code table.

## What is checked

| Tier | Check | Source of authority |
|---|---|---|
| 0 | real instantiation + required export set | [propagator-abi.md](propagator-abi.md) §The export set |
| 0 | cross-runtime byte-identity | **GAP here by design** — the parity gate (`space-data-module parity-gate`) is the Tier 0 authority; this runner never re-certifies half of it |
| B | corpus anchors reproduced within band | the module's `vectors.json` (tolerance policy `abs + rel * |expected|`); NaN is its own failure class |
| C | vis-viva closure, period closure | corpus-declared invariants (`conformance.mu` from the corpus; ECEF un-rotation when the module declares frame 3) — run only where the corpus declares them applicable to the model |
| C | determinism as BYTES, surviving destroy/re-ingest | ABI §Parity envelope |
| C | frame/flags/reserved declared, corpus-consistent | ABI §Frames — a frame declaration that contradicts the module's own corpus is the silently-wrong-numbers defect |
| C | batch and single agree exactly | ABI §Threading — the batch path is the same physics |
| C | typed refusals (NOT_INITIALIZED / BAD_ENTITY_INDEX / unphysical ingest) | ABI §Error codes — the degradation ladder needs distinguishable codes |
| C | create RETURNS its handle | ABI §Identity — "the entity I just created is count−1" is the race the harness exists to kill (finding §4.4) |
| 4 | lifecycle leak: zero page growth after warm-up | ABI §Lifetime |
| 4 | destroy idempotent, refuses typed, comes back cleanly | ABI §Lifetime |
| 4 | leak-metric negative control | a gate never observed to fail is indistinguishable from one that cannot fail |

## The self-test

`--self-test` runs the SAME suite against mock propagators, each carrying ONE
planted defect drawn from a real defect class the finding documented live:

| Planted defect | Real-world citation | Must be caught by |
|---|---|---|
| `units-km` (1000× error) | the `orbpro_propagator.h` km/meters contradiction (finding §4.1) | `tierB/anchors` |
| `leaky-destroy` | `destroySource(){}` in both shipped propagators (§4.5) | `tier4/lifecycle-leak` |
| `confident-nonsense` (accepts e ≥ 1) | the underground phasing orbit (§5) | `tierC/typed-refusals` |
| `count-fallback` (returns success, not the handle) | three families deriving count−1 (§4.4) | `tierC/create-returns-handle` |
| `frame-lies` (declares TEME, writes ECEF) | the Δv frame never pinned (§4.3) | `tierC/frame-flags-reserved-declared` |
| `batch-divergence` | batch path not the same physics | `tierC/batch-single-agreement` |
| `nondeterministic` | byte-determinism is the parity envelope's floor | `tierC/determinism-byte-identity` |
| `missing-exports` | destroy was optional once; it is not now | `tier0/instantiation-and-exports` |

The self-test exits 0 only when the conformant baseline mock is clean AND
every planted defect is caught by the check that owns it. It needs no
toolchain, no artifact and no network — `npm run conformance:self-test`.

## Receipt & trust (Wave 4, not yet wired)

The conformance receipt travels as a bundle `ATTESTATION` entry
(publisher-signed under bundle scope); the graduated listing requirement
(receipt REQUIRED for `CORE`+`ANONYMOUS`, badge for `RECOMMENDED`) and the
`SDN-CONFORMANCE-RECEIPT-V1` third-party attestor domain are W4.1/W4.2 of the
program — see the finding §5 "Receipt & trust".

## Reference implementation

`space-data-network-modules propagator/keplerian-reference` is the exemplar
the kit was generalized from: its `tests/` are the original expression of
these checks, its `vectors/` suite is the corpus format, and
`tests/sdk-conformance-runner.test.mjs` proves the runner reaches the same
verdict on the same artifact — including the corrupted-corpus negative
control.
