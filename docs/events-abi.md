# Event locator ABI

**Status: EXPERIMENTAL.** The schema, the generated header, the drift gate and
the runner have landed and are measured. There is no conformance kit and no
reference module yet, so this is not `Shipped` and a commercial module should
not be sold against it. It is the **event-location sub-harness of the
[Analytics](families/analytics.html) family** — not a twentieth harness family.
The nineteen-family taxonomy is owner-ratified and this ABI does not amend it.

## Table of contents

- [Doctrine](#doctrine)
- [Capability](#capability)
- [The export set](#the-export-set)
- [The pull protocol](#the-pull-protocol)
- [Wire layout](#wire-layout)
- [Units, frames and epochs](#units-frames-and-epochs)
- [Sentinels](#sentinels)
- [Identity](#identity)
- [Threading](#threading)
- [Error codes](#error-codes)
- [Interval pairing](#interval-pairing)
- [Propagate-to-condition](#propagate-to-condition)
- [Lifetime](#lifetime)
- [Versioning](#versioning)
- [Parity envelope](#parity-envelope)
- [Conformance](#conformance)
- [Consumer seam](#consumer-seam)
- [Guest usage](#guest-usage)
- [Regenerating](#regenerating)

## Doctrine

**One ABI, N locators.** Eclipse (umbra / penumbra / antumbra, any number of
occulting bodies), station contact with masks and light time, sensor-FOV
intrusion, apsides, node crossings and a propagate-to-condition stop are the
SAME computation: a vector of scalar event functions `g_i(t)` whose sign
changes are refined to roots. They differ only in `g`.

**The locator supplies `g`. It supplies nothing else.** The bracketing scan,
the root refinement, the direction filtering, the occurrence counting, the
endpoint bookkeeping and the epoch ordering live in
`include/orbpro/orbpro_event_runner.h`, which every locator compiles in
unchanged. "Adding a new locator requires no change to the runner" is therefore
a structural fact and not a promise: there is no runner to change, only a `g`
to write. A locator that needed the runner to change would be evidence that
this ABI is wrong.

**The state source is PULLED, never imported.** A locator needs states at
epochs only it can choose — Brent picks the next abscissa from the last three.
It does not import a host function to fetch them. `plugin_event_next` reports
the epochs it wants, the consumer evaluates them through whatever module is
wired to the propagator port, and `plugin_event_supply` feeds the states back.
Three consequences, and they are the reason the design is this way:

- The propagator stays a **port**, per the pluggable-propagation law (owner,
  2026-07-29). No provider is named anywhere in this ABI.
- **No new host capability and no new import.** The browser, native-WasmEdge
  and Docker-WasmEdge lanes are byte-identical by construction, because the
  consumer shuttles buffers and decides nothing.
- The refinement stays **inside the guest**. A host-side root finder would be
  physics in JavaScript and its arithmetic would differ per lane.

**A hit is a crossing, not an interval.** Apsides and node crossings are
instants; eclipse and contact are intervals. Emitting crossings and pairing
them is total over both; an interval-shaped hit would put a sentinel in half
the family. See [Interval pairing](#interval-pairing).

## Capability

**None.** An event locator declares no capability at all: it computes, and
every byte it consumes arrives through its own exports. This is not an
oversight to be corrected later — the pull protocol exists precisely so that
locating an eclipse does not require a module to reach outside itself.

A locator that also wants to *emit* an SDS `$EVL` record through the invoke
surface declares whatever that surface already requires, and nothing new.

## The export set

Three exports are the locator's. Seven are the runner's, and
`ORBPRO_EVENT_RUNNER_EXPORTS(runner)` emits all seven.

### The locator writes these

| Export | Signature | Returns |
| --- | --- | --- |
| `plugin_event_describe` | `int32_t(uint8_t* out, uint32_t capacity)` | bytes of the `EventLocatorDescription` FlatBuffer written, the required size if `capacity` is short, or a negative [error code](#error-codes) |
| `plugin_event_configure` | `int32_t(const uint8_t* config, uint32_t len)` | components configured (>0), or negative |
| `plugin_event_eval` | `int32_t(double epoch_jd_day, double epoch_seconds, const OrbProStateVector* states, uint32_t object_count, double* g_out, uint32_t component_count)` | `0`, or negative |

`plugin_event_eval` **must be a pure function of its arguments.** A `g` that
depends on call order or on a cached previous epoch breaks bracketing: Brent
evaluates epochs out of chronological order by design. The conformance
obligation is that `plugin_event_eval` at an epoch and the `g` the runner used
to find a root at that epoch agree exactly.

It is vector-valued on purpose: one state fetch feeds every component, so a
ten-component locator costs one propagation per epoch rather than ten. That is
what makes "eclipse against three occulting bodies" and "contact with eight
stations" ordinary rather than special.

### The runner provides these

| Export | Signature | Returns |
| --- | --- | --- |
| `plugin_event_begin` | `int32_t(const OrbProEventInterval*, const OrbProRootPolicy*)` | `0`, or negative |
| `plugin_event_next` | `int32_t(OrbProEventStateRequest*, double* epochs, uint32_t epoch_capacity)` | epochs written (`2 * n` doubles), `0` when finished, or negative |
| `plugin_event_supply` | `int32_t(const OrbProStateVector*, uint32_t count)` | `0`, or negative |
| `plugin_event_hit_count` | `int32_t(void)` | hits held |
| `plugin_event_hits` | `int32_t(OrbProEventHit*, uint32_t capacity)` | hits written, or negative |
| `plugin_event_summaries` | `int32_t(OrbProEventScanSummary*, uint32_t capacity)` | summaries written, or negative |
| `plugin_event_destroy` | `void(void)` | — |

Plus `memory`, `plugin_alloc` and `plugin_free`, as every family requires.

## The pull protocol

```
  configure ──► begin ──► next ──┬──► (n > 0) consumer propagates ──► supply ──┐
                                 │                                             │
                                 └──► (n == 0) ──► hits / summaries            │
                                 ▲                                             │
                                 └─────────────────────────────────────────────┘
```

- `next` writes `2 * n` doubles: `(jd_day, seconds)` **pairs**, in scan order,
  and fills the `OrbProEventStateRequest` with the object count and the frame
  the states must be in.
- The consumer evaluates **every** requested epoch for **every** object.
- `supply` takes `epoch_count * object_count` states, ordered **epoch-major**:
  `states[e * object_count + o]` is object `o` at epoch `e`. A count that is
  not exactly that is `SUPPLY_COUNT_MISMATCH` — never a partial evaluation,
  because a locator that accepted a short supply would report events computed
  from another object's trajectory.
- The **coarse scan** batches (up to `ORBPRO_EVENT_SCAN_BATCH`, default 64), so
  a consumer drives it through `plugin_propagate_batch`. The **refinement**
  asks for exactly one epoch: it is inherently sequential.
- Brackets found in a scan batch are refined **before** the scan advances, so
  occurrence counting is chronological and a `max_events` stop lands on the
  right event.

Calling `next` twice without an intervening `supply`, or `supply` with nothing
outstanding, is `PROTOCOL_ORDER`.

## Wire layout

Generated header: `include/orbpro/orbpro_events_abi.h`. Source of truth:
`schemas/orbpro/Events.fbs`. Drift gate: `node scripts/check-events-abi.mjs`.

| Struct | Size | Align |
| --- | ---: | ---: |
| `OrbProRootPolicy` | 32 | 8 |
| `OrbProEventInterval` | 56 | 8 |
| `OrbProEventHit` | 48 | 8 |
| `OrbProEventScanSummary` | 32 | 8 |
| `OrbProEventStateRequest` | 16 | 4 |

`OrbProStateVector` (64 bytes) and `OrbProReferenceFrame` are **not**
redeclared here — they come from `orbpro/orbpro_propagator_abi.h`, which the
generated header includes. A second `ReferenceFrame` typedef is refused by
`scripts/check-reference-frame-uniqueness.mjs` C1, and it would fail to compile
the moment both headers met in one translation unit, which they always do.

Every struct has a generated `_init` that zeroes the padding, and a generated
`_set_<field>` for every enum field that clears the padding behind it. Use
them. A partial write leaves the previous call's bytes in the padding the IDL
requires to be zero.

## Units, frames and epochs

- `scan_step_seconds`, `epoch_tolerance_seconds`, `state_epoch_resolution_seconds`
  and `epoch_seconds`: **SECONDS**.
- `value`, `goalValue`, `value_tolerance`, `initial_value`, `final_value`: the
  component's own declared `unit` string. The ABI does not convert.
- `reference_frame`: an `OrbProReferenceFrame` value. A consumer whose
  propagator emits another frame converts through the frames port; a consumer
  that cannot **fails loudly** rather than supplying a differently-framed
  state.

### Epochs are split pairs, and that is not decoration

Every epoch here is `(jd_day, seconds)`: an exactly-representable Julian day
plus an offset in seconds.

A Julian date carried in one `float64` resolves to `ulp(2460000.5) = 2^-31 d =`
**4.02e-5 s** — forty microseconds. A single-double JD therefore *cannot*
express a stop epoch to 1e-6 s, and a locator that reported one would be
reporting rounding noise. The split pair resolves 1.5e-11 s. Internally the
runner works in seconds from the interval start, and never collapses the pair.

`epoch_seconds` may exceed 86400 and is **not normalized**. The fine coordinate
stays fine and two epochs from one scan stay directly comparable.

### The state source bounds the answer, and says so

`OrbProStateVector.epoch` is a single `float64` and is **frozen** — 64 bytes,
on the wire, in the field. So a propagator whose ABI takes a single Julian date
quantizes `g` at about 4.02e-5 s, and no refinement can resolve a root below
that no matter what tolerance it is handed.

This is declared, not assumed. `EventLocatorConfig.stateEpochResolutionSeconds`
carries the source's resolution; the runner clamps
`epoch_tolerance_seconds` up to it and reports
`ORBPRO_ROOT_STATUS_EPOCH_RESOLUTION_LIMITED` on every root that hit the clamp.
`orbpro_event_runner_effective_tolerance()` reports the tolerance actually
used.

**Consequence for acceptance criteria.** A "stop epoch reproducible to 1e-6 s"
claim is only meaningful against a state source that resolves better than
1e-6 s. Against a single-double-JD propagator the honest bar is
`max(requested, source resolution)`, and the receipt must record the
resolution. Extending the propagator ABI to a split epoch would be a breaking
change to a frozen 64-byte struct and is an **owner** decision, not an oracle
call.

## Sentinels

| Value | Meaning |
| --- | --- |
| `EventInterval.component == 0xFFFFFFFF` | every component |
| `EventInterval.max_events == 0` | unbounded (still bounded by `max_evaluations` and the caller's buffer). A nonzero cap returns the first N IN SCAN ORDER and sets `truncated`, so "these are the events" and "these are the first N" are distinguishable |
| `EventInterval.max_evaluations == 0` | unbounded |
| `EventInterval.occurrence == 0` | report every qualifying crossing |
| `RootPolicy.value_tolerance == 0` | converge on the bracket width alone |
| `EventLocatorConfig.stateEpochResolutionSeconds == 0` | not declared; the runner trusts the tolerance it was given |
| `EventLocatorDescription.maxSafeScanStepSeconds == 0` | the locator declines to bound it — a NAMED GAP, never a pass |

`RootPolicy.scan_step_seconds == 0` is **not** a sentinel. It is refused with
`BAD_INPUT`: a silent default step is how a scan misses every event shorter
than it, and the miss looks exactly like "there was no event".

### The scan start is not a bracket

An event exactly at the interval **start** has no preceding sample to bracket
it and is therefore not a crossing. One exactly at the interval **end** is.
The asymmetry is real and deliberate; `EventScanSummary.initial_sign == ZERO`
is how a consumer learns an event sits on the start.

## Identity

A component is a dense 0-based index, stable for the lifetime of one
configuration, and it is the ONLY handle the ABI structs carry. Names live in
`EventComponent.name` and resolve through the SDS parameter-catalog record —
this schema deliberately carries no parameter roster of its own, because a
second roster is a second source of truth.

Objects are positional: object `o` is the `o`-th object the consumer supplies
states for, in the order `EventLocatorDescription.objectCount` declares.

## Threading

Locators compile `clang --target=wasm32-wasip1-threads`, per the
isomorphic-pthreads law. **Never `emcc -pthread`.**

**Declare `wasi-sequential`, with `sequentialJustification.kind =
"inherently-sequential-algorithm"`.** Root refinement carries state from
iteration `k-1` into iteration `k` — that is the literal definition of that
justification kind, and it is also the strongest available guarantee of the
step-independence and byte-identity properties above: a threaded refinement
would evaluate abscissae in a nondeterministic order and would not be
reproducible.

A **parameter-catalog** module, which evaluates named quantities from a state
and has nothing to fan out inside one call, declares `wasi-sequential` with
`kind = "caller-level-parallelism"` when it exposes a batch export the host
shards, or `"pure-transform"` when it does not.

> **Known defect, still live:** `resolveThreadModel` reads the compile
> OPTION, not `manifest.threadModel`, and otherwise infers the model from
> `runtimeTargets`. Pass `threadModel` explicitly to
> `compileModuleFromSource` and assert `result.threadModel` came back as
> declared, until `sdk-manifest-threadmodel-silently-ignored` lands.
> `threadModel: "single-thread"` is the **legacy Emscripten** model and routes
> to `em++`, not to the sanctioned clang toolchain — it is not a synonym for
> "does not thread".

The runner never allocates, never reads a clock and never spawns. Its state is
a fixed arena sized by `ORBPRO_EVENT_MAX_COMPONENTS`, `ORBPRO_EVENT_MAX_OBJECTS`,
`ORBPRO_EVENT_MAX_HITS`, `ORBPRO_EVENT_SCAN_BATCH` and
`ORBPRO_EVENT_MAX_PENDING`, each overridable by the locator before the include.

## Error codes

Every failure returns its OWN code. A locator that answers `-1` for everything
is unconformable: the consumer cannot place the failure on the degradation
ladder, so it cannot decide between retrying, widening the interval and
refusing. Codes `-1..-6` are deliberately the same numbers and meanings as the
propagator family's; the events-specific codes start at `-20` so no consumer
can confuse the two tables by value.

| Code | Name | When |
| ---: | --- | --- |
| `-1` | `NOT_CONFIGURED` | `plugin_event_configure` has not been called, or it failed |
| `-2` | `BAD_OBJECT_INDEX` | an object index outside `[0, object_count)` |
| `-3` | `NULL_OUTPUT` | a required output pointer was null |
| `-4` | `BAD_INPUT` | malformed policy or interval (zero step, zero span, NaN tolerance, zero `max_iterations`) |
| `-5` | `NOT_CONVERGED` | strict convergence was demanded and not reached |
| `-6` | `UNPHYSICAL` | geometry outside the locator's domain |
| `-20` | `NOT_STARTED` | `plugin_event_begin` has not been called |
| `-21` | `UNKNOWN_COMPONENT` | a component, parameter or object this locator does not implement |
| `-22` | `BUFFER_TOO_SMALL` | a caller buffer was short; nothing is truncated silently |
| `-23` | `PROTOCOL_ORDER` | `next`/`supply` out of order |
| `-24` | `SUPPLY_COUNT_MISMATCH` | `count != epoch_count * object_count` |
| `-25` | `INTERNAL` | never returned by a conformant locator |

Non-convergence of one root is normally reported per hit in
`EventHit.status`, not as a call failure. The statuses are `CONVERGED`,
`MAX_ITERATIONS`, `FLAT_BRACKET`, `DISCONTINUOUS`, `TRUNCATED` and
`EPOCH_RESOLUTION_LIMITED`, and they are distinct because a root that stopped
on the iteration cap and a root that converged are different answers.

## Interval pairing

Hits are crossings. An interval is a `FALLING` hit followed by the next
`RISING` hit on the same component (for the usual "`g > 0` means outside"
convention). The pairing is total because `EventScanSummary` carries the
endpoint signs:

| `initial_sign` | `final_sign` | Reading |
| --- | --- | --- |
| `POSITIVE` | `POSITIVE` | intervals fully inside the scan; pair `FALLING`→`RISING` |
| `NEGATIVE` | … | the first interval was **already open** at the scan start; its opening epoch is before the interval, and the first `RISING` hit closes it (`INTERVAL_OPEN_AT_START`) |
| … | `NEGATIVE` | the last interval is still open at the scan end (`INTERVAL_OPEN_AT_END`) |

Without the endpoint signs, "no hits" is ambiguous between "never in eclipse"
and "in eclipse the entire time", and those are opposite answers. This is the
classic event-scan defect and the summary struct exists to make it
unrepresentable.

Hits are reported in **scan order** — increasing epoch forward, decreasing
backward — regardless of the order refinement completed them.

## Propagate-to-condition

A GMAT-style `Propagate ... {Sat.Altitude = 400}` is this ABI with one
component whose `isStopCondition` is true and whose `g = parameter - goalValue`.
Nothing is added to the propagator ABI, and that is an engineering decision,
not a scoping convenience:

1. **It is the same algorithm.** A stop condition is
   `(event function, root refinement)`. Putting a second copy of Brent behind
   `plugin_propagate` would be two implementations of one algorithm that must
   agree — exactly the drift the generated-ABI lane exists to end.
2. **It would break every shipped propagator.** The propagator export set is a
   per-epoch state evaluation. Adding stop conditions to it makes root
   refinement a family-wide obligation on `sgp4`, `hpop` and
   `keplerian-reference`, all in the field. That is a breaking ABI change and
   an owner decision.
3. **A propagator is a state SOURCE.** It has no opinion about what is
   interesting, and giving it one couples every propagator to the parameter
   catalog.

**Backward propagation is not a mode.** It is `stop` earlier than `start`. The
runner steps negatively, the consumer's propagator is asked for earlier epochs,
and every hit carries `BACKWARD`. There is no second code path to keep in
agreement with the first.

**Synchronized multi-spacecraft (`Formation`) stops** are `object_count > 1`.
Every configured object is evaluated at **every** requested epoch, so the
states are aligned by construction rather than by the consumer remembering to
align them.

## Lifetime

`plugin_event_destroy` is **required** and must actually release: it resets the
runner to its post-`init` state while keeping the `eval` wiring, so a second
`configure`/`begin` cycle starts clean. It is idempotent, and after it
`plugin_event_hit_count()` is `0`.

Because the runner's arena is static and fixed, a locator's page count after N
scan cycles must equal its page count after one. That is the leak invariant,
and it is free here by construction.

## Versioning

Additive-only within a MAJOR. New enum members are **appended**; existing
values are never renumbered. New struct fields are appended only where they do
not move an existing offset — in practice that means a new struct, because
every struct in this ABI is packed to its alignment. The size and offset locks
in the generated header are what make a violation a compile error rather than a
silently-wrong-numbers defect.

## Parity envelope

Byte-identical across browser, native WasmEdge and Docker WasmEdge, for
identical inputs:

- the hit list: every `epoch_jd_day`, `epoch_seconds`, `value`, `component`,
  `direction`, `status`, `iterations`, `evaluations` and `flags`;
- the summaries: every endpoint value, sign and count;
- the epoch sequence `plugin_event_next` produces, and the evaluation count;
- the trap class of every refusal.

This is not a hope. The runner's arithmetic is IEEE-754 `+ - * /` and
comparison, which WebAssembly specifies exactly and which has no
fused-multiply-add form in the MVP. There is nothing for the lanes to disagree
about, and a divergence is a **P1 SDK defect**.

**A native reference build must use `-ffp-contract=off`.** On arm64, clang
contracts `a*b + c` into a single fused multiply-add; wasm has no `fma`, so the
same source computes a different (both correct) double. Measured on this ABI:
the Illinois regula-falsi step diverged by 1 ulp in the root epoch, which is
2.6e-10 s — inside every tolerance, and still a byte difference. A native build
that leaves contraction on is not comparing the same arithmetic.

### Measured, on this candidate

`test/events-abi.test.js` compiles `test/fixtures/event-runner-harness.c`
twice — natively and to `wasm32-wasip1-threads` — and diffs the raw IEEE-754
bit patterns of every reported number. Result: **identical**.

Against the closed form (`g0 = z`, roots at `kT/2`; `g1 = x`, roots at
`T/4 + kT/2`), worst `|root - analytic|` over two orbits:

| Scan | Method / step | Worst residual | g evaluations |
| --- | --- | ---: | ---: |
| A | Brent, 60 s | **7.3e-12 s** | 227 |
| B | Brent, 137 s | **5.5e-12 s** | 118 |
| C | Brent, 300 s | **2.4e-11 s** | 70 |
| D | Brent, 60 s, BACKWARD over the same arc | **4.5e-12 s** | 226 |
| E | Bisection, 60 s | **8.2e-10 s** | 484 |
| F | Illinois, 60 s | **3.3e-10 s** | 388 |
| G | Brent, source resolution 4.0233e-5 s | **2.1e-7 s** | 111 |

All eight events, in the same order, at all three scan steps; the backward scan
returns the same eight; the three methods agree to better than 1e-6 s while
costing 227 / 484 / 388 evaluations. Scan G is the clamp working: it reports
`EPOCH_RESOLUTION_LIMITED` and its residual is bounded by the source resolution
it was told about, not by the 1e-9 s it was asked for.

**The ordering defect this measurement caught.** Hits were originally reported
in *discovery* order, which is chronological per component but interleaved
across components. With a 60 s step two components' events fell in separate
scan samples and came out in epoch order; with a 137 s step they fell in the
same sample and came out in component order — the same eight events, two of
them transposed by half an orbit. Step-independence is a property of the LIST,
not only of each epoch, so the runner now inserts in scan order.

## Conformance

There is **no events conformance kit yet**, and `space-data-module conformance`
refuses the family by name rather than coercing it — a family with no kit can
never be `CORE`. What exists today and is wired into `npm test`:

```
node scripts/check-events-abi.mjs          # the drift gate
node --test test/events-abi.test.js   # the both-harness proof
```

The kit that would make this family `Shipped` owes: Tier 0 (the export set),
Tier C (`plugin_event_eval` agrees exactly with the `g` the runner used;
determinism as bytes across destroy/reconfigure; typed refusals;
step-independence; forward-backward closure; root convergence on a
known-analytic event), Tier 4 (lifecycle), and a self-test with planted
defects — including a locator whose `g` is impure, which is the failure mode
this ABI is most exposed to.

## Consumer seam

Per the pluggable-propagation law, the consumer resolves the propagator ONCE
and feeds it to the locator's supply loop. The locator never learns which
propagator it was. Concretely:

```js
const request = new OrbProEventStateRequest();       // from events-abi.js offsets
for (;;) {
  const n = wasm.plugin_event_next(requestPtr, epochsPtr, capacity);
  if (n < 0) throw new Error(eventErrorName(n));
  if (n === 0) break;
  for (let e = 0; e < n; e += 1) {
    const jd = epochs[2 * e] + epochs[2 * e + 1] / 86400.0;
    for (let o = 0; o < objectCount; o += 1) {
      propagator.propagate(jd, o, statesPtr + (e * objectCount + o) * 64);
    }
  }
  const rc = wasm.plugin_event_supply(statesPtr, n * objectCount);
  if (rc < 0) throw new Error(eventErrorName(rc));
}
```

That loop is the whole host obligation. It contains no physics, no tolerance,
no decision about which epochs matter, and it is identical in all three
runtimes.

## Guest usage

```c
#include "orbpro/orbpro_event_runner.h"   /* pulls in the generated ABI */

static OrbProEventRunner g_runner;

/* THE locator. Everything else is the runner. */
static int32_t eclipse_g(double jd_day, double seconds,
                         const OrbProStateVector* states, uint32_t objects,
                         double* g, uint32_t components, void* user) {
  (void)jd_day; (void)seconds; (void)user;
  if (objects < 1u || components < 1u) return ORBPRO_EVENT_E_BAD_INPUT;
  /* g > 0 outside the shadow, g < 0 inside. A FALLING crossing is entry. */
  g[0] = shadow_function(&states[0]);
  return 0;
}

ORBPRO_EVENT_EXPORT("plugin_event_eval")
int32_t plugin_event_eval(double jd_day, double seconds,
                          const OrbProStateVector* states, uint32_t objects,
                          double* g, uint32_t components) {
  return eclipse_g(jd_day, seconds, states, objects, g, components, NULL);
}

/* plugin_event_begin / next / supply / hit_count / hits / summaries / destroy */
ORBPRO_EVENT_RUNNER_EXPORTS(g_runner)
```

`plugin_event_describe` and `plugin_event_configure` are the locator's too:
they encode and decode the `EventLocatorDescription` / `EventLocatorConfig`
FlatBuffers and end in `orbpro_event_runner_configure` plus one
`orbpro_event_runner_set_component` per component.

## Regenerating

```
node scripts/generate-events-abi.mjs   # regenerate the header + bindings
node scripts/check-events-abi.mjs      # the drift gate, wired into npm test
```

Edit `schemas/orbpro/Events.fbs` — it is the single source of truth. A hand
edit to the generated header is erased by the next run and failed by the gate
in between. `include/orbpro/orbpro_event_runner.h` is **not** generated: it is
algorithm, not layout, and there is exactly one copy of it.
