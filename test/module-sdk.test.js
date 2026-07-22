import test from "node:test";
import assert from "node:assert/strict";
import { WASI } from "node:wasi";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  compileModuleFromSource,
  ModuleThreadModel,
  createRecipientKeypairHex,
  decodePlgManifest,
  decodePluginManifest,
  encodePlgManifest,
  encodePluginManifest,
  generateEmbeddedManifestSource,
  isPlgManifestBuffer,
  legacyManifestToPlg,
  loadKnownTypeCatalog,
  loadStandardsCatalog,
  PluginFamily,
  PluginManifestT,
  protectModuleArtifact,
  resolveWasiThreadsToolchain,
  toEmbeddedPluginManifest,
  validateArtifactWithStandards,
  validateManifestWithStandards,
} from "../src/index.js";
import { createBrowserModuleHarness } from "../src/testing/browserModuleHarness.js";

function wasiThreadsAvailable() {
  try {
    resolveWasiThreadsToolchain();
    return true;
  } catch {
    return false;
  }
}

const VERSIONED_TEST_IDENTITY = Object.freeze({
  schemaVersion: "1.0.0",
  schemaHash: Object.freeze([0x10, 0x20, 0x30, 0x40]),
});

function createTestManifest(options = {}) {
  const identity = options.versionedIdentity
    ? VERSIONED_TEST_IDENTITY
    : {};
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
              createDualTypeSet("omm", "OMM.fbs", "$OMM", "OMM", {
                identity,
              }),
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
              createDualTypeSet("cat", "CAT.fbs", "$CAT", "CAT", {
                identity,
              }),
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

function createDualTypeSet(
  setId,
  schemaName,
  fileIdentifier,
  rootTypeName,
  overrides = {},
) {
  const identity = {
    schemaName,
    fileIdentifier,
    rootTypeName,
    ...(overrides.identity ?? {}),
  };
  return {
    setId,
    allowedTypes: [
      { ...identity, wireFormat: "flatbuffer" },
      {
        ...identity,
        wireFormat: "aligned-binary",
        byteLength: overrides.byteLength ?? 64,
        requiredAlignment: overrides.requiredAlignment ?? 8,
      },
    ],
  };
}

function resolveSharedMemoryEmscriptenRoot() {
  const candidates = [
    process.env.SDN_SHARED_MEMORY_EMSDK_DIR,
    process.env.SDN_LOCAL_EMSDK_DIR,
    path.resolve(
      "..",
      "..",
      "main-packages",
      "space-data-network-modules",
      "analysis",
      "conjunction-assessment",
      "deps",
      "emsdk",
    ),
    path.resolve(
      "..",
      "..",
      "main-packages",
      "OrbPro",
      "packages",
      "wasm-engine",
      "deps",
      "emsdk",
    ),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (
      existsSync(path.join(candidate, "upstream", "emscripten", "em++"))
    ) {
      return candidate;
    }
  }
  return null;
}

function createAlignedType(overrides = {}) {
  return {
    schemaName: "StateVector.fbs",
    fileIdentifier: "STVC",
    schemaVersion: "1.0.0",
    schemaHash: [0x10, 0x20, 0x30, 0x40],
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
    schemaVersion: "1.0.0",
    schemaHash: [0x10, 0x20, 0x30, 0x40],
    rootTypeName: "StateVector",
    wireFormat: "flatbuffer",
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
  assert.equal(decoded.pluginFamily, manifest.pluginFamily);
  assert.deepEqual(decoded.capabilities, manifest.capabilities);
  assert.equal(decoded.methods[0].methodId, "propagate");
  assert.equal(
    decoded.methods[0].drainPolicy,
    manifest.methods[0].drainPolicy,
  );
});

test("PLG encoding derives both allowed wire formats from the required pair", () => {
  const manifest = createTestManifest();
  manifest.methods[0].inputPorts[0].acceptedTypeSets[0].allowedWireFormats = [
    "aligned-binary",
  ];

  const decoded = decodePluginManifest(encodePluginManifest(manifest));

  assert.deepEqual(
    decoded.methods[0].inputPorts[0].acceptedTypeSets[0].allowedWireFormats,
    ["flatbuffer", "aligned-binary"],
  );
});

test("PLG encoding rejects malformed graph records instead of dropping them", () => {
  const manifest = {
    ...createTestManifest(),
    flowEdges: [
      {
        edgeId: "broken",
        fromNodeId: "source",
        toNodeId: "sink",
        toPortId: "in",
      },
    ],
  };

  assert.throws(
    () => encodePluginManifest(manifest),
    /flow edge.*fromPortId/i,
  );
});

test("plugin manifest decoder accepts canonical PLG artifact buffers", () => {
  const manifest = createTestManifest({ versionedIdentity: true });
  const embeddedManifest = legacyManifestToPlg(manifest);
  assert.deepEqual(embeddedManifest.requiredSchemas, ["OMM.fbs", "CAT.fbs"]);
  assert.deepEqual(embeddedManifest.entryFunctions[0].inputSchemas, ["OMM.fbs"]);
  assert.equal(embeddedManifest.entryFunctions[0].outputSchema, "CAT.fbs");
  const encoded = encodePlgManifest(embeddedManifest);
  const decoded = decodePluginManifest(encoded);
  assert.equal(decoded.pluginId, manifest.pluginId);
  assert.equal(decoded.name, manifest.name);
  assert.equal(decoded.version, manifest.version);
  assert.equal(decoded.methods[0].methodId, "propagate");
  for (const [port, expectedSchema, expectedFileId, expectedRoot] of [
    [decoded.methods[0].inputPorts[0], "OMM.fbs", "$OMM", "OMM"],
    [decoded.methods[0].outputPorts[0], "CAT.fbs", "$CAT", "CAT"],
  ]) {
    const allowedTypes = port.acceptedTypeSets[0].allowedTypes;
    assert.equal(allowedTypes.length, 2);
    assert.deepEqual(
      allowedTypes.map((typeRef) => typeRef.wireFormat),
      ["flatbuffer", "aligned-binary"],
    );
    for (const typeRef of allowedTypes) {
      assert.equal(typeRef.schemaName, expectedSchema);
      assert.equal(typeRef.fileIdentifier, expectedFileId);
      assert.equal(typeRef.schemaVersion, "1.0.0");
      assert.equal(typeRef.rootTypeName, expectedRoot);
      assert.deepEqual(
        Array.from(typeRef.schemaHash),
        [0x10, 0x20, 0x30, 0x40],
      );
    }
  }
});

test("plugin manifest encoder preserves numeric PMAN plugin families in PLG buffers", () => {
  for (const [pluginFamily, expected] of [
    [PluginFamily.PROPAGATOR, "propagator"],
    [PluginFamily.SHADER, "shader"],
  ]) {
    const manifest = new PluginManifestT(
      `com.digitalarsenal.examples.${expected}`,
      `${expected} plugin`,
      "0.1.0",
      pluginFamily,
    );
    const decoded = decodePluginManifest(encodePluginManifest(manifest));
    assert.equal(decoded.pluginFamily, expected);
  }
});

test("plugin manifest encoder emits canonical PLG with rich invoke metadata", () => {
  const manifest = {
    ...createTestManifest(),
    capabilities: [
      "clock",
      {
        capability: "protocol_handle",
        scope: "sgp4",
        required: false,
        description: "Serve SGP4 stream requests.",
      },
    ],
    invokeSurfaces: ["direct", "command"],
    runtimeTargets: ["browser", "wasmedge"],
    timers: [
      {
        timerId: "refresh",
        methodId: "propagate",
        inputPortId: "request",
        defaultIntervalMs: 60000n,
        description: "Refresh propagated states.",
      },
    ],
    protocols: [createHostedProtocol()],
    buildArtifacts: [
      {
        artifactId: "isomorphic-wasm",
        kind: "wasm",
        path: "dist/isomorphic/module.wasm",
        target: "browser+wasmedge",
        entrySymbol: "plugin_invoke_stream",
      },
    ],
    schemasUsed: [
      {
        schemaName: "OMM.fbs",
        fileIdentifier: "$OMM",
        rootTypeName: "OMM",
      },
      createAlignedType({
        schemaName: "StateVector.fbs",
        fileIdentifier: "STVC",
        rootTypeName: "StateVector",
      }),
    ],
    methods: [
      {
        ...createTestManifest().methods[0],
        inputPorts: [
          {
            portId: "request",
            displayName: "Request",
            acceptedTypeSets: [
              {
                setId: "omm",
                description: "Canonical OMM input.",
                allowedTypes: [
                  {
                    schemaName: "OMM.fbs",
                    fileIdentifier: "$OMM",
                    rootTypeName: "OMM",
                  },
                ],
              },
            ],
            minStreams: 1,
            maxStreams: 2,
            required: true,
            description: "Propagation request stream.",
          },
        ],
        outputPorts: [
          {
            portId: "state",
            displayName: "State",
            acceptedTypeSets: [
              {
                setId: "state-vector",
                description: "FlatBuffer fallback plus aligned state vector.",
                allowedTypes: [
                  createFlatbufferType({ rootTypeName: "StateVector" }),
                  createAlignedType({ rootTypeName: "StateVector" }),
                ],
              },
            ],
            minStreams: 0,
            maxStreams: 1,
            required: false,
            description: "Propagated states.",
          },
        ],
        maxBatch: 64,
        drainPolicy: "drain-until-yield",
        description: "Propagate one batch of requests.",
      },
    ],
  };

  const encoded = encodePluginManifest(manifest);
  assert.equal(isPlgManifestBuffer(encoded), true);

  const decodedPlg = decodePlgManifest(encoded);
  assert.deepEqual(decodedPlg.invokeSurfaces, ["direct", "command"]);
  assert.deepEqual(decodedPlg.runtimeTargets, ["browser", "wasmedge"]);
  assert.equal(decodedPlg.methods[0].methodId, "propagate");
  assert.equal(decodedPlg.methods[0].maxBatch, 64);
  assert.equal(decodedPlg.methods[0].drainPolicy, "drain-until-yield");
  assert.equal(decodedPlg.methods[0].inputPorts[0].portId, "request");
  assert.equal(decodedPlg.methods[0].inputPorts[0].maxStreams, 2);
  assert.equal(
    decodedPlg.methods[0].outputPorts[0].acceptedTypeSets[0].allowedTypes[1]
      .wireFormat,
    "aligned-binary",
  );
  assert.equal(decodedPlg.hostCapabilities[0].capability, "clock");
  assert.equal(decodedPlg.hostCapabilities[1].capability, "protocol_handle");
  assert.equal(decodedPlg.hostCapabilities[1].scope, "sgp4");
  assert.equal(decodedPlg.timers[0].defaultIntervalMs, 60000n);
  assert.equal(decodedPlg.protocols[0].wireId, "/sdn/sgp4/1.0.0");
  assert.equal(decodedPlg.buildArtifacts[0].path, "dist/isomorphic/module.wasm");
  assert.equal(decodedPlg.schemasUsed[1].wireFormat, "aligned-binary");

  const decoded = decodePluginManifest(encoded);
  assert.deepEqual(decoded.methods, decodedPlg.methods);
  assert.deepEqual(decoded.protocols, decodedPlg.protocols);
  assert.deepEqual(decoded.buildArtifacts, decodedPlg.buildArtifacts);
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
  assert.equal(alignedType.schemaVersion, "1.0.0");
  assert.deepEqual(Array.from(alignedType.schemaHash), [0x10, 0x20, 0x30, 0x40]);
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

test("runtimeTargets round-trip through FlatBuffer encoding and embedded manifests", () => {
  const manifest = {
    ...createTestManifest(),
    runtimeTargets: ["browser", "wasmedge"],
  };
  const encoded = encodePluginManifest(manifest);
  const decoded = decodePluginManifest(encoded);
  assert.deepEqual(decoded.runtimeTargets, ["browser", "wasmedge"]);
  const embedded = toEmbeddedPluginManifest(manifest);
  assert.deepEqual(embedded.warnings, []);
  assert.deepEqual(embedded.manifest.runtimeTargets, ["browser", "wasmedge"]);
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

test("source compiler rejects a PLG port without its aligned representation before toolchain execution", async () => {
  const manifest = createTestManifest();
  manifest.methods[0].outputPorts[0].acceptedTypeSets[0].allowedTypes =
    manifest.methods[0].outputPorts[0].acceptedTypeSets[0].allowedTypes.filter(
      (typeRef) => typeRef.wireFormat === "flatbuffer",
    );

  await assert.rejects(
    () =>
      compileModuleFromSource({
        manifest,
        sourceCode: "int propagate(void) { return 7; }\n",
        language: "c",
      }),
    (error) =>
      error?.report?.errors?.some(
        (issue) => issue.code === "missing-aligned-peer",
      ) === true,
  );
});

test("source compiler rejects a paired non-SDS port before toolchain execution", async () => {
  const manifest = createTestManifest();
  manifest.methods[0].inputPorts[0].acceptedTypeSets = [
    createDualTypeSet(
      "unregistered-record",
      "UnregisteredRecord.fbs",
      "ZZZZ",
      "UnregisteredRecord",
    ),
  ];

  await assert.rejects(
    () =>
      compileModuleFromSource({
        manifest,
        sourceCode: "int propagate(void) { return 7; }\n",
        language: "c",
      }),
    (error) =>
      error?.report?.errors?.some(
        (issue) => issue.code === "unresolved-standards-type",
      ) === true,
  );
});

test("source compiler honors an explicit standards catalog for both validation passes", async () => {
  const manifest = createTestManifest({ versionedIdentity: true });
  const catalog = [
    {
      schemaCode: "OMM",
      schemaName: "OMM.fbs",
      fileIdentifier: "$OMM",
      rootTypeName: "OMM",
      version: "1.0.0",
      hash: "10203040",
      idl: "",
      files: [],
    },
    {
      schemaCode: "CAT",
      schemaName: "CAT.fbs",
      fileIdentifier: "$CAT",
      rootTypeName: "CAT",
      version: "1.0.0",
      hash: "10203040",
      idl: "",
      files: [],
    },
  ];

  const result = await compileModuleFromSource({
    manifest,
    sourceCode: "int propagate(void) { return 7; }\n",
    language: "c",
    catalog,
  });

  assert.equal(result.report.ok, true);
  assert.deepEqual(result.report.warnings, []);
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
  assert.ok(result.guestLink?.objectBytes.length > 0);
  assert.equal(
    result.guestLink?.methodSymbols?.propagate?.endsWith("propagate"),
    true,
  );
});

test("source compile records an explicit guest-link capability slice", async () => {
  const manifest = {
    ...createTestManifest(),
    capabilities: ["clock", "http"],
  };
  const result = await compileModuleFromSource({
    manifest,
    sourceCode: "int propagate(void) { return 7; }\n",
    language: "c",
    guestLinkCapabilities: ["http"],
  });

  assert.deepEqual(result.guestLink?.capabilities, ["http"]);
});

test("source compile emits growable memory for dense browser module outputs", async () => {
  const manifest = createTestManifest();
  const result = await compileModuleFromSource({
    manifest,
    sourceCode: "int propagate(void) { return 7; }\n",
    language: "c",
  });
  const wasmModule = new WebAssembly.Module(result.wasmBytes);
  const importModules = Array.from(
    new Set(WebAssembly.Module.imports(wasmModule).map((entry) => entry.module)),
  ).sort();
  const wasi = new WASI({
    version: "preview1",
    args: ["growable-memory"],
    env: {},
    preopens: {},
    returnOnExit: true,
  });
  const instance = await WebAssembly.instantiate(
    wasmModule,
    wasi.getImportObject(),
  );
  const memory = instance.exports.memory;

  assert.deepEqual(importModules, ["wasi_snapshot_preview1"]);
  assert.equal(memory instanceof WebAssembly.Memory, true);
  assert.doesNotThrow(() => memory.grow(1));
});

test("artifact compliance can validate a built module from its embedded PLG manifest bytes", async () => {
  const manifest = {
    ...createTestManifest(),
    capabilities: ["clock", "random"],
    methods: [
      {
        ...createTestManifest().methods[0],
        inputPorts: [
          {
            ...createTestManifest().methods[0].inputPorts[0],
            acceptedTypeSets: [
              createDualTypeSet(
                "versioned-record",
                "VersionedRecord.fbs",
                "VREC",
                "VersionedRecord",
                { identity: VERSIONED_TEST_IDENTITY },
              ),
            ],
          },
        ],
      },
    ],
  };
  const catalog = [
    {
      schemaCode: "VREC",
      schemaName: "VersionedRecord.fbs",
      fileIdentifier: "VREC",
      rootTypeName: "VersionedRecord",
      version: VERSIONED_TEST_IDENTITY.schemaVersion,
      hash: "10203040",
      idl: "",
      files: [],
    },
    {
      schemaCode: "CAT",
      schemaName: "CAT.fbs",
      fileIdentifier: "$CAT",
      rootTypeName: "CAT",
      version: null,
      hash: null,
      idl: "",
      files: [],
    },
  ];
  const result = await compileModuleFromSource({
    manifest,
    sourceCode: "int propagate(void) { return 7; }\n",
    language: "c",
    catalog,
  });
  const wasi = new WASI({
    version: "preview1",
    args: ["embedded-manifest"],
    env: {},
    preopens: {},
    returnOnExit: true,
  });
  const { instance } = await WebAssembly.instantiate(
    result.wasmBytes,
    wasi.getImportObject(),
  );
  const memory = instance.exports.memory;
  const manifestPtr = Number(instance.exports.plugin_get_manifest_flatbuffer());
  const manifestSize = Number(
    instance.exports.plugin_get_manifest_flatbuffer_size(),
  );
  const embeddedManifest = decodePlgManifest(
    new Uint8Array(memory.buffer, manifestPtr, manifestSize).slice(),
  );

  assert.equal(embeddedManifest.pluginId, manifest.pluginId);
  assert.equal(embeddedManifest.version, manifest.version);
  assert.deepEqual(
    embeddedManifest.capabilities.map((capability) => capability.name),
    manifest.capabilities,
  );
  const embeddedInputTypes =
    embeddedManifest.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes;
  assert.equal(embeddedInputTypes.length, 2);
  assert.deepEqual(
    embeddedInputTypes.map((typeRef) => ({
      schemaName: typeRef.schemaName,
      fileIdentifier: typeRef.fileIdentifier,
      schemaVersion: typeRef.schemaVersion,
      schemaHash: Array.from(typeRef.schemaHash ?? []),
      rootTypeName: typeRef.rootTypeName,
      wireFormat: typeRef.wireFormat,
      requiredAlignment: typeRef.requiredAlignment,
    })),
    [
      {
        schemaName: "VersionedRecord.fbs",
        fileIdentifier: "VREC",
        schemaVersion: "1.0.0",
        schemaHash: [0x10, 0x20, 0x30, 0x40],
        rootTypeName: "VersionedRecord",
        wireFormat: "flatbuffer",
        requiredAlignment: undefined,
      },
      {
        schemaName: "VersionedRecord.fbs",
        fileIdentifier: "VREC",
        schemaVersion: "1.0.0",
        schemaHash: [0x10, 0x20, 0x30, 0x40],
        rootTypeName: "VersionedRecord",
        wireFormat: "aligned-binary",
        requiredAlignment: 8,
      },
    ],
  );

  const validation = await validateArtifactWithStandards({
    manifest,
    wasmPath: result.outputPath,
    catalog,
  });
  assert.equal(validation.ok, true);
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
  assert.ok(result.guestLink?.objectBytes.length > 0);
  assert.ok(result.guestLink?.methodSymbols?.propagate);
});

test("source compilation uses production optimization flags for module objects", async () => {
  const source = await readFile(
    new URL("../src/compiler/compileModule.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /function buildSourceCompilerArgs\(options = \{\}\)/);
  assert.match(source, /"-O3"/);
  assert.match(source, /"-DNDEBUG"/);
  assert.doesNotMatch(source, /const args = \[\s+"-O2"/);
  assert.match(source, /sourceCompilerCommand,\s+"\-c",\s+sourcePath,[\s\S]*\.\.\.buildSourceCompilerArgs\(compileOptions\)/);
  assert.match(source, /sourcePath,[\s\S]*\.\.\.guestLink\.renameArgs,[\s\S]*\.\.\.buildSourceCompilerArgs\(compileOptions\)/);
});

test("wasmedge-targeted compile resolves to the pthread thread model", async (t) => {
  if (!wasiThreadsAvailable()) {
    t.skip("wasi-threads toolchain (wasm32-wasip1-threads) is not available.");
    return;
  }
  const manifest = {
    ...createTestManifest(),
    runtimeTargets: ["wasmedge"],
  };
  const result = await compileModuleFromSource({
    manifest,
    sourceCode:
      '#include <atomic>\n#include <thread>\n' +
      'extern "C" int propagate(void) {\n' +
      '  std::atomic<int> a{0};\n' +
      '  std::thread t([&]{ a.fetch_add(13, std::memory_order_seq_cst); });\n' +
      '  t.join();\n' +
      '  return a.load();\n' +
      '}\n',
    language: "c++",
  });

  assert.equal(result.threadModel, ModuleThreadModel.EMSCRIPTEN_PTHREADS);
  assert.equal(
    result.guestLink?.threadModel,
    ModuleThreadModel.EMSCRIPTEN_PTHREADS,
  );
  assert.match(result.compiler, /wasi-threads/i);
  assert.equal(result.report.ok, true);
});

test("wasmedge-targeted pthread builds emit the wasi-threads contract, not emscripten worker hooks", async (t) => {
  if (!wasiThreadsAvailable()) {
    t.skip("wasi-threads toolchain (wasm32-wasip1-threads) is not available.");
    return;
  }
  const manifest = {
    ...createTestManifest(),
    runtimeTargets: ["wasmedge"],
    invokeSurfaces: ["command"],
  };
  const result = await compileModuleFromSource({
    manifest,
    sourceCode:
      '#include <atomic>\n#include <thread>\n' +
      'extern "C" int propagate(void) {\n' +
      '  std::atomic<int> a{0};\n' +
      '  std::thread t([&]{ a.fetch_add(34, std::memory_order_seq_cst); });\n' +
      '  t.join();\n' +
      '  return a.load();\n' +
      '}\n',
    language: "c++",
  });

  const imports = WebAssembly.Module.imports(
    new WebAssembly.Module(result.wasmBytes),
  );

  assert.equal(result.threadModel, ModuleThreadModel.EMSCRIPTEN_PTHREADS);
  // The isomorphic wasi-threads contract: imports wasi.thread-spawn + shared
  // env.memory, exports wasi_thread_start, and imports NONE of Emscripten's
  // browser-only worker/mailbox hooks.
  assert.equal(result.threadFeatures.isIsomorphicPthreads, true);
  assert.equal(result.threadFeatures.hasWasiThreadSpawnImport, true);
  assert.equal(result.threadFeatures.hasWasiThreadStartExport, true);
  assert.deepEqual(result.threadFeatures.emscriptenThreadHooks, []);
  assert.ok(
    imports.some((entry) => entry.module === "env" && entry.name === "memory"),
  );
  assert.ok(
    imports.some(
      (entry) => entry.module === "wasi" && entry.name === "thread-spawn",
    ),
  );
  assert.ok(
    imports.every((entry) => entry.name !== "__pthread_create_js"),
  );
});

test("explicit threadModel overrides runtime-target inference", async () => {
  const manifest = {
    ...createTestManifest(),
    runtimeTargets: ["wasmedge"],
  };
  const result = await compileModuleFromSource({
    manifest,
    sourceCode: "int propagate(void) { return 21; }\n",
    language: "c",
    threadModel: ModuleThreadModel.SINGLE_THREAD,
  });

  assert.equal(result.threadModel, ModuleThreadModel.SINGLE_THREAD);
  assert.equal(result.guestLink?.threadModel, ModuleThreadModel.SINGLE_THREAD);
  assert.equal(result.compiler, "em++ (emception)");
  assert.equal(result.report.ok, true);
});

test("source compilation can emit an imported shared-memory browser artifact", async (t) => {
  if (typeof SharedArrayBuffer !== "function") {
    t.skip("SharedArrayBuffer is not available in this runtime.");
    return;
  }
  const emscriptenRoot = resolveSharedMemoryEmscriptenRoot();
  if (!emscriptenRoot) {
    t.skip("Repo-local Emscripten shared-memory toolchain is not available.");
    return;
  }

  const manifest = {
    ...createTestManifest(),
    runtimeTargets: ["browser"],
    invokeSurfaces: ["direct"],
  };
  const result = await compileModuleFromSource({
    manifest,
    sourceCode: "int propagate(void) { return 55; }\n",
    language: "c",
    importedMemory: true,
    sharedMemory: true,
    emscriptenRoot,
  });
  const imports = WebAssembly.Module.imports(
    new WebAssembly.Module(result.wasmBytes),
  );
  assert.deepEqual(
    imports.filter((entry) => entry.kind === "memory"),
    [{ module: "env", name: "memory", kind: "memory" }],
  );

  const harness = await createBrowserModuleHarness({
    wasmSource: result.wasmBytes,
    surface: "direct",
    sharedMemory: true,
    initialMemoryBytes: 64 * 1024 * 1024,
    maximumMemoryBytes: 2 * 1024 * 1024 * 1024,
  });
  t.after(() => {
    harness.destroy();
  });

  assert.equal(harness.memory.buffer instanceof SharedArrayBuffer, true);
  assert.equal(typeof harness.instance.exports.plugin_invoke_stream, "function");
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
  assert.ok(protectedArtifact.protectedArtifactBytes.length > 0);
  assert.ok(protectedArtifact.publicationNotice.cid.length > 0);
  assert.ok(protectedArtifact.encryptedEnvelope.protectedBlobBase64.length > 0);
  assert.ok(protectedArtifact.encryptedEnvelope.encRecordBase64.length > 0);
  assert.ok(protectedArtifact.encryptedEnvelope.pnmRecordBase64.length > 0);
});

test("publication protection honors fixed PNM metadata for reproducible records", async () => {
  const manifest = createTestManifest();
  const result = await compileModuleFromSource({
    manifest,
    sourceCode: "int propagate(void) { return 11; }\n",
    language: "c",
  });
  const protectionOptions = {
    manifest,
    wasmBytes: result.wasmBytes,
    artifactId: "reproducible-publication-record",
    mnemonic:
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    publishTimestamp: "2026-01-02T03:04:05.006Z",
  };

  const first = await protectModuleArtifact(protectionOptions);
  const second = await protectModuleArtifact(protectionOptions);

  assert.equal(
    first.publicationNotice.publishTimestamp,
    protectionOptions.publishTimestamp,
  );
  assert.equal(
    Buffer.from(first.publicationRecordsBytes).toString("hex"),
    Buffer.from(second.publicationRecordsBytes).toString("hex"),
  );
});

test("shared module and current OrbPro type refs resolve without warnings", async () => {
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
              createDualTypeSet(
                "tick",
                "TimerTick.fbs",
                "TICK",
                "TimerTick",
              ),
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
              createDualTypeSet(
                "state",
                "StateVector.fbs",
                "STVC",
                "StateVector",
              ),
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
        rootTypeName: "HttpRequest",
      },
      {
        schemaName: "OMM.fbs",
        fileIdentifier: "$OMM",
        rootTypeName: "OMM",
      },
      {
        schemaName: "PropagatorBatchRequest.fbs",
        fileIdentifier: "PROP",
        rootTypeName: "PropagatorBatchRequest",
      },
      {
        schemaName: "DetachedSignature.fbs",
        fileIdentifier: "SIGD",
        rootTypeName: "DetachedSignature",
      },
    ],
  };
  const report = await validateManifestWithStandards(manifest);
  assert.equal(report.ok, true);
  assert.deepEqual(report.warnings, []);
});

test("module-local stream type refs fail closed outside the standards catalog", async () => {
  const manifest = {
    pluginId: "com.digitalarsenal.examples.local-type-registry",
    name: "Local Type Registry Coverage",
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
            portId: "coverage",
            acceptedTypeSets: [
              createDualTypeSet(
                "local-metric",
                "LocalCoverageMetric.fbs",
                "LCM1",
                "LocalCoverageMetric",
              ),
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
      {
        schemaName: "LocalAccessRequest.fbs",
        fileIdentifier: "LAR1",
        rootTypeName: "LocalAccessRequest",
      },
      {
        schemaName: "LocalAccessResult.fbs",
        fileIdentifier: "LAS1",
        rootTypeName: "LocalAccessResult",
      },
      {
        schemaName: "LocalCoverageProduct.fbs",
        fileIdentifier: "LCP1",
        rootTypeName: "LocalCoverageProduct",
      },
    ],
  };
  const report = await validateManifestWithStandards(manifest);
  assert.equal(report.ok, false);
  assert.ok(report.errors.length >= 4);
  assert.equal(
    report.errors.every((error) => error.code === "unresolved-standards-type"),
    true,
  );
});

test("aligned current OrbPro-style stream type refs resolve without standards warnings", async () => {
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
        schemaName: "PropagatorBatchRequest.fbs",
        fileIdentifier: "PROP",
        rootTypeName: "PropagatorBatchRequest",
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
      (entry) => entry.schemaName === "OMM.fbs" && entry.fileIdentifier === "$OMM",
    ),
  );
});

test("reentry launch-ascent and hypersonics SDS type refs resolve without warnings", async () => {
  const catalog = await loadKnownTypeCatalog();
  for (const expected of [
    ["HFC.fbs", "$HFC"],
    ["REM.fbs", "$REM"],
    ["LAM.fbs", "$LAM"],
  ]) {
    assert.ok(
      catalog.some(
        (entry) =>
          entry.schemaName === expected[0] && entry.fileIdentifier === expected[1],
      ),
      `${expected[0]} should resolve from the standards catalog`,
    );
  }

  const manifest = {
    pluginId: "com.digitalarsenal.examples.reentry-launch-hypersonics-contract",
    name: "Reentry Launch Hypersonics Contract",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: [],
    externalInterfaces: [],
    invokeSurfaces: ["command"],
    methods: [
      {
        methodId: "query_atmosphere_state_batch",
        displayName: "Query Atmosphere State Batch",
        inputPorts: [
          {
            portId: "atmosphere",
            acceptedTypeSets: [
              {
                setId: "atm",
                ...createDualTypeSet("atm", "ATM.fbs", "$ATM", "ATM"),
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        outputPorts: [
          {
            portId: "conditions",
            acceptedTypeSets: [
              {
                setId: "hfc",
                ...createDualTypeSet("hfc", "HFC.fbs", "$HFC", "HFC"),
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        maxBatch: 1024,
        drainPolicy: "drain-to-empty",
      },
      {
        methodId: "evaluate_hypersonic_state_batch",
        displayName: "Evaluate Hypersonic State Batch",
        inputPorts: [
          {
            portId: "trajectory",
            acceptedTypeSets: [
              createDualTypeSet(
                "trajectory",
                "OEM.fbs",
                "$OEM",
                "OEM",
              ),
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
          {
            portId: "atmosphere",
            acceptedTypeSets: [
              {
                setId: "atm",
                ...createDualTypeSet("atm", "ATM.fbs", "$ATM", "ATM"),
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        outputPorts: [
          {
            portId: "conditions",
            acceptedTypeSets: [
              {
                setId: "hfc",
                ...createDualTypeSet("hfc", "HFC.fbs", "$HFC", "HFC"),
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        maxBatch: 1024,
        drainPolicy: "drain-to-empty",
      },
      {
        methodId: "simulate_reentry",
        displayName: "Simulate Reentry",
        inputPorts: [
          {
            portId: "reentry",
            acceptedTypeSets: [
              {
                setId: "rdm",
                ...createDualTypeSet("rdm", "RDM.fbs", "$RDM", "RDM"),
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        outputPorts: [
          {
            portId: "evaluation",
            acceptedTypeSets: [
              {
                setId: "rem",
                ...createDualTypeSet("rem", "REM.fbs", "$REM", "REM"),
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        maxBatch: 128,
        drainPolicy: "drain-to-empty",
      },
      {
        methodId: "simulate_launch_ascent",
        displayName: "Simulate Launch Ascent",
        inputPorts: [
          {
            portId: "launch",
            acceptedTypeSets: [
              {
                setId: "ldm",
                ...createDualTypeSet("ldm", "LDM.fbs", "$LDM", "LDM"),
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        outputPorts: [
          {
            portId: "ascent",
            acceptedTypeSets: [
              {
                setId: "lam",
                ...createDualTypeSet("lam", "LAM.fbs", "$LAM", "LAM"),
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        maxBatch: 128,
        drainPolicy: "drain-to-empty",
      },
    ],
    schemasUsed: [
      { schemaName: "ATM.fbs", fileIdentifier: "$ATM", rootTypeName: "ATM" },
      { schemaName: "HFC.fbs", fileIdentifier: "$HFC", rootTypeName: "HFC" },
      { schemaName: "REM.fbs", fileIdentifier: "$REM", rootTypeName: "REM" },
      { schemaName: "LAM.fbs", fileIdentifier: "$LAM", rootTypeName: "LAM" },
      { schemaName: "OCM.fbs", fileIdentifier: "$OCM", rootTypeName: "OCM" },
    ],
  };

  const report = await validateManifestWithStandards(manifest);
  assert.equal(report.ok, true);
  assert.deepEqual(report.warnings, []);
});

test("standards catalogs can load from an explicit standards root", async () => {
  const standardsRoot = await mkdtemp(path.join(os.tmpdir(), "sdn-standards-"));
  await mkdir(path.join(standardsRoot, "dist"));
  await writeFile(
    path.join(standardsRoot, "dist", "manifest.json"),
    JSON.stringify({
      STANDARDS: {
        TMX: {
          IDL: 'namespace spacedata;\ntable TMX {}\nroot_type TMX;\nfile_identifier "$TMX";\n',
          files: ["schema/TMX/main.fbs"],
        },
      },
    }),
  );

  const standardsCatalog = await loadStandardsCatalog({ standardsRoot });
  assert.ok(
    standardsCatalog.some(
      (entry) =>
        entry.schemaName === "TMX.fbs" && entry.fileIdentifier === "$TMX",
    ),
  );

  const manifest = createTestManifest();
  const tmxTypeSet = createDualTypeSet(
    "tmx",
    "TMX.fbs",
    "$TMX",
    "TMX",
    {
      identity: { schemaVersion: undefined, schemaHash: undefined },
      byteLength: 4,
      requiredAlignment: 4,
    },
  );
  manifest.methods[0].inputPorts[0].acceptedTypeSets = [tmxTypeSet];
  manifest.methods[0].outputPorts[0].acceptedTypeSets = [tmxTypeSet];
  manifest.schemasUsed = tmxTypeSet.allowedTypes;

  const report = await validateManifestWithStandards(manifest, { standardsRoot });
  assert.equal(
    report.warnings.some((warning) => warning.code === "unresolved-standards-type"),
    false,
  );

  const artifactReport = await validateArtifactWithStandards({
    manifest,
    standardsRoot,
  });
  assert.equal(
    artifactReport.warnings.some(
      (warning) => warning.code === "unresolved-standards-type",
    ),
    false,
  );

  const mismatchedManifest = structuredClone(manifest);
  for (const direction of ["inputPorts", "outputPorts"]) {
    for (const typeRef of mismatchedManifest.methods[0][direction][0]
      .acceptedTypeSets[0].allowedTypes) {
      typeRef.fileIdentifier = "$BAD";
    }
  }
  const mismatchedReport = await validateManifestWithStandards(
    mismatchedManifest,
    { standardsRoot },
  );
  assert.equal(mismatchedReport.ok, false);
  assert.ok(
    mismatchedReport.errors.some(
      (issue) => issue.code === "standards-type-identity-mismatch",
    ),
    JSON.stringify(mismatchedReport.issues),
  );

  for (const [field, value] of [
    ["schemaName", "tmx.fbs"],
    ["fileIdentifier", "$tmx"],
  ]) {
    const caseChangedManifest = structuredClone(manifest);
    for (const direction of ["inputPorts", "outputPorts"]) {
      for (const typeRef of caseChangedManifest.methods[0][direction][0]
        .acceptedTypeSets[0].allowedTypes) {
        typeRef[field] = value;
      }
    }
    for (const typeRef of caseChangedManifest.schemasUsed) {
      typeRef[field] = value;
    }
    const caseChangedReport = await validateManifestWithStandards(
      caseChangedManifest,
      { standardsRoot },
    );
    assert.equal(caseChangedReport.ok, false, `${field} must be case-exact`);
    assert.ok(
      caseChangedReport.errors.some(
        (issue) => issue.code === "standards-type-identity-mismatch",
      ),
      JSON.stringify(caseChangedReport.issues),
    );
  }
});

test("standards validation treats every empty schema-hash encoding as absent", async () => {
  const catalog = [
    {
      schemaCode: "TST",
      schemaName: "TestRecord.fbs",
      fileIdentifier: "TSTR",
      rootTypeName: "TestRecord",
      hash: "10203040",
      version: null,
      idl: "",
      files: [],
    },
  ];

  for (const schemaHash of [undefined, [], new Uint8Array(), "", "0x"]) {
    const manifest = createTestManifest();
    const typeSet = createDualTypeSet(
      "test-record",
      "TestRecord.fbs",
      "TSTR",
      "TestRecord",
      { identity: { schemaHash } },
    );
    manifest.methods[0].inputPorts[0].acceptedTypeSets = [typeSet];
    manifest.methods[0].outputPorts[0].acceptedTypeSets = [typeSet];

    const report = await validateManifestWithStandards(manifest, { catalog });
    assert.equal(report.ok, true, JSON.stringify(report.issues));
  }
});

test("standards validation fails closed for stale SCV generated bindings", async () => {
  const standardsRoot = await mkdtemp(path.join(os.tmpdir(), "sdn-stale-scv-"));
  await mkdir(path.join(standardsRoot, "dist"));
  await writeFile(
    path.join(standardsRoot, "dist", "manifest.json"),
    JSON.stringify({
      STANDARDS: {
        SCV: {
          IDL: [
            "// Hash: stale",
            "// Version: 1.101.3",
            "// -----------------------------------END_HEADER",
            "enum scvEnvelopeKind : ubyte { REQUEST, RESULT }",
            "enum scvSensorShapeKind : ubyte { CONIC, RECTANGULAR, CUSTOM_POLYGON, SAR_ANNULAR_SECTOR }",
            "table SCVResult { MESSAGE:string; }",
            "table SCV { RESULT:SCVResult; }",
            "root_type SCV;",
            'file_identifier "$SCV";',
            "",
          ].join("\n"),
          files: ["schema/SCV/main.fbs"],
        },
      },
    }),
  );

  const manifest = createTestManifest();
  manifest.schemasUsed = [{ schemaName: "SCV.fbs", fileIdentifier: "$SCV" }];

  const report = await validateManifestWithStandards(manifest, {
    standardsRoot,
  });

  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((error) => error.code === "stale-scv-contract"),
    "stale SCV contracts must be compliance errors",
  );
});

test("standards validation rejects unsupported SCV coverage result fields", async () => {
  const standardsRoot = await mkdtemp(
    path.join(os.tmpdir(), "sdn-unsupported-scv-"),
  );
  await mkdir(path.join(standardsRoot, "dist"));
  await writeFile(
    path.join(standardsRoot, "dist", "manifest.json"),
    JSON.stringify({
      STANDARDS: {
        SCV: {
          IDL: [
            "// Hash: unsupported-result-field",
            "// Version: 1.101.9",
            "// -----------------------------------END_HEADER",
            "enum scvEnvelopeKind : ubyte { REQUEST, RESULT }",
            "enum scvSensorShapeKind : ubyte { CONIC, RECTANGULAR, CUSTOM_POLYGON, SAR_ANNULAR_SECTOR }",
            "enum scvCoordinateFrame : ubyte { SENSOR_LOCAL }",
            "enum scvSensorRangeBoundaryKind : ubyte { RADIAL_SPHERICAL, LOCAL_Z_PLANE }",
            "enum scvRasterProductKind : ushort { PERCENT_COVERAGE, PASS_COUNT }",
            "table SCVSensorShapeContract { SHAPE_KIND:scvSensorShapeKind; }",
            "table SCVAggregateStatistics { TOTAL_CELLS:uint32; }",
            "table SCVPackedRasterBand { PRODUCT_KIND:scvRasterProductKind; }",
            "table SCVPackedRasterProducts { BANDS:[SCVPackedRasterBand]; }",
            [
              "table SCVResult {",
              "  MESSAGE:string;",
              "  RASTER_PRODUCTS:SCVPackedRasterProducts;",
              "  AGGREGATE_STATISTICS:SCVAggregateStatistics;",
              "  UNSUPPORTED_FIELD:uint32;",
              "}",
            ].join("\n"),
            "table SCV { RESULT:SCVResult; RASTER_PRODUCTS:SCVPackedRasterProducts; }",
            "root_type SCV;",
            'file_identifier "$SCV";',
            "",
          ].join("\n"),
          files: ["schema/SCV/main.fbs"],
        },
      },
    }),
  );

  const manifest = createTestManifest();
  manifest.schemasUsed = [{ schemaName: "SCV.fbs", fileIdentifier: "$SCV" }];

  const report = await validateManifestWithStandards(manifest, {
    standardsRoot,
  });

  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some(
      (error) =>
        error.code === "stale-scv-contract" &&
        error.message.includes("UNSUPPORTED_FIELD"),
    ),
    "unsupported SCV result fields must be compliance errors",
  );
});

test("default standards dependency exposes the current SCV coverage result contract", async () => {
  const catalog = await loadStandardsCatalog();
  const scv = catalog.find((entry) => entry.schemaCode === "SCV");
  assert.ok(scv, "SCV must be present in the installed SDS catalog");
  assert.match(scv.version, /^1\.101\.[6-9]\d*$/);
  assert.match(scv.idl, /\bSENSOR_LOCAL\b/);
  assert.match(scv.idl, /\btable SCVAggregateStatistics\b/);
  assert.match(scv.idl, /\bAGGREGATE_STATISTICS:SCVAggregateStatistics\b/);
  assert.match(scv.idl, /\btable SCVPackedRasterProducts\b/);
  assert.match(scv.idl, /\bRASTER_PRODUCTS:SCVPackedRasterProducts\b/);
  const resultTable = scv.idl.match(/\btable\s+SCVResult\s*\{([\s\S]*?)\n\}/);
  assert.ok(resultTable, "SCVResult table must be present");
  const actualFields = resultTable[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .map((line) => line.match(/^([A-Z0-9_]+)\s*:/)?.[1] ?? null)
    .filter(Boolean)
    .sort();
  assert.deepEqual(actualFields, [
    "AGGREGATE_STATISTICS",
    "CELL_STATS",
    "CONTRIBUTIONS",
    "GEOMETRY",
    "HISTOGRAMS",
    "INTERVALS",
    "JOB_ID",
    "LATITUDE_BANDS",
    "MESSAGE",
    "RASTER_PRODUCTS",
    "STATUS",
    "TARGET_BODY",
    "TIME_GRID",
    "TIME_SERIES",
    "TOTAL_SENSORS",
    "TOTAL_WINDOWS",
    "TRACE_ID",
  ]);
});
