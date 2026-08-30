# Harness family matrix

The Space Data Module SDK exposes one *harness family* per kind of scenario
behavior. A harness family is a uniform WASM ABI: a named export set, a
generated wire layout, declared units and frames, named error codes, and a
conformance kit that proves an implementation satisfies it. A third party
implements the exports, compiles to WebAssembly, and the module is loadable by
any consumer of that family — with no modification to the consuming engine.

A family port that cannot absorb a legitimate module without an engine edit is
itself the defect.

## The uniform spine

Every family is specified and documented against the same spine, in the same
order. The propagator family is the reference implementation of the spine; read
[Propagator](families/propagator.html) first, whichever family you are building for.

| Section | What it fixes |
| --- | --- |
| Doctrine | Why this family exists and what it is explicitly not |
| Capability | What a module of this family is allowed to compute and to touch |
| Import / export set | The exact symbols the guest must export and may import |
| Wire layout | Byte-exact structs, generated from a single `.fbs` source |
| Units and frames | The unit of every field and the reference frame of every vector |
| Sentinels | The reserved values that mean "absent", "unknown", "refused" |
| Identity | How an entity is addressed across calls |
| Threading | The threading model and the shard-write discipline |
| Error codes | The named negative codes; never a generic `-1` |
| Lifetime | Init, reuse, and a real idempotent teardown |
| Parity envelope | What must be byte-identical across browser, WasmEdge and Docker WasmEdge |
| Consumer seam | How a consuming surface takes the module as a pluggable port |
| Guest C++ example | A compilable starting point |

## How a family is built

1. A single `.fbs` schema is the source of the wire layout. Nothing is
   hand-written twice.
2. A generator emits the ABI header (and the JS/TS bindings) from that schema,
   and a drift gate byte-diffs the generated output against what is committed.
   A schema edit that is not regenerated fails the gate.
3. Modules are compiled `wasm32-wasip1-threads`. This is isomorphic by
   construction: the same artifact runs in the browser, under WasmEdge, and
   under Docker WasmEdge.
4. Data in and out of a module is Space Data Standards records, never a bespoke
   JSON shape.
5. A conformance kit and a reference module ship with the family. The kit
   carries its own negative control, so a kit that cannot catch a planted defect
   fails itself.
6. The artifact is protected, signed, published and listed. See the integrator
   path below.
7. Exactly one generic consumer port exists per family.

## Status vocabulary

Status on this site is literal, and is taken from the ratified harness-family
taxonomy of 2026-08-14. It is not aspirational.

| Status | Meaning |
| --- | --- |
| Shipped | Ratified `.fbs` single source, generated header with a drift gate, conformance kit, reference module. Build against it. |
| Experimental | Real code exists and the shape is taking form, but it is not frozen and known defects are open. Do not ship a commercial module against it. |
| Designed | An ABI has been drafted against a real consumer. No generated header, no conformance kit, no reference module has landed. |
| Planned | A ratified entry in the taxonomy whose individual shape has not been ratified. Nothing is implemented. |

Only **propagator** and **data-source** are Shipped. **maneuver**,
**estimation** and **analytics** are Experimental — analytics on the strength
of ONE sub-harness, [event location](events-abi.html), whose `.fbs`, generated
header, drift gate, shared runner and measured parity envelope have landed and
whose conformance kit has not. Only **rf**, **obstruction** and **conjunction**
are Designed. Every other family is Planned, and its status has not been
ratified individually — a Planned page states scope and nothing more.

A sub-harness is not a twentieth family. The nineteen-family taxonomy above is
owner-ratified: a capability that fits inside a ratified family arrives as a
sub-harness with its own contract document, and the family page states exactly
which part of it is shaped.

Where a family page says a thing does not exist, that is a checked statement
about the tree today, not a placeholder.

## Vehicle domains are not a harness family

Space, air, ground and naval vehicles do not each get a harness. The vehicle
domain is a declaration in the module manifest — state space, frames, and
degrees of freedom — consumed by whichever family the module implements. A
ground-vehicle propagator and a spacecraft propagator implement the same
propagator export set and differ in the manifest.

## Harness families are not the runtime `PluginFamily` enum

Two vocabularies exist and they are not the same list.

- The **harness-family taxonomy** on this site is the owner-ratified list of
  ABI-bearing plugin kinds: propagator, maneuver, propulsion, attitude, gnc, rf,
  sensor, signature, environment, obstruction, breakup, reentry, conjunction,
  effects, estimation, data-source, analytics, scheduler, behavior.
- The **`PluginFamily` enum** in `schemas/PluginManifest.fbs` is the SDK's
  internal manifest classification (`SENSOR`, `PROPAGATOR`, `RENDERER`,
  `ANALYSIS`, `DATA_SOURCE`, `COMMS`, `SHADER`, `SDF`, `INFRASTRUCTURE`, `FLOW`,
  `BRIDGE`, `MANEUVER`, `ORBIT_DETERMINATION`, `FOUNDATION`, `PARSER`,
  `VALIDATOR`, `EXPORTER`, `PUBLISHER`, `BASILISK`). It is what a manifest
  declares today.

They overlap but do not correspond one-to-one, and a family in the taxonomy may
project onto a broader `PluginFamily` member until a dedicated one is minted.
Do not file a mismatch between the two lists as a bug; the family pages state
which enum member each family projects onto.

## Internal plumbing is never a public contract

Two boundaries are permanent rulings, not maturity gaps:

- **JavaScript registries are internal engine plumbing.** They are how a
  consuming engine dispatches to compiled modules. They are never offered as a
  public extension point. Harness contracts are WASM ABIs only.
- **Scalar kernel-op ABIs behind closed modules are internal.** In particular
  the closed scalar `rf_*` kernel ABI is never the public RF contract. The
  public RF surface is the `.fbs`-defined harness ABI plus the record types
  a module consumes and emits.

## The integrator path

1. [BYO-wasm quickstart](byo-wasm-quickstart.html) — multi-translation-unit C++
   against the pinned `wasm32-wasip1-threads` toolchain, to a loadable artifact.
2. [Conformance kit](conformance.html) and the
   [tri-runtime parity gate](tri-runtime-parity-gate.html) — prove the ABI, then
   prove byte-identical behavior in every lane.
3. [Protect and sign](protect-and-sign.html) — encrypt the payload where the
   module is closed, attach the manifest, sign the artifact.
4. [Publication and listing](publication-submission.html) — the publication
   record layout, delivery, and the current state of self-serve listing.

An LLM building a module against this SDK should start at
[llms.txt](llms.txt).
