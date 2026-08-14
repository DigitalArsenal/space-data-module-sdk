# RF

**Status: DESIGNED.** The RF ABI has been drafted against a real paying
consumer, and the boundary of what will and will not be a public contract has
been ruled. No `.fbs`, no generated header, no conformance kit and no reference
module exist yet. Nothing on this page is a stable ABI.

## Doctrine

Read this section before anything else, because it decides whether you need this
family at all.

**Most third-party RF does not need a harness.** RF that takes records in and
emits records out — link budgets, access intervals, coverage products expressed
as `$RFL`, `$ACI` and `$CVP`-class records — is an ordinary invoke-envelope
module. It has no harness requirement, no ABI freeze to wait for, and it is the
entry point for a vendor bringing an existing RF engine. If your engine computes
propagation loss, link margin, interference or coverage and hands back numbers,
this is your path today, and it is available now: build a BYO-wasm module, emit
records, publish it.

**The RF harness family exists only for RF that writes scene state.** A module
that draws footprints, writes entity or render state, or otherwise participates
in the consumer's scene graph needs the harness, because that is where a
byte-exact shared-memory contract is required.

**The closed scalar `rf_*` kernel ABI is never the public contract.** A set of
closed, encrypted, individually licensed scalar RF kernels exists — free-space
path loss, link budget, antenna pattern, gaseous and rain and cloud attenuation,
diffraction, Doppler and Fresnel geometry, terrain solvers, empirical and
Longley-Rice models, bit-error-rate and modulation. Their scalar kernel-op ABI
is internal by permanent ruling, not by maturity. It will not be offered as a
third-party contract, and a third-party module must never be written against it.

## Capability

A harness-class RF module computes link geometry and radio physics over many
links and many epochs, and writes its results into caller-provided memory. It
does not fetch data, does not decide tasking, and does not own the entities it
computes over.

## Import and export set

**Not specified.** The design calls for one aligned-binary invocation covering
many links and epochs, following the propagator family's export-set template
(init, compute, destroy, plus optional typed ingest and introspection), with the
symbol names to be fixed when the header is generated. `orbpro_rf_abi.h` does
not exist.

## Wire layout

**Drafted, not generated.** The drafted bulk link-matrix ABI is a single
`.fbs`-defined invocation that emits, in one call:

| Output | Shape |
| --- | --- |
| Link samples | Per-link, per-epoch scalar results |
| Intervals | Access and outage intervals derived from those samples |
| Coverage grid | A gridded coverage product |
| Coverage rings | A packed ring representation of the same coverage |

Receiver and channel grouping for interference aggregation happens inside the
module, not in the consumer — a design decision, so that an interference
computation is never split across the ABI boundary.

No `.fbs` file for this exists in the tree yet. Field names, offsets and sizes
are unfixed.

## Units and frames

Not fixed. The scalar physics behind the closed kernels works in decibel-watt
power and decibel loss with linear-power summation for incoherent aggregation,
and any published ABI will have to state per-field units explicitly the way the
propagator ABI does. Do not infer them from this page.

## Sentinels

Not specified.

## Identity

Not specified. Links will need a stable identity across a bulk call so a
consumer can associate a sample row with the link that produced it.

## Threading

`wasm32-wasip1-threads`, and the drafted design explicitly reuses the propagator
family's shard-write discipline for its bulk outputs: the same base pointer is
given to every thread, each thread writes a disjoint range, each writes only its
own row, and a failed row is zeroed rather than left partially written. That
discipline is the one part of this family that is already settled, because it is
inherited rather than invented.

## Error codes

Not specified.

## Lifetime

Not specified. Expect the propagator family's contract: a real, idempotent
teardown proven by a steady-state leak test.

## Parity envelope

Cross-runtime parity claims for RF are currently blocked. The existing closed RF
packages are not isomorphic, and their manifests declare browser and node
targets while in practice being gated on WasmEdge — an open defect. An embedded
WasmEdge parity lane is a prerequisite before any RF parity claim can be made at
all.

## Consumer seam

One generic RF port on the consumer side, taking the module as a pluggable
parameter. Not implemented.

## Guest C++ example

None. Publishing a skeleton against an unfixed wire layout would create exactly
the drift this family is being designed to avoid.

## What to do today

If you are a vendor with an RF engine and you want to ship on the Space Data
Network now:

1. Build a records-in, records-out module. No harness required.
2. Follow the [BYO-wasm quickstart](../byo-wasm-quickstart.html) for the
   toolchain pin and the multi-TU build.
3. Emit `$RFL`, `$ACI` and `$CVP`-class records. Use the Space Data Standards
   C++ headers for the record types.
4. Run [conformance](../conformance.html) and the
   [parity gate](../tri-runtime-parity-gate.html), then
   [protect and sign](../protect-and-sign.html).

That path is real today and does not wait on this family's ratification. Come
back to the harness only if your module must write scene state.
