# Propulsion

**Status: PLANNED.** This family is a ratified entry in the harness-family
taxonomy. Its individual shape has not been ratified, and nothing is
implemented. This page states scope and status; it is not a contract, and it
does not imply parity with the Designed tier.

## Scope

Model thrust production and propellant consumption: thruster performance, specific impulse, throttle and duty-cycle behavior, tank state and mass depletion over a burn. It supplies the maneuver family rather than replacing it — maneuver decides the burn, propulsion decides what the vehicle can actually deliver and what it costs in mass.

## What exists today

Nothing. No schema, no header, no module, no open design task.

Note that a propulsion contract is inseparable from a mass-properties contract: a thrust model that cannot report the mass it consumed is not usable by a propagator that integrates the resulting acceleration. Expect these to be ratified together.

## What ratification requires

A family reaches Designed when an ABI has been drafted against a real consumer,
and Shipped only when all of the following exist:

- A single `.fbs` schema as the source of the wire layout.
- A generated ABI header with size and offset locks, plus a drift gate that
  fails when the schema and the committed header disagree.
- Declared units and frames per field, named sentinels, and named negative error
  codes.
- A conformance kit carrying its own negative control, and a reference module.
- A stated tri-runtime parity envelope.
- Exactly one generic consumer port.

Until then, do not build against this family. If your work falls in this scope
and cannot wait, build a records-in, records-out module through the
[BYO-wasm quickstart](../byo-wasm-quickstart.html) — that path needs no harness
and is available now — and expect to migrate to the family ABI when it is
ratified.
