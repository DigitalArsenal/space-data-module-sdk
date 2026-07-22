import test from "node:test";
import assert from "node:assert/strict";
import { FlatcRunner } from "flatc-wasm";

import {
  validatePluginManifest,
  validatePluginArtifact,
} from "../src/compliance/pluginCompliance.js";
import { validateManifestWithStandards } from "../src/compliance/index.js";

function createValidManifest() {
  return {
    pluginId: "com.test.validator",
    name: "Validator Test",
    version: "1.0.0",
    pluginFamily: "analysis",
    capabilities: ["clock"],
    externalInterfaces: [],
    methods: [
      {
        methodId: "run",
        displayName: "Run",
        inputPorts: [
          {
            portId: "in",
            acceptedTypeSets: [
              createExactDualFormatTypeSet({
                setId: "omm",
                schemaName: "OMM.fbs",
                fileIdentifier: "$OMM",
                rootTypeName: "OMM",
              }),
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        outputPorts: [
          {
            portId: "out",
            acceptedTypeSets: [
              createExactDualFormatTypeSet({
                setId: "cat",
                schemaName: "CAT.fbs",
                fileIdentifier: "$CAT",
                rootTypeName: "CAT",
              }),
            ],
            minStreams: 0,
            maxStreams: 1,
            required: false,
          },
        ],
        maxBatch: 1,
        drainPolicy: "drain-to-empty",
      },
    ],
  };
}

function createAlignedAllowedType(overrides = {}) {
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

function createFlatbufferAllowedType(overrides = {}) {
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

function createDualFormatTypeSet(overrides = {}) {
  const alignedType = createAlignedAllowedType(overrides);
  return {
    setId: "state-vector",
    allowedTypes: [
      createFlatbufferAllowedType({
        schemaName: alignedType.schemaName,
        fileIdentifier: alignedType.fileIdentifier,
        schemaVersion: alignedType.schemaVersion,
        schemaHash: alignedType.schemaHash,
        rootTypeName: alignedType.rootTypeName,
      }),
      alignedType,
    ],
  };
}

function createExactDualFormatTypeSet({
  setId = "state-vector",
  schemaName = "StateVector.fbs",
  fileIdentifier = "STVC",
  schemaVersion = "1.0.0",
  schemaHash = [0x10, 0x20, 0x30, 0x40],
  rootTypeName = "StateVector",
  byteLength = 64,
  fixedStringLength,
  requiredAlignment = 8,
} = {}) {
  const identity = {
    schemaName,
    fileIdentifier,
    schemaVersion,
    schemaHash,
    rootTypeName,
  };
  return {
    setId,
    allowedTypes: [
      { ...identity, wireFormat: "flatbuffer" },
      {
        ...identity,
        wireFormat: "aligned-binary",
        byteLength,
        ...(fixedStringLength === undefined ? {} : { fixedStringLength }),
        requiredAlignment,
      },
    ],
  };
}

function createDualPortManifest() {
  const manifest = createValidManifest();
  manifest.methods[0].inputPorts[0].acceptedTypeSets = [
    createExactDualFormatTypeSet({
      setId: "omm",
      schemaName: "OMM.fbs",
      fileIdentifier: "$OMM",
      rootTypeName: "OMM",
    }),
  ];
  manifest.methods[0].outputPorts[0].acceptedTypeSets = [
    createExactDualFormatTypeSet({
      setId: "cat",
      schemaName: "CAT.fbs",
      fileIdentifier: "$CAT",
      rootTypeName: "CAT",
    }),
  ];
  return manifest;
}

let generatedAlignedFallbackTypePromise = null;

async function createFlatcWasmAlignedAllowedType(overrides = {}) {
  if (!generatedAlignedFallbackTypePromise) {
    generatedAlignedFallbackTypePromise = (async () => {
      const flatc = await FlatcRunner.init();
      const { layouts } = await flatc.generateAlignedCode(
        {
          entry: "aligned-vector-test.fbs",
          files: {
            "aligned-vector-test.fbs": `
              namespace SDS.Test;
              file_identifier "AVEC";
              struct Cartesian3 {
                x:double;
                y:double;
                z:double;
              }
              table Cartesian3Envelope {
                value:Cartesian3;
              }
              root_type Cartesian3Envelope;
            `,
          },
        },
        { defaultStringLength: 255 },
      );
      const layout = layouts.Cartesian3;
      if (!layout) {
        throw new Error("flatc-wasm did not return a Cartesian3 aligned layout");
      }
      return {
        schemaName: "AlignedVectorTest.fbs",
        fileIdentifier: "AVEC",
        wireFormat: "aligned-binary",
        rootTypeName: "Cartesian3",
        byteLength: layout.size,
        requiredAlignment: layout.align,
      };
    })();
  }
  return {
    ...(await generatedAlignedFallbackTypePromise),
    ...overrides,
  };
}

function createHostedProtocol(overrides = {}) {
  return {
    protocolId: "sgp4-stream",
    methodId: "run",
    inputPortId: "in",
    outputPortId: "out",
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

// --- Positive baseline ---

test("valid manifest passes validation", () => {
  const report = validatePluginManifest(createValidManifest());
  assert.equal(report.ok, true);
  assert.equal(report.errors.length, 0);
});

test("invokeSurfaces must be an array when present", () => {
  const m = createValidManifest();
  m.invokeSurfaces = "direct";
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "invalid-invoke-surfaces"));
});

test("unknown invoke surface produces error", () => {
  const m = createValidManifest();
  m.invokeSurfaces = ["rpc"];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "unknown-invoke-surface"));
});

// --- Top-level structure errors ---

test("null manifest produces error", () => {
  const report = validatePluginManifest(null);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "invalid-manifest"));
});

test("array manifest produces error", () => {
  const report = validatePluginManifest([1, 2, 3]);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "invalid-manifest"));
});

