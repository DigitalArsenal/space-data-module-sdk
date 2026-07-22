import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_FILE_IDENTIFIER,
  decodeAppManifest,
  encodeAppManifest,
  validateAppManifest,
} from "../src/app/index.js";

const pageContent = "<!doctype html><title>Neutral status</title>";
const pageHash = "b".repeat(64);
const moduleHash = "a".repeat(64);

function validManifest() {
  return {
    id: "org.example.weather-app",
    name: "Weather app",
    version: "1.2.3",
    description: "Neutral APP codec fixture.",
    modules: [
      {
        id: "weather-flow",
        pluginId: "org.example.weather-flow",
        contentHash: moduleHash,
        version: "1.2.3",
        role: "primary",
        description: "One composed module.",
        maxWallClockMs: 5_000,
        maxCostUnits: 50_000,
        maxMemoryPages: 256,
        runtimeTarget: "node",
      },
    ],
    data: [
      {
        id: "weather-records",
        sdsType: "WTH",
        direction: "produces",
        moduleId: "weather-flow",
        description: "Weather output.",
      },
    ],
    sources: [
      {
        id: "weather-source",
        kind: "dataset",
        ref: "weather-observations",
        description: "Neutral source.",
      },
    ],
    pages: [
      {
        id: "status",
        title: "Weather status",
        description: "Inline status UI.",
        content: pageContent,
        encoding: "utf8",
        mediaType: "text/html",
        contentSha256: pageHash,
        entry: true,
      },
    ],
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    dataflow: [
      {
        name: "weather-status",
        direction: "to_page",
        sdsSchema: "WTH",
        transport: "gateway_route",
        locator: "/sdn/v1/artifacts/{contentHash}/query",
        moduleId: "weather-flow",
        methodId: "query",
        portId: "records",
        contentEncoding: "utf8",
        description: "Artifact-addressed status records.",
      },
    ],
  };
}

test("canonical APP manifests round-trip through size-prefixed $APP bytes", () => {
  const manifest = validManifest();
  assert.deepEqual(validateAppManifest(manifest), manifest);

  const encoded = encodeAppManifest(manifest);
  assert.ok(encoded instanceof Uint8Array);
  assert.equal(
    new TextDecoder().decode(encoded.subarray(8, 12)),
    APP_FILE_IDENTIFIER,
    "size-prefixed FlatBuffers place the file identifier after size+root offsets",
  );

  assert.deepEqual(decodeAppManifest(encoded), manifest);
});

test("APP validation enforces content addressing and exactly one page delivery lane", () => {
  const missingHash = validManifest();
  missingHash.modules[0].contentHash = "";
  assert.throws(
    () => validateAppManifest(missingHash),
    /modules\[0\].*contentHash.*64 lowercase hexadecimal/i,
  );

  const bothPageLanes = validManifest();
  Object.assign(bothPageLanes.pages[0], {
    moduleId: "weather-flow",
    url: "/status",
  });
  assert.throws(
    () => validateAppManifest(bothPageLanes),
    /pages\[0\].*exactly one.*inline content.*moduleId\+url/i,
  );
});

test("APP validation rejects broken references, duplicate identities, and unknown enums", () => {
  const broken = validManifest();
  broken.data[0].moduleId = "missing";
  assert.throws(() => validateAppManifest(broken), /data\[0\].*unknown module/i);

  const duplicate = validManifest();
  duplicate.modules.push({ ...duplicate.modules[0] });
  assert.throws(() => validateAppManifest(duplicate), /duplicate module id/i);

  const unknownEnum = validManifest();
  unknownEnum.dataflow[0].transport = "socket";
  assert.throws(() => validateAppManifest(unknownEnum), /dataflow\[0\].*transport/i);
});

test("APP validation and encoding do not mutate sparse caller-owned manifests", () => {
  const sparse = {
    id: "org.example.sparse-app",
    name: "Sparse app",
    version: "1.0.0",
    modules: [
      {
        id: "weather-flow",
        pluginId: "org.example.weather-flow",
        contentHash: moduleHash,
      },
    ],
  };
  const before = structuredClone(sparse);

  assert.equal(validateAppManifest(sparse), sparse);
  assert.deepEqual(sparse, before);
  assert.deepEqual(decodeAppManifest(encodeAppManifest(sparse)), {
    ...before,
    modules: [{ ...before.modules[0], runtimeTarget: "node" }],
    data: [],
    sources: [],
    pages: [],
    dataflow: [],
  });
  assert.deepEqual(sparse, before);
});
