/**
 * W0.3 — the plugin family vocabulary fails LOUDLY.
 *
 * Before this, `normalizePluginFamily` returned `PluginFamily.ANALYSIS` for
 * anything it did not recognize and compliance validated `pluginFamily` as a
 * free string. A typo and a deliberate new family were indistinguishable, and
 * both were silent — which is how 19 first-party modules came to ship
 * mislabelled and family-typed resolution only ever worked for propagators.
 *
 * Ruling: graph/findings/official-harness-shapes.md §4.7 / §8.3
 * Task:   graph/tasks/harness-w0-immediate-fixes.md (W0.3)
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  PluginFamilyNames,
  UnknownPluginFamilyError,
  normalizePluginFamily,
  pluginFamilyByName,
  sdsPluginCategoryByFamily,
} from "../src/manifest/normalize.js";
import { PluginFamily } from "../src/generated/orbpro/manifest.js";
import { validatePluginManifest } from "../src/compliance/pluginCompliance.js";

function manifest(overrides = {}) {
  return {
    pluginId: "com.test.family",
    name: "Family Test",
    version: "1.0.0",
    pluginFamily: "analysis",
    capabilities: ["clock"],
    externalInterfaces: [],
    methods: [],
    ...overrides,
  };
}

function issueCodes(report) {
  return report.issues.map((issue) => issue.code);
}

test("every canonical family string resolves to its own enum member", () => {
  for (const [name, value] of Object.entries(pluginFamilyByName)) {
    assert.equal(
      normalizePluginFamily(name),
      value,
      `family "${name}" did not round-trip`,
    );
  }
});

test("MANEUVER and ORBIT_DETERMINATION exist and are appended, not renumbered", () => {
  assert.equal(PluginFamily.MANEUVER, 11);
  assert.equal(PluginFamily.ORBIT_DETERMINATION, 12);
  assert.equal(normalizePluginFamily("maneuver"), PluginFamily.MANEUVER);
  assert.equal(
    normalizePluginFamily("orbit_determination"),
    PluginFamily.ORBIT_DETERMINATION,
  );

  // Append-only: the ordinals that existed before must not have moved. These
  // are WIRE values — a renumber silently relabels every published manifest.
  assert.deepEqual(
    {
      SENSOR: PluginFamily.SENSOR,
      PROPAGATOR: PluginFamily.PROPAGATOR,
      RENDERER: PluginFamily.RENDERER,
      ANALYSIS: PluginFamily.ANALYSIS,
      DATA_SOURCE: PluginFamily.DATA_SOURCE,
      COMMS: PluginFamily.COMMS,
      SHADER: PluginFamily.SHADER,
      SDF: PluginFamily.SDF,
      INFRASTRUCTURE: PluginFamily.INFRASTRUCTURE,
      FLOW: PluginFamily.FLOW,
      BRIDGE: PluginFamily.BRIDGE,
    },
    {
      SENSOR: 0,
      PROPAGATOR: 1,
      RENDERER: 2,
      ANALYSIS: 3,
      DATA_SOURCE: 4,
      COMMS: 5,
      SHADER: 6,
      SDF: 7,
      INFRASTRUCTURE: 8,
      FLOW: 9,
      BRIDGE: 10,
    },
  );
});

test("an unknown family THROWS instead of becoming ANALYSIS", () => {
  // The negative control for the whole change: this exact input used to
  // return ANALYSIS with no diagnostic of any kind.
  assert.throws(
    () => normalizePluginFamily("not-a-real-family"),
    (error) => {
      assert.ok(error instanceof UnknownPluginFamilyError);
      assert.equal(error.code, "unknown-plugin-family");
      assert.equal(error.value, "not-a-real-family");
      // The refusal must name the offender AND the vocabulary — a refusal
      // that says only "invalid" makes the author guess.
      assert.match(error.message, /not-a-real-family/);
      assert.match(error.message, /propagator/);
      assert.match(error.message, /maneuver/);
      assert.deepEqual(error.validFamilies, PluginFamilyNames);
      return true;
    },
  );
});

test("a missing or blank family is refused, not defaulted", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert.throws(
      () => normalizePluginFamily(value),
      UnknownPluginFamilyError,
      `expected refusal for ${JSON.stringify(value)}`,
    );
  }
});

test("an out-of-range numeric family is refused", () => {
  assert.equal(normalizePluginFamily(PluginFamily.PROPAGATOR), 1);
  assert.throws(() => normalizePluginFamily(250), UnknownPluginFamilyError);
  assert.throws(() => normalizePluginFamily(-1), UnknownPluginFamilyError);
});

test("compliance enforces the enum, not a free string", () => {
  const bad = validatePluginManifest(manifest({ pluginFamily: "foundational" }));
  assert.ok(issueCodes(bad).includes("unknown-plugin-family"));
  const issue = bad.issues.find(
    (candidate) => candidate.code === "unknown-plugin-family",
  );
  assert.match(issue.message, /foundational/);
  assert.match(issue.message, /Valid families/);

  const good = validatePluginManifest(manifest({ pluginFamily: "maneuver" }));
  assert.ok(!issueCodes(good).includes("unknown-plugin-family"));
});

test("compliance still refuses a missing family with the string diagnostic", () => {
  const report = validatePluginManifest(manifest({ pluginFamily: undefined }));
  assert.ok(issueCodes(report).includes("missing-string"));
});

test("every family projects onto a named SDS pluginCategory member", () => {
  // SDS is authoritative and this enum is a projection of it. The mapping is
  // BY NAME because the ordinals diverge from index 5 (SDK COMMS=5 vs SDS
  // EW=5) — a numeric conversion between the two silently relabels families.
  for (const value of Object.values(pluginFamilyByName)) {
    const category = sdsPluginCategoryByFamily[value];
    assert.equal(
      typeof category,
      "string",
      `PluginFamily ${value} has no SDS pluginCategory projection`,
    );
    assert.ok(category.length > 0);
  }

  // The divergence itself, pinned: if these ever line up, the by-name rule can
  // be revisited — until then, an ordinal-based conversion is a defect.
  assert.equal(PluginFamily.COMMS, 5, "SDK COMMS ordinal moved");
  assert.notEqual(
    sdsPluginCategoryByFamily[PluginFamily.COMMS],
    "EW",
    "SDS ordinal 5 is EW; a numeric conversion would produce this",
  );
});
