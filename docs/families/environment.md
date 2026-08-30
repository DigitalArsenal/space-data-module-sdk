# Environment

**Status: PLANNED.** This family is a ratified entry in the harness-family
taxonomy. Its individual shape has not been ratified, and no family ABI is
implemented. This page states scope and status; it is not a contract, and it
does not imply parity with the Designed tier.

## Scope

Ambient models that other families query rather than invoke directly: atmospheric density, gravity field, magnetic field, solar and radiation environment, and space weather indices. A propagator asks the environment for density; it does not carry its own atmosphere.

## What exists today

Nothing as a family contract.

This family is the clearest case for a query-shaped ABI rather than a compute-shaped one: many callers, small requests, high call frequency, and a strong requirement that two callers asking the same question at the same epoch get bit-identical answers.

The **propagator** family (SHIPPED) now carries provisional, propagator-scoped
versions of three of the ports this family will eventually own. They are named
here so the family ABI is drafted against a real consumer rather than a guess,
and so nobody mistakes them for the family contract:

| Provisional port | Where it lives today | What it must teach the family ABI |
| --- | --- | --- |
| Atmosphere selection | `plugin_set_atmosphere_model(int) -> int`, `plugin_get_atmosphere_model_count/name/status/provenance` | **A label must refuse rather than substitute.** Every label the ABI names declares whether a published implementation stands behind it; selecting one that has none returns a negative status and leaves the configuration untouched. The roster and its provenance strings are read FROM the module, so a caller's list can never drift ahead of the build. |
| Gravity field | `plugin_load_gravity_field(ptr, len, maxDeg, maxOrd) -> int`, `plugin_get_gravity_field_error/name` | **A field is data, not a build-time blob.** The module has no filesystem: the host supplies bytes and the module parses them. Loading and selecting are two decisions — a loaded field is flown only when the force model asks for it by name. |
| Force contribution | `plugin_register_force_contribution(slot, kind, params) -> int`, `plugin_clear_force_contributions`, `plugin_get_force_contribution_slots`, and the extended `plugin_get_acceleration_breakdown_v2(jd, ptr, len)` lane | **Contributions are PARAMETERS, not code.** Hosting foreign code inside a module is a new host capability and is not granted by any family surface. A parameterized slot table covers what a force list is actually asked for, is allocation-free in the derivative's inner loop, and is exact: a zonal registered through the port is evaluated by an independent Legendre-gradient recursion and reproduces the built-in closed form to 5e-15. |

Two ABI-shape lessons came out of building those, and both belong in the family
ABI when it is drafted:

- **A packed array must carry its own length.** `plugin_set_force_model` takes
  exactly fifteen doubles and its callers allocate exactly `15 * 8` bytes, so a
  sixteenth element is an out-of-bounds heap read, not an additive field. The
  extension is a separate `plugin_set_force_model_v2(double*, int len)` that is
  told how much room it has; the same applies to
  `plugin_get_acceleration_breakdown_v2`. Appending to a fixed-length packed
  array is never additive.
- **A cast between two enums is a coincidence, not a conversion.** A drag
  setting was being turned into an atmosphere selection with
  `static_cast`, and the two enumerations had stopped sharing an ordering: four
  of six values named a different model than the caller asked for. Every
  cross-enum mapping in the family ABI is written out one member at a time.

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

Conformance additions this family will carry, from the provisional ports above:

- A registered contribution reproduces the built-in model it stands in for,
  exactly, on the acceleration breakdown.
- A label with no implementation behind it returns a typed refusal and does not
  change the configuration — asserted by measuring the model's output before and
  after the refused call, not by reading the return code alone.
- A malformed potential file is refused with a reason, never answered with an
  empty field.

Until then, do not build against this family. If your work falls in this scope
and cannot wait, build a records-in, records-out module through the
[BYO-wasm quickstart](../byo-wasm-quickstart.html) — that path needs no harness
and is available now — and expect to migrate to the family ABI when it is
ratified.
