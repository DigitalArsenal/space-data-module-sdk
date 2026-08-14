# Attitude

**Status: PLANNED.** This family is a ratified entry in the harness-family
taxonomy. Its individual shape has not been ratified, and nothing is
implemented. This page states scope and status; it is not a contract, and it
does not imply parity with the Designed tier.

## Scope

Produce body orientation over time, independent of translational state: attitude profiles, pointing modes, slew dynamics, and the quaternion or direction-cosine output a renderer, a sensor model or a signature model consumes.

## What exists today

Nothing dedicated. Attitude appears only as a topic in the foundational-math scope of a general-purpose module family, not as a family with its own contract.

The frame discipline here is stricter than in most families: an attitude output is meaningless without naming both the body frame and the reference frame it is expressed against, and any freeze will have to make both mandatory fields rather than documented conventions.

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
