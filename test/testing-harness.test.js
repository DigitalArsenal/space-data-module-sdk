import test from "node:test";
import assert from "node:assert/strict";

import {
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

test("capability runtime surface matrix distinguishes WASI, sync hostcalls, and host-only APIs", () => {
  assert.deepEqual(
    describeCapabilityRuntimeSurface("clock"),
    {
      capability: "clock",
      wasi: true,
      syncHostcall: true,
      nodeHostApi: true,
      notes: [
        "WASI runtimes can expose clock/time directly to standalone guests.",
        "The SDK sync hostcall bridge also exposes clock.now/clock.nowIso/clock.monotonicNow.",
      ],
    },
  );

  assert.equal(describeCapabilityRuntimeSurface("filesystem").wasi, true);
  assert.equal(describeCapabilityRuntimeSurface("filesystem").syncHostcall, true);
  assert.equal(describeCapabilityRuntimeSurface("pipe").wasi, true);
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
    plan.capabilities.map((entry) => [entry.capability, entry.wasi, entry.syncHostcall, entry.nodeHostApi]),
    [
      ["clock", true, true, true],
      ["filesystem", true, true, true],
      ["http", false, false, true],
      ["crypto_hash", false, false, true],
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
