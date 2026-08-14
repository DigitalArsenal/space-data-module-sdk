# Conjunction

**Status: DESIGNED as a harness family.** This one needs an explicit caveat,
because the plain word "designed" would mislead you: a mature, externally
validated conjunction-assessment module ships today and is in production. What
does not exist is a *harness* — a ratified family ABI that a third party
implements so their screening engine drops into a consumer's conjunction port.

Read that distinction carefully before choosing your path.

## Doctrine

A conjunction module screens a catalog for close approaches, refines the time of
closest approach, and computes collision probability. As a harness family, it
would let a vendor substitute their own screening and probability engine behind
a uniform port. As a shipped application module, it already does the work
through the generic invoke surface.

The shipped module rides the generic analysis family in the manifest vocabulary;
there is no dedicated conjunction member in the runtime `PluginFamily` enum, and
this family was never brought into the harness-shapes ratification program. That
is why its harness status is Designed while its capability is real.

## Capability

Screen a catalog, prefilter, refine time of closest approach, compute
probability of collision, and emit conjunction records. In the shipped module
this includes a k-d-tree candidate search, a refinement stage, and signed
Conjunction Data Message output.

## Import and export set

**Not specified as a harness ABI.** The shipped module declares a `command`
invoke surface with an assessment method, runtime targets browser, wasi and
wasmedge, and a dependency on a propagator plugin. There is no
`orbpro_conjunction_abi.h`.

## Wire layout

**Real schemas exist, but as a module's own message set, not as a ratified
family ABI.** The shipped module carries a schema set including shared types and
per-operation request and result messages:

| Schema group | Contents |
| --- | --- |
| Common | Element-set records, B-plane geometry, screening statistics, reference-frame and source-kind enumerations |
| Probability | Probability-of-collision request and result |
| Alfano | Alfano-method request and result |
| Pair and catalog screening | Pair request, catalog screening request and result |
| Events | Time-of-closest-approach result, conjunction event, version result |

B-plane geometry carries the miss-distance components and the combined
covariance terms plus a combined hard-body radius. Screening statistics report
objects screened, pairs screened, pairs prefiltered, candidates from the
acceleration structure, refinements, conjunctions found, propagations performed,
and elapsed time.

Results are emitted as Space Data Standards `$CDM` conjunction data messages,
whose schema is separately ratified.

Because this is a module's message set rather than a generated family header,
there are no size and offset locks and no drift gate on it as an ABI.

## Units and frames

The reference frame is explicit in the schema — an enumeration covering ECI,
ECEF, TEME and ICRF, plus an unknown value. That explicitness is the right
pattern and should survive into any harness freeze. Per-field units are defined
by the module's own schemas.

## Sentinels

Enumerations carry an explicit unknown member rather than overloading zero with
a real meaning. That is the one sentinel convention this family already gets
right.

## Identity

Objects are addressed by their catalog identity, and a conjunction event is
identified by the object pair plus the time of closest approach.

## Threading

`wasm32-wasip1-threads`. The screening path is thread-parallel and is exercised
by a standalone WasmEdge harness in the module's own test suite.

## Error codes

Not specified as a named harness code set.

## Lifetime

Command-surface lifetime: instantiate, invoke, tear down.

## Parity envelope

The module has its own cross-runtime harness tests, including a standalone
WasmEdge run. It has no ratified family parity envelope. Use the generic
[parity gate](../tri-runtime-parity-gate.html).

## Consumer seam

The propagator dependency is the seam that already works: the module takes its
propagator as a plugin rather than compiling one in, which satisfies the
pluggable-propagation law. There is no generic conjunction port on the consumer
side yet, and the consumer-side rendering integration has open defects.

## Guest C++ example

None published as a family example. The shipped module is an application module,
not a reference harness implementation, and presenting it as one would imply an
ABI that has not been frozen.

## What to do today

If you have a screening or probability engine you want to run on the Space Data
Network: build a records-in, records-out module through the
[BYO-wasm quickstart](../byo-wasm-quickstart.html), consume element-set records,
emit `$CDM`, and take your propagator as a plugin. That works now. The harness
freeze is what will later let your engine be substituted behind a consumer's
conjunction port without the consumer knowing.
