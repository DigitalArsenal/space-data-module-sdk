/**
 * WILDCARD PORT BOUNDARY — guardrail corpus (P1 `upstream-module-sdk-1`).
 *
 * The rule this file pins has two halves and BOTH are load-bearing:
 *
 *  - application-blind host-capability nodes (http-request, storage-ingest,
 *    clock, random, file) and compiled flows are wildcard BY DESIGN — the flow
 *    compiler synthesizes wildcard ports itself — so a rule that rejects them
 *    contradicts the architecture and made the live celestrak flow family
 *    unbuildable from main (37 `wildcard-port-type` errors);
 *  - the SAME rule is what correctly forced the CCSDS 124 codec to declare typed
 *    `$CPS`/`$SPP` ports instead of shipping `acceptsAnyFlatbuffer`.
 *
 * Every test below fixes one side of that boundary. Deleting one to make the
 * other pass is the regression.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  validatePluginManifest,
  manifestDeclaresHostBoundaryBlindness,
  WildcardJustificationKind,
} from "../src/compliance/pluginCompliance.js";
import {
  LegacyWildcardPortLedger,
  LEGACY_WILDCARD_LEDGER_FROZEN_PLUGIN_COUNT,
  LEGACY_WILDCARD_LEDGER_FROZEN_PORT_COUNT,
  isLegacyWildcardPort,
} from "../src/compliance/legacyWildcardPorts.js";

const WILDCARD_TYPE_SET = {
  setId: "any",
  allowedTypes: [{ wireFormat: "flatbuffer", acceptsAnyFlatbuffer: true }],
};

function createWildcardManifest(overrides = {}) {
  return {
    pluginId: "com.test.wildcard",
    name: "Wildcard Boundary Test",
    version: "1.0.0",
    pluginFamily: "analysis",
    capabilities: [],
    externalInterfaces: [],
    methods: [
      {
        methodId: "run",
        displayName: "Run",
        inputPorts: [
          {
            portId: "in",
            acceptedTypeSets: [structuredClone(WILDCARD_TYPE_SET)],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        outputPorts: [],
        maxBatch: 1,
        drainPolicy: "drain-to-empty",
      },
    ],
    ...overrides,
  };
}

function hostServiceInterface(capability = "http") {
  return {
    interfaceId: "host-svc",
    kind: "host-service",
    direction: "bidirectional",
    capability,
    resource: "https://*",
  };
}

function wildcardIssues(report) {
  return report.issues.filter((issue) =>
    [
      "wildcard-port-type",
      "legacy-wildcard-port-type",
      "invalid-wildcard-justification",
      "unsupported-wildcard-justification",
    ].includes(issue.code),
  );
}

function inputTypeSet(manifest) {
  return manifest.methods[0].inputPorts[0].acceptedTypeSets[0];
}

// --- TIER D: the rule still bites (the CCSDS 124 codec shape) ---

test("wildcard is rejected for a product module that names no host boundary", () => {
  // Shape of codec/ccsds124-pocketplus before $CPS: capabilities [],
  // externalInterfaces [], not on the legacy ledger.
  const report = validatePluginManifest(createWildcardManifest());
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((issue) => issue.code === "wildcard-port-type"));
});

test("declaring a host-service interface whose capability is UNDECLARED does not buy a wildcard", () => {
  const manifest = createWildcardManifest({
    capabilities: [],
    externalInterfaces: [hostServiceInterface("http")],
  });
  assert.equal(manifestDeclaresHostBoundaryBlindness(manifest), false);
  const report = validatePluginManifest(manifest);
  assert.ok(report.errors.some((issue) => issue.code === "wildcard-port-type"));
});

test("a non-host-service external interface does not buy a wildcard", () => {
  const manifest = createWildcardManifest({
    capabilities: ["http"],
    externalInterfaces: [{ ...hostServiceInterface("http"), kind: "http" }],
  });
  assert.equal(manifestDeclaresHostBoundaryBlindness(manifest), false);
  const report = validatePluginManifest(manifest);
  assert.ok(report.errors.some((issue) => issue.code === "wildcard-port-type"));
});

// --- TIER A: application-blind at the host boundary, proven mechanically ---

test("wildcard is permitted when the manifest proves host-boundary blindness", () => {
  const manifest = createWildcardManifest({
    capabilities: ["http"],
    externalInterfaces: [hostServiceInterface("http")],
  });
  assert.equal(manifestDeclaresHostBoundaryBlindness(manifest), true);
  const report = validatePluginManifest(manifest);
  assert.deepEqual(wildcardIssues(report), []);
  assert.equal(report.ok, true);
});

// --- TIER B: declared, machine-checked justification ---

test("foreign-wire-format justification permits a wildcard on a schema-aware module", () => {
  const manifest = createWildcardManifest();
  inputTypeSet(manifest).wildcardJustification = {
    kind: WildcardJustificationKind.ForeignWireFormat,
    detail:
      "CelesTrak GP CSV response body; the feed defines the bytes and no SDS identity exists before parsing.",
    mediaType: "text/csv",
  };
  const report = validatePluginManifest(manifest);
  assert.deepEqual(wildcardIssues(report), []);
  assert.equal(report.ok, true);
});

test("a justification claiming a FlatBuffer/SDS media type is rejected", () => {
  const manifest = createWildcardManifest();
  inputTypeSet(manifest).wildcardJustification = {
    kind: WildcardJustificationKind.ForeignWireFormat,
    detail: "Carries a compressed packet stream record over the port.",
    mediaType: "application/x-flatbuffer",
  };
  const report = validatePluginManifest(manifest);
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some(
      (issue) => issue.code === "unsupported-wildcard-justification",
    ),
  );
});

test("host-boundary-opaque justification requires a real host-service declaration", () => {
  const manifest = createWildcardManifest();
  inputTypeSet(manifest).wildcardJustification = {
    kind: WildcardJustificationKind.HostBoundaryOpaque,
    detail: "Claims to be a host passthrough without declaring any host service.",
  };
  const report = validatePluginManifest(manifest);
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some(
      (issue) => issue.code === "unsupported-wildcard-justification",
    ),
  );
});

test("foreign-wire-format and intra-flow-control-frame justifications require mediaType", () => {
  for (const kind of [
    WildcardJustificationKind.ForeignWireFormat,
    WildcardJustificationKind.IntraFlowControlFrame,
  ]) {
    const manifest = createWildcardManifest();
    inputTypeSet(manifest).wildcardJustification = {
      kind,
      detail: "A substantive explanation that is long enough to pass the length gate.",
    };
    const report = validatePluginManifest(manifest);
    assert.equal(report.ok, false, kind);
    assert.ok(
      report.errors.some(
        (issue) => issue.code === "invalid-wildcard-justification",
      ),
      kind,
    );
  }
});

test("an unrecognised justification kind or a thin detail is rejected", () => {
  const badJustifications = [
    { kind: "because-i-said-so", detail: "This kind is not in the closed enum at all." },
    { kind: WildcardJustificationKind.ForeignWireFormat, detail: "opaque", mediaType: "text/csv" },
    "not-an-object",
  ];
  for (const justification of badJustifications) {
    const manifest = createWildcardManifest();
    inputTypeSet(manifest).wildcardJustification = justification;
    const report = validatePluginManifest(manifest);
    assert.equal(report.ok, false, JSON.stringify(justification));
    assert.ok(
      report.errors.some(
        (issue) => issue.code === "invalid-wildcard-justification",
      ),
      JSON.stringify(justification),
    );
  }
});

test("a malformed justification is an error even on a Tier A host-capability node", () => {
  const manifest = createWildcardManifest({
    capabilities: ["http"],
    externalInterfaces: [hostServiceInterface("http")],
  });
  inputTypeSet(manifest).wildcardJustification = { kind: "nonsense" };
  const report = validatePluginManifest(manifest);
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some(
      (issue) => issue.code === "invalid-wildcard-justification",
    ),
  );
});

// --- TIER C: the frozen legacy ledger ---

test("a ledgered legacy port warns instead of erroring, and errors under strict", () => {
  // com.digitalarsenal.data-source.celestrak-parser parse_gp:out:omm_records is
  // shipped, deployed and hash-frozen; it is debt, not permission.
  const manifest = createWildcardManifest({
    pluginId: "com.digitalarsenal.data-source.celestrak-parser",
  });
  manifest.methods[0].methodId = "parse_gp";
  manifest.methods[0].inputPorts[0].portId = "job";

  const report = validatePluginManifest(manifest);
  assert.equal(
    report.errors.some((issue) => issue.code === "wildcard-port-type"),
    false,
  );
  assert.ok(
    report.warnings.some((issue) => issue.code === "legacy-wildcard-port-type"),
  );

  const strict = validatePluginManifest(manifest, { allowLegacyWildcards: false });
  assert.equal(strict.ok, false);
  assert.ok(strict.errors.some((issue) => issue.code === "wildcard-port-type"));
});

test("the legacy ledger does not grandfather a port it never listed", () => {
  const manifest = createWildcardManifest({
    pluginId: "com.digitalarsenal.data-source.celestrak-parser",
  });
  manifest.methods[0].methodId = "parse_gp";
  manifest.methods[0].inputPorts[0].portId = "a_brand_new_port";
  const report = validatePluginManifest(manifest);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((issue) => issue.code === "wildcard-port-type"));
  assert.equal(
    isLegacyWildcardPort(
      "com.digitalarsenal.data-source.celestrak-parser",
      "parse_gp",
      "in",
      "a_brand_new_port",
    ),
    false,
  );
});

test("THE LEDGER MAY ONLY SHRINK — frozen 2026-07-29", () => {
  const plugins = Object.keys(LegacyWildcardPortLedger);
  const ports = Object.values(LegacyWildcardPortLedger).flat();

  assert.ok(
    plugins.length <= LEGACY_WILDCARD_LEDGER_FROZEN_PLUGIN_COUNT,
    `legacy wildcard ledger grew to ${plugins.length} plugins (frozen at ${LEGACY_WILDCARD_LEDGER_FROZEN_PLUGIN_COUNT}). ` +
      "New wildcard ports are NOT grandfathered: declare the concrete SDS identity or an acceptedTypeSet.wildcardJustification.",
  );
  assert.ok(
    ports.length <= LEGACY_WILDCARD_LEDGER_FROZEN_PORT_COUNT,
    `legacy wildcard ledger grew to ${ports.length} ports (frozen at ${LEGACY_WILDCARD_LEDGER_FROZEN_PORT_COUNT}).`,
  );

  for (const entry of ports) {
    assert.match(
      entry,
      /^[^:]+:(in|out):[^:]+$/,
      `ledger entry ${JSON.stringify(entry)} must be "methodId:in|out:portId"`,
    );
  }
  for (const [pluginId, entries] of Object.entries(LegacyWildcardPortLedger)) {
    assert.equal(
      new Set(entries).size,
      entries.length,
      `duplicate ledger entries for ${pluginId}`,
    );
  }
});
