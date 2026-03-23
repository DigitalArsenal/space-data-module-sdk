import test from "node:test";
import assert from "node:assert/strict";

import {
  compileModuleFromSource,
  createRecipientKeypairHex,
  decodePluginManifest,
  encodePluginManifest,
  generateEmbeddedManifestSource,
  loadKnownTypeCatalog,
  protectModuleArtifact,
  toEmbeddedPluginManifest,
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

function createAlignedType(overrides = {}) {
  return {
    schemaName: "StateVector.fbs",
    fileIdentifier: "STVC",
    wireFormat: "aligned-binary",
    rootTypeName: "StateVector",
    byteLength: 64,
    requiredAlignment: 8,
    ...overrides,
  };
}

function createFlatbufferType(overrides = {}) {
  return {
    schemaName: "StateVector.fbs",
    fileIdentifier: "STVC",
    ...overrides,
  };
}

function createHostedProtocol(overrides = {}) {
  return {
    protocolId: "sgp4-stream",
    methodId: "propagate",
    inputPortId: "request",
    outputPortId: "state",
    description: "Expose the propagator over SDN.",
    wireId: "/sdn/sgp4/1.0.0",
    transportKind: "libp2p",
    role: "handle",
    specUri: "https://spacedatastandards.org/#/schemas/PNM",
    autoInstall: true,
    advertise: true,
    discoveryKey: "sgp4-stream",
    defaultPort: 443,
    requireSecureTransport: true,
    ...overrides,
  };
}

test("plugin manifests round-trip through FlatBuffer encoding", () => {
  const manifest = createTestManifest();
  const encoded = encodePluginManifest(manifest);
  const decoded = decodePluginManifest(encoded);
  assert.equal(decoded.pluginId, manifest.pluginId);
  assert.equal(decoded.methods[0].methodId, "propagate");
});

test("plugin manifest invoke surfaces round-trip through FlatBuffer encoding", () => {
  const manifest = {
    ...createTestManifest(),
    invokeSurfaces: ["direct", "command"],
  };
  const encoded = encodePluginManifest(manifest);
  const decoded = decodePluginManifest(encoded);
  assert.deepEqual(decoded.invokeSurfaces, ["direct", "command"]);
});

test("protocol declarations round-trip through FlatBuffer encoding", () => {
  const manifest = {
    ...createTestManifest(),
    capabilities: ["protocol_handle", "ipfs"],
    protocols: [createHostedProtocol()],
  };
  const encoded = encodePluginManifest(manifest);
  const decoded = decodePluginManifest(encoded);
  assert.deepEqual(
    decoded.protocols.map((entry) => ({ ...entry })),
    [createHostedProtocol()],
  );
});

test("aligned payload type refs round-trip through FlatBuffer encoding", () => {
  const manifest = {
    ...createTestManifest(),
    methods: [
      {
        ...createTestManifest().methods[0],
        inputPorts: [
          {
            ...createTestManifest().methods[0].inputPorts[0],
            acceptedTypeSets: [
              {
                setId: "aligned-state",
                allowedTypes: [
                  createFlatbufferType(),
                  createAlignedType(),
                ],
              },
              {
                setId: "dual-state",
                allowedTypes: [
                  createFlatbufferType(),
                  createAlignedType({ rootTypeName: "StateVectorRecord" }),
                ],
              },
            ],
          },
        ],
      },
    ],
    schemasUsed: [
      createAlignedType({ rootTypeName: "StateVectorRecord" }),
      {
        schemaName: "StateVector.fbs",
        fileIdentifier: "STVC",
      },
    ],
  };
  const encoded = encodePluginManifest(manifest);
  const decoded = decodePluginManifest(encoded);
  const alignedType =
    decoded.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes[1];
  assert.equal(alignedType.wireFormat, "aligned-binary");
  assert.equal(alignedType.rootTypeName, "StateVector");
  assert.equal(alignedType.byteLength, 64);
  assert.equal(alignedType.requiredAlignment, 8);
  assert.equal(
    decoded.methods[0].inputPorts[0].acceptedTypeSets[1].allowedTypes[0]
      .wireFormat,
    "flatbuffer",
  );
  assert.equal(decoded.schemasUsed[0].wireFormat, "aligned-binary");
  assert.equal(decoded.schemasUsed[1].wireFormat, "flatbuffer");
});

test("embedded manifests preserve expanded canonical capabilities", () => {
  const manifest = {
    ...createTestManifest(),
    capabilities: [
      "http",
      "filesystem",
      "mqtt",
      "process_exec",
      "crypto_sign",
      "schedule_cron",
    ],
  };
  const embedded = toEmbeddedPluginManifest(manifest);
  assert.deepEqual(embedded.warnings, []);
  assert.equal(embedded.manifest.capabilities.length, 6);
});

test("embedded manifests preserve hosted protocol metadata", () => {
  const manifest = {
    ...createTestManifest(),
    capabilities: ["protocol_handle", "ipfs"],
    protocols: [createHostedProtocol()],
  };
  const embedded = toEmbeddedPluginManifest(manifest);
  assert.deepEqual(embedded.warnings, []);
  assert.equal(embedded.manifest.protocols.length, 1);
  assert.equal(embedded.manifest.protocols[0].wireId, "/sdn/sgp4/1.0.0");
  assert.equal(embedded.manifest.protocols[0].transportKind, "libp2p");
  assert.equal(embedded.manifest.protocols[0].role, "handle");
  assert.equal(embedded.manifest.protocols[0].defaultPort, 443);
  assert.equal(embedded.manifest.protocols[0].requireSecureTransport, true);
});

test("runtimeTargets are validated in JSON manifests but omitted from embedded manifests", () => {
  const manifest = {
    ...createTestManifest(),
    runtimeTargets: ["browser"],
  };
  const embedded = toEmbeddedPluginManifest(manifest);
  assert.ok(
    embedded.warnings.some((warning) =>
      warning.includes("runtimeTargets are not yet representable"),
    ),
  );
});

test("embedded manifest source stays a raw byte buffer for c and c++ modules", () => {
  const source = generateEmbeddedManifestSource({
    manifest: {
      ...createTestManifest(),
      methods: [
        {
          ...createTestManifest().methods[0],
          inputPorts: [
            {
              ...createTestManifest().methods[0].inputPorts[0],
              acceptedTypeSets: [
                {
                  setId: "aligned-state",
                  allowedTypes: [
                    createFlatbufferType(),
                    createAlignedType(),
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  });
  assert.match(source, /static const uint8_t g_module_manifest\[\] = \{/);
  assert.match(source, /MODULE_MANIFEST_EXPORT const uint8_t\*/);
  assert.match(source, /extern "C"/);
  assert.equal(source.includes("FlatBufferBuilder"), false);
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
  assert.ok(validation.exportNames.includes("plugin_invoke_stream"));
  assert.ok(validation.exportNames.includes("plugin_alloc"));
  assert.ok(validation.exportNames.includes("plugin_free"));
  assert.ok(validation.exportNames.includes("_start"));
});

test("c++ source compile emits a compliant wasm module with aligned manifest metadata", async () => {
  const manifest = {
    ...createTestManifest(),
    methods: [
      {
        ...createTestManifest().methods[0],
        inputPorts: [
          {
            ...createTestManifest().methods[0].inputPorts[0],
            acceptedTypeSets: [
              {
                setId: "aligned-state",
                allowedTypes: [
                  createFlatbufferType(),
                  createAlignedType(),
                ],
              },
            ],
          },
        ],
      },
    ],
    schemasUsed: [createAlignedType()],
  };
  const result = await compileModuleFromSource({
    manifest,
    sourceCode: 'extern "C" int propagate(void) { return 11; }\n',
    language: "c++",
  });
  assert.equal(result.language, "c++");
  assert.equal(result.report.ok, true);
  assert.ok(result.wasmBytes.length > 0);
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

test("aligned OrbPro-style stream type refs resolve without standards warnings", async () => {
  const manifest = {
    pluginId: "com.digitalarsenal.examples.aligned-sgp4-contract",
    name: "Aligned SGP4 Contract",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: [],
    externalInterfaces: [],
    methods: [
      {
        methodId: "stream_invoke",
        displayName: "Stream Invoke",
        inputPorts: [
          {
            portId: "state",
            acceptedTypeSets: [
              {
                setId: "aligned-state",
                allowedTypes: [
                  createFlatbufferType({
                    schemaName: "StateVector.fbs",
                    fileIdentifier: "STVC",
                  }),
                  createAlignedType({
                    schemaName: "StateVector.fbs",
                    fileIdentifier: "STVC",
                    rootTypeName: "StateVector",
                  }),
                ],
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        outputPorts: [],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
    schemasUsed: [
      createAlignedType({
        schemaName: "CatalogQueryRequest.fbs",
        fileIdentifier: "CQRQ",
        rootTypeName: "CatalogQueryRequest",
        byteLength: 128,
        requiredAlignment: 8,
      }),
    ],
  };
  const report = await validateManifestWithStandards(manifest);
  assert.equal(report.ok, true);
  assert.deepEqual(report.warnings, []);
});

test("regular input and aligned output port contracts validate together", async () => {
  const manifest = {
    pluginId: "com.digitalarsenal.examples.sgp4-mixed-contract",
    name: "SGP4 Mixed Contract",
    version: "0.1.0",
    pluginFamily: "propagator",
    capabilities: [],
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
                setId: "state-vector",
                allowedTypes: [
                  createFlatbufferType(),
                  createAlignedType(),
                ],
              },
            ],
            minStreams: 0,
            maxStreams: 1,
            required: false,
          },
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  };
  const encoded = encodePluginManifest(manifest);
  const decoded = decodePluginManifest(encoded);
  assert.equal(
    decoded.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes[0].wireFormat,
    "flatbuffer",
  );
  assert.equal(
    decoded.methods[0].outputPorts[0].acceptedTypeSets[0].allowedTypes[0].wireFormat,
    "flatbuffer",
  );
  assert.equal(
    decoded.methods[0].outputPorts[0].acceptedTypeSets[0].allowedTypes[1].wireFormat,
    "aligned-binary",
  );
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
