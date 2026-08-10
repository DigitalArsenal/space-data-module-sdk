// __MODULE_NAME__ — scaffolded tests.
//
// These check the two things every propagator module must get right before
// any physics is real: the manifest is well-formed, and the compiled
// artifact actually exposes the ABI surface a host will link against. Run
// `npm run build` first — the compliance/export checks SKIP (not fail) if
// dist/isomorphic/module.wasm has not been built yet, matching how
// space-data-module-sdk's own first-party modules test themselves.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MANIFEST_PATH = new URL("../plugin-manifest.json", import.meta.url);
const ISOMORPHIC_WASM_PATH = new URL("../dist/isomorphic/module.wasm", import.meta.url);

const EXPECTED_ABI_EXPORTS = [
  "plugin_init",
  "plugin_init_omm",
  "plugin_ingest_omm_one",
  "plugin_propagate",
  "plugin_propagate_batch",
  "plugin_entity_count",
  "plugin_destroy",
  "ingest_omm",
];

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function wasmBuilt() {
  return fs.existsSync(fileURLToPath(ISOMORPHIC_WASM_PATH));
}

test("__MODULE_NAME__ manifest declares the shared browser/WasmEdge artifact", () => {
  const manifest = readManifest();
  assert.equal(manifest.pluginId, "__PLUGIN_ID__");
  assert.equal(manifest.pluginFamily, "propagator");
  assert.deepEqual(manifest.runtimeTargets, ["browser", "wasmedge"]);
  assert.equal(manifest.buildArtifacts?.[0]?.path, "dist/isomorphic/module.wasm");
  assert.ok(Array.isArray(manifest.methods) && manifest.methods.length > 0);
});

test("__MODULE_NAME__ declares wasi-sequential with a substantive justification", () => {
  // This module never spawns a thread of its own — see the SHARD-WRITE
  // DISCIPLINE comment on plugin_propagate_batch() in
  // src/__MODULE_NAME_SNAKE__.cpp for why that's the strong default for a
  // propagator, not a shortcut. build.js passes threadModel: manifest.threadModel
  // explicitly (resolveThreadModel does NOT read this field on its own, and
  // "wasmedge" in runtimeTargets otherwise infers the OTHER model) and
  // asserts the compiler agreed — this test guards the manifest side of that
  // same invariant.
  const manifest = readManifest();
  assert.equal(manifest.threadModel, "wasi-sequential");
  assert.equal(typeof manifest.sequentialJustification?.kind, "string");
  assert.ok(manifest.sequentialJustification.kind.length > 0);
  assert.ok(
    (manifest.sequentialJustification.detail ?? "").length >= 40,
    "sequentialJustification.detail must be a substantive explanation, not a placeholder",
  );
});

test("__MODULE_NAME__ artifact passes SDK compliance checks", async (t) => {
  if (!wasmBuilt()) {
    t.skip("dist/isomorphic/module.wasm not built yet — run `npm run build` first.");
    return;
  }
  const { validateArtifactWithStandards } = await import("space-data-module-sdk/compliance");
  const report = await validateArtifactWithStandards({
    manifest: readManifest(),
    wasmPath: fileURLToPath(ISOMORPHIC_WASM_PATH),
  });
  assert.equal(report.ok, true, JSON.stringify(report.issues, null, 2));
});

test("__MODULE_NAME__ artifact exposes the propagator ABI exports", async (t) => {
  if (!wasmBuilt()) {
    t.skip("dist/isomorphic/module.wasm not built yet — run `npm run build` first.");
    return;
  }
  const { inspectModule } = await import("space-data-module-sdk/host/isomorphic");
  const inspection = await inspectModule(fs.readFileSync(fileURLToPath(ISOMORPHIC_WASM_PATH)));
  for (const name of EXPECTED_ABI_EXPORTS) {
    assert.ok(inspection.exports.includes(name), `missing export ${name}`);
  }
  // This module declares wasi-sequential and must not link the wasi-threads
  // contract — its absence here is a POSITIVE assertion, not an oversight,
  // and catches an accidental regression to emscripten-pthreads just as
  // loudly as a missing export would.
  assert.ok(
    !inspection.exports.includes("wasi_thread_start"),
    "wasi_thread_start must be absent for a wasi-sequential artifact",
  );
});

// TODO: your propagation goes here (part 3 of 3) — once propagate_entity()
// holds real physics, replace this with an assertion on an actual computed
// state vector (e.g. ingest a known OMM, propagate to its epoch, and check
// position/velocity against an independent reference).
test("__MODULE_NAME__ TODO: assert real propagated output once physics lands", (t) => {
  t.skip("placeholder — see propagate_entity() in src/__MODULE_NAME_SNAKE__.cpp");
});
