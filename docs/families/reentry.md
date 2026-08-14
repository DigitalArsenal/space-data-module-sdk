# Reentry

**Status: PLANNED.** This family is a ratified entry in the harness-family
taxonomy. Its individual shape has not been ratified, and nothing is
implemented. This page states scope and status; it is not a contract, and it
does not imply parity with the Designed tier.

## Scope

Atmospheric reentry: the descent corridor, aerothermal heating, ablation and demise of components, and the surviving-debris ground footprint.

## What exists today

No physics-kernel harness. An open, low-priority task describes a reentry dynamics module covering corridor, heating and footprint with visualization, blocked behind SDK prerequisites. A closed reentry-related package exists but it is a data-source provider, not a physics kernel — it brings data in, it does not model descent.

Reentry depends on the environment family for atmospheric density and on a signature or materials contract for demise modelling, neither of which exists.

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
