import test from "node:test";
import assert from "node:assert/strict";

import {
  SDS_GUEST_LINK_METADATA_ENTRY_ID,
  SDS_GUEST_LINK_OBJECT_ENTRY_ID,
} from "../src/bundle/constants.js";
import {
  computeCanonicalModuleHash,
  createSingleFileBundle,
  getWasmCustomSections,
  parseSingleFileBundle,
} from "../src/bundle/wasm.js";
import {
  decodeModuleBundle,
  encodeModuleBundle,
} from "../src/bundle/codec.js";
import {
  compileModuleFromSource,
  protectModuleArtifact,
} from "../src/compiler/compileModule.js";
import {
  decodePublicationRecordCollection,
  extractPublicationRecordCollection,
} from "../src/transport/records.js";

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

function recordStandards(recordCollection) {
  return recordCollection.records.map((record) => record.standard);
}

test("module bundle codec normalizes regenerated snake_case bindings to the SDK camelCase shape", () => {
  const encoded = encodeModuleBundle({
    bundleVersion: 1,
    moduleFormat: "space-data-module",
    canonicalization: {
      version: 1,
      strippedCustomSectionPrefix: "sds.",
      bundleSectionName: "rec.mbl",
      hashAlgorithm: "sha256",
    },
    canonicalModuleHash: Uint8Array.from({ length: 32 }, (_, index) => index),
    manifestHash: Uint8Array.from({ length: 32 }, (_, index) => 255 - index),
    manifestExportSymbol: "plugin_get_manifest_flatbuffer",
    manifestSizeSymbol: "plugin_get_manifest_flatbuffer_size",
    entries: [
      {
        entryId: "manifest",
        role: "manifest",
        sectionName: "sds.manifest",
        typeRef: {
          schemaName: "PluginManifest.fbs",
          fileIdentifier: "PMAN",
        },
        payloadEncoding: "flatbuffer",
        payload: Uint8Array.of(1, 2, 3, 4),
        description: "Canonical plugin manifest.",
      },
    ],
  });

  const decoded = decodeModuleBundle(encoded);
  assert.equal(decoded.bundleVersion, 1);
  assert.equal(decoded.moduleFormat, "space-data-module");
  assert.equal(decoded.canonicalization?.bundleSectionName, "rec.mbl");
  assert.equal(decoded.entries[0]?.entryId, "manifest");
  assert.equal(decoded.entries[0]?.sectionName, "sds.manifest");
  assert.equal(decoded.entries[0]?.payloadEncoding, 1);
  assert.equal(decoded.entries[0]?.typeRef?.fileIdentifier, "PMAN");
  assert.equal(decoded.entries[0]?.typeRef?.schemaName, "PluginManifest.fbs");
});

test("single-file bundles round-trip through one appended REC trailer carrying MBL", async () => {
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
  assert.equal(getWasmCustomSections(protectedBundle.payloadBytes, "sds.bundle").length, 0);
  assert.deepEqual(recordStandards(protectedBundle), ["MBL", "PNM"]);

  const parsed = await parseSingleFileBundle(
    protectedArtifact.singleFileBundle.wasmBytes,
  );
  assert.equal(parsed.manifest?.pluginId, manifest.pluginId);
  assert.equal(parsed.publicationRecords?.pnm?.fileId, manifest.pluginId);
  assert.deepEqual(recordStandards(parsed.publicationRecords), ["MBL", "PNM"]);

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
  assert.equal(
    guestLinkMetadataEntry?.decodedPayload?.threadModel,
    compilation.threadModel,
  );
});

test("rebundling replaces the prior REC trailer and preserves canonical hash", async () => {
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

  const secondProtectedBundle = extractPublicationRecordCollection(secondBundle.wasmBytes);
  assert.ok(secondProtectedBundle);
  assert.equal(WebAssembly.validate(secondProtectedBundle.payloadBytes), true);
  assert.equal(
    getWasmCustomSections(
      secondProtectedBundle.payloadBytes,
      "sds.bundle",
    ).length,
    0,
  );
  assert.deepEqual(
    recordStandards(secondProtectedBundle),
    ["MBL"],
  );

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

test("encrypted publication protection keeps MBL, ENC, and PNM in one REC trailer", async () => {
  const manifest = createTestManifest();
  const compilation = await compileTestModule();
  const recipientPublicKeyHex = "11".repeat(32);

  const protectedArtifact = await protectModuleArtifact({
    manifest,
    wasmBytes: compilation.wasmBytes,
    singleFileBundle: true,
    recipientPublicKeyHex,
  });

  const parsed = decodePublicationRecordCollection(
    extractPublicationRecordCollection(protectedArtifact.protectedArtifactBytes)
      .recordCollectionBytes,
  );
  assert.deepEqual(recordStandards(parsed), ["MBL", "ENC", "PNM"]);
});