// --- Missing required string fields ---

test("missing pluginId produces error", () => {
  const m = createValidManifest();
  delete m.pluginId;
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "missing-string"));
});

test("empty name produces error", () => {
  const m = createValidManifest();
  m.name = "   ";
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "missing-string"));
});

test("missing version produces error", () => {
  const m = createValidManifest();
  delete m.version;
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
});

test("missing pluginFamily produces error", () => {
  const m = createValidManifest();
  delete m.pluginFamily;
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
});

// --- Methods ---

test("empty methods array produces error", () => {
  const m = createValidManifest();
  m.methods = [];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "missing-methods"));
});

test("missing methods key produces error", () => {
  const m = createValidManifest();
  delete m.methods;
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "missing-methods"));
});

test("duplicate methodId produces error", () => {
  const m = createValidManifest();
  m.methods.push({ ...m.methods[0] });
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "duplicate-method-id"));
});

test("method entry that is not an object produces error", () => {
  const m = createValidManifest();
  m.methods.push("not-an-object");
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "invalid-method"));
});

// --- Ports ---

test("missing inputPorts produces error", () => {
  const m = createValidManifest();
  delete m.methods[0].inputPorts;
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "missing-input-ports"));
});

test("missing outputPorts produces error", () => {
  const m = createValidManifest();
  delete m.methods[0].outputPorts;
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "missing-output-ports"));
});

test("maxStreams less than minStreams produces error", () => {
  const m = createValidManifest();
  m.methods[0].inputPorts[0].minStreams = 5;
  m.methods[0].inputPorts[0].maxStreams = 1;
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "stream-range"));
});

test("non-integer minStreams produces error", () => {
  const m = createValidManifest();
  m.methods[0].inputPorts[0].minStreams = 1.5;
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "invalid-integer"));
});

test("negative maxStreams produces error", () => {
  const m = createValidManifest();
  m.methods[0].inputPorts[0].maxStreams = -1;
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "integer-range"));
});

// --- Drain policy ---

test("invalid drainPolicy produces error", () => {
  const m = createValidManifest();
  m.methods[0].drainPolicy = "invalid-policy";
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "invalid-drain-policy"));
});

test("missing drainPolicy produces error", () => {
  const m = createValidManifest();
  delete m.methods[0].drainPolicy;
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "missing-drain-policy"));
});

