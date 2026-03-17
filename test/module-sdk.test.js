import test from "node:test";
import assert from "node:assert/strict";

import {
  compileModuleFromSource,
  createRecipientKeypairHex,
  decodePluginManifest,
  encodePluginManifest,
  loadKnownTypeCatalog,
  protectModuleArtifact,
  validateArtifactWithStandards,
  validateManifestWithStandards,
} from "../src/index.js";

function createTestManifest() {
  return {
    pluginId: "com.digitalarsenal.examples.basic-propagator",
    name: "Basic Propagator",
    version: "0.1.0",
    pluginFamily: "propagator",
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
        maxBatch: 32,
        drainPolicy: "drain-to-empty",
      },
    ],
  };
}

test("plugin manifests round-trip through FlatBuffer encoding", () => {
  const manifest = createTestManifest();
  const encoded = encodePluginManifest(manifest);
  const decoded = decodePluginManifest(encoded);
  assert.equal(decoded.pluginId, manifest.pluginId);
  assert.equal(decoded.methods[0].methodId, "propagate");
});

test("source compile emits a compliant wasm module", async () => {
  const manifest = createTestManifest();
  const result = await compileModuleFromSource({
    manifest,
    sourceCode: "int propagate(void) { return 7; }\n",
    language: "c",
  });
  assert.equal(result.report.ok, true);
  assert.ok(result.wasmBytes.length > 0);
  const validation = await validateArtifactWithStandards({
    manifest,
    wasmPath: result.outputPath,
  });
  assert.equal(validation.ok, true);
});

test("artifacts can be signed and encrypted for transport", async () => {
  const manifest = createTestManifest();
  const result = await compileModuleFromSource({
    manifest,
    sourceCode: "int propagate(void) { return 9; }\n",
    language: "c",
  });
  const recipient = await createRecipientKeypairHex();
  const protectedArtifact = await protectModuleArtifact({
    manifest,
    wasmBytes: result.wasmBytes,
    recipientPublicKeyHex: recipient.publicKeyHex,
  });
  assert.equal(protectedArtifact.encrypted, true);
  assert.ok(protectedArtifact.payload.authorization.signatureHex.length > 0);
  assert.ok(protectedArtifact.encryptedEnvelope.ciphertextBase64.length > 0);
});

test("shared module and legacy OrbPro type refs resolve without warnings", async () => {
  const manifest = {
    pluginId: "com.digitalarsenal.examples.type-registry",
    name: "Type Registry Coverage",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: [],
    externalInterfaces: [],
    methods: [
      {
        methodId: "analyze",
        displayName: "Analyze",
        inputPorts: [
          {
            portId: "tick",
            acceptedTypeSets: [
              {
                setId: "tick",
                allowedTypes: [
                  {
                    schemaName: "TimerTick.fbs",
                    fileIdentifier: "TICK",
                  },
                ],
              },
              {
                setId: "legacy-graph",
                allowedTypes: [
                  {
                    schemaName: "orbpro.analysis.GraphDefinition",
                    fileIdentifier: "FGDF",
                  },
                ],
              },
              {
                setId: "catalog-query",
                allowedTypes: [
                  {
                    schemaName: "orbpro.query.CatalogQueryRequest",
                    fileIdentifier: "CQRQ",
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
                setId: "state",
                allowedTypes: [
                  {
                    schemaName: "StateVector.fbs",
                    fileIdentifier: "STVC",
                  },
                  {
                    schemaName: "DetachedSignature.fbs",
                    fileIdentifier: "SIGD",
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
    schemasUsed: [
      {
        schemaName: "HttpRequest.fbs",
        fileIdentifier: "HREQ",
      },
      {
        schemaName: "OMM.fbs",
        fileIdentifier: "$OMM",
      },
    ],
  };
  const report = await validateManifestWithStandards(manifest);
  assert.equal(report.ok, true);
  assert.deepEqual(report.warnings, []);
});

test("known type catalog includes shared module and SDS entries", async () => {
  const catalog = await loadKnownTypeCatalog();
  assert.ok(
    catalog.some(
      (entry) =>
        entry.schemaName === "TimerTick.fbs" && entry.fileIdentifier === "TICK",
    ),
  );
  assert.ok(
    catalog.some(
      (entry) => entry.schemaName === "OMM.fbs" && entry.fileIdentifier === "OMM",
    ),
  );
});
