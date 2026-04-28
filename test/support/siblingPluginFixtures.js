import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateManifestHarnessPlan,
  materializeHarnessScenario,
} from "../../src/testing/index.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const supportDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(supportDir, "..", "..");
export const siblingPluginsRoot = process.env.SPACE_DATA_NETWORK_PLUGINS_ROOT
  ? path.resolve(process.env.SPACE_DATA_NETWORK_PLUGINS_ROOT)
  : path.resolve(repoRoot, "..", "space-data-network-plugins");

const odRequestFixtureText = `created:2026-03-10 20:32:53 UTC
ephemeris_start:2026-03-10 20:16:42 UTC ephemeris_stop:2026-03-13 20:16:42 UTC step_size:60
ephemeris_source:blend
UVW
2026069201642.000 2331.2303823166 -3812.9956790343 -5288.3093377396 7.1279396227 1.8278970842 1.8252801029
5.0574356535e-07 -4.0409074495e-07 7.9867014315e-07 -1.5244353051e-10 2.2405205309e-10 1.3019804582e-06 8.6964446628e-10
-9.2645027173e-10 -1.4154697945e-12 2.0332016107e-12 -4.8806160534e-10 4.2160627916e-10 1.9653622789e-12 -8.4753151771e-13
5.2167151149e-13 -3.5430236412e-13 -1.9835853617e-13 1.7374846904e-09 -6.5771401381e-16 2.6012134046e-15 5.4232564737e-12
2026069201742.000 2753.5753612189 -3695.1830223004 -5167.4424341778 6.9451594823 2.0977895841 2.2021774396
5.5877928873e-07 -4.7375264519e-07 9.1102189897e-07 -2.1752319120e-10 4.1022000836e-10 1.5237983513e-06 9.7534909273e-10
-1.0742139295e-09 -1.7844400970e-12 2.2539013390e-12 -5.4098450089e-10 4.9252228263e-10 2.2865893169e-12 -9.5425673314e-13
5.7442159873e-13 -5.2862580271e-13 2.2079571161e-13 1.9544407278e-09 -1.3018409197e-15 3.0161098392e-15 5.1863337220e-12
2026069201842.000 3164.0497097397 -3561.4406046759 -5024.2367974268 6.7323931239 2.3586995247 2.5696384902
6.1526243750e-07 -5.5175648026e-07 1.0420883160e-06 -2.9911207274e-10 6.5538787474e-10 1.7697659451e-06 1.0887857305e-09
-1.2415650564e-09 -2.2403173610e-12 2.4917480116e-12 -5.9748245532e-10 5.7189693440e-10 2.6325665880e-12 -1.0690003735e-12
6.3090290772e-13 -7.1251333042e-13 6.7782739014e-13 2.1394109823e-09 -1.9784042803e-15 3.3732085227e-15 4.9203888241e-12
`;

function packageDir(relativePackagePath) {
  return path.join(siblingPluginsRoot, relativePackagePath);
}

function packagePath(relativePackagePath, ...parts) {
  return path.join(packageDir(relativePackagePath), ...parts);
}

const CANONICAL_BROWSER_ARTIFACT_PARTS = ["dist", "browser", "module.wasm"];
const CANONICAL_BROWSER_LOADER_PARTS = ["dist", "browser", "module.js"];
const CANONICAL_ISOMORPHIC_ARTIFACT_PARTS = [
  "dist",
  "isomorphic",
  "module.wasm",
];