// --- Accepted type sets ---

test("empty allowedTypes produces error", () => {
  const m = createValidManifest();
  m.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes = [];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "missing-allowed-types"));
});

test("allowed type without any identity field produces error", () => {
  const m = createValidManifest();
  m.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes = [{}];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "missing-type-identity"));
});

test("acceptsAnyFlatbuffer is rejected on mandatory paired ABI ports", () => {
  const m = createValidManifest();
  m.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes = [
    { acceptsAnyFlatbuffer: true },
  ];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "wildcard-port-type"));
});

test("aligned-binary type requires a regular flatbuffer fallback in the same type set", async () => {
  const m = createValidManifest();
  m.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes = [
    await createFlatcWasmAlignedAllowedType(),
  ];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "missing-flatbuffer-fallback"));
});

test("aligned-binary type passes with required layout fields and a regular fallback", async () => {
  const alignedType = await createFlatcWasmAlignedAllowedType();
  const m = createValidManifest();
  m.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes = [
    createFlatbufferAllowedType({
      schemaName: alignedType.schemaName,
      fileIdentifier: alignedType.fileIdentifier,
      schemaVersion: alignedType.schemaVersion,
      schemaHash: alignedType.schemaHash,
      rootTypeName: alignedType.rootTypeName,
    }),
    alignedType,
  ];
  m.schemasUsed = [alignedType];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, true);
});

test("aligned-binary type rejects acceptsAnyFlatbuffer", () => {
  const m = createValidManifest();
  m.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes = [
    createAlignedAllowedType({ acceptsAnyFlatbuffer: true }),
  ];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some(
      (e) => e.code === "accepts-any-flatbuffer-format-conflict",
    ),
  );
});

test("aligned-binary type requires rootTypeName", () => {
  const m = createValidManifest();
  m.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes = [
    createAlignedAllowedType({ rootTypeName: undefined }),
  ];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((e) => e.code === "missing-aligned-root-type-name"),
  );
});

test("aligned-binary type requires positive byteLength for its fixed inline layout", () => {
  const missing = createValidManifest();
  missing.methods[0].inputPorts[0].acceptedTypeSets[0] = createDualFormatTypeSet({
    byteLength: undefined,
  });
  const missingReport = validatePluginManifest(missing);
  assert.equal(missingReport.ok, false);
  assert.ok(
    missingReport.errors.some(
      (e) =>
        e.code === "invalid-integer" &&
        e.location?.endsWith(".byteLength"),
    ),
  );

  const zero = createValidManifest();
  zero.methods[0].inputPorts[0].acceptedTypeSets[0] = createDualFormatTypeSet({
    byteLength: 0,
  });
  const zeroReport = validatePluginManifest(zero);
  assert.equal(zeroReport.ok, false);
  assert.ok(
    zeroReport.errors.some(
      (e) =>
        e.code === "integer-range" &&
        e.location?.endsWith(".byteLength"),
    ),
  );
});

test("aligned-binary type requires positive requiredAlignment", () => {
  const missing = createValidManifest();
  missing.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes = [
    createAlignedAllowedType({ requiredAlignment: undefined }),
  ];
  const missingReport = validatePluginManifest(missing);
  assert.equal(missingReport.ok, false);
  assert.ok(
    missingReport.errors.some(
      (e) =>
        e.code === "invalid-integer" &&
        e.location?.endsWith(".requiredAlignment"),
    ),
  );

  const zero = createValidManifest();
  zero.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes = [
    createAlignedAllowedType({ requiredAlignment: 0 }),
  ];
  const zeroReport = validatePluginManifest(zero);
  assert.equal(zeroReport.ok, false);
  assert.ok(
    zeroReport.errors.some(
      (e) =>
        e.code === "integer-range" &&
        e.location?.endsWith(".requiredAlignment"),
    ),
  );
});

