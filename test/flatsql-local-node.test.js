import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import {
  compileModuleFromSource,
  validateArtifactWithStandards,
  validateManifestWithStandards,
} from "../src/index.js";
import * as sdk from "../src/index.js";
import { createHandlers } from "../examples/flatsql-store-local/plugin.js";
import {
  createModuleRegistry,
  createRuntimeHost,
} from "../src/runtime-host/index.js";

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

test("runtime host preserves canonical row and region identities", async () => {
  assert.equal(typeof sdk.createRuntimeHost, "function");
  assert.equal(typeof sdk.createFlatSqlRuntimeStore, "function");
  assert.equal(typeof sdk.createRuntimeRegionStore, "function");
  assert.equal(typeof sdk.createModuleRegistry, "function");

  const moduleRegistry = createModuleRegistry();
  const host = createRuntimeHost({ moduleRegistry });

  const firstRow = host.rows.appendRow({
    schemaFileId: "OMM",
    payload: {
      norad: 25544,
      name: "ISS",
    },
  });
  const secondRow = host.rows.appendRow({
    schemaFileId: "OMM",
    payload: {
      norad: 20580,
      name: "HST",
    },
  });
  const thirdRow = host.rows.appendRow({
    schemaFileId: "OMM",
    payload: {
      norad: 25544,
      name: "ISS-UPDATED",
    },
  });
  const entityMetadataRow = host.rows.appendRow({
    schemaFileId: "ENTM",
    payload: {
      entityId: "sat-25544",
    },
  });

  assert.deepEqual(firstRow, {
    schemaFileId: "OMM",
    rowId: 1,
  });
  assert.deepEqual(secondRow, {
    schemaFileId: "OMM",
    rowId: 2,
  });
  assert.deepEqual(thirdRow, {
    schemaFileId: "OMM",
    rowId: 3,
  });
  assert.deepEqual(entityMetadataRow, {
    schemaFileId: "ENTM",
    rowId: 1,
  });

  assert.deepEqual(host.rows.resolveRow(firstRow), {
    handle: firstRow,
    payload: {
      norad: 25544,
      name: "ISS",
    },
  });
  assert.deepEqual(host.rows.listRows("OMM"), [
    {
      handle: firstRow,
      payload: {
        norad: 25544,
        name: "ISS",
      },
    },
    {
      handle: secondRow,
      payload: {
        norad: 20580,
        name: "HST",
      },
    },
    {
      handle: thirdRow,
      payload: {
        norad: 25544,
        name: "ISS-UPDATED",
      },
    },
  ]);
  assert.deepEqual(host.rows.listRows("ENTM"), [
    {
      handle: entityMetadataRow,
      payload: {
        entityId: "sat-25544",
      },
    },
  ]);
  assert.equal(typeof host.rows.query, "function");
  assert.deepEqual(
    host.rows.query(
      "SELECT schemaFileId, rowId FROM RuntimeHostRow WHERE schemaFileId = 'OMM' ORDER BY rowId",
    ),
    {
      columns: ["schemaFileId", "rowId"],
      rows: [
        ["OMM", 1],
        ["OMM", 2],
        ["OMM", 3],
      ],
      rowCount: 3,
    },
  );

  const region = host.regions.allocateRegion({
    layoutId: "StateVector:f64x6",
    recordByteLength: 48,
    alignment: 16,
    initialRecords: [
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([5, 6, 7, 8]),
    ],
  });

  assert.equal(region.regionId, 1);
  assert.equal(region.recordCount, 2);
  assert.equal(region.alignment, 16);

  const firstRecord = host.regions.resolveRecord({
    regionId: region.regionId,
    recordIndex: 0,
  });
  const secondRecord = host.regions.resolveRecord({
    regionId: region.regionId,
    recordIndex: 1,
  });

  assert.deepEqual(firstRecord, {
    regionId: 1,
    recordIndex: 0,
    layoutId: "StateVector:f64x6",
    recordByteLength: 48,
    alignment: 16,
    byteLength: 48,
    bytes: new Uint8Array([
      1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]),
  });
  assert.deepEqual(secondRecord, {
    regionId: 1,
    recordIndex: 1,
    layoutId: "StateVector:f64x6",
    recordByteLength: 48,
    alignment: 16,
    byteLength: 48,
    bytes: new Uint8Array([
      5, 6, 7, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]),
  });
  moduleRegistry.installModule({
    moduleId: "runtime-view",
    methods: {
      describe() {
        return {
          rows: host.rows.listRows("OMM"),
          region: host.regions.describeRegion(region.regionId),
        };
      },
    },
  });

  const mutableDefinition = {
    moduleId: "mutable-module",
    metadata: {
      label: "stable",
    },
    methods: {
      getLabel() {
        return this.metadata.label;
      },
    },
  };
  const installedMutableModule = moduleRegistry.installModule(mutableDefinition);
  mutableDefinition.metadata.label = "mutated-after-install";

  assert.equal(installedMutableModule.metadata.label, "stable");
  assert.equal(await moduleRegistry.invokeModule("mutable-module", "getLabel"), "stable");

  const loadedMutableModule = moduleRegistry.loadModule("mutable-module");
  loadedMutableModule.metadata.label = "mutated-after-load";
  assert.equal(
    (await moduleRegistry.loadModule("mutable-module")).metadata.label,
    "stable",
  );

  const listedMutableModule = moduleRegistry.listModules().find(
    (module) => module.moduleId === "mutable-module",
  );
  listedMutableModule.metadata.label = "mutated-after-list";
  assert.equal(
    moduleRegistry.listModules().find((module) => module.moduleId === "mutable-module")
      .metadata.label,
    "stable",
  );

  const description = await moduleRegistry.invokeModule("runtime-view", "describe");
  assert.equal(description.rows[2].handle.rowId, 3);
  assert.deepEqual(description.region, {
    regionId: 1,
    layoutId: "StateVector:f64x6",
    recordByteLength: 48,
    alignment: 16,
    recordCount: 2,
  });
  assert.deepEqual(host.regions.setRegionRecordCount(region.regionId, 3), {
    regionId: 1,
    layoutId: "StateVector:f64x6",
    recordByteLength: 48,
    alignment: 16,
    recordCount: 3,
  });
  assert.deepEqual(
    host.regions.resolveRecord({
      regionId: region.regionId,
      recordIndex: 2,
    }),
    {
      regionId: 1,
      recordIndex: 2,
      layoutId: "StateVector:f64x6",
      recordByteLength: 48,
      alignment: 16,
      byteLength: 48,
      bytes: new Uint8Array(48),
    },
  );
  assert.deepEqual(host.regions.setRegionRecordCount(region.regionId, 1), {
    regionId: 1,
    layoutId: "StateVector:f64x6",
    recordByteLength: 48,
    alignment: 16,
    recordCount: 1,
  });
  assert.equal(
    host.regions.resolveRecord({
      regionId: region.regionId,
      recordIndex: 1,
    }),
    null,
  );

  assert.throws(
    () =>
      host.regions.allocateRegion({
        layoutId: "Invalid:zero",
        recordByteLength: 0,
      }),
    /recordByteLength must be a positive integer/,
  );
  assert.throws(
    () =>
      host.regions.allocateRegion({
        layoutId: "Invalid:alignment-zero",
        recordByteLength: 4,
        alignment: 0,
      }),
    /alignment must be a positive integer/,
  );
  assert.equal(host.regions.describeRegion(999), null);
  assert.equal(
    host.regions.resolveRecord({
      regionId: region.regionId,
      recordIndex: 99,
    }),
    null,
  );
  assert.equal(
    host.regions.resolveRecord({
      regionId: 999,
      recordIndex: 0,
    }),
    null,
  );

  const externalRegion = host.regions.registerExternalRegion({
    layoutId: "EntityPosition:f64x3",
    recordByteLength: 24,
    alignment: 8,
    getRecordCount() {
      return 4;
    },
    resolveRecordView({ recordIndex }) {
      return {
        byteOffset: 4096 + recordIndex * 24,
        elementType: "float64",
        elementCount: 3,
        strideElements: 3,
      };
    },
  });

  assert.deepEqual(externalRegion, {
    regionId: externalRegion.regionId,
    layoutId: "EntityPosition:f64x3",
    recordByteLength: 24,
    alignment: 8,
    recordCount: 4,
  });
  assert.deepEqual(
    host.regions.resolveRecordView({
      regionId: externalRegion.regionId,
      recordIndex: 2,
    }),
    {
      regionId: externalRegion.regionId,
      recordIndex: 2,
      layoutId: "EntityPosition:f64x3",
      recordByteLength: 24,
      alignment: 8,
      byteOffset: 4144,
      elementType: "float64",
      elementCount: 3,
      strideElements: 3,
    },
  );
  assert.equal(
    host.regions.resolveRecord({
      regionId: externalRegion.regionId,
      recordIndex: 0,
    }),
    null,
  );
  assert.equal(
    host.regions.resolveRecordView({
      regionId: externalRegion.regionId,
      recordIndex: 8,
    }),
    null,
  );
  assert.throws(
    () => host.regions.setRegionRecordCount(externalRegion.regionId, 2),
    /Cannot set recordCount for externally counted regions/,
  );
});

test("host storage ABI carries runtime-region record bytes", async () => {
  const schema = await readText("../schemas/HostStorageAbi.fbs");
  assert.match(schema, /table ResolveRegionRecordResult/);
  assert.match(schema, /bytes:\s*\[ubyte\]/);
  assert.match(schema, /byte_length:\s*uint32/);
});

test("runtime host row store preserves non-JSON payloads without coercing them through JSON", () => {
  const rows = sdk.createFlatSqlRuntimeStore();
  const payload = new Map([
    [
      "epoch",
      new Date("2026-04-08T00:00:00.000Z"),
    ],
    ["bytes", Uint8Array.from([1, 2, 3, 4])],
  ]);

  const handle = rows.appendRow({
    schemaFileId: "OMM",
    payload,
  });
  const resolved = rows.resolveRow(handle);

  assert.ok(resolved);
  assert.ok(resolved.payload instanceof Map);
  assert.equal(resolved.payload.get("epoch").toISOString(), "2026-04-08T00:00:00.000Z");
  assert.deepEqual(resolved.payload.get("bytes"), Uint8Array.from([1, 2, 3, 4]));
});
