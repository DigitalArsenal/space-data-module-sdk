/**
 * W0.4 — the engine-access compliance paradox is resolved.
 *
 * `scene_access`, `entity_access` and `render_hooks` were simultaneously in
 * `RecommendedCapabilityIds` (declare them) and `BrowserIncompatibleCapabilityIds`
 * (declaring them alongside `browser` is a hard error). The browser is the ONLY
 * runtime where a scene, an entity collection or a render loop exists — the one
 * implementation in the stack (OrbPro `ProviderAccessPort` +
 * `providerAccessEngineAdapter`) needs a live Cesium `Scene`, and NodeHost fails
 * all three closed with `host-capability-unsupported`.
 *
 * They are therefore ENGINE-HOSTED: browser-only, wasmedge-incompatible.
 *
 * Ruling: graph/findings/official-harness-shapes.md §8.4
 * Task:   graph/tasks/harness-w0-immediate-fixes.md (W0.4)
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  BrowserIncompatibleCapabilityIds,
  EngineHostedCapabilityIds,
  LegIncompatibleCapabilityIds,
  RecommendedCapabilityIds,
  StandaloneWasiCapabilityIds,
  WasmEdgeIncompatibleCapabilityIds,
} from "../src/capabilities.js";
import { validatePluginManifest } from "../src/compliance/pluginCompliance.js";
import { runtimeTargetSatisfies } from "../src/host/runtimeTargetGate.js";
import { NodeHostSupportedCapabilities } from "../src/host/nodeHost.js";

const ENGINE_CAPABILITIES = ["scene_access", "entity_access", "render_hooks"];

function manifest(overrides = {}) {
  return {
    pluginId: "com.test.engine-access",
    name: "Engine Access Test",
    version: "1.0.0",
    pluginFamily: "renderer",
    capabilities: ["clock"],
    externalInterfaces: [],
    methods: [],
    ...overrides,
  };
}

function codesFor(report, code) {
  return report.issues.filter((issue) => issue.code === code);
}

test("the engine-hosted set is exactly the three engine capabilities", () => {
  assert.deepEqual([...EngineHostedCapabilityIds].sort(), [...ENGINE_CAPABILITIES].sort());
});

test("no capability is both recommended and impossible on every runtime", () => {
  // The paradox, stated as an invariant. A capability the SDK RECOMMENDS must
  // be servable somewhere; if every leg's incompatible list contains it, the
  // recommendation is a trap.
  const legs = Object.keys(LegIncompatibleCapabilityIds);
  assert.ok(legs.length > 0);
  for (const capability of RecommendedCapabilityIds) {
    const blockedOnEveryLeg = legs.every((leg) =>
      LegIncompatibleCapabilityIds[leg].includes(capability),
    );
    assert.equal(
      blockedOnEveryLeg,
      false,
      `capability "${capability}" is recommended but incompatible with every runtime leg`,
    );
  }
});

test("engine capabilities left the browser-incompatible set", () => {
  for (const capability of ENGINE_CAPABILITIES) {
    assert.ok(
      !BrowserIncompatibleCapabilityIds.includes(capability),
      `"${capability}" must not be browser-incompatible — the engine lives in the browser`,
    );
    assert.ok(
      WasmEdgeIncompatibleCapabilityIds.includes(capability),
      `"${capability}" must be wasmedge-incompatible — there is no scene in a headless runtime`,
    );
  }
});

test("declaring engine access with a browser target is COMPLIANT", () => {
  for (const capability of ENGINE_CAPABILITIES) {
    const report = validatePluginManifest(
      manifest({
        capabilities: [capability],
        runtimeTargets: ["browser"],
      }),
    );
    assert.equal(
      codesFor(report, "capability-runtime-conflict").length,
      0,
      `"${capability}" + browser must not conflict:\n` +
        JSON.stringify(report.issues, null, 2),
    );
    // And it must not be flagged as off-vocabulary either — it IS recommended.
    assert.equal(codesFor(report, "noncanonical-capability").length, 0);
  }
});

test("declaring engine access with a wasmedge target IS a conflict", () => {
  for (const capability of ENGINE_CAPABILITIES) {
    const report = validatePluginManifest(
      manifest({
        capabilities: [capability],
        runtimeTargets: ["wasmedge"],
      }),
    );
    const conflicts = codesFor(report, "capability-runtime-conflict");
    assert.equal(conflicts.length, 1, `"${capability}" + wasmedge must conflict`);
    assert.match(conflicts[0].message, new RegExp(capability));
    assert.match(conflicts[0].message, /wasmedge/);
  }
});

test("the browser conflict rule still fires for genuinely host-only capabilities", () => {
  // Negative control: the rule was generalized across legs, not weakened.
  const report = validatePluginManifest(
    manifest({
      capabilities: ["process_exec"],
      runtimeTargets: ["browser"],
    }),
  );
  const conflicts = codesFor(report, "capability-runtime-conflict");
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0].message, /process_exec/);
  assert.match(conflicts[0].message, /browser/);
});

test("the wasi portability baseline still refuses engine access", () => {
  // wasi is the strict subset; nothing outside it is admitted. The generalized
  // leg table must not have opened a hole here.
  for (const capability of ENGINE_CAPABILITIES) {
    assert.ok(!StandaloneWasiCapabilityIds.includes(capability));
    assert.equal(
      runtimeTargetSatisfies(["wasi"], "wasmedge", [capability]),
      false,
      `"${capability}" must not reach wasmedge via the wasi baseline`,
    );
  }
});

test("a wasi-baseline artifact with engine access may still reach the browser", () => {
  // The browser CAN serve these (that is the whole point), so the conservative
  // wasi inference must not strip the one leg that works.
  for (const capability of ENGINE_CAPABILITIES) {
    assert.equal(
      runtimeTargetSatisfies(["wasi"], "browser", [capability]),
      true,
      `"${capability}" should still admit the browser leg`,
    );
  }
});

test("NodeHost does not claim to serve engine capabilities", () => {
  // The evidence the ruling rests on, pinned so it cannot drift silently: if
  // NodeHost ever grows one of these, the leg table above is wrong.
  for (const capability of ENGINE_CAPABILITIES) {
    assert.ok(
      !NodeHostSupportedCapabilities.includes(capability),
      `NodeHost now claims "${capability}" — revisit LegIncompatibleCapabilityIds`,
    );
  }
});