test("aligned layout metadata must fit the canonical TAB integer widths", async (t) => {
  for (const [name, field, value] of [
    ["fixedStringLength uint16 overflow", "fixedStringLength", 0x1_0000],
    ["byteLength uint32 overflow", "byteLength", 0x1_0000_0000],
    ["requiredAlignment uint16 overflow", "requiredAlignment", 0x1_0000],
  ]) {
    await t.test(name, () => {
      const manifest = createDualPortManifest();
      const alignedType = manifest.methods[0].inputPorts[0]
        .acceptedTypeSets[0].allowedTypes.find(
          (typeRef) => typeRef.wireFormat === "aligned-binary",
        );
      alignedType[field] = value;

      const report = validatePluginManifest(manifest);

      assert.equal(report.ok, false);
      assert.ok(
        report.errors.some(
          (issue) =>
            issue.code === "integer-range" &&
            issue.location?.endsWith(`.${field}`),
        ),
        JSON.stringify(report.issues),
      );
    });
  }
});

test("schemaHash byte arrays are accepted as a paired identity field", () => {
  const m = createValidManifest();
  m.methods[0].inputPorts[0].acceptedTypeSets = [
    createExactDualFormatTypeSet({
      schemaHash: [0xde, 0xad, 0xbe, 0xef],
    }),
  ];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, true);
});

test("schemaHash hex strings and byte arrays identify the same SDS schema", () => {
  const manifest = createDualPortManifest();
  const [canonical, aligned] =
    manifest.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes;
  canonical.schemaHash = "0xdeadbeef";
  aligned.schemaHash = [0xde, 0xad, 0xbe, 0xef];

  const report = validatePluginManifest(manifest);

  assert.equal(report.ok, true, JSON.stringify(report.issues));
});

test("schemaHash rejects malformed hex and invalid byte values", async (t) => {
  const invalidHashes = [
    ["odd-length hex", "abc"],
    ["non-hex string", "0xnothex"],
    ["byte above 255", [0, 256]],
    ["negative byte", [-1, 0]],
    ["fractional byte", [1.5, 2]],
  ];

  for (const [name, invalidHash] of invalidHashes) {
    await t.test(name, () => {
      const manifest = createDualPortManifest();
      manifest.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes[0]
        .schemaHash = invalidHash;

      const report = validatePluginManifest(manifest);

      assert.equal(report.ok, false);
      assert.ok(
        report.errors.some((issue) => issue.code === "invalid-schema-hash"),
        JSON.stringify(report.issues),
      );
    });
  }
});

test("paired type refs require an exact four-byte printable file identifier", async (t) => {
  for (const [name, fileIdentifier] of [
    ["too short", "ABC"],
    ["too long", "ABCDE"],
    ["multi-byte Unicode", "éABC"],
    ["control byte", "A\nBC"],
  ]) {
    await t.test(name, () => {
      const manifest = createDualPortManifest();
      for (const typeRef of manifest.methods[0].inputPorts[0]
        .acceptedTypeSets[0].allowedTypes) {
        typeRef.fileIdentifier = fileIdentifier;
      }

      const report = validatePluginManifest(manifest);

      assert.equal(report.ok, false);
      assert.ok(
        report.errors.some(
          (issue) => issue.code === "invalid-file-identifier",
        ),
        JSON.stringify(report.issues),
      );
    });
  }
});

test("explicit allowedWireFormats cannot remove either required representation", () => {
  const manifest = createDualPortManifest();
  manifest.methods[0].inputPorts[0].acceptedTypeSets[0].allowedWireFormats = [
    "aligned-binary",
  ];

  const report = validatePluginManifest(manifest);

  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some(
      (issue) => issue.code === "allowed-wire-formats-mismatch",
    ),
    JSON.stringify(report.issues),
  );
});

test("canonical PLG graph records are validated instead of silently discarded", () => {
  const manifest = createDualPortManifest();
  manifest.flowNodes = [
    { nodeId: "source", pluginId: "com.test.source", methodId: "run" },
  ];
  manifest.flowEdges = [
    {
      edgeId: "broken",
      fromNodeId: "source",
      toNodeId: "missing",
      toPortId: "in",
    },
  ];

  const report = validatePluginManifest(manifest);

  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((issue) => issue.code === "invalid-flow-edge"),
    JSON.stringify(report.issues),
  );
  assert.ok(
    report.errors.some((issue) => issue.code === "unknown-flow-node"),
    JSON.stringify(report.issues),
  );
});

