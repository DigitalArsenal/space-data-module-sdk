# Propagator ABI

**Status:** v1 — owner ruling 2026-08-10 ("No JS propagator!!!! WASM ONLY"),
graph task `harness-w1-propagator-abi-and-reference`, ratified by
`graph/findings/official-harness-shapes.md` §7 SHIP-1.

This is **the** official third-party propagator harness. A propagator that
touches OrbPro primitives ships as a signed WASM module implementing the
exports below. The JavaScript `Propagators` registry is INTERNAL engine
plumbing — how the engine dispatches to compiled modules — and is never
offered as a public extension point.

Nothing in this ABI names Cesium, OrbPro, or a vendor. The same exports serve
the browser frame-worker pool, a WasmEdge flow runtime, and a deterministic
test fixture.

## Table of contents

- [Doctrine](#doctrine)
- [Capability](#capability)
- [The export set](#the-export-set)
- [Wire layout](#wire-layout)
- [Units](#units)
- [Frames](#frames)
- [Identity](#identity)
- [Threading](#threading)
- [Error codes](#error-codes)
- [Lifetime](#lifetime)
- [Versioning](#versioning)
- [Parity envelope](#parity-envelope)
- [Conformance](#conformance)
- [Consumer seam](#consumer-seam)
- [Guest usage](#guest-usage)

## Doctrine

Five rules govern every line below.

1. **One source, generated everywhere.** The structs, enums, size locks and
   offset locks in this ABI are GENERATED from
   `schemas/orbpro/Propagator.fbs`. No hand-written mirror is legitimate
   anywhere in the stack. Before W1.1 there were five, they disagreed, and the
   disagreement was a units contradiction inside a single file — kilometres in
   the field comments, METERS in the layout block three lines below.
2. **The wire is bytes at offsets, and the offsets are locked.** Every ABI
   struct carries `_Static_assert` on its size AND on every field offset. This
   is not decoration: JavaScript reads these structs out of linear memory at
   byte offsets, and no runtime check can catch a shifted field — `6778` and
   `6778000` are both finite doubles.
3. **Refuse rather than approximate.** A propagator that cannot answer returns
   a documented negative code. It never returns a plausible number it does not
   stand behind, and it never traps on input it was given the chance to
   validate. A `converged` flag is never trusted by a consumer; it is
   adjudicated by verify-by-propagation.
4. **Declare what you are.** Frame, validity flags and reserved bytes are
   WRITTEN, every call. A state vector that leaves `reference_frame` at its
   default is unreadable by a host that honours the field, and one that leaves
   the padding bytes alone is handing back the previous call's data.
5. **The engine owns the schedule; the module owns one row.** Sharding a batch
   across workers is the host's decision. A module writes only the rows it was
   given and holds no cross-row state, which is what makes it safe under any
   sharding the host chooses.

## Capability

A propagator module declares family `propagator` in its
`plugin-manifest.json`. The family vocabulary is authoritative and
fail-closed: `normalizePluginFamily` throws `UnknownPluginFamilyError` naming
the value and the vocabulary (W0.3). There is no silent `ANALYSIS` fallback —
that fallback silently mislabelled 22 modules.

**The namespace rule.** A `$`-prefixed four-byte file identifier is ratified
SDS. A bare four-byte identifier is a vendor invention, and **a harness MUST
refuse it**. A port declaring `acceptsAnyFlatbuffer` is unconformable and is
not admissible on a harnessed family: a wildcard cannot be
conformance-tested, and six first-party manifests currently declare one on
both faces.

The reference module's ingest port is the worked example: it declares exactly
`$OMM`, in both its canonical FlatBuffer form and its aligned-binary peer, and
nothing else.

## The export set

Exports are announced with `__attribute__((export_name(...)))`. The SDK
compiler exports the invoke-surface symbols and every declared `methodId`;
the propagator ABI entry points are not `methodId`s, so they announce
themselves.

### Required

| Export | Signature | Returns |
|---|---|---|
| `plugin_init` | `int32_t(const uint8_t* data, size_t len)` | entities initialized (>0), or a negative [error code](#error-codes) |
| `plugin_propagate` | `int32_t(double julian_date, uint32_t entity_index, OrbProStateVector* out)` | `0`, or a negative error code |
| `plugin_destroy` | `void(void)` | — |

At least one of `plugin_propagate` or `plugin_propagate_batch` must exist;
shipping both is expected, and they must agree exactly (see
[parity envelope](#parity-envelope)).

### Typed ingest

| Export | Signature | Returns |
|---|---|---|
| `plugin_init_omm` | `int32_t(const OrbProOMMRecord* records, uint32_t count)` | entities now held, or negative |
| `plugin_ingest_omm_one` | `int32_t(const OrbProOMMRecord* record)` | **the handle it assigned**, or negative |
| `plugin_init_elements` | `int32_t(const OrbProOrbitalElements* elements, uint32_t count)` | entities initialized, or negative |

`plugin_init_omm` REPLACES the element set. `plugin_ingest_omm_one` APPENDS
and returns its handle — see [identity](#identity).

### Ephemeris ingest

| Export | Signature | Returns |
|---|---|---|
| `plugin_init_ephemeris` | `int32_t(const uint8_t* bytes, size_t len, uint32_t format)` | entities initialized (>0), or a negative [error code](#error-codes) |

`format` is an `OrbProEphemerisFormat` member (`AUTO` = identify from the
bytes). This is the ONLY legal door for an ephemeris container. It exists
because `plugin_init` is bound to packed `OrbProOMMRecord` and MUST refuse a
length that is not a whole multiple of that struct — so a DAF, a Code-500
record stream or an STK `.e` body has no entry point through it, and passing
one anyway is a size-lock violation dressed as an ingest. Do not smuggle
ephemeris bytes through `plugin_init` as fake OMM records.

An ephemeris provider is a propagator like any other. It exports
`plugin_init_ephemeris` INSTEAD of the OMM/element ingest verbs, and is
otherwise held to every rule on this page: `plugin_propagate` and
`plugin_propagate_batch` agree exactly, output is **ECEF metres** (§[Frames](#frames)),
padding bytes are zero, `plugin_destroy` really releases, and every failure
carries its own code. The consumer seam does not change — the host still
resolves it by name and drives it through `PropagatedPositionProperty`.

Three obligations are specific to this verb:

- **The frame is DECLARED, and this is the one family that may exit
  non-ECEF.** Every other provider outputs ECEF because it computes in a frame
  of its own choosing and the host cannot know which. An ephemeris container is
  different: it states its frame outright (a `REF_FRAME` keyword, a DAF frame
  code, an STK `CoordinateSystem`, SP3's terrestrial frame), and rotating a
  J2000 kernel to ECEF so the consumer can rotate it straight back is two
  interpolated rotations added to an answer that was already exact. So an
  ephemeris provider emits the container's own frame and SAYS SO in
  `StateVector.reference_frame`, set through
  `orbpro_state_set_reference_frame()` — never by assigning the field, which
  leaves the padding bytes stale.

  The frame it names must be a member of the ABI's own `ReferenceFrame` roster,
  translated by NAMED TOKEN. A native frame integer never crosses this seam:
  five incompatible `ReferenceFrame` vocabularies meet here and `ECI == 0`,
  `TEME == 0` and `FIXED == 0` all collide. A container whose declared frame
  has no member on the roster is `UNSUPPORTED_FORMAT`, not a guess.
- **Interpolation is declared, not implied.** A container that states its own
  interpolation rule (SPK segment type, OEM `INTERPOLATION`/`INTERPOLATION_DEGREE`,
  STK `InterpolationMethod`) is evaluated by THAT rule. A module that silently
  substitutes its own is not reading the file, it is fitting one.
- **Ingest is streamed, not slurped.** A multi-hundred-megabyte kernel that
  loads on native WasmEdge and dies in the browser is a runtime-shaped branch.
  Read the container by record and declare `initialMemoryBytes` /
  `maximumMemoryBytes` rather than inheriting a per-lane default.

### Batch and introspection

| Export | Signature | Returns |
|---|---|---|
| `plugin_propagate_batch` | `int32_t(double julian_date, OrbProStateVector* out, uint32_t count)` | `0`, or negative |
| `plugin_entity_count` | `int32_t(void)` | entities currently held |

`plugin_init` must accept a packed array of `OrbProOMMRecord` and MUST refuse
a length that is not a whole multiple of `sizeof(OrbProOMMRecord)`. A partial
trailing record means the caller and the module disagree about the struct
size, and the size lock cannot see across the boundary.

## Wire layout

Generated header: `include/orbpro/orbpro_propagator_abi.h`.
Generated TS byte offsets: `space-data-module-sdk/generated/propagator-abi`.
**Read offsets from the generated bindings. Never write a literal `8`.**

### `OrbProStateVector` — 64 bytes, 8-byte aligned

| Offset | Size | Type | Field |
|---|---|---|---|
| 0 | 8 | float64 | `epoch` — Julian date |
| 8 | 24 | float64×3 | `position` — **METERS** |
| 32 | 24 | float64×3 | `velocity` — **METERS/SECOND** |
| 56 | 1 | uint8 | `reference_frame` |
| 57 | 3 | uint8×3 | padding — **MUST be written as zero** |
| 60 | 4 | uint32 | `flags` |

The one-byte frame plus three reserved bytes is a DECLARED layout, not an
accident. The C header formerly declared a `uint32_t` at offset 56, which is
wire-identical only by little-endian accident (W0.2).

### `OrbProOMMRecord` — 88 bytes, 8-byte aligned

| Offset | Size | Field | Units |
|---|---|---|---|
| 0 | 8 | `epoch_jd` | Julian date |
| 8 | 8 | `mean_motion` | REV/DAY |
| 16 | 8 | `eccentricity` | — |
| 24 | 8 | `inclination` | DEGREES |
| 32 | 8 | `ra_of_asc_node` | DEGREES |
| 40 | 8 | `arg_of_pericenter` | DEGREES |
| 48 | 8 | `mean_anomaly` | DEGREES |
| 56 | 8 | `bstar` | 1/earth-radii |
| 64 | 8 | `mean_motion_dot` | REV/DAY² |
| 72 | 8 | `mean_motion_ddot` | REV/DAY³ |
| 80 | 4 | `norad_cat_id` | uint32 |
| 84 | 4 | padding | MUST be zero |

**This struct is also an on-disk format.** The first-party SGP4 module
persists it verbatim as a SQLite BLOB
(`sqlite3_bind_blob(..., &omm, sizeof(OrbProOMMRecord), ...)`). Until W1.1 it
carried no size or offset lock anywhere in the stack, so the layout every
stored blob depends on was held only by the field order of one hand-written
C struct in one module.

The layout above is that layout, exactly as it has already been written to
disk, trailing padding included. Locking it revealed **no ambiguity**: the
IDL-derived layout reproduces the hand-written struct byte for byte, so the
lock pins the existing wire rather than changing it. Migration is out of
scope and would invalidate every stored blob.

### `OrbProOrbitalElements` — 64 bytes, 8-byte aligned

Eight float64 in declaration order: `semi_major_axis` (**KILOMETRES**),
`eccentricity`, `inclination`, `raan`, `arg_periapsis`, `true_anomaly`
(all RADIANS), `epoch` (Julian date), `reserved` (MUST be 0).

## Units

> `OrbProStateVector.position` IS IN METERS.
> `OrbProStateVector.velocity` IS IN METERS PER SECOND.

There is no km variant, no per-plugin unit flag, and no negotiation. A plugin
that writes kilometres here is off by 1000× and its satellites render inside
the Earth.

The ONE place kilometres survive is `OrbProOrbitalElements.semi_major_axis`,
an INPUT struct that is not the state vector. It is kilometres there and
stays kilometres. Do not "unify" them.

Ruling: finding §4.1 / §8.1; landed as W0.1.

## Frames

`reference_frame` is `OrbProReferenceFrame`. Values **0-5 are frozen and are
never renumbered**; the GMAT axis roster is appended at 6+:

`TEME=0 J2000=1 ICRF=2 ECEF=3 MCI=4 MCMF=5 MJ2000EC=6 MOD=7 TOD=8 MOE=9 TOE=10
BODY_FIXED=11 BODY_INERTIAL=12 OBJECT_REFERENCED=13 LOCAL_ALIGNED_CONSTRAINED=14
EQUATOR=15 GSE=16 GSM=17 TOPOCENTRIC=18 BODY_SPIN_SUN=19 SPICE_DEFINED=20
MOD_FK5=21 TOD_FK5=22`

`ECEF`, `MCI` and `MCMF` are body-bound legacy instances of the generic pair at
11/12 — ECEF is `BODY_FIXED` about the Earth, MCI is `BODY_INERTIAL` about Mars,
MCMF is `BODY_FIXED` about Mars. They are retained; the generic members are not
a second spelling of them.

`MOD_FK5` and `TOD_FK5` are the IAU-76/FK5 route, retained under a NAME rather
than left as an undocumented second answer. They differ from `MOD`/`TOD` at the
milliarcsecond level and are not interchangeable with them.

**Plugins output ECEF.** The frame transform happens INSIDE the module. A
plugin that emits an inertial frame and expects the host to rotate it is
relying on a host path that is still unimplemented — `PropagatorPlugin.toICRF`
carries a live TEME≈ICRF approximation, and an ECEF input there is wrong by up
to a full Earth rotation (`orbpro-toicrf-frame-transform-unimplemented`).

**Never let a raw integer frame value cross a boundary unqualified.** Five
incompatible `ReferenceFrame` vocabularies are live on this seam, plus an
axis-type roster that is not a `ReferenceFrame` at all:

| Vocabulary | Values |
|---|---|
| `orbpro.propagator` (**this ABI**) | TEME=0 J2000=1 ICRF=2 ECEF=3 MCI=4 MCMF=5, then the roster at 6+ |
| `orbpro.plugins` (`PropagatorState.fbs`) | ECI=0 ECEF=1 TEME=2 ICRF=3 |
| OrbPro engine `ReferenceFrame.js` | FIXED=0 INERTIAL=1 TEME=2 VVLH=3 ENU=4 NED=5 NEU=6 RIC=7 LVLH=8 |
| `ConjunctionCommon.fbs` | ECI=1 |
| `foundation/frames` `AxisType` | an ORIENTATION rule, no origin — never numerically equated with a frame |

The engine row is the one this document got wrong for a long time: it said
"`Cesium.ReferenceFrame` FIXED=0 INERTIAL=1", and it was stale in the direction
that mattered — it hid seven live members. Verified against OrbPro `417320c5c5`
on 2026-08-30.

`ECI==0`, `TEME==0` and `FIXED==0` all collide, and ECEF is 1 in `orbpro.plugins`
but 3 here. Those values are frozen by compiled WASM artifacts already in the
field, so collapsing them is a wire break, tracked as
`sdk-reference-frame-enum-unification` — which also owns the ABI-vs-engine
inversion at 0/1. Until it lands, **translate by named token at every seam**.

The crosswalk between all of them is DATA, in
`schemas/orbpro/reference-frame-crosswalk.json`, and
`npm run check:reference-frame` (wired into `npm test` as
`test/reference-frame-uniqueness.test.js`) holds four things at once: exactly
one definition crosses the ABI; its numbering is append-only against
`schemas/orbpro/reference-frame.lock.json`; every foreign vocabulary maps onto
it by NAMED TOKEN and totally, re-read from source when that repo is on disk and
skipped-with-a-note when it is not; and the three live RTN triads (RIC, RSW,
RTN, plus the LVLH/VVLH relabellings) collapse to the single
`OBJECT_REFERENCED` member with an axes spec rather than becoming members of
their own.

Use the generated setter `orbpro_state_set_reference_frame()`, never a bare
assignment: it clears the three padding bytes a consumer reading offset 56 as
a 32-bit word would otherwise see as garbage.

## Identity

**`NORAD_CAT_ID` is the identity authority.** It is carried through, never
invented, never synthesized to make a lookup succeed.

**The entity index is a local handle** into one module instance's own array.
It is meaningless outside that instance and must never be persisted as an
identity.

### Creating engine state RETURNS its handle

This is the single highest-value primitive the harness adds.

```c
int32_t handle = plugin_ingest_omm_one(&record);   /* -> the handle assigned */
```

A caller must never derive "the entity I just created" as `count − 1`. Three
families in this stack independently reinvented that derivation; all three are
race-unsafe, undeclared and untested, and it is the root of defect B3 (the
maneuver marker renders from a buffer the seam never writes).

The engine-side implementation of this primitive for the FIRST-PARTY
propagators is **W1.5** (`graph/tasks/official-harness-shapes-program.md`).
This document states the contract now; third-party modules are expected to
honour it from day one, and the reference module does.

## Threading

Modules compile to `wasm32-wasip1-threads` (clang), per the isomorphic-pthreads
law. **Never `emcc -pthread`** — that emits the browser-only Web Worker +
postMessage thread model and has no wasi thread-spawn contract, so it cannot
thread under WasmEdge.

Two thread models are legitimate, and both use that same toolchain:

- **`emscripten-pthreads`** — despite the name, the real wasi-threads contract:
  the guest imports `wasi.thread-spawn` and exports `wasi_thread_start` over an
  imported shared memory. The post-link artifact guard fails the build if the
  emitted wasm does not actually carry shared memory and atomics.
- **`wasi-sequential`** — the module provably never spawns a thread. Requires
  `manifest.sequentialJustification` with a `kind` and a substantive `detail`;
  a mirror guard fails the build if the artifact is not what was claimed.

**A propagator is normally `wasi-sequential`, and that is the strong default.**
Propagation is embarrassingly parallel ACROSS entities and strictly sequential
WITHIN one, and the sharding belongs to the host. A module that spawns its own
pool contends with the pool already scheduling it.

> **Known defect:** `resolveThreadModel` reads the compile OPTION, not
> `manifest.threadModel`, and otherwise infers the model from
> `runtimeTargets` — where `"wasmedge"` infers pthreads. Pass
> `threadModel: manifest.threadModel` explicitly until
> `sdk-manifest-threadmodel-silently-ignored` lands, and assert the compiler
> agreed.

### Shard write discipline

When the host runs `plugin_propagate_batch` across a worker pool it hands each
worker the SAME output base pointer and a DISJOINT index range.

- Write **only** rows in your own range. Never write outside your stride.
- Never READ a neighbour's row. Your output must not depend on rows you were
  not given.
- Hold no cross-row state between rows of one batch.
- On failure, zero the offending row before returning, so a host that ignores
  the return value still reads a state marked not-valid rather than stale
  bytes. A partially written batch with no signal is the silent-wrong-numbers
  failure this ABI exists to prevent.

A module that satisfies these is safe under any sharding the host chooses,
which is the property the ABI actually requires — not a particular thread
count.

## Error codes

Every failure returns its OWN documented negative code. A propagator that
returns `-1` for everything is unconformable: the host cannot tell a bad
entity index from an uninitialized module, so it cannot place the failure on
the degradation ladder (transient → skip; fatal → respawn; exhausted → latch).

| Code | Name | Meaning |
|---|---|---|
| `0` | OK | success |
| `-1` | NOT_INITIALIZED | no elements ingested yet |
| `-2` | BAD_ENTITY_INDEX | index ≥ entity count |
| `-3` | NULL_OUTPUT | caller passed a null output pointer |
| `-4` | BAD_INPUT | malformed or short input buffer |
| `-5` | NOT_CONVERGED | the solve failed to converge |
| `-6` | UNPHYSICAL | the elements describe no closed orbit |
| `-7` | UNSUPPORTED_FORMAT | the ephemeris container is not one this module reads, or `AUTO` could not identify it |
| `-8` | EPOCH_OUT_OF_RANGE | the requested epoch lies outside every segment the loaded ephemeris covers |

Rules that are not negotiable:

- **Validated input can never trap.** Malformed input is a code, not a crash.
- **NaN is its own failure class.** It is never "a number that happened".
- **A physically impossible result is a refusal**, not an output.
- **Error classes are identical across runtimes.** A code that differs between
  browser and WasmEdge is a P1 SDK defect.

## Lifetime

`plugin_destroy` is **required**, and it must actually release.

The test is mechanical: N × ingest / propagate / destroy must reach a steady
memory baseline. WebAssembly linear memory never shrinks, so "memory went back
down" is not available and a test asserting it would assert something
impossible. What a non-leaking module gives you is that growth STOPS: after a
warm-up that pays for every allocation the cycle will ever need, further
identical cycles add ZERO pages.

`destroy` must also be idempotent, must leave `plugin_entity_count()` at zero,
and must leave the module usable — a destroyed module refuses to propagate
(`NOT_INITIALIZED`) rather than reading freed state, and comes back cleanly on
the next ingest.

> **Historical defect, retired 2026-08-12.** `destroySource()` was literally
> `{}` in BOTH shipped first-party propagators when this ABI was written
> (finding §4.5), and sgp4's `createSourceFromState` re-ingested the whole
> catalogue for a single burn. The maneuver program landed the fix on OrbPro
> `main` (`2db279766c` and `97cc38127e`): both propagators now recycle
> post-burn source SLOTS — the entity stays resident so no index above it
> moves, destroy marks the slot free, and creating a source re-points the
> recycled entity in place. The reference module remains the leak-test bar,
> now enforced mechanically by
> `space-data-module conformance propagator` (tier4/lifecycle-leak).

## Versioning

`abi_version` gates at register/load. `ORBPRO_ABI_VERSION` is declared in
`orbpro_plugin.h`; a module declares `abiVersion` in its manifest, and a
mismatch is refused with `ORBPRO_ERROR_ABI_MISMATCH`, never coerced.

Shape versions are `SHAPE_MAJOR.SHAPE_MINOR`, independent of the SDS wave
counter.

- **Additive-only within a MAJOR.** Enforced by the drift gate, not by prose:
  `npm run check:propagator-abi` regenerates every artifact from the IDL and
  byte-diffs it against what is committed. Any difference fails.
- **Consumers declare a FLOOR plus a MAJOR, never exact equality.**
  Exact-equality resolution caused three build outages and a P1 in one week.
  Floors only advance.
- **Stability promise:** additive-only for two minors; a breaking change
  requires a one-minor deprecation notice.
- **Deprecation, never deletion.**
- **Refusals are legible.** A mismatch names the shape, what was required and
  what was offered — never "not found".

## Parity envelope

**Inside the envelope** — byte-identical across browser, native WasmEdge and
Docker WasmEdge, at thread counts 1/2/4/8:

- every byte of every `OrbProStateVector` a module writes for given inputs
- `plugin_propagate` and `plugin_propagate_batch` for the same entity and epoch
- every error code, for every malformed and unsatisfiable input
- the handle `plugin_ingest_omm_one` assigns, for a given ingest order
- the steady-state verdict of the lifecycle leak test

Determinism is compared as **bytes, not as numbers**, and must survive a
destroy / re-ingest cycle: output that changes after a lifecycle round trip is
state leaking across it.

**Outside the envelope**, stated so it is never mistaken for a defect: results
from a propagator whose physics depends on live external data (space weather,
EOP) at different acquisition instants. Their ABI BEHAVIOUR — codes, struct
shapes, frame declaration, padding, copy accounting — is fully inside.

**Divergence in anything listed as inside the envelope is a P1 SDK defect.**
Not a platform quirk. File, block, fix.

Run it:

```
space-data-module parity-gate --artifact <id>=./dist/isomorphic/module.wasm:module
```

## Conformance

What "official" buys a third party: one command, family-dispatched, shipped
with its own negative control ([docs/conformance.md](conformance.md)):

```
space-data-module conformance propagator --artifact ./dist/isomorphic/module.wasm
space-data-module conformance propagator --self-test    # must exit 0 BY failing
```

The runner adjudicates everything this document specifies that a single lane
can observe — the export set, the corpus anchors, the invariants with no
stored expectation, the error-code table, and the leak test — and reports the
cross-runtime lane honestly as a gap that only the parity gate above closes.
`PASS` / `PASS-WITH-GAPS` exit 0; `FAIL` exits 1 with the offending check
named.

## Consumer seam

Per the pluggable-propagation law (owner, 2026-07-29), **every surface that
consumes a propagator takes it as a parameter or port** — never hardwired to
SGP4 or any single provider. A Sandcastle demo resolves it once from
`?propagator=NAME` and feeds that single value to every consumer downstream.

Engine-side, `PropagatedPositionProperty` accepts a propagator instance OR a
registered name/id, and orbits are drawn by the regular path visualizer.
Third-party modules reach it through the storefront ADD path —
`Cesium.registerPlugin(name, source)` then `initPlugins({ plugins: [name] })`.
Built-in bundle names are refused there (`E92`); a third-party module uses its
own name.

## Guest usage

The complete, buildable reference implementation lives at
`space-data-network-modules/propagator/keplerian-reference/`. Every export in
it is annotated with the section of this document it implements, and
`space-data-module init --family propagator` scaffolds its skeleton.

```c
#include "space_data_module_invoke.h"
#include "orbpro/orbpro_propagator_abi.h"   /* the ONE generated ABI */

#define ORBPRO_ABI_EXPORT(name) __attribute__((export_name(name))) extern "C"

ORBPRO_ABI_EXPORT("plugin_propagate")
int32_t plugin_propagate(double julian_date, uint32_t entity_index,
                         OrbProStateVector* out) {
  if (out == NULL)                 return -3;  /* NULL_OUTPUT      */
  if (entity_count == 0)           return -1;  /* NOT_INITIALIZED  */
  if (entity_index >= entity_count) return -2; /* BAD_ENTITY_INDEX */

  /* Start from the initializer: it zeroes the WHOLE struct, including the
   * three reserved bytes the IDL requires to be zero. The host reuses one
   * scratch buffer across every call, so a partial write hands back the
   * previous call's bytes. */
  orbpro_state_init(out);
  out->epoch = julian_date;
  out->position[0] = x_metres;      /* METERS. Not kilometres. */
  out->position[1] = y_metres;
  out->position[2] = z_metres;
  out->velocity[0] = vx_metres_per_second;
  out->velocity[1] = vy_metres_per_second;
  out->velocity[2] = vz_metres_per_second;

  /* Use the generated setter — it clears the padding bytes. */
  orbpro_state_set_reference_frame(out, ORBPRO_FRAME_ECEF);
  out->flags |= (uint32_t)ORBPRO_STATE_VALID;
  return 0;
}
```

Reading a state vector from JavaScript, without a single literal offset:

```js
import { ORBPRO_STATE_VECTOR } from "space-data-module-sdk/generated/propagator-abi";

const { offsets, size } = ORBPRO_STATE_VECTOR;
const view = new DataView(memory.buffer, pointer, size);
const epoch = view.getFloat64(offsets.epoch, true);
const x     = view.getFloat64(offsets.position, true);
const frame = view.getUint8(offsets.reference_frame);
```

## Regenerating

```
node scripts/generate-propagator-abi.mjs   # regenerate from the IDL
node scripts/check-propagator-abi.mjs      # the drift gate (runs in npm test)
```

The gate ships its own negative control: a test corrupts a copy of the
generated tree and requires the gate to name the corruption. A gate never
observed to fail is indistinguishable from one that cannot fail.
