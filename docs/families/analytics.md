# Analytics

**Status: EXPERIMENTAL.** One sub-harness of this family — **event location** —
has a ratified `.fbs` source, a generated header with a drift gate, named error
codes, a shared runner and a measured tri-runtime parity envelope. It has no
conformance kit and no reference module, so it is not `Shipped` and a
commercial module should not be sold against it. The rest of the family
(coverage quality, revisit statistics, availability, link-margin distributions)
remains **Planned** and this page states its scope and nothing more.

This is a sub-harness, not a twentieth family. The nineteen-family taxonomy is
owner-ratified; event location is analytics because it derives a figure over a
scenario rather than advancing one.

## Scope

Derived figures of merit computed over a scenario: coverage quality, revisit
statistics, availability, link margin distributions, and other aggregate
measures that summarize a run rather than advance it — plus **event location**,
which reduces a scenario to the epochs at which something became true.

## Event location — the shaped part

**Read [the event locator ABI](../events-abi.html).** Everything below is a
summary of it.

Eclipse (umbra / penumbra / antumbra, any number of occulting bodies), station
contact with masks and light time, sensor-FOV intrusion, apsides, node
crossings and a propagate-to-condition stop are ONE ABI: a vector of scalar
event functions `g_i(t)` whose sign changes are refined to roots.

A locator writes `plugin_event_eval` — the `g` vector — plus its description
and its configuration decoder. The bracketing scan, the root refinement, the
direction filtering, the occurrence counting and the epoch ordering come from
`include/orbpro/orbpro_event_runner.h`, unchanged, in every locator. "Adding a
new locator requires no change to the runner" is therefore structural: there is
no runner to change, only a `g` to write.

Two decisions are worth reading the contract for:

- **The state source is pulled, never imported.** `plugin_event_next` reports
  the epochs the locator wants; the consumer propagates them through whatever
  module is wired to the port; `plugin_event_supply` feeds the states back.
  The propagator stays a port, no new host capability is needed, and the three
  runtimes are byte-identical because the consumer decides nothing.
- **Epochs are `(jd_day, seconds)` pairs.** A Julian date in one `float64`
  resolves to 4.02e-5 s, so a single-double JD cannot carry a stop epoch to
  1e-6 s. The split pair resolves 1.5e-11 s — and because
  `OrbProStateVector.epoch` is a frozen single `float64`, the state source's
  own resolution is what bounds the answer. It is DECLARED, the runner clamps
  to it, and a clamped root is reported `EPOCH_RESOLUTION_LIMITED` rather than
  claiming a precision nothing measured.

## What exists today

- `schemas/orbpro/Events.fbs` — the single source of the wire layout.
- `include/orbpro/orbpro_events_abi.h` — generated, with size and offset locks;
  `node scripts/check-events-abi.mjs` fails when the two disagree.
- `include/orbpro/orbpro_event_runner.h` — the shared runner. Hand-written
  because it is algorithm, not layout, and there is exactly one copy of it.
- `src/generated/orbpro/events-abi.{ts,js}` — byte-offset bindings, so no
  JavaScript consumer hard-codes an offset.
- `test/events-abi.test.js` — the both-harness proof: one source
  file compiled natively and to `wasm32-wasip1-threads`, diffed as raw
  IEEE-754 bit patterns. Identical. Roots reproduce the closed form to
  7.3e-12 s under Brent, are independent of the scan step at 60 / 137 / 300 s,
  survive time reversal, and agree across all three bracketing methods.

Nothing else in this family is implemented. Matches for the word "analytics"
elsewhere in the stack refer to product and interface analytics work, not to a
plugin family.

## The rest of the family, and why it is still Planned

An analytics harness is mostly a question of what it is allowed to READ. A
figure of merit computed over a whole scenario needs broad read access to
results, which is the opposite of the narrow, per-call inputs every other
family gets — and that is the design problem to solve before freezing anything.

Event location did not have that problem, which is why it went first: it needs
states at epochs it chooses, and the pull protocol gives it exactly that
without widening what a module may reach.

## What ratification requires

A family reaches Designed when an ABI has been drafted against a real consumer,
and Shipped only when all of the following exist:

- A single `.fbs` schema as the source of the wire layout. **(event location:
  done)**
- A generated ABI header with size and offset locks, plus a drift gate that
  fails when the schema and the committed header disagree. **(done)**
- Declared units and frames per field, named sentinels, and named negative error
  codes. **(done)**
- A conformance kit carrying its own negative control, and a reference module.
  **(open — this is what holds event location at Experimental)**
- A stated tri-runtime parity envelope. **(done, and measured)**
- Exactly one generic consumer port. **(done: the pull loop)**

Outside event location, do not build against this family. If your work falls in
that scope and cannot wait, build a records-in, records-out module through the
[BYO-wasm quickstart](../byo-wasm-quickstart.html) — that path needs no harness
and is available now — and expect to migrate to the family ABI when it is
ratified.
