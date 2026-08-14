# Obstruction

**Status: DESIGNED, and thinner than any other Designed family.** One paragraph
of intent exists, in one open task, blocked behind two unfinished prerequisites.
There is no schema, no header, no code, and no package. This page exists so the
scope is stated honestly rather than implied by silence.

## Doctrine

An obstruction module answers whether a path between two points is blocked, and
by what, given arbitrary three-dimensional geometry with physical material
properties. It is a service to other families rather than a family a consumer
invokes directly: RF asks it whether a link is occluded and how much loss the
obstruction imposes, sensors ask it whether a target is visible, and event
physics asks it what a fragment would strike.

It is currently designed as an *extension* of the RF bulk link-matrix ABI rather
than as a standalone contract, so its shape is downstream of that family's
schema.

## Capability

Take an obstacle set and a set of paths; return occlusion and the loss or
visibility consequence of that occlusion. Compute only — no scene writes, no
data fetching.

## Import and export set

**Not specified.** Nothing exists.

## Wire layout

**Drafted in prose only.** The intended obstacle set is:

- Triangle meshes, and analytic shapes — sphere, ellipsoid, box, extruded
  polygon.
- Each obstacle references a material record carrying relative permittivity,
  conductivity, reflection, absorption and transmission loss as a function of
  frequency, a roughness or scattering class, and a validity range, following
  the ITU-R P.2040 material classes.

No field names, no struct layout, no `.fbs` message. The material record itself
depends on a Space Data Standards mint that is separately in flight.

## Units and frames

Not fixed.

## Sentinels

Not specified.

## Identity

Not specified. Obstacles will need stable identity so a consumer can attribute a
blocked path to a specific obstacle and material.

## Threading

Expected to inherit `wasm32-wasip1-threads` and the propagator family's
shard-write discipline, as the RF family does. Not specified.

## Error codes

Not specified.

## Lifetime

Not specified. An obstacle set is the obvious candidate for cross-call
persistence in this family — build the acceleration structure once, query it
many times — which is exactly the kind of decision the ABI freeze has to make.

## Parity envelope

Not specified. Ray–geometry intersection is a classic source of cross-runtime
floating-point divergence, so a byte-identical parity requirement here will be
harder to satisfy than in most families and should be assumed to be strict.

## Consumer seam

Not implemented.

## Guest C++ example

None.

## Prerequisites before this family can be ratified

- The RF bulk link-matrix `.fbs` must exist first; this family extends it.
- The Space Data Standards material record must be minted.
- An ABI-freeze consultation with the module-SDK owner is a stated precondition
  and has not happened.

Until those land, an integrator needing occlusion should compute it inside their
own module against geometry they supply themselves, and expect to migrate when
the shared contract exists.