test("dual-representation contract rejects canonical-only input and output ports", async (t) => {
  for (const direction of ["inputPorts", "outputPorts"]) {
    await t.test(direction, () => {
      const manifest = createDualPortManifest();
      const typeSet = manifest.methods[0][direction][0].acceptedTypeSets[0];
      typeSet.allowedTypes = typeSet.allowedTypes.filter(
        (typeRef) => typeRef.wireFormat === "flatbuffer",
      );

      const report = validatePluginManifest(manifest);

      assert.equal(report.ok, false);
      assert.ok(
        report.errors.some((issue) => issue.code === "missing-aligned-peer"),
        JSON.stringify(report.issues),
      );
    });
  }
});

test("dual-representation contract rejects every mismatched paired identity field", async (t) => {
  const mismatches = [
    ["schemaName", "Different.fbs"],
    ["fileIdentifier", "DIFF"],
    ["schemaVersion", "2.0.0"],
    ["schemaHash", [0xaa, 0xbb, 0xcc, 0xdd]],
    ["rootTypeName", "DifferentRoot"],
  ];

  for (const [field, value] of mismatches) {
    await t.test(field, () => {
      const manifest = createDualPortManifest();
      const aligned =
        manifest.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes[1];
      aligned[field] = value;

      const report = validatePluginManifest(manifest);

      assert.equal(report.ok, false);
      assert.ok(
        report.errors.some(
          (issue) => issue.code === "paired-type-identity-mismatch",
        ),
        JSON.stringify(report.issues),
      );
    });
  }
});

test("dual-representation contract rejects wildcard port types", () => {
  const manifest = createDualPortManifest();
  manifest.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes = [
    { acceptsAnyFlatbuffer: true },
  ];

  const report = validatePluginManifest(manifest);

  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((issue) => issue.code === "wildcard-port-type"),
    JSON.stringify(report.issues),
  );
});

test("dual-representation contract rejects multiple accepted type sets per port", () => {
  const manifest = createDualPortManifest();
  manifest.methods[0].inputPorts[0].acceptedTypeSets.push(
    createExactDualFormatTypeSet({ setId: "second" }),
  );

  const report = validatePluginManifest(manifest);

  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some(
      (issue) => issue.code === "invalid-accepted-type-set-count",
    ),
    JSON.stringify(report.issues),
  );
});

test("dual-representation contract requires root type on the canonical peer", () => {
  const manifest = createDualPortManifest();
  delete manifest.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes[0]
    .rootTypeName;

  const report = validatePluginManifest(manifest);

  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some(
      (issue) => issue.code === "missing-canonical-root-type-name",
    ),
    JSON.stringify(report.issues),
  );
});

test("dual-representation contract rejects non-power-of-two alignment", () => {
  const manifest = createDualPortManifest();
  manifest.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes[1]
    .requiredAlignment = 3;

  const report = validatePluginManifest(manifest);

  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((issue) => issue.code === "invalid-aligned-layout"),
    JSON.stringify(report.issues),
  );
});

// --- Capabilities ---

test("missing capabilities array produces warning", () => {
  const m = createValidManifest();
  delete m.capabilities;
  const report = validatePluginManifest(m);
  assert.ok(report.warnings.some((w) => w.code === "missing-capabilities-array"));
});

test("duplicate capability produces warning", () => {
  const m = createValidManifest();
  m.capabilities = ["clock", "clock"];
  const report = validatePluginManifest(m);
  assert.ok(report.warnings.some((w) => w.code === "duplicate-capability"));
});

test("non-canonical capability produces warning", () => {
  const m = createValidManifest();
  m.capabilities = ["some_custom_capability"];
  const report = validatePluginManifest(m);
  assert.ok(report.warnings.some((w) => w.code === "noncanonical-capability"));
});

test("gpu_compute is a canonical optional host capability", () => {
  const m = createValidManifest();
  m.runtimeTargets = ["browser", "wasmedge"];
  m.capabilities = [
    "clock",
    {
      capability: "gpu_compute",
      scope: "webgpu.v1",
      required: false,
    },
  ];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, true);
  assert.equal(
    report.warnings.some((w) => w.code === "noncanonical-capability"),
    false,
  );
});

