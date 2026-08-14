# Maneuver

**Status: EXPERIMENTAL.** A real maneuver module ships and a consumer-side seam
is frozen, but the WASM invoke surface itself is not frozen and carries known
defects. Do not ship a commercial module against this family yet. Everything
below describes what exists, and names precisely what does not.

## Doctrine

A maneuver module answers one question: given a chaser state, an optional target
state, and a maneuver intent, what burns achieve it and what does the resulting
trajectory look like? It computes; it does not render, and it does not decide
when a burn happens — that belongs to the scheduler and behavior families.

The family's defining discipline is that a computed maneuver is answered by the
module or not at all. The consuming seam never falls back to arithmetic in
JavaScript when the module declines; it returns an empty plan and a diagnostic.
This is what makes a third-party maneuver module a real substitution rather than
a decoration on a built-in solver.

## Capability

A maneuver module may read the states it is given, compute impulsive or finite
burns, and return a plan. It may not mutate scene state, may not fetch data, and
may not schedule itself.

The conformance model pinned by the shipped seam is deliberately narrow:
two-body point-mass Earth with impulsive burns, `mu = 3.986004418e14 m^3 s^-2`
and `Re = 6378137 m`. A module offering higher fidelity is welcome, but it must
answer these vectors within the seam's tolerance to be a drop-in.

## Import and export set

**Not frozen.** The shipped module uses the SDK's generic command invoke
surface rather than a family-specific export set. A module declares
`invoke surface: command` in its manifest and receives a JSON command envelope:

```json
{ "operation": "<name>", "params": { } }
```

Structured JSON comes back, with an `errorCode` on every failure path. The
manifest of the shipped module declares `acceptsAnyFlatbuffer: true`, justified
as a foreign-wire-format wildcard port — that wildcard is exactly the thing a
frozen ABI is supposed to remove.

There is no `orbpro_maneuver_abi.h`. There is no maneuver `.fbs` message ABI.
The freeze of this surface is open work under the graph task
`harness-w2-maneuver-invoke-freeze`.

## Wire layout

**Not specified.** The command envelope is JSON, not a byte-exact struct. The
typed FlatBuffer runtime wire — delta-v nodes with a mandatory frame and named
basis, signed doubles in metres per second, epoch-or-anchor timing — is designed
but unminted; the SDS `$MVW` maneuver-plan record does not exist. Tracked by
`harness-w3-maneuver-plan-record-mvw`.

Until that lands, treat the JSON envelope as an implementation detail that will
be replaced, not as a contract.

## Units and frames

SI end-to-end at the frozen consumer seam: metres, metres per second, seconds,
radians. Frames must be named explicitly on every delta-v; the future typed wire
makes the frame field mandatory precisely because the current envelope allows it
to be implied.

## Sentinels

An unanswerable card returns an empty plan plus a diagnostic — never a zero
burn, and never a silently substituted approximation. A zero-length plan is a
refusal, not a no-op maneuver.

## Identity

States are passed by value into the call. There is no persistent entity handle
in this family today; a plan is addressed by the card kind and the seed it was
produced from.

## Threading

`wasm32-wasip1-threads`, as for every family. The shipped module declares
runtime targets browser, wasi and wasmedge. No batch or shard-write discipline
is defined for this family yet, because no batch call exists.

## Error codes

**Not frozen.** The envelope returns an `errorCode` on failure paths, but the
named code set is not ratified, and an audit found a dead error path in the
shipped implementation. Do not depend on specific numeric values.

## Lifetime

Command-surface modules are instantiated, invoked, and torn down by the host.
Nothing in this family holds cross-call state today.

## Parity envelope

The module builds for browser, wasi and wasmedge targets and is exercised by the
project's own tests, but this family has no ratified parity envelope statement
of its own. Run the generic
[tri-runtime parity gate](../tri-runtime-parity-gate.html) against any candidate.

## Consumer seam

The consumer-side seam **is** frozen, and it is the most useful part of this
family today. A solver is a pluggable port with two methods:

```ts
plan(cardKind, seed, chaserState, targetState?): Node[]
reconcile(plan, simT): { liveElements, firedJobs }
```

Card kinds: `pro`, `radial`, `normal`, `cislunar`, `custom`, `hohmann`,
`hohplane`, `biel`, `lambert`, `phasing`, `rendezvous`.

The computed cards — `hohmann`, `hohplane`, `biel`, `phasing`, `lambert` — are
answered by the module or not at all. The node-seed cards — `pro`, `radial`,
`normal`, `custom` — have no module operation and are seeded directly.

## Guest C++ example

There is no reference maneuver module in this SDK to derive a canonical example
from, and publishing an invented one against an unfrozen surface would be worse
than publishing none. Build against the
[propagator guest example](propagator.html) for the module skeleton, threading
model and teardown discipline, and treat the maneuver computation itself as
command-envelope handling until the invoke freeze lands.

## Known defects, stated plainly

The invoke surface is not frozen because of specific, reproduced defects:

- A dead error path that cannot be reached.
- Delta-v scalars that lose their sign — magnitudes are returned where signed
  values are required.
- Lambert solutions that report a converged flag which is not true, for the
  large majority of the tested geometries.

These are tracked under `harness-w2-maneuver-invoke-freeze`. The seam contract
publication, the invoke freeze, and the `$MVW` record mint are the three
gates between this page and a Shipped status.
