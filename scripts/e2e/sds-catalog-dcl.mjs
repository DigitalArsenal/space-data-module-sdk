// E2E (upgrade-module-sdk--spacedatastandards--upstream-spacedatastandards-2): the SDK's
// standards catalog carries $DCL, so a module can take a $DCL port on its command surface.
//
// At spacedatastandards.org 1.206.0 the catalog (built from the package's dist/manifest.json)
// had no $DCL and a manifest naming one was refused (unresolved-standards-type). This checks, on
// the installed dependency and the SDK built on it:
//   1. the pin: package.json pins spacedatastandards.org exactly, that is what is installed, and
//      it is 1.259.0 or later (the release that adds DCL provenance);
//   2. the catalog: DCL.fbs / $DCL resolves, and so does the PVN provenance table DCL names;
//   3. validation: a manifest with $DCL ports validates;
//   4. the artifact: a module with a $DCL input and a $DCL output compiles, and the manifest
//      embedded in the wasm round-trips the $DCL identity;
//   5. the runtime: a real $DCL record (product, correction nodes, PVN provenance) sent to the
//      module's command surface comes back byte-identical from headless Chromium and from
//      native WasmEdge, and decodes to the same record - the port type check passed in both.
// usage: node scripts/e2e/sds-catalog-dcl.mjs   (browser lane: run it through headless-run)
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import * as flatbuffers from "flatbuffers";
import { DCL, DCLT } from "spacedatastandards.org/lib/js/DCL/DCL.js";
import { dclCorrectionT } from "spacedatastandards.org/lib/js/DCL/dclCorrection.js";
import { PVNT } from "spacedatastandards.org/lib/js/PVN/PVN.js";

import { compileModuleFromSource } from "../../src/compiler/compileModule.js";
import { validateArtifactWithStandards } from "../../src/compliance/index.js";
import { loadStandardsCatalog, resolveStandardsTypeRef } from "../../src/standards/index.js";
import { decodePluginManifest } from "../../src/manifest/index.js";
import { SDS_MANIFEST_SECTION_NAME } from "../../src/bundle/constants.js";
import { listWasmCustomSections } from "../../src/bundle/wasm.js";
import { decodePluginInvokeResponse } from "../../src/invoke/index.js";
import { formatParityReport, normalizeParityFixture, runParityHarness } from "../../src/testing/parityHarness.js";
import { defaultParityLaneRunners } from "../../src/testing/parityLanes.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);

const DCL_TYPE = { schemaName: "DCL.fbs", fileIdentifier: "$DCL", rootTypeName: "DCL", wireFormat: "flatbuffer" };
const typeSet = (setId, type) => ({ setId, allowedTypes: [type] });

const manifest = {
  pluginId: "com.digitalarsenal.e2e.dcl-port",
  name: "DCL port",
  version: "0.1.0",
  pluginFamily: "analysis",
  capabilities: [],
  externalInterfaces: [],
  invokeSurfaces: ["direct", "command"],
  runtimeTargets: ["browser", "wasmedge"],
  sequentialJustification: { kind: "pure-transform", detail: "E2E fixture: one pure call that hands a record back; it never spawns a thread." },
  methods: [{
    methodId: "echo_dcl",
    displayName: "Echo DCL",
    inputPorts: [{ portId: "dca", acceptedTypeSets: [typeSet("dcl", DCL_TYPE)], minStreams: 1, maxStreams: 1, required: true }],
    outputPorts: [{ portId: "calibrated", acceptedTypeSets: [typeSet("dcl", DCL_TYPE)], minStreams: 1, maxStreams: 1, required: true }],
    maxBatch: 1,
    drainPolicy: "single-shot",
  }],
};

const sourceCode = `
#include "space_data_module_invoke.h"
int echo_dcl(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) {
    plugin_set_error("missing-frame", "No DCL frame was provided.");
    return 3;
  }
  return plugin_push_output("calibrated", "DCL.fbs", "$DCL", frame->payload, frame->payload_length) < 0 ? 1 : 0;
}
`;