test("non-string capability produces error", () => {
  const m = createValidManifest();
  m.capabilities = [123];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "invalid-capability"));
});

test("browser runtime target rejects browser-impossible capabilities", () => {
  const m = createValidManifest();
  m.runtimeTargets = ["browser"];
  m.capabilities = ["http", "process_exec"];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((e) => e.code === "capability-runtime-conflict"),
  );
});

test("browser runtime target accepts browser-safe capabilities", () => {
  const m = createValidManifest();
  m.runtimeTargets = ["browser"];
  m.capabilities = [
    "clock",
    "random",
    "timers",
    "filesystem",
    "http",
    "websocket",
    "crypto_sign",
  ];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, true);
});

test("browser runtime target accepts the generic opaque storage adapter", () => {
  const m = createValidManifest();
  m.runtimeTargets = ["browser", "wasmedge"];
  m.capabilities = ["storage_adapter"];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.equal(
    report.errors.some((error) => error.code === "capability-runtime-conflict"),
    false,
  );
});

test("wasi runtime target rejects capabilities that need host wrappers", () => {
  const m = createValidManifest();
  m.runtimeTargets = ["wasi"];
  m.invokeSurfaces = ["command"];
  m.capabilities = ["clock", "filesystem", "http", "schedule_cron"];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((e) => e.code === "capability-wasi-standalone-conflict"),
  );
});

test("wasi runtime target requires command surface", () => {
  const m = createValidManifest();
  m.runtimeTargets = ["wasi"];
  m.invokeSurfaces = ["direct"];
  m.capabilities = ["clock", "logging"];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((e) => e.code === "missing-wasi-command-surface"),
  );
});

test("wasi runtime target rejects non-wasi protocol transports", () => {
  const m = createValidManifest();
  m.runtimeTargets = ["wasi"];
  m.invokeSurfaces = ["command"];
  m.capabilities = ["logging", "pipe"];
  m.protocols = [
    {
      protocolId: "svc",
      methodId: "doThing",
      inputPortId: "in",
      outputPortId: "out",
      wireId: "/sdn/test/1.0.0",
      transportKind: "libp2p",
      role: "handle",
    },
  ];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((e) => e.code === "protocol-wasi-standalone-conflict"),
  );
});

test("wasi runtime target accepts standalone-wasi capability subset", () => {
  const m = createValidManifest();
  m.runtimeTargets = ["wasi"];
  m.invokeSurfaces = ["command"];
  m.capabilities = ["logging", "clock", "random", "filesystem", "pipe"];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, true);
});

test("invalid runtimeTargets type produces error", () => {
  const m = createValidManifest();
  m.runtimeTargets = "browser";
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "invalid-runtime-targets"));
});

test("duplicate runtime target produces warning", () => {
  const m = createValidManifest();
  m.runtimeTargets = ["node", "node"];
  const report = validatePluginManifest(m);
  assert.ok(report.warnings.some((w) => w.code === "duplicate-runtime-target"));
});

test("wasmedge runtime target is canonical", () => {
  const m = createValidManifest();
  m.runtimeTargets = ["wasmedge"];
  const report = validatePluginManifest(m);
  assert.equal(
    report.warnings.some((w) => w.code === "noncanonical-runtime-target"),
    false,
  );
});

// --- External interfaces ---

test("external interface with unknown kind produces warning", () => {
  const m = createValidManifest();
  m.externalInterfaces = [
    {
      interfaceId: "ext1",
      kind: "unknown_kind",
      direction: "inbound",
      capability: "clock",
    },
  ];
  const report = validatePluginManifest(m);
  assert.ok(report.warnings.some((w) => w.code === "unknown-interface-kind"));
});

test("external interface with undeclared capability produces error", () => {
  const m = createValidManifest();
  m.externalInterfaces = [
    {
      interfaceId: "ext1",
      kind: "http",
      direction: "inbound",
      capability: "not_declared",
    },
  ];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "undeclared-interface-capability"));
});

