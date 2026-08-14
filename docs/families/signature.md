# Signature

**Status: PLANNED.** This family is a ratified entry in the harness-family
taxonomy. Its individual shape has not been ratified, and nothing is
implemented. This page states scope and status; it is not a contract, and it
does not imply parity with the Designed tier.

## Scope

Observable signature models: radar cross section, optical brightness and phase behavior, and thermal emission, as functions of aspect angle, illumination geometry and wavelength or frequency. The sensor family consumes what this family produces.

## What exists today

Nothing. The only matches for the word in the codebase concern cryptographic artifact signing, which is unrelated to this family.

The natural dependency chain is attitude to signature to sensor: aspect angle requires orientation, and detection requires signature. Ratifying signature before attitude would produce a contract that cannot state its own inputs.

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
