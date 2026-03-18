import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import {
  compileModuleFromSource,
  validateArtifactWithStandards,
  validateManifestWithStandards,
} from "../src/index.js";
import { createHandlers } from "../examples/flatsql-store-local/plugin.js";

async function readJson(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  return JSON.parse(await fs.readFile(url, "utf8"));
}

async function readText(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  return fs.readFile(url, "utf8");
}

function frame(portId, schemaName, fileIdentifier, payload, overrides = {}) {
  return {
    portId,
    typeRef: {
      schemaName,
      fileIdentifier,
      schemaHash: [1, 2, 3, 4],
    },
    alignment: 8,
    offset: overrides.offset ?? 4096,
    size: overrides.size ?? 64,
    ownership: "shared",
    generation: 0,
    mutability: "immutable",
    traceId:
      overrides.traceId ??
      `${schemaName}:${payload?.norad ?? payload?.anchorNorad ?? "x"}`,
    streamId: overrides.streamId ?? 1,
    sequence: overrides.sequence ?? 1,
    payload,
  };
}

test("local FlatSQL module manifest validates and compiles", async () => {
  const manifest = await readJson("../examples/flatsql-store-local/manifest.json");
  const sourceCode = await readText("../examples/flatsql-store-local/module.c");

  const manifestReport = await validateManifestWithStandards(manifest);
  assert.equal(manifestReport.ok, true);

  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode,
    language: "c",
  });
  assert.equal(compilation.report.ok, true);
  assert.ok(compilation.wasmBytes.length > 0);

  const artifactReport = await validateArtifactWithStandards({
    manifest,
    wasmPath: compilation.outputPath,
  });
  assert.equal(artifactReport.ok, true);
});

test("local FlatSQL handlers execute all canonical store methods", async () => {
  const handlers = createHandlers();

  const upsert = await handlers.upsert_records({
    inputs: [
      frame("records", "StoredRecordRef.fbs", "STRF", {
        norad: 25544,
        name: "ISS",
        distanceKm: 12.4,
      }),
      frame("records", "StoredRecordRef.fbs", "STRF", {
        norad: 20580,
        name: "HST",
        distanceKm: 88.2,
      }),
      frame(
        "records",
        "StoredRecordRef.fbs",
        "STRF",
        {
          norad: 25544,
          name: "ISS-UPDATED",
          distanceKm: 18.5,
        },
        {
          sequence: 3,
        },
      ),
    ],
  });

  assert.equal(upsert.outputs.length, 3);
  assert.equal(upsert.outputs[0].portId, "stored");
  assert.equal(upsert.outputs[0].payload.norad, 25544);

  const querySql = await handlers.query_sql({
    inputs: [
      frame("query", "SqlQueryRequest.fbs", "SQLQ", {
        sql: "SELECT norad, name, distanceKm FROM OrbitalRecord WHERE distanceKm BETWEEN 0 AND 50",
      }),
    ],
  });

  assert.equal(querySql.outputs.length, 1);
  assert.equal(querySql.outputs[0].portId, "rows");
  assert.deepEqual(querySql.outputs[0].payload.columns, [
    "norad",
    "name",
    "distanceKm",
  ]);
  assert.equal(querySql.outputs[0].payload.rowCount, 1);
  assert.deepEqual(querySql.outputs[0].payload.rows, [
    [25544, "ISS-UPDATED", 18.5],
  ]);

  const radiusQuery = await handlers.query_objects_within_radius({
    inputs: [
      frame("query", "AnchorRadiusQuery.fbs", "ARQY", {
        anchorNorad: 25544,
        radiusKm: 50,
        samplesPerOrbit: 90,
        orbitCount: 1,
      }),
    ],
  });

  assert.equal(radiusQuery.outputs.length, 1);
  assert.equal(radiusQuery.outputs[0].portId, "matches");
  assert.deepEqual(radiusQuery.outputs[0].payload, {
    anchorNorad: 25544,
    radiusKm: 50,
    sampleCount: 90,
    orbitCount: 1,
    matches: [25544],
  });
});
