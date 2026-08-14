# Estimation

**Status: EXPERIMENTAL.** A production orbit-determination module is shipped and
running, but it is not a ratified harness: it has no generated ABI header, no
conformance kit, and no reference module in the harness sense. The broader
estimation surface that its headers describe is largely not wired into the
shipped path.

## Doctrine

An estimation module turns observations into state. Observations and an initial
guess go in; an estimated state, and where the family matures, a covariance,
come out. It is the inverse of the propagator family, and it depends on that
family: an estimator that cannot take its propagator as a pluggable port is
hardwired to one force model and is not a member of this family.

The pluggable-propagation law applies here with full force. Every
propagator-consuming surface — an estimator emphatically included — takes the
propagator as a parameter or port, never as a compiled-in choice.

## Capability

Ingest observations, fit a state, emit results as standards records. The shipped
path emits `$OMM`-class mean-element results and `$OBD` observation-derived
records. Input ephemerides are transient by rule: they are fitted and discarded,
and only the results are stored.

## Import and export set

**Not specified as a harness ABI.** No `orbpro_od_abi.h` or equivalent
generated header exists. The shipped module is invoked through the SDK's generic
module surface, not through a family-specific export set.

In the manifest vocabulary the family projects onto
`PluginFamily.ORBIT_DETERMINATION`, which itself carries a known projection gap:
Space Data Standards has no dedicated plugin-category member for it yet, so it
projects onto the analysis category until one is minted.

## Wire layout

**Not specified as a public wire.** The internal C++ types describe the intended
shape and are useful as a design reference, but they are not a published ABI and
their layout is not locked:

| Type | Fields |
| --- | --- |
| `StateVector` | `epoch_jd`, `x`, `y`, `z`, `vx`, `vy`, `vz` |
| `Observation` | `epoch_jd`, `type`, `value`, `sigma`, `station_id` |
| `GroundStation` | `id`, `name`, `lat_deg`, `lon_deg`, `alt_km` |
| `Covariance6x6` | 6×6 array of doubles |

`ObservationType` covers right ascension, declination, azimuth, elevation,
range, range rate, and position components.

The SDS `$ODW` problem record and its runtime wire are unminted; `$OBD` remains
the results record. By explicit ruling, the OD *result model* decision stays
deferred — a future record mint covers the problem and wire side only and must
not freeze the result model.

## Units and frames

The internal types mix conventions and this is a real hazard: epochs are Julian
dates, station geodetic position is in degrees with altitude in kilometres, and
state components are in the propagator family's units. Any published estimation
ABI must state the unit of every field at the field, exactly as the propagator
ABI does. Until it does, read the module's own headers rather than assuming.

## Sentinels

Not specified. The shipped path treats a failed fit as a refusal and does not
emit a record; there is no ratified sentinel vocabulary for a partially
converged solution.

## Identity

Objects are addressed by their catalog identity in the shipped path — the same
identity the propagator family uses for an entity.

## Threading

`wasm32-wasip1-threads`. The shipped fit path is genuinely multi-threaded and
runs a full catalog fit inside one composed WASM flow; that is the strongest
evidence in this family that the threading model is sound. No harness-level
shard-write discipline is specified because no batch ABI is published.

## Error codes

Not specified as a named set.

## Lifetime

The shipped module is instantiated once per flow run and torn down with it.

## Parity envelope

Cross-runtime parity is exercised for the shipped flow, but the family has no
parity envelope statement of its own. Use the generic
[parity gate](../tri-runtime-parity-gate.html).

## Consumer seam

The seam that matters is the propagator port. An estimation module accepts a
propagator plugin and calls it; the consumer chooses which propagator is
supplied. Any estimation module that internally hardwires a single propagator is
non-conforming by the pluggable-propagation law, regardless of how good its
filter is.

## Guest C++ example

None published. Publishing a skeleton against an unratified ABI would invite
exactly the drift this family needs to avoid. Start from the
[propagator guest example](propagator.html) for module structure, and consume the
propagator through its published ABI from inside your estimator.

## Known gaps, stated plainly

- The shipped production path is SGP4 mean-element batch fitting. That is what
  runs.
- The wider surface described in the module's own headers — Gauss, Laplace,
  double-r, Gibbs and Herrick-Gibbs initial orbit determination; sequential EKF
  and UKF; 6×6 covariance with consider parameters and state-transition-matrix
  propagation — is compiled but audited as dead code, reachable only from a test
  path and never called by the production entry points. Treat it as design
  intent, not as available capability.
- The abstract propagator interface inside that module is part of the same dead
  path. The pluggable-propagation law is satisfied by design in the header and
  not yet exercised in the shipped flow.
- No conformance kit, no generated header, no negative control.
