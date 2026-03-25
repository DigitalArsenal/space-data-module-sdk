import test from "node:test";
import assert from "node:assert/strict";

import {
  compileModuleFromSource,
  computeCanonicalModuleHash,
  createSingleFileBundle,
  extractPublicationRecordCollection,
  getWasmCustomSections,
  parseSingleFileBundle,
  protectModuleArtifact,
  SDS_GUEST_LINK_METADATA_ENTRY_ID,
  SDS_GUEST_LINK_OBJECT_ENTRY_ID,
} from "../src/index.js";

function createTestManifest() {
  return {
    pluginId: "com.digitalarsenal.examples.bundle-test",
    name: "Bundle Test Module",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: ["clock"],
    externalInterfaces: [],
    methods: [
      {
        methodId: "propagate",
        displayName: "Propagate",
        inputPorts: [
          {
            portId: "request",
            acceptedTypeSets: [
              {
                setId: "omm",
                allowedTypes: [
                  {
                    schemaName: "OMM.fbs",
                    fileIdentifier: "$OMM",
                  },
                ],
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        outputPorts: [
          {
            portId: "state",
            acceptedTypeSets: [
              {
                setId: "cat",
                allowedTypes: [
                  {
                    schemaName: "CAT.fbs",
                    fileIdentifier: "$CAT",
                  },
                ],
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  };
}

async function compileTestModule() {
  return compileModuleFromSource({
    manifest: createTestManifest(),
    sourceCode: "int propagate(void) { return 7; }\n",
    language: "c",
  });
}

test("single-file bundles round-trip through wasm custom sections", async () => {
  const manifest = createTestManifest();
  const compilation = await compileTestModule();
  const protectedArtifact = await protectModuleArtifact({
    manifest,
    wasmBytes: compilation.wasmBytes,
    guestLink: compilation.guestLink,
    singleFileBundle: true,
  });

  assert.ok(protectedArtifact.singleFileBundle);
  const protectedBundle = extractPublicationRecordCollection(
    protectedArtifact.singleFileBundle.wasmBytes,
  );
  assert.ok(protectedBundle);
  assert.equal(WebAssembly.validate(protectedBundle.payloadBytes), true);
  assert.equal(
    getWasmCustomSections(
      protectedArtifact.singleFileBundle.wasmBytes,
      "sds.bundle",
    ).length,
    1,
  );

  const parsed = await parseSingleFileBundle(
    protectedArtifact.singleFileBundle.wasmBytes,
  );
  assert.equal(parsed.manifest?.pluginId, manifest.pluginId);
  assert.equal(parsed.publicationRecords?.pnm?.fileId, manifest.pluginId);

  const manifestEntry = parsed.entries.find((entry) => entry.entryId === "manifest");
  assert.ok(manifestEntry?.decodedManifest);
  assert.equal(manifestEntry.decodedManifest.pluginId, manifest.pluginId);

  const authorizationEntry = parsed.entries.find(
    (entry) => entry.entryId === "authorization",
  );
  assert.equal(authorizationEntry?.decodedPayload?.payload?.action, "deploy-flow");
  const guestLinkEntry = parsed.entries.find(
    (entry) => entry.entryId === SDS_GUEST_LINK_OBJECT_ENTRY_ID,
  );
  assert.ok(guestLinkEntry?.payloadBytes?.length > 0);
  const guestLinkMetadataEntry = parsed.entries.find(
    (entry) => entry.entryId === SDS_GUEST_LINK_METADATA_ENTRY_ID,
  );
  assert.equal(guestLinkMetadataEntry?.decodedPayload?.methodSymbols?.propagate.length > 0, true);
});

test("rebundling replaces prior sds sections and preserves canonical hash", async () => {
  const manifest = createTestManifest();
  const compilation = await compileTestModule();

  const firstBundle = await createSingleFileBundle({
    manifest,
    wasmBytes: compilation.wasmBytes,
    authorization: { step: 1, status: "first" },
  });
  const secondBundle = await createSingleFileBundle({
    manifest,
    wasmBytes: firstBundle.wasmBytes,
    authorization: { step: 2, status: "second" },
  });

  assert.equal(WebAssembly.validate(secondBundle.wasmBytes), true);
  assert.equal(getWasmCustomSections(secondBundle.wasmBytes, "sds.bundle").length, 1);

  const baseCanonical = await computeCanonicalModuleHash(compilation.wasmBytes);
  const rebundledCanonical = await computeCanonicalModuleHash(secondBundle.wasmBytes);
  assert.deepEqual(
    Array.from(rebundledCanonical.hashBytes),
    Array.from(baseCanonical.hashBytes),
  );

  const parsed = await parseSingleFileBundle(secondBundle.wasmBytes);
  const authorizationEntry = parsed.entries.find(
    (entry) => entry.entryId === "authorization",
  );
  assert.equal(authorizationEntry?.decodedPayload?.step, 2);
  assert.equal(authorizationEntry?.decodedPayload?.status, "second");
});