export const siblingPluginSpecs = Object.freeze([
  {
    name: "conjunction-assessment",
    packagePath: "analysis/conjunction-assessment",
    expectedIsomorphicProfile: "emscripten",
    expectedImportModules: ["env", "wasi_snapshot_preview1"],
    skipBrowserHarness:
      "Conjunction assessment is a pthread Emscripten isomorphic artifact; package-local tests cover its loader path.",
    requestFixturePath: packagePath(
      "analysis/conjunction-assessment",
      "tests",
      "fixtures",
      "request.assess.json",
    ),
    assertResponsePayload(payload) {
      assert.equal(typeof payload, "object");
      assert.notEqual(payload, null);
    },
  },
  {
    name: "atmosphere",
    packagePath: "propagator/atmosphere",
    requestFixturePath: packagePath(
      "propagator/atmosphere",
      "tests",
      "fixtures",
      "request.altitude.json",
    ),
    assertResponsePayload(payload) {
      assert.equal(payload.model, "US76");
      assert.equal(payload.altitudeM, 10000);
      assert.ok(payload.state.density > 0);
      assert.ok(payload.state.temperature > 200);
    },
  },
  {
    name: "cislunar",
    packagePath: "propagator/cislunar",
    requestFixturePath: packagePath(
      "propagator/cislunar",
      "tests",
      "fixtures",
      "request.lagrange.json",
    ),
    assertResponsePayload(payload) {
      assert.equal(Array.isArray(payload), true);
      assert.equal(payload.length, 5);
      assert.equal(payload[0].point, "L1");
    },
  },
  {
    name: "hpop",
    packagePath: "propagator/hpop",
    requestFixturePath: packagePath(
      "propagator/hpop",
      "tests",
      "fixtures",
      "request.propagate.json",
    ),
    assertResponsePayload(payload) {
      assert.equal(typeof payload, "object");
      assert.notEqual(payload, null);
    },
  },
  {
    name: "maneuver",
    packagePath: "analysis/maneuver",
    requestFixturePath: packagePath(
      "analysis/maneuver",
      "tests",
      "fixtures",
      "request.hohmann.json",
    ),
    assertResponsePayload(payload) {
      assert.equal(payload.error, undefined);
      assert.equal(typeof payload.totalDeltaV, "number");
      assert.ok(payload.totalDeltaV > 0);
    },
  },
  {
    name: "od",
    packagePath: "analysis/od",
    requestFixturePath: packagePath(
      "analysis/od",
      "tests",
      "fixtures",
      "request.fit.meme",
    ),
    requestFixtureText: odRequestFixtureText,
    assertResponsePayload(payload) {
      assert.equal(payload.error, undefined);
      assert.equal(typeof payload.RMS, "string");
    },
  },
  {
    name: "sgp4",
    packagePath: "propagator/sgp4",
    skipBrowserHarness:
      "SGP4 uses the SDS PIV invoke envelope, not the SDK PluginInvokeResponse command envelope.",
    requestFixturePath: packagePath(
      "propagator/sgp4",
      "tests",
      "fixtures",
      "request.propagate.json",
    ),
    assertResponsePayload(payload) {
      assert.equal(payload.objectName, "ISS (ZARYA)");
      assert.equal(payload.noradId, 25544);
      assert.ok(payload.numStates >= 13);
      assert.equal(Array.isArray(payload.states), true);
    },
  },
].map((spec) =>
  Object.freeze({
    ...spec,
    packageDir: packageDir(spec.packagePath),
    manifestPath: packagePath(spec.packagePath, "plugin-manifest.json"),
    browserLoaderPath: packagePath(
      spec.packagePath,
      ...CANONICAL_BROWSER_LOADER_PARTS,
    ),
    browserArtifactPath: packagePath(
      spec.packagePath,
      ...CANONICAL_BROWSER_ARTIFACT_PARTS,
    ),
    standaloneArtifactPath: packagePath(
      spec.packagePath,
      ...CANONICAL_ISOMORPHIC_ARTIFACT_PARTS,
    ),
  }),
));

export function hasSiblingPluginWorkspace() {
  return fs.existsSync(siblingPluginsRoot);
}

export function listCheckedOutSiblingPluginSpecs() {
  return siblingPluginSpecs.filter((spec) => fs.existsSync(spec.packageDir));
}

export function readSiblingPluginManifest(spec) {
  return JSON.parse(fs.readFileSync(spec.manifestPath, "utf8"));
}

export function readSiblingPluginStandaloneBytes(spec) {
  return fs.readFileSync(spec.standaloneArtifactPath);
}

export function readSiblingPluginRequestBytes(spec) {
  if (spec.requestFixturePath) {
    return fs.readFileSync(spec.requestFixturePath);
  }
  return textEncoder.encode(spec.requestFixtureText ?? "");
}

export function createSiblingPluginCommandScenario(spec) {
  const manifest = readSiblingPluginManifest(spec);
  const plan = generateManifestHarnessPlan({
    manifest,
    payloadForPort({ portId }) {
      const firstMethod = manifest.methods?.[0] ?? {};
      const firstInputPort = firstMethod.inputPorts?.[0]?.portId ?? null;
      if (portId !== firstInputPort) {
        return null;
      }
      return readSiblingPluginRequestBytes(spec);
    },
  });
  const scenario = plan.generatedCases.find((entry) => entry.surface === "command");
  assert.ok(scenario, `missing command scenario for ${spec.name}`);
  return materializeHarnessScenario(scenario);
}

export function assertSiblingPluginInvokeResponse(spec, response) {
  assert.equal(response.statusCode, 0, `${spec.name} returned a non-zero status`);
  assert.ok(
    response.errorCode === "" || response.errorCode === null,
    `${spec.name} returned errorCode=${response.errorCode}`,
  );
  assert.equal(response.outputs.length, 1, `${spec.name} should emit one output frame`);
  const payload = JSON.parse(textDecoder.decode(response.outputs[0].payload));
  spec.assertResponsePayload(payload);
}
