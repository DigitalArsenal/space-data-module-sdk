import test from "node:test";
import assert from "node:assert/strict";

import {
  getPayloadTypeWireFormat,
  payloadTypeRefsMatch,
  selectPreferredPayloadTypeRef,
  describeCapabilityRuntimeSurface,
  generateManifestHarnessPlan,
  materializeHarnessScenario,
  decodePluginInvokeRequest,
} from "../src/index.js";

function createManifest() {
  return {
    pluginId: "com.digitalarsenal.examples.testing-harness",
    name: "Testing Harness Fixture",
    version: "0.1.0",
    pluginFamily: "flow",
    capabilities: ["clock", "filesystem", "http", "crypto_hash"],
    invokeSurfaces: ["direct", "command"],
    methods: [
      {
        methodId: "echo",
        displayName: "Echo",
        inputPorts: [
          {
            portId: "in",
            required: true,
            acceptedTypeSets: [
              {
                setId: "any",
                allowedTypes: [{ acceptsAnyFlatbuffer: true }],
              },
            ],
          },
        ],
        outputPorts: [],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  };
}

function createDualFormatManifest() {
  return {
    pluginId: "com.digitalarsenal.examples.testing-harness-dual",
    name: "Testing Harness Dual Fixture",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: [],
    invokeSurfaces: ["command"],
    methods: [
      {
        methodId: "transform",
        displayName: "Transform",
        inputPorts: [
          {
            portId: "request",
            required: true,
            acceptedTypeSets: [
              {
                setId: "state-vector",
                allowedTypes: [
                  {
                    schemaName: "StateVector.fbs",
                    fileIdentifier: "STVC",
                  },
                  {
                    schemaName: "StateVector.fbs",
                    fileIdentifier: "STVC",
                    wireFormat: "aligned-binary",
                    rootTypeName: "StateVector",
                    byteLength: 64,
                    requiredAlignment: 16,
                  },
                ],
              },
            ],
          },
        ],
        outputPorts: [],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  };
}

function createSchemaWithoutFileIdentifierManifest() {
  return {
    pluginId: "com.digitalarsenal.examples.testing-harness-no-file-id",
    name: "Testing Harness No File Identifier Fixture",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: [],
    invokeSurfaces: ["command"],
    methods: [
      {
        methodId: "transform",
        displayName: "Transform",
        inputPorts: [
          {
            portId: "request",
            required: true,
            acceptedTypeSets: [
              {
                setId: "state-vector",
                allowedTypes: [
                  {
                    schemaName: "StateVector.fbs",
                    fileIdentifier: null,
                  },
                  {
                    schemaName: "StateVector.fbs",
                    fileIdentifier: null,
                    wireFormat: "aligned-binary",
                    rootTypeName: "StateVector",
                    byteLength: 64,
                    requiredAlignment: 16,
                  },
                ],
              },
            ],
          },
        ],
        outputPorts: [],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  };
}

test("capability runtime surface matrix distinguishes WASI, sync hostcalls, and host-only APIs", () => {
  assert.deepEqual(
    describeCapabilityRuntimeSurface("clock"),
    {
      capability: "clock",
      wasi: true,
      standaloneWasi: true,
      wasmedge: true,
      syncHostcall: true,
      nodeHostApi: true,
      notes: [
        "WASI runtimes can expose clock/time directly to standalone guests.",
        "The SDK sync hostcall bridge also exposes clock.now/clock.nowIso/clock.monotonicNow.",
      ],
    },
  );

  assert.equal(describeCapabilityRuntimeSurface("filesystem").wasi, true);
  assert.equal(describeCapabilityRuntimeSurface("filesystem").standaloneWasi, true);
  assert.equal(describeCapabilityRuntimeSurface("filesystem").wasmedge, true);
  assert.equal(describeCapabilityRuntimeSurface("filesystem").syncHostcall, true);
  assert.equal(describeCapabilityRuntimeSurface("pipe").wasi, true);
  assert.equal(describeCapabilityRuntimeSurface("schedule_cron").standaloneWasi, false);
  assert.equal(describeCapabilityRuntimeSurface("network").wasmedge, true);
  assert.equal(describeCapabilityRuntimeSurface("http").wasmedge, true);
  assert.equal(describeCapabilityRuntimeSurface("websocket").wasmedge, false);
  assert.equal(describeCapabilityRuntimeSurface("pipe").nodeHostApi, false);
  assert.equal(describeCapabilityRuntimeSurface("network").nodeHostApi, true);
  assert.equal(describeCapabilityRuntimeSurface("logging").wasi, true);
  assert.equal(describeCapabilityRuntimeSurface("http").wasi, false);
  assert.equal(describeCapabilityRuntimeSurface("http").syncHostcall, false);
  assert.equal(describeCapabilityRuntimeSurface("http").nodeHostApi, true);
  assert.equal(describeCapabilityRuntimeSurface("unknown-capability").nodeHostApi, false);
});

test("manifest harness plan treats flows as degenerate modules and derives default invoke cases", () => {
  const plan = generateManifestHarnessPlan({
    manifest: createManifest(),
    payloadForPort({ portId }) {
      return `payload:${portId}`;
    },
  });

  assert.equal(plan.moduleKind, "flow");
  assert.deepEqual(plan.invokeSurfaces, ["direct", "command"]);
  assert.equal(plan.generatedCases.length, 2);
  assert.deepEqual(
    plan.generatedCases.map((scenario) => scenario.id),
    ["direct:echo", "command:echo"],
  );
  assert.deepEqual(
    plan.capabilities.map((entry) => [
      entry.capability,
      entry.wasi,
      entry.standaloneWasi,
      entry.wasmedge,
      entry.syncHostcall,
      entry.nodeHostApi,
    ]),
    [
      ["clock", true, true, true, true, true],
      ["filesystem", true, true, true, true, true],
      ["http", false, false, true, false, true],
      ["crypto_hash", false, false, false, false, true],
    ],
  );
});

test("materialized command scenarios encode invoke envelopes from manifest-derived cases", () => {
  const plan = generateManifestHarnessPlan({
    manifest: createManifest(),
    payloadForPort() {
      return "hello from generated harness";
    },
  });
  const commandScenario = plan.generatedCases.find(
    (scenario) => scenario.surface === "command",
  );
  const materialized = materializeHarnessScenario(commandScenario);
  assert.ok(materialized.stdinBytes instanceof Uint8Array);
  assert.ok(materialized.requestBytes instanceof Uint8Array);

  const decoded = decodePluginInvokeRequest(materialized.stdinBytes);
  assert.equal(decoded.methodId, "echo");
  assert.equal(decoded.inputs.length, 1);
  assert.equal(decoded.inputs[0].portId, "in");
  assert.equal(
    new TextDecoder().decode(decoded.inputs[0].payload),
    "hello from generated harness",
  );
});

test("manifest harness plan can prefer aligned-binary type refs for mixed-format ports", () => {
  const payloadFormats = [];
  const plan = generateManifestHarnessPlan({
    manifest: createDualFormatManifest(),
    preferredWireFormat: "aligned-binary",
    payloadForPort({ typeRef }) {
      payloadFormats.push(typeRef.wireFormat ?? "flatbuffer");
      return "aligned payload";
    },
  });

  assert.equal(plan.generatedCases.length, 1);
  assert.equal(plan.generatedCases[0].inputs.length, 1);
  assert.equal(
    plan.generatedCases[0].inputs[0].typeRef?.wireFormat,
    "aligned-binary",
  );
  assert.equal(plan.generatedCases[0].inputs[0].typeRef?.rootTypeName, "StateVector");
  assert.deepEqual(payloadFormats, ["aligned-binary"]);
});

test("payload type helpers distinguish aligned-binary from regular flatbuffers", () => {
  const dualPort =
    createDualFormatManifest().methods[0].inputPorts[0];
  const selected = selectPreferredPayloadTypeRef(dualPort, {
    preferredWireFormat: "aligned-binary",
  });
  assert.equal(getPayloadTypeWireFormat(selected), "aligned-binary");
  assert.equal(
    payloadTypeRefsMatch(
      {
        schemaName: "StateVector.fbs",
        fileIdentifier: "STVC",
      },
      {
        schemaName: "StateVector.fbs",
        fileIdentifier: "STVC",
        wireFormat: "aligned-binary",
        rootTypeName: "StateVector",
        byteLength: 64,
        requiredAlignment: 16,
      },
    ),
    false,
  );
  assert.equal(
    payloadTypeRefsMatch(selected, {
      schemaName: "StateVector.fbs",
      fileIdentifier: "STVC",
      wireFormat: "aligned-binary",
      rootTypeName: "StateVector",
      byteLength: 64,
      requiredAlignment: 16,
    }),
    true,
  );
  assert.equal(
    payloadTypeRefsMatch(
      {
        schemaName: "TimerTick.fbs",
        fileIdentifier: "TICK",
        schemaHash: [],
      },
      {
        schemaName: "TimerTick.fbs",
        fileIdentifier: "TICK",
        schemaHash: [1, 2, 3, 4],
      },
    ),
    true,
  );
});

test("selectPreferredPayloadTypeRef preserves null file identifiers for schemas without identifiers", () => {
  const port = createSchemaWithoutFileIdentifierManifest().methods[0].inputPorts[0];
  const selected = selectPreferredPayloadTypeRef(port, {
    preferredWireFormat: "aligned-binary",
  });
  assert.equal(selected.fileIdentifier, null);
  assert.equal(selected.schemaName, "StateVector.fbs");
  assert.equal(selected.wireFormat, "aligned-binary");
});

test("aligned-binary payload type matching tolerates decoded flatbuffer default values", () => {
  assert.equal(
    payloadTypeRefsMatch(
      {
        schemaName: "orbpro.propagator.PropagatorDescribeSourcesBatchResult",
        wireFormat: "aligned-binary",
        rootTypeName: "PropagatorDescribeSourcesBatchResult",
        schemaHash: [],
        fixedStringLength: 0,
        byteLength: 0,
        requiredAlignment: 8,
      },
      {
        schemaName: "orbpro.propagator.PropagatorDescribeSourcesBatchResult",
        wireFormat: "aligned-binary",
        rootTypeName: "PropagatorDescribeSourcesBatchResult",
        requiredAlignment: 8,
      },
    ),
    true,
  );
});

test("selectPreferredPayloadTypeRef canonicalizes numeric wire-format enums and aligned defaults", () => {
  const selected = selectPreferredPayloadTypeRef(
    {
      acceptedTypeSets: [
        {
          setId: "describe-result",
          allowedTypes: [
            {
              schemaName: "orbpro.propagator.PropagatorDescribeSourcesBatchResult",
              wireFormat: 1,
              rootTypeName: "PropagatorDescribeSourcesBatchResult",
              schemaHash: [],
              fixedStringLength: 0,
              byteLength: 0,
              requiredAlignment: 8,
            },
          ],
        },
      ],
    },
    { preferredWireFormat: "aligned-binary" },
  );
  assert.equal(selected.wireFormat, "aligned-binary");
  assert.equal(selected.schemaHash, undefined);
  assert.equal(selected.fixedStringLength, undefined);
  assert.equal(selected.byteLength, undefined);
  assert.equal(selected.requiredAlignment, 8);
});