// A DCL record a downstream module would receive: a dimensionless common-mode log-density
// correction at time nodes, with its PVN provenance.
function buildDcl() {
  const record = new DCLT();
  record.ID = "dcl-e2e-0001";
  record.CREATED_AT_MS = BigInt(Date.UTC(2026, 9, 23, 12, 0, 0));
  record.PRODUCT = 2; // dclProduct.DensityCalibration
  record.CORRECTION = new dclCorrectionT(
    3, // dclCorrectionForm.LogDensityNodes
    0,
    [],
    [BigInt(Date.UTC(2026, 9, 23, 0)), BigInt(Date.UTC(2026, 9, 23, 6)), BigInt(Date.UTC(2026, 9, 23, 12))],
    [],
    [],
    [],
    [0.02, -0.015, 0.031],
  );
  const provenance = new PVNT();
  provenance.SOURCE_ID = "e2e-observed-densities";
  provenance.SOURCE_KIND = 3; // pvnSourceKind.Observation
  provenance.ORIGINATOR = "SDK E2E";
  provenance.LICENSE_CLASS = 2; // pvnLicenseClass.CiteOnly
  record.PROVENANCE = provenance;
  const builder = new flatbuffers.Builder(512);
  builder.finish(record.pack(builder), "$DCL");
  return builder.asUint8Array();
}

function readDcl(bytes) {
  const copy = Uint8Array.from(bytes);
  assert.equal(DCL.bufferHasIdentifier(new flatbuffers.ByteBuffer(copy)), true, "the record is not a $DCL buffer");
  const record = DCL.getRootAsDCL(new flatbuffers.ByteBuffer(copy)).unpack();
  return {
    id: record.ID,
    product: record.PRODUCT,
    form: record.CORRECTION?.FORM,
    scales: Array.from(record.CORRECTION?.NODE_LOG_DENSITY_SCALE_DIMENSIONLESS ?? []).map((value) => Math.fround(value)),
    nodes: record.CORRECTION?.NODE_TIMES_MS?.length,
    provenance: record.PROVENANCE && {
      sourceId: record.PROVENANCE.SOURCE_ID,
      kind: record.PROVENANCE.SOURCE_KIND,
      originator: record.PROVENANCE.ORIGINATOR,
      license: record.PROVENANCE.LICENSE_CLASS,
    },
  };
}

