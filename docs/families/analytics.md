# Analytics

**Status: PLANNED.** This family is a ratified entry in the harness-family
taxonomy. Its individual shape has not been ratified, and nothing is
implemented. This page states scope and status; it is not a contract, and it
does not imply parity with the Designed tier.

## Scope

Derived figures of merit computed over a scenario: coverage quality, revisit statistics, availability, link margin distributions, and other aggregate measures that summarize a run rather than advance it.

## What exists today

Nothing as a family contract. Matches for the word in the stack refer to product and interface analytics work, not to a plugin family.

An analytics harness is mostly a question of what it is allowed to read. A figure of merit computed over a whole scenario needs broad read access to results, which is the opposite of the narrow, per-call inputs every other family gets, and that is the design problem to solve before freezing anything.

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
