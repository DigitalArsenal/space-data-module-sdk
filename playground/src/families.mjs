/**
 * The harness-family roster the playground offers, in the ratified taxonomy
 * order of graph/tasks/module-sdk-harness-family-matrix.md (owner-reviewed
 * one-pager, 2026-08-14).
 *
 * `status` is the family's REAL shape status, not the playground's ambition:
 *
 *   shipped   — the shape is ratified AND the SDK ships a conformance kit.
 *   designed  — the shape exists on paper; no conformance kit, no scaffold.
 *   experimental — shape in flight.
 *   planned   — named in the taxonomy, nothing ratified.
 *
 * Only a `shipped` family with a `templateDir` gets a compilable example. A
 * family the SDK cannot yet certify is rendered as NOT YET RATIFIED with the
 * reason — never as an empty editor that silently compiles nothing.
 */
export const FAMILIES = Object.freeze([
  {
    id: "propagator",
    group: "Dynamics",
    label: "Propagator",
    status: "shipped",
    statusNote:
      "Ratified shape with a conformance kit (space-data-module conformance propagator).",
    conformanceKit: "propagator",
    templateDir: "templates/propagator-module",
    abiHeaders: ["orbpro/orbpro_propagator_abi.h"],
    examples: [
      {
        id: "two-body",
        title: "Two-body (Keplerian) propagator — worked",
        summary:
          "The SDK's propagator template with its two TODO physics blocks filled in: closed-form Kepler + PQW->ECI->ECEF. Produces numbers the Tier-B conformance corpus can adjudicate.",
        file: "playground/examples/two_body_propagator.cpp",
      },
      {
        id: "scaffold",
        title: "Propagator template scaffold (physics TODOs unfilled)",
        summary:
          "templates/propagator-module verbatim. Every byte of the wire contract is exercised; the entity does not move. Compile it, then watch Tier B FAIL against the two-body corpus — that is the check working, not the playground breaking.",
        template: "src/__MODULE_NAME_SNAKE__.cpp",
      },
    ],
    replacements: {
      __MODULE_NAME_SNAKE__: "playground_propagator",
      __MODULE_NAME__: "Playground Propagator",
      __PLUGIN_ID__: "io.spacedatanetwork.playground.propagator",
    },
  },
  {
    id: "maneuver",
    group: "Dynamics",
    label: "Maneuver",
    status: "experimental",
    statusNote:
      "Wave 2 of the official-harness-shapes program; no conformance kit, so no module in this family can be CORE yet.",
  },
  {
    id: "propulsion",
    group: "Dynamics",
    label: "Propulsion",
    status: "planned",
    statusNote: "Named in the ratified taxonomy; shape not yet ratified.",
  },
  {
    id: "attitude",
    group: "Dynamics",
    label: "Attitude",
    status: "planned",
    statusNote: "Named in the ratified taxonomy; shape not yet ratified.",
  },
  {
    id: "gnc",
    group: "Dynamics",
    label: "GNC",
    status: "planned",
    statusNote: "Named in the ratified taxonomy; shape not yet ratified.",
  },
  {
    id: "rf",
    group: "Environment & interaction",
    label: "RF",
    status: "designed",
    statusNote:
      "Shape DESIGNED; lands with module-sdk-rf-harness-family (orbpro_rf_abi.h + reference RF module + rf conformance kit). This example arrives with that task.",
  },
  {
    id: "sensor",
    group: "Environment & interaction",
    label: "Sensor",
    status: "planned",
    statusNote: "Named in the ratified taxonomy; shape not yet ratified.",
  },
  {
    id: "signature",
    group: "Environment & interaction",
    label: "Signature",
    status: "planned",
    statusNote: "Named in the ratified taxonomy; shape not yet ratified.",
  },
  {
    id: "environment",
    group: "Environment & interaction",
    label: "Environment",
    status: "planned",
    statusNote: "Named in the ratified taxonomy; shape not yet ratified.",
  },
  {
    id: "obstruction",
    group: "Environment & interaction",
    label: "Obstruction",
    status: "designed",
    statusNote: "Shape DESIGNED; no conformance kit yet.",
  },
  {
    id: "breakup",
    group: "Event physics",
    label: "Breakup",
    status: "planned",
    statusNote: "Named in the ratified taxonomy; shape not yet ratified.",
  },
  {
    id: "reentry",
    group: "Event physics",
    label: "Reentry",
    status: "planned",
    statusNote: "Named in the ratified taxonomy; shape not yet ratified.",
  },
  {
    id: "conjunction",
    group: "Event physics",
    label: "Conjunction",
    status: "designed",
    statusNote: "Shape DESIGNED; no conformance kit yet.",
  },
  {
    id: "effects",
    group: "Event physics",
    label: "Effects",
    status: "planned",
    statusNote: "Named in the ratified taxonomy; shape not yet ratified.",
  },
  {
    id: "estimation",
    group: "Estimation, data & logic",
    label: "Estimation",
    status: "experimental",
    statusNote: "EXPERIMENTAL in the taxonomy; OD conformance deferred by ruling.",
  },
  {
    id: "data-source",
    group: "Estimation, data & logic",
    label: "Data source",
    status: "shipped-no-example",
    statusNote:
      "Family shape is SHIPPED (templates/provider-access-module ships include/space_data_provider_abi.h), but the template carries no plugin-manifest.json or source scaffold, so there is nothing honest to compile here yet. The playground refuses to invent one.",
  },
  {
    id: "analytics",
    group: "Estimation, data & logic",
    label: "Analytics",
    status: "planned",
    statusNote: "Named in the ratified taxonomy; shape not yet ratified.",
  },
  {
    id: "scheduler",
    group: "Estimation, data & logic",
    label: "Scheduler",
    status: "planned",
    statusNote: "Named in the ratified taxonomy; shape not yet ratified.",
  },
  {
    id: "behavior",
    group: "Estimation, data & logic",
    label: "Behavior",
    status: "planned",
    statusNote: "Named in the ratified taxonomy; shape not yet ratified.",
  },
]);
