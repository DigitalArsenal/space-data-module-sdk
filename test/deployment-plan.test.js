import test from "node:test";
import assert from "node:assert/strict";

import {
  compileModuleFromSource,
  createDeploymentPlanBundleEntry,
  createSingleFileBundle,
  normalizeDeploymentPlan,
  parseSingleFileBundle,
  readDeploymentPlanFromBundle,
  validateDeploymentPlan,
} from "../src/index.js";

function createManifest() {
  return {
    pluginId: "com.digitalarsenal.examples.protocol-deployment",
    name: "Protocol Deployment Test",
    version: "0.1.0",
    pluginFamily: "propagator",
    capabilities: ["protocol_handle", "ipfs"],
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
            minStreams: 0,
            maxStreams: 1,
            required: false,
          },
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
    protocols: [
      {
        protocolId: "sgp4-stream",
        methodId: "propagate",
        inputPortId: "request",
        outputPortId: "state",
        wireId: "/sdn/sgp4/1.0.0",
        transportKind: "libp2p",
        role: "handle",
        autoInstall: true,
        advertise: true,
        discoveryKey: "sgp4-stream",
        defaultPort: 443,
        requireSecureTransport: true,
      },
    ],
  };
}

function createDeploymentPlan(overrides = {}) {
  return {
    formatVersion: 1,
    pluginId: "com.digitalarsenal.examples.protocol-deployment",
    version: "0.1.0",
    artifactCid: "bafybeigdyrzt5example",
    environmentId: "orbpro-dev",
    protocolInstallations: [
      {
        protocolId: "sgp4-stream",
        wireId: "/sdn/sgp4/1.0.0",
        transportKind: "libp2p",
        role: "handle",
        peerId: "12D3KooWTestPeer",
        listenMultiaddrs: [
          "/ip4/127.0.0.1/tcp/14080/ws/p2p/12D3KooWTestPeer",
        ],
        advertisedMultiaddrs: [
          "/dns4/sgp4.example.test/tcp/443/ws/p2p/12D3KooWTestPeer",
        ],
        nodeInfoUrl: "https://sgp4.example.test/api/node/info",
        serviceName: "sgp4-stream",
        resolvedPort: 443,
      },
    ],
    inputBindings: [
      {
        bindingId: "catalog-feed",
        targetMethodId: "propagate",
        targetInputPortId: "request",
        sourceKind: "pubsub",
        topic: "/spacedatanetwork/sds/OMM.fbs",
      },
      {
        bindingId: "service-feed",
        targetMethodId: "propagate",
        targetInputPortId: "request",
        sourceKind: "protocol_stream",
        wireId: "/sdn/upstream-catalog/1.0.0",
        multiaddrs: [
          "/dns4/upstream.example.test/tcp/443/wss/p2p/12D3KooWUpstream",
        ],
        allowServerKeys: ["ed25519:test-key"],
      },
    ],
    ...overrides,
  };
}

test("deployment plans normalize and validate against a manifest", () => {
  const manifest = createManifest();
  const plan = createDeploymentPlan();
  const normalized = normalizeDeploymentPlan(plan);
  assert.equal(normalized.inputBindings[1].sourceKind, "protocol-stream");

  const report = validateDeploymentPlan(plan, { manifest });
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);

  const entry = createDeploymentPlanBundleEntry(plan);
  assert.equal(entry.entryId, "deployment-plan");
  assert.equal(entry.sectionName, "sds.deployment");
  assert.equal(entry.payloadEncoding, "json-utf8");
});

test("deployment plans catch manifest mismatches", () => {
  const manifest = createManifest();
  const plan = createDeploymentPlan({
    inputBindings: [
      {
        bindingId: "bad-port",
        targetMethodId: "propagate",
        targetInputPortId: "missing",
        sourceKind: "pubsub",
        topic: "/spacedatanetwork/sds/OMM.fbs",
      },
    ],
  });
  const report = validateDeploymentPlan(plan, { manifest });
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((issue) => issue.code === "unknown-input-binding-port"),
  );
});

test("deployment plans round-trip through sds.bundle entries", async () => {
  const manifest = createManifest();
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: "int propagate(void) { return 3; }\n",
    language: "c",
  });
  const plan = createDeploymentPlan();
  const normalizedPlan = normalizeDeploymentPlan(plan);

  const bundle = await createSingleFileBundle({
    wasmBytes: compilation.wasmBytes,
    manifest,
    deploymentPlan: plan,
  });
  const parsed = await parseSingleFileBundle(bundle.wasmBytes);

  assert.deepEqual(parsed.deploymentPlan, normalizedPlan);
  assert.deepEqual(readDeploymentPlanFromBundle(parsed), normalizedPlan);
  assert.deepEqual(
    parsed.entries.find((entry) => entry.entryId === "deployment-plan")
      ?.decodedDeploymentPlan,
    normalizedPlan,
  );
});
