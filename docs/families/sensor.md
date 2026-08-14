# Sensor

**Status: PLANNED.** This family is a ratified entry in the harness-family
taxonomy. Its individual shape has not been ratified, and nothing is
implemented. This page states scope and status; it is not a contract, and it
does not imply parity with the Designed tier.

## Scope

Detection geometry and instrument tasking: field of regard and field of view, access windows, detection thresholds against a target signature, and the coverage products that follow from them.

## What exists today

Sensor capability ships, but not as a ratified public harness. A sensor member exists in the runtime PluginFamily enum, and closed first-party packages ship covering sensor coverage, sensor models and sensor shaders. None of that constitutes a public family ABI: there is no sensor .fbs single source, no generated header with size and offset locks, no conformance kit and no reference module a third party could build against.

This is the family where the gap between 'capability exists' and 'contract exists' is widest. A third party wanting to supply a sensor model today has no public contract to implement, and the internal packages are not it.

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