test("external interface missing direction produces error", () => {
  const m = createValidManifest();
  m.externalInterfaces = [
    {
      interfaceId: "ext1",
      kind: "http",
      capability: "clock",
    },
  ];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "missing-interface-direction"));
});

// --- Timers and protocols ---

test("timer requires declared timers capability and valid method/inputPort references", () => {
  const m = createValidManifest();
  m.capabilities = ["clock"];
  m.timers = [
    {
      timerId: "tick",
      methodId: "run",
      inputPortId: "in",
      defaultIntervalMs: 1000,
    },
  ];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "undeclared-timer-capability"));
});

test("timer with unknown method produces error", () => {
  const m = createValidManifest();
  m.capabilities = ["timers"];
  m.timers = [
    {
      timerId: "tick",
      methodId: "missing",
      defaultIntervalMs: 1000,
    },
  ];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "unknown-timer-method"));
});

test("protocol requires declared protocol capability and valid port references", () => {
  const m = createValidManifest();
  m.capabilities = ["http"];
  m.protocols = [createHostedProtocol()];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "undeclared-protocol-capability"));
});

test("valid timer and protocol declarations pass compliance", () => {
  const m = createValidManifest();
  m.capabilities = ["timers", "protocol_handle", "ipfs"];
  m.timers = [
    {
      timerId: "tick",
      methodId: "run",
      inputPortId: "in",
      defaultIntervalMs: 1000,
    },
  ];
  m.protocols = [createHostedProtocol()];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, true);
});

test("protocol requires wireId and transportKind metadata", () => {
  const m = createValidManifest();
  m.capabilities = ["protocol_handle", "ipfs"];
  m.protocols = [createHostedProtocol({ wireId: "", transportKind: "" })];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "missing-string"));
});

test("dial-only protocol cannot advertise and libp2p requires ipfs", () => {
  const m = createValidManifest();
  m.capabilities = ["protocol_dial"];
  m.protocols = [createHostedProtocol({ role: "dial", advertise: true })];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((e) => e.code === "protocol-advertise-role-conflict"),
  );
  assert.ok(report.errors.some((e) => e.code === "missing-ipfs-capability"));
});

test("unknown protocol role produces error", () => {
  const m = createValidManifest();
  m.capabilities = ["protocol_handle", "ipfs"];
  m.protocols = [createHostedProtocol({ role: "listen" })];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "unknown-protocol-role"));
});

// --- Artifact validation ---

test("missing WASM exports produce errors in artifact validation", async () => {
  const m = createValidManifest();
  const report = await validatePluginArtifact({
    manifest: m,
    exportNames: ["some_other_export"],
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "missing-plugin-manifest-export"));
  assert.equal(report.checkedArtifact, true);
});

test("declared direct invoke surface requires direct ABI exports", async () => {
  const m = createValidManifest();
  m.invokeSurfaces = ["direct"];
  const report = await validatePluginArtifact({
    manifest: m,
    exportNames: [
      "plugin_get_manifest_flatbuffer",
      "plugin_get_manifest_flatbuffer_size",
    ],
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "missing-plugin-invoke-export"));
});

test("declared command invoke surface requires _start export", async () => {
  const m = createValidManifest();
  m.invokeSurfaces = ["command"];
  const report = await validatePluginArtifact({
    manifest: m,
    exportNames: [
      "plugin_get_manifest_flatbuffer",
      "plugin_get_manifest_flatbuffer_size",
      "plugin_invoke_stream",
      "plugin_alloc",
      "plugin_free",
    ],
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "missing-plugin-command-export"));
});

test("no WASM artifact produces skipped-check warning", async () => {
  const m = createValidManifest();
  const report = await validatePluginArtifact({ manifest: m });
  assert.ok(report.warnings.some((w) => w.code === "artifact-abi-not-checked"));
  assert.equal(report.checkedArtifact, false);
});

// --- Standards validation ---

