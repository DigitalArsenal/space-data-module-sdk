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
    capabilities: ["protocol_handle", "pubsub", "http", "ipfs"],
    externalInterfaces: [
      {
        interfaceId: "catalog-pubsub",
        kind: "pubsub",
        direction: "input",
        capability: "pubsub",
      },
      {
        interfaceId: "upstream-protocol",
        kind: "protocol",
        direction: "input",
        capability: "protocol_handle",
      },
      {
        interfaceId: "state-catalog-pubsub",
        kind: "pubsub",
        direction: "output",
        capability: "pubsub",
      },
      {
        interfaceId: "state-query-api",
        kind: "http",
        direction: "output",
        capability: "http",
      },
    ],
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
        interfaceId: "catalog-pubsub",
        targetMethodId: "propagate",
        targetInputPortId: "request",
        sourceKind: "pubsub",
      },
      {
        bindingId: "service-feed",
        interfaceId: "upstream-protocol",
        targetMethodId: "propagate",
        targetInputPortId: "request",
        sourceKind: "protocol_stream",
        multiaddrs: [
          "/dns4/upstream.example.test/tcp/443/wss/p2p/12D3KooWUpstream",
        ],
        allowServerKeys: ["ed25519:test-key"],
      },
    ],
    scheduleBindings: [
      {
        scheduleId: "poll-upstream",
        bindingMode: "local",
        targetMethodId: "propagate",
        targetInputPortId: "request",
        scheduleKind: "cron",
        cron: "*/15 * * * *",
        timezone: "UTC",
      },
    ],
    serviceBindings: [
      {
        serviceId: "https-query",
        bindingMode: "delegated",
        serviceKind: "http-server",
        routePath: "/api/sgp4",
        method: "GET",
        remoteUrl: "https://gateway.example.test/api/sgp4",
        allowTransports: ["https"],
        authPolicyId: "approved-keys",
      },
    ],
    authPolicies: [
      {
        policyId: "approved-keys",
        bindingMode: "delegated",
        targetKind: "service",
        targetId: "https-query",
        walletProfileId: "orbpro-default",
        trustMapId: "approved-operators",
        allowServerKeys: ["ed25519:test-key"],
      },
    ],
    publicationBindings: [
      {
        publicationId: "state-catalog",
        interfaceId: "state-catalog-pubsub",
        bindingMode: "local",
        sourceKind: "method-output",
        sourceMethodId: "propagate",
        sourceOutputPortId: "state",
        schemaName: "CAT.fbs",
        emitPnm: true,
        emitFlatbufferArchive: true,
        archivePath: "/data/catalog/cat.bin",
        queryInterfaceId: "state-query-api",
        recordRangeStartField: "startIndex",
        recordRangeStopField: "stopIndex",
        maxRecords: 2048,
        maxBytes: 1048576,
        minLivelinessSeconds: 900,
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
  assert.equal(normalized.inputBindings[0].interfaceId, "catalog-pubsub");
  assert.equal(normalized.scheduleBindings[0].scheduleKind, "cron");
  assert.equal(normalized.serviceBindings[0].bindingMode, "delegated");
  assert.equal(
    normalized.publicationBindings[0].queryInterfaceId,
    "state-query-api",
  );

  const report = validateDeploymentPlan(plan, { manifest });
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);

  const entry = createDeploymentPlanBundleEntry(plan);
  assert.equal(entry.entryId, "deployment-plan");
  assert.equal(entry.sectionName, "sds.deployment");
  assert.equal(entry.payloadEncoding, "json-utf8");
});

test("deployment plans only compare protocol wireId when explicitly provided", () => {
  const manifest = createManifest();
  const plan = createDeploymentPlan({
    protocolInstallations: [
      {
        ...createDeploymentPlan().protocolInstallations[0],
        wireId: "/sdn/sgp4/legacy-wire",
      },
    ],
  });
  const report = validateDeploymentPlan(plan, { manifest });
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some(
      (issue) => issue.code === "installation-wire-id-mismatch",
    ),
  );
});

test("deployment plans catch manifest mismatches", () => {
  const manifest = createManifest();
  const plan = createDeploymentPlan({
    inputBindings: [
      {
        bindingId: "bad-port",
        interfaceId: "catalog-pubsub",
        targetMethodId: "propagate",
        targetInputPortId: "missing",
        sourceKind: "pubsub",
      },
    ],
  });
  const report = validateDeploymentPlan(plan, { manifest });
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((issue) => issue.code === "unknown-input-binding-port"),
  );
});

test("deployment plans catch missing auth policy and malformed schedules", () => {
  const manifest = createManifest();
  const plan = createDeploymentPlan({
    serviceBindings: [
      {
        serviceId: "https-query",
        bindingMode: "delegated",
        serviceKind: "http-server",
        routePath: "/api/sgp4",
        authPolicyId: "missing-policy",
      },
    ],
    scheduleBindings: [
      {
        scheduleId: "bad-schedule",
        bindingMode: "local",
        scheduleKind: "interval",
        targetMethodId: "propagate",
        targetInputPortId: "request",
        intervalMs: 0,
      },
    ],
  });
  const report = validateDeploymentPlan(plan, { manifest });
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((issue) => issue.code === "unknown-service-auth-policy"),
  );
  assert.ok(
    report.errors.some((issue) => issue.code === "invalid-interval-ms"),
  );
});

test("deployment plans require declared interface ids for deployment bindings", () => {
  const manifest = createManifest();
  const basePlan = createDeploymentPlan();
  const plan = createDeploymentPlan({
    inputBindings: [
      {
        ...basePlan.inputBindings[0],
        interfaceId: null,
      },
    ],
    publicationBindings: [
      {
        ...basePlan.publicationBindings[0],
        interfaceId: "unknown-publication-interface",
        queryInterfaceId: "unknown-query-interface",
      },
    ],
  });
  const report = validateDeploymentPlan(plan, { manifest });
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some(
      (issue) =>
        issue.location === "deploymentPlan.inputBindings[0].interfaceId" &&
        issue.code === "missing-string",
    ),
  );
  assert.ok(
    report.errors.some(
      (issue) => issue.code === "unknown-publication-binding-interface",
    ),
  );
  assert.ok(
    report.errors.some(
      (issue) => issue.code === "unknown-publication-query-interface",
    ),
  );
});

test("deployment plans accept interface-keyed bindings without a manifest", () => {
  const plan = createDeploymentPlan({
    inputBindings: [
      {
        ...createDeploymentPlan().inputBindings[0],
        targetPluginId: "com.digitalarsenal.examples.protocol-deployment",
      },
    ],
  });
  const report = validateDeploymentPlan(plan);
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
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