function atLeast(version, minimum) {
  const a = version.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

async function main() {
  const started = Date.now();
  const dir = await mkdtemp(path.join(os.tmpdir(), "sdm-sds-dcl-e2e-"));
  try {
    // --- 1. the pin ------------------------------------------------------------------------------
    const pinned = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).dependencies["spacedatastandards.org"];
    const installed = JSON.parse(await readFile(require.resolve("spacedatastandards.org/package.json"), "utf8")).version;
    assert.match(pinned, /^\d+\.\d+\.\d+$/, `spacedatastandards.org must be pinned exactly, got ${pinned}`);
    assert.equal(installed, pinned, `installed spacedatastandards.org ${installed} is not the pinned ${pinned}`);
    assert.ok(atLeast(installed, "1.259.0"), `spacedatastandards.org ${installed} predates 1.259.0 (DCL provenance)`);
    console.log(`pin: spacedatastandards.org ${installed}, pinned exactly and installed`);

    // --- 2. the catalog --------------------------------------------------------------------------
    const catalog = await loadStandardsCatalog();
    const dcl = resolveStandardsTypeRef({ schemaName: "DCL.fbs", fileIdentifier: "$DCL" }, catalog);
    assert.ok(dcl, "the standards catalog has no $DCL");
    const pvn = resolveStandardsTypeRef({ schemaName: "PVN.fbs", fileIdentifier: "$PVN" }, catalog);
    assert.ok(pvn, "the standards catalog has no $PVN (the provenance table DCL names)");
    console.log("catalog: $DCL (DCL.fbs) and $PVN resolve");

    // --- 3. validation ---------------------------------------------------------------------------
    const validation = await validateArtifactWithStandards({ manifest });
    assert.equal(validation.ok, true, `a manifest with $DCL ports is refused: ${JSON.stringify((validation.errors ?? []).map((issue) => issue.message))}`);
    console.log("validation: a manifest with $DCL input and output ports validates");

    // --- 4. the artifact -------------------------------------------------------------------------
    const outputPath = path.join(dir, "dcl-echo.wasm");
    const compiled = await compileModuleFromSource({ manifest, sourceCode, language: "c", threadModel: "wasi-sequential", outputPath, compileCache: { dir: path.join(dir, "cache") } });
    assert.equal(compiled.report.ok, true, "the module with $DCL ports does not pass the artifact validator");
    const section = listWasmCustomSections(compiled.wasmBytes).find((entry) => entry.name === SDS_MANIFEST_SECTION_NAME);
    assert.ok(section, "the artifact carries no embedded manifest");
    const embedded = decodePluginManifest(section.dataBytes);
    const ports = (embedded.methods?.[0]?.inputPorts ?? []).concat(embedded.methods?.[0]?.outputPorts ?? []);
    assert.equal(ports.length, 2);
    for (const port of ports) {
      const type = port.acceptedTypeSets?.[0]?.allowedTypes?.[0];
      assert.equal(type?.fileIdentifier, "$DCL", `port ${port.portId} lost its $DCL identity`);
      assert.equal(type?.schemaName, "DCL.fbs");
    }
    console.log(`artifact: ${compiled.wasmBytes.length} B module with $DCL ports compiles; the embedded manifest round-trips $DCL`);

    // --- 5. the runtime --------------------------------------------------------------------------
    const record = buildDcl();
    const sent = readDcl(record);
    assert.deepEqual(sent.provenance, { sourceId: "e2e-observed-densities", kind: 3, originator: "SDK E2E", license: 2 });
    const plan = await normalizeParityFixture({
      name: "dcl-echo",
      cases: [{
        id: "dcl",
        request: { methodId: "echo_dcl", inputs: [{ portId: "dca", payloadBase64: Buffer.from(record).toString("base64"), typeRef: DCL_TYPE }] },
      }],
    });
    const captured = [];
    const laneRunners = Object.fromEntries(["browser", "wasmedge"].map((lane) => [lane, async (context) => {
      const runs = await defaultParityLaneRunners[lane](context);
      captured.push(...runs.map((run) => ({ ...run, lane })));
      return runs;
    }]));
    const report = await runParityHarness({ wasmPath: outputPath, plan, lanes: ["browser", "wasmedge"], laneRunners, log: (line) => console.error(line) });
    assert.equal(report.ok, true, formatParityReport(report));
    assert.equal(captured.length, 2);
    for (const run of captured) {
      const response = decodePluginInvokeResponse(run.stdout);
      assert.equal(response.statusCode, 0, `${run.lane}: status ${response.statusCode} (${response.errorCode}: ${response.errorMessage})`);
      const payload = new Uint8Array(response.outputs[0].payload);
      assert.equal(Buffer.compare(Buffer.from(payload), Buffer.from(record)), 0, `${run.lane}: the $DCL record came back different`);
      assert.deepEqual(readDcl(payload), sent, `${run.lane}: the decoded $DCL record differs`);
    }
    console.log(`runtime: a ${record.length} B $DCL record (density calibration, log-density nodes, PVN provenance) returns byte-identical from headless Chromium and native WasmEdge`);

    console.log(`SDS-CATALOG-DCL PASS in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.log(`SDS-CATALOG-DCL FAIL: ${error?.stack ?? error}`);
  process.exit(1);
});
