# GNC

**Status: PLANNED.** This family is a ratified entry in the harness-family
taxonomy. Its individual shape has not been ratified, and nothing is
implemented. This page states scope and status; it is not a contract, and it
does not imply parity with the Designed tier.

## Scope

Closed-loop guidance, navigation and control. A GNC module observes estimated state, decides what the vehicle should do, and commands the maneuver and attitude families. It is the only family in the dynamics group that is allowed to be stateful across a scenario timeline, because a controller without memory is not a controller.

## What exists today

Nothing. No schema, no header, no module, no open design task.

GNC is the family most likely to need a scheduler and behavior contract to exist first, since a control loop is defined as much by when it runs as by what it computes.

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
