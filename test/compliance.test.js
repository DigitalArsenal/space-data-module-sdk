import test from "node:test";
import assert from "node:assert/strict";
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
              {
                setId: "omm",
                allowedTypes: [
                  { schemaName: "OMM.fbs", fileIdentifier: "$OMM" },
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
            portId: "out",
            acceptedTypeSets: [
              {
                setId: "cat",
                allowedTypes: [
                  { schemaName: "CAT.fbs", fileIdentifier: "$CAT" },
                ],
              },
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
    ...overrides,
  };
}

function createDualFormatTypeSet(alignedOverrides = {}) {
  const alignedType = createAlignedAllowedType(alignedOverrides);
  return {
    setId: "state-vector",
    allowedTypes: [
      createFlatbufferAllowedType({
        schemaName: alignedType.schemaName,
        fileIdentifier: alignedType.fileIdentifier,
      }),
      alignedType,
    ],
  };
}

async function createFlatcWasmAlignedAllowedType(overrides = {}) {
  return {
    schemaName: "AlignedVectorTest.fbs",
    fileIdentifier: "AVEC",
    wireFormat: "aligned-binary",
    rootTypeName: "Cartesian3",
    byteLength: 24,
    requiredAlignment: 8,
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

test("acceptsAnyFlatbuffer type passes without identity fields", () => {
  const m = createValidManifest();
  m.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes = [
    { acceptsAnyFlatbuffer: true },
  ];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, true);
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

test("aligned-binary type allows omitted byteLength for variable-length layouts", () => {
  const missing = createValidManifest();
  missing.methods[0].inputPorts[0].acceptedTypeSets[0] = createDualFormatTypeSet({
    byteLength: undefined,
  });
  const missingReport = validatePluginManifest(missing);
  assert.equal(missingReport.ok, true);
  assert.equal(missingReport.errors.length, 0);

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

test("schemaHash byte arrays count as stable identity fields", () => {
  const m = createValidManifest();
  m.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes = [
    { schemaHash: [0xde, 0xad, 0xbe, 0xef] },
  ];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, true);
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
  m.capabilities = ["http", "filesystem", "process_exec"];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((e) => e.code === "capability-runtime-conflict"),
  );
});

test("browser runtime target accepts browser-safe capabilities", () => {
  const m = createValidManifest();
  m.runtimeTargets = ["browser"];
  m.capabilities = ["clock", "random", "timers", "http", "websocket", "crypto_sign"];
  const report = validatePluginManifest(m);
  assert.equal(report.ok, true);
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

test("unresolvable schema produces warning via standards validation", async () => {
  const m = createValidManifest();
  m.methods[0].inputPorts[0].acceptedTypeSets[0].allowedTypes = [
    { schemaName: "DoesNotExist.fbs", fileIdentifier: "XXXX" },
  ];
  const report = await validateManifestWithStandards(m);
  assert.ok(report.warnings.length > 0);
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