test("unresolvable paired port schema fails standards validation", async () => {
  const m = createValidManifest();
  m.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes = [
    {
      schemaName: "DoesNotExist.fbs",
      fileIdentifier: "XXXX",
      rootTypeName: "DoesNotExist",
      wireFormat: "flatbuffer",
    },
    {
      schemaName: "DoesNotExist.fbs",
      fileIdentifier: "XXXX",
      rootTypeName: "DoesNotExist",
      wireFormat: "aligned-binary",
      byteLength: 64,
      requiredAlignment: 8,
    },
  ];
  const report = await validateManifestWithStandards(m);
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((error) => error.code === "unresolved-standards-type"),
  );
});

test("OrbPro local analysis and propagator type refs resolve via standards validation", async () => {
  const m = createValidManifest();
  m.schemasUsed = [
    { schemaName: "orbpro.analysis.AccessWindowRequest", fileIdentifier: "AWRQ" },
    { schemaName: "orbpro.analysis.AccessWindowResult", fileIdentifier: "AWRS" },
    { schemaName: "orbpro.analysis.CoverageGridConfig", fileIdentifier: "CVGC" },
    { schemaName: "orbpro.analysis.CoverageGridInfo", fileIdentifier: "CVGI" },
    { schemaName: "orbpro.analysis.CoverageFootprintBatch", fileIdentifier: "CVFB" },
    { schemaName: "orbpro.analysis.CoverageStatisticsResult", fileIdentifier: "CVST" },
    { schemaName: "orbpro.analysis.CoverageIntervalsResult", fileIdentifier: "CVIR" },
    { schemaName: "orbpro.analysis.CoverageFomResult", fileIdentifier: "CVFR" },
    { schemaName: "orbpro.analysis.CoverageHeatmapResult", fileIdentifier: "CVHR" },
    { schemaName: "orbpro.analysis.CoverageUnionResult", fileIdentifier: "CVUR" },
    { schemaName: "orbpro.analysis.SwathFootprintRequest", fileIdentifier: "SFPQ" },
    { schemaName: "orbpro.analysis.SwathFootprintResult", fileIdentifier: "SFPR" },
    { schemaName: "orbpro.analysis.SwathGroundTrackRequest", fileIdentifier: "SGRQ" },
    { schemaName: "orbpro.analysis.SwathGroundTrackResult", fileIdentifier: "SGRS" },
    { schemaName: "orbpro.analysis.SwathGenerationRequest", fileIdentifier: "SWAQ" },
    { schemaName: "orbpro.analysis.SwathGenerationResult", fileIdentifier: "SWAS" },
    { schemaName: "orbpro.analysis.SwathContainmentRequest", fileIdentifier: "SPIQ" },
    { schemaName: "orbpro.analysis.SwathContainmentResult", fileIdentifier: "SPIR" },
    { schemaName: "orbpro.analysis.SwathAccessRequest", fileIdentifier: "SAPQ" },
    { schemaName: "orbpro.analysis.SwathAccessResult", fileIdentifier: "SAPR" },
    { schemaName: "orbpro.propagator.PropagatorBatchRequest", fileIdentifier: "PROP" },
    { schemaName: "orbpro.plugins.PropagatorState", fileIdentifier: "PRST" },
  ];
  const report = await validateManifestWithStandards(m);
  assert.equal(
    report.warnings.some((warning) => warning.code === "unresolved-standards-type"),
    false,
  );
});

// --- maxBatch ---

test("non-integer maxBatch produces error", () => {
  const m = createValidManifest();
  m.methods[0].maxBatch = "many";
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "invalid-integer"));
});

test("maxBatch of zero produces error", () => {
  const m = createValidManifest();
  m.methods[0].maxBatch = 0;
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "integer-range"));
});

// --- Port required flag ---

test("non-boolean required flag produces error", () => {
  const m = createValidManifest();
  m.methods[0].inputPorts[0].required = "yes";
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === "invalid-required-flag"));
});

// --- Multiple errors accumulate ---

test("multiple errors are accumulated, not short-circuited", () => {
  const m = {
    pluginId: "",
    name: "",
    version: "",
    pluginFamily: "",
    methods: [],
  };
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(report.errors.length >= 4, `Expected >=4 errors, got ${report.errors.length}`);
});
