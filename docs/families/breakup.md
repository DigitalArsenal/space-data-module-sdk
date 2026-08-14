# Breakup

**Status: PLANNED.** This family is a ratified entry in the harness-family
taxonomy. Its individual shape has not been ratified, and nothing is
implemented. This page states scope and status; it is not a contract, and it
does not imply parity with the Designed tier.

## Scope

Fragmentation events: given a parent object and an event energy, produce a fragment population with area-to-mass ratio, delta-v and size distributions, and the resulting fragment states.

## What exists today

Nothing in this SDK. Breakup physics is an active program elsewhere in the stack, under its own owner and its own parity law, and is not currently shaped as a module-SDK harness family.

A fragment population is only acceptable if it matches the standard breakup model within tolerance. Any future harness in this family inherits that parity requirement as an admission gate, not as a nice-to-have — a breakup module that produces a plausible-looking cloud with the wrong distribution is a failure, not an approximation.

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
