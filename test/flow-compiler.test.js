import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  cleanupCompilation,
  compileModuleFromSource,
  ModuleThreadModel,
} from "../src/compiler/compileModule.js";
import {
  analyzeWasmThreadFeatures,
  assertPthreadArtifact,
} from "../src/compiler/pthreadArtifactGuard.js";
import { resolveWasiThreadsToolchain } from "../src/compiler/wasiThreadsToolchain.js";
import {
  __testables,
  buildFlowModuleManifest,
  checkFlowProgram,
  compileFlowProgram,
  encodeFlowDocumentProgram,
} from "../src/flow/flowCompiler.js";
import { decodeFlowProgram } from "../src/flow/flowCodec.js";
import { createFlowRuntimeHost } from "../src/flow/flowRuntimeHost.js";
import { createIsomorphicFlowRuntimeHost } from "../src/flow/isomorphicFlowHost.js";
import { normalizeManifestForSdnFlow } from "../src/flow/normalize.js";
import {
  decodePluginManifest,
  encodePluginManifest,
} from "../src/manifest/index.js";
import {
  signModuleArtifact,
  verifyModuleArtifact,
} from "../src/bundle/signing.js";
import {
  locateEmbeddedPlgManifest,
  validatePluginManifest,
} from "../src/compliance/index.js";
import { createBrowserModuleHarness } from "../src/host/browserModuleHarness.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../bin/space-data-module.js", import.meta.url));

function wildcardTypeSet(setId) {
  return { setId, allowedTypes: [{ acceptsAnyFlatbuffer: true }] };
}

function typedTypeSet(setId, schemaName, fileIdentifier) {
  return dualTypeSet(setId, schemaName, fileIdentifier);
}

function dualTypeSet(
  setId,
  schemaName,
  fileIdentifier,
  {
    schemaVersion = "1.0.0",
    schemaHash = [0x10, 0x20, 0x30, 0x40],
    rootTypeName = schemaName.replace(".fbs", ""),
    byteLength = 64,
    fixedStringLength,
    requiredAlignment = 8,
  } = {},
) {
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
        ...(byteLength === undefined ? {} : { byteLength }),
        ...(fixedStringLength === undefined ? {} : { fixedStringLength }),
        requiredAlignment,
      },
    ],
  };
}

function catalogForManifests(...manifests) {
  const entries = new Map();
  const addTypeRef = (typeRef) => {
    if (!typeRef?.schemaName || !typeRef?.fileIdentifier) return;
    const key = `${typeRef.schemaName}\0${typeRef.fileIdentifier}`;
    if (entries.has(key)) return;
    const hash = Array.isArray(typeRef.schemaHash) || typeRef.schemaHash instanceof Uint8Array
      ? Array.from(typeRef.schemaHash, (byte) => byte.toString(16).padStart(2, "0")).join("")
      : (typeRef.schemaHash ?? null);
    entries.set(key, {
      schemaCode: `TEST_${entries.size}`,
      schemaName: typeRef.schemaName,
      fileIdentifier: typeRef.fileIdentifier,
      rootTypeName: typeRef.rootTypeName ?? null,
      version: typeRef.schemaVersion ?? null,
      hash,
      idl: "",
      files: [],
    });
  };
  for (const manifest of manifests) {
    for (const method of manifest?.methods ?? []) {
      for (const direction of ["inputPorts", "outputPorts"]) {
        for (const portDefinition of method?.[direction] ?? []) {
          for (const typeSet of portDefinition?.acceptedTypeSets ?? []) {
            for (const typeRef of typeSet?.allowedTypes ?? []) addTypeRef(typeRef);
          }
        }
      }
    }
    for (const typeRef of manifest?.schemasUsed ?? []) addTypeRef(typeRef);
  }
  return [...entries.values()];
}

function port(portId, { required = true, typeSets }) {
  return {
    portId,
    required,
    minStreams: required ? 1 : 0,
    maxStreams: 1,
    acceptedTypeSets: typeSets,
  };
}

function makeDependency({
  pluginId,
  version = "1.0.0",
  capabilities = [],
  guestCapabilities,
  threadModel,
  methods,
  dependencies,
  pluginFamily = "foundation",
  // Every real module manifest in the stack declares the isomorphic pair; the
  // old ["browser"] default made these fixtures teach a shape that does not
  // exist, and now that composed targets are DERIVED it made them derive the
  // wrong answer too.
  runtimeTargets = ["browser", "wasmedge"],
}) {
  const manifest = {
    pluginId,
    name: pluginId,
    version,
    pluginFamily,
    capabilities,
    externalInterfaces: [],
    runtimeTargets,
    methods,
    schemasUsed: [],
    abiVersion: 1,
    ...(dependencies ? { dependencies } : {}),
  };
  return {
    pluginId,
    manifest,
    normalized: normalizeManifestForSdnFlow(manifest),
    guestLink: {
      objectBytes: new Uint8Array([0]),
      metadata: {
        symbolPrefix: "test_",
        methodSymbols: Object.fromEntries(methods.map((method) => [method.methodId, `test_${method.methodId}`])),
        ...(guestCapabilities === undefined ? {} : { capabilities: guestCapabilities }),
        ...(threadModel === undefined ? {} : { threadModel }),
      },
    },
    wasmPath: "/nonexistent/module.wasm",
  };
}

const producerDependency = makeDependency({
  pluginId: "test.producer",
  capabilities: ["storage_query"],
  methods: [
    {
      methodId: "produce",
      inputPorts: [port("request", { typeSets: [typedTypeSet("req", "CAQ.fbs", "$CAQ")] })],
      outputPorts: [port("stream", { typeSets: [typedTypeSet("out", "OMM.fbs", "$OMM")] })],
      maxBatch: 1,
      drainPolicy: "single-shot",
    },
  ],
});

const consumerDependency = makeDependency({
  pluginId: "test.consumer",
  capabilities: ["http"],
  methods: [
    {
      methodId: "consume",
      inputPorts: [
        port("stream", { typeSets: [typedTypeSet("in", "OMM.fbs", "$OMM")] }),
        port("aux", {
          required: false,
          typeSets: [typedTypeSet("aux", "OMM.fbs", "$OMM")],
        }),
      ],
      outputPorts: [port("done", { typeSets: [typedTypeSet("resp", "HttpResponseAbi.fbs", "$HTR")] })],
      maxBatch: 1,
      drainPolicy: "single-shot",
    },
  ],
});

function makeFlow(overrides = {}) {
  return {
    programId: "test.check-flow",
    name: "Check flow",
    version: "0.1.0",
    nodes: [
      { nodeId: "producer", pluginId: "test.producer", methodId: "produce", kind: "transform" },
      { nodeId: "consumer", pluginId: "test.consumer", methodId: "consume", kind: "transform" },
      { nodeId: "egress", pluginId: "test.sink", methodId: "collect", kind: "sink" },
    ],
    edges: [
      { fromNodeId: "producer", fromPortId: "stream", toNodeId: "consumer", toPortId: "stream" },
      { fromNodeId: "consumer", fromPortId: "done", toNodeId: "egress", toPortId: "response" },
    ],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [
      { triggerId: "manual", targetNodeId: "producer", targetPortId: "request", queueDepth: 4 },
    ],
    requiredPlugins: ["test.producer", "test.consumer"],
    ...overrides,
  };
}

function dependencyMap(...entries) {
  return new Map(entries.map((entry) => [entry.pluginId, entry]));
}

async function signedEmptyArtifact(seedByte, keyId) {
  const signed = await signModuleArtifact(
    Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
    {
      privateKeySeedHex: seedByte.repeat(32),
      keyId,
      signatureScope: "bundle",
    },
  );
  return {
    bytes: signed.wasmBytes,
    sha256: createHash("sha256").update(signed.wasmBytes).digest("hex"),
    publisher: {
      algorithm: "ed25519",
      keyId,
      publicKeyHex: signed.signature.publicKeyHex,
      developmentOnly: false,
    },
  };
}

function singleNodeFlow(dependency, nodeOverrides = {}) {
  const method = dependency.manifest.methods[0];
  const inputPort = method.inputPorts[0];
  return {
    programId: `test.${dependency.pluginId}.flow`,
    name: `${dependency.pluginId} flow`,
    version: "0.1.0",
    nodes: [
      {
        nodeId: "node",
        pluginId: dependency.pluginId,
        methodId: method.methodId,
        kind: "transform",
        ...nodeOverrides,
      },
    ],
    edges: [],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: inputPort
      ? [{ triggerId: "manual", targetNodeId: "node", targetPortId: inputPort.portId }]
      : [],
    requiredPlugins: [dependency.pluginId],
  };
}

function wasiThreadsAvailable() {
  try {
    resolveWasiThreadsToolchain();
    return true;
  } catch {
    return false;
  }
}

test("flow check passes a well-formed flow and computes the capability union", () => {
  const check = checkFlowProgram({
    flow: makeFlow(),
    dependencies: dependencyMap(producerDependency, consumerDependency),
  });
  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.deepEqual(check.capabilities, ["http", "storage_query"]);
  assert.deepEqual(
    check.nodes.map((node) => node.dispatchModel),
    ["linked-direct", "linked-direct", "host"],
  );
});

// ---------------------------------------------------------------------------
// Family/interface-typed node binding (PLUGGABLE-PROPAGATION LAW, ruling E) —
// the additive alternative to exact-pluginId binding: a node declares
// `pluginFamily` + `methodId` instead of `pluginId` and is resolved at check
// time to the one qualifying dependency.
// ---------------------------------------------------------------------------

const sgp4Dependency = makeDependency({
  pluginId: "com.spacedatanetwork.sgp4",
  pluginFamily: "propagator",
  capabilities: [],
  methods: [
    "ingest_omm",
    "upsert_cat",
    "propagate_state",
    "propagate_path",
    "catalog_query",
  ].map((methodId) => ({
    methodId,
    inputPorts: [port("state", { typeSets: [typedTypeSet("state", "OMM.fbs", "$OMM")] })],
    outputPorts: [port("out", { typeSets: [typedTypeSet("out", "OMM.fbs", "$OMM")] })],
    maxBatch: 1,
    drainPolicy: "single-shot",
  })),
});

const hpopDependency = makeDependency({
  pluginId: "com.spacedatanetwork.hpop",
  pluginFamily: "propagator",
  capabilities: [],
  methods: [
    "invoke",
    "ingest_state",
    "propagate_state",
    "prepare_trajectory_segments",
    "describe_trajectory_segments",
  ].map((methodId) => ({
    methodId,
    inputPorts: [port("state", { typeSets: [typedTypeSet("state", "OMM.fbs", "$OMM")] })],
    outputPorts: [port("out", { typeSets: [typedTypeSet("out", "OMM.fbs", "$OMM")] })],
    maxBatch: 1,
    drainPolicy: "single-shot",
  })),
});

function familyFlow(nodeOverrides = {}) {
  return {
    programId: "test.family-flow",
    name: "Family flow",
    version: "0.1.0",
    nodes: [
      {
        nodeId: "propagate",
        methodId: "propagate_state",
        kind: "transform",
        pluginFamily: "propagator",
        ...nodeOverrides,
      },
    ],
    edges: [],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [
      { triggerId: "manual", targetNodeId: "propagate", targetPortId: "state" },
    ],
    requiredPlugins: [],
  };
}

test("normalizePluginFamilyName canonicalizes case, separators, and the datasource alias", () => {
  const { normalizePluginFamilyName } = __testables;
  assert.equal(normalizePluginFamilyName("propagator"), "PROPAGATOR");
  assert.equal(normalizePluginFamilyName("PROPAGATOR"), "PROPAGATOR");
  assert.equal(normalizePluginFamilyName(" Propagator "), "PROPAGATOR");
  assert.equal(normalizePluginFamilyName("data_source"), "DATA_SOURCE");
  assert.equal(normalizePluginFamilyName("datasource"), "DATA_SOURCE");
  assert.equal(normalizePluginFamilyName("data-source"), "DATA_SOURCE");
  assert.equal(normalizePluginFamilyName(1), "PROPAGATOR");
  assert.equal(normalizePluginFamilyName(""), null);
  assert.equal(normalizePluginFamilyName(null), null);
});

test("a node bound by pluginFamily resolves to the single qualifying dependency", () => {
  const flow = familyFlow();
  const dependencies = dependencyMap(sgp4Dependency);
  const check = checkFlowProgram({ flow, dependencies });

  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.equal(flow.nodes[0].pluginId, "com.spacedatanetwork.sgp4");
  assert.equal(check.nodes[0].pluginId, "com.spacedatanetwork.sgp4");
  assert.equal(check.nodes[0].resolvedFromPluginFamily, "PROPAGATOR");

  // No trace of the family declaration reaches the compiled artifact's own
  // embedded flow record — the resolved node round-trips as an ordinary
  // exact-pluginId node (zero wire/ABI change).
  const decoded = decodeFlowProgram(encodeFlowDocumentProgram(flow));
  assert.equal(decoded.nodes[0].pluginId, "com.spacedatanetwork.sgp4");

  // The other downstream stage that reads flow.nodes[].pluginId directly
  // (not through check.nodes) also sees the resolved concrete id.
  const manifest = buildFlowModuleManifest({ flow, check, dependencies });
  assert.deepEqual(
    manifest.flowNodes.map((node) => node.pluginId),
    ["com.spacedatanetwork.sgp4"],
  );
});

test("pluginFamily resolution picks the ONE dependency exposing the requested method (heterogeneous vocabulary)", () => {
  // Only sgp4 exposes catalog_query (ruling C: no shared vocabulary is required
  // beyond whatever the node's own methodId demands).
  const flow = familyFlow({ methodId: "catalog_query" });
  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(sgp4Dependency, hpopDependency),
  });
  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.equal(flow.nodes[0].pluginId, "com.spacedatanetwork.sgp4");
});

test("pluginFamily resolution is an error, never a guess, when more than one candidate qualifies", () => {
  const flow = familyFlow(); // propagate_state: both sgp4 and hpop qualify
  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(sgp4Dependency, hpopDependency),
  });
  assert.equal(check.ok, false);
  const issue = check.errors.find((entry) => entry.code === "ambiguous-plugin-family");
  assert.ok(issue, JSON.stringify(check.issues));
  assert.match(issue.message, /com\.spacedatanetwork\.hpop/);
  assert.match(issue.message, /com\.spacedatanetwork\.sgp4/);
  assert.equal(flow.nodes[0].pluginId, undefined, "an ambiguous binding must not silently pick one");
});

test("pluginFamily resolution fails closed when no dependency in the family exposes the method", () => {
  const flow = familyFlow({ methodId: "prepare_trajectory_segments" });
  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(sgp4Dependency), // sgp4 does not expose it
  });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((entry) => entry.code === "unresolvable-plugin-family"));
});

test("pluginFamily resolution rejects an unknown family with no matching candidate", () => {
  const flow = familyFlow({ pluginFamily: "renderer" });
  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(sgp4Dependency),
  });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((entry) => entry.code === "unresolvable-plugin-family"));
});

test("a node declaring both pluginId and pluginFamily is a value error (declaration, never inference)", () => {
  const flow = familyFlow({ pluginId: "com.spacedatanetwork.sgp4" });
  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(sgp4Dependency),
  });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((entry) => entry.code === "ambiguous-plugin-binding"));
});

test("pluginFamily without a methodId to resolve against is a value error", () => {
  const flow = familyFlow({ methodId: undefined });
  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(sgp4Dependency),
  });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((entry) => entry.code === "missing-method-id"));
});

test("exact-pluginId binding is unaffected by the additive pluginFamily path", () => {
  // Backward compatibility: every pre-existing flow.json shape (no
  // pluginFamily field anywhere) must behave byte-for-byte as before.
  const check = checkFlowProgram({
    flow: makeFlow(),
    dependencies: dependencyMap(producerDependency, consumerDependency),
  });
  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.deepEqual(
    check.nodes.map((node) => node.resolvedFromPluginFamily),
    [null, null, null],
  );
});

test("flow check preserves exact hash-bound isomorphic child dispatch", () => {
  const producer = {
    ...producerDependency,
    guestLink: null,
  };
  const consumer = {
    ...consumerDependency,
    guestLink: null,
  };
  const flow = makeFlow({
    nodes: makeFlow().nodes.map((node) =>
      node.pluginId === "test.sink"
        ? node
        : {
            ...node,
            dispatchModel: "isomorphic",
            artifact: {
              path: `nodes/${node.nodeId}/module.wasm`,
              sha256: node.nodeId === "producer" ? "11".repeat(32) : "22".repeat(32),
              publisher: `nodes/${node.nodeId}/publisher.json`,
            },
          },
    ),
  });

  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(producer, consumer),
  });

  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.deepEqual(
    check.nodes.map((node) => node.dispatchModel),
    ["isomorphic", "isomorphic", "host"],
  );

	const signedGraph = decodePluginManifest(
	  encodePluginManifest(buildFlowModuleManifest({
	    flow,
	    check,
	    dependencies: dependencyMap(producer, consumer),
	  })),
	);
	assert.deepEqual(
	  signedGraph.flowNodes.map((node) => node.dispatchModel ?? null),
	  ["isomorphic", "isomorphic", "host-capability"],
	  "canonical PLG dispatch must match the checked runtime dispatch model",
	);
});

test("flow check rejects an isomorphic child without an exact artifact lock", () => {
  const flow = singleNodeFlow(producerDependency, {
    dispatchModel: "isomorphic",
  });
  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(producerDependency),
  });

  assert.equal(check.ok, false);
  assert.ok(
    check.errors.some((issue) => issue.code === "missing-isomorphic-artifact-lock"),
    JSON.stringify(check.issues),
  );
});

test("compiled isomorphic graph dispatches through separate child handlers without guest-link objects", async () => {
  const producerArtifact = await signedEmptyArtifact("41", "producer-test");
  const consumerArtifact = await signedEmptyArtifact("42", "consumer-test");
  const producer = {
    ...producerDependency,
    guestLink: null,
    artifactBytes: producerArtifact.bytes,
    publisherRecord: producerArtifact.publisher,
  };
  const consumer = {
    ...consumerDependency,
    guestLink: null,
    artifactBytes: consumerArtifact.bytes,
    publisherRecord: consumerArtifact.publisher,
  };
  const flow = makeFlow({
    nodes: makeFlow().nodes.map((node) =>
      node.pluginId === "test.sink"
        ? node
        : {
            ...node,
            dispatchModel: "isomorphic",
            artifact: {
              path: `nodes/${node.nodeId}/module.wasm`,
              sha256:
                node.nodeId === "producer"
                  ? producerArtifact.sha256
                  : consumerArtifact.sha256,
              publisher: `nodes/${node.nodeId}/publisher.json`,
            },
          },
    ),
  });
  const result = await compileFlowProgram({
    flow,
    dependencies: dependencyMap(producer, consumer),
    catalog: catalogForManifests(producer.manifest, consumer.manifest),
  });
  const host = await createFlowRuntimeHost({ wasmSource: result.wasmBytes });

  assert.equal(host.dependencyCount, 2);
  assert.equal(host.getNodeDispatchDescriptor(0).dispatchModel, "isomorphic");
  assert.equal(host.getNodeDispatchDescriptor(1).dispatchModel, "isomorphic");
  assert.equal(host.getDependencyDescriptor(0).sha256, producerArtifact.sha256);
  assert.equal(host.getDependencyDescriptor(1).sha256, consumerArtifact.sha256);

  const canonicalType = (method, direction, portId) =>
    method[direction]
      .find((candidate) => candidate.portId === portId)
      .acceptedTypeSets[0].allowedTypes
      .find((typeRef) => typeRef.wireFormat === "flatbuffer");
  const producerMethod = producer.manifest.methods[0];
  const consumerMethod = consumer.manifest.methods[0];
  const seen = [];
  let producerInputTypeRef = null;
  assert.throws(
    () =>
      host.enqueueTriggerFrame(0, {
        portId: "request",
        bytes: new TextEncoder().encode("wrong-type"),
        typeRef: canonicalType(producerMethod, "outputPorts", "stream"),
      }),
    /Flow runtime rejected trigger frame \(-53\)/,
  );
  assert.equal(host.getNodeState(0).queuedFrames, 0);
  assert.equal(host.getRoutingState().rejectedFrames, 1n);
  host.resetState();
  host.enqueueTriggerFrame(0, {
    portId: "request",
    bytes: new TextEncoder().encode("request"),
  });
  await host.drain(
    {
      "test.producer:produce": ({ frames }) => {
        seen.push("producer");
        assert.equal(new TextDecoder().decode(frames[0].bytes), "request");
        producerInputTypeRef = frames[0].typeRef;
        return {
          outputs: [
            {
              portId: "stream",
              bytes: new TextEncoder().encode("orbit"),
              typeRef: canonicalType(producerMethod, "outputPorts", "stream"),
            },
          ],
        };
      },
      "test.consumer:consume": ({ frames }) => {
        seen.push("consumer");
        assert.equal(new TextDecoder().decode(frames[0].bytes), "orbit");
        return {
          outputs: [
            {
              portId: "done",
              bytes: new TextEncoder().encode("stored"),
              typeRef: canonicalType(consumerMethod, "outputPorts", "done"),
            },
          ],
        };
      },
      "test.sink:collect": ({ frames }) => {
        seen.push("sink");
        assert.equal(new TextDecoder().decode(frames[0].bytes), "stored");
        return { statusCode: 0 };
      },
    },
    { maxIterations: 10 },
  );

  assert.deepEqual(seen, ["producer", "consumer", "sink"]);
  const expectedInputTypeRef = canonicalType(producerMethod, "inputPorts", "request");
  assert.deepEqual(
    {
      ...producerInputTypeRef,
      schemaHash: Array.from(producerInputTypeRef?.schemaHash ?? []),
    },
    {
      ...expectedInputTypeRef,
      schemaHash: Array.from(expectedInputTypeRef.schemaHash ?? []),
    },
  );
});

test("null trigger startup carries the target port canonical identity without graph edges", async () => {
  const triggerArtifact = await signedEmptyArtifact("49", "trigger-type-identity-test");
  const triggerDependencyBase = makeDependency({
    pluginId: "test.trigger-type-identity",
    methods: [
      {
        methodId: "run",
        inputPorts: [
          port("start", {
            typeSets: [
              dualTypeSet("start", "TriggerStart.fbs", "TRG1", {
                schemaVersion: "4.2.0",
                schemaHash: [0xaa, 0xbb, 0xcc, 0xdd],
                rootTypeName: "TriggerStart",
              }),
            ],
          }),
          port("aux", {
            required: false,
            typeSets: [dualTypeSet("aux", "TriggerAux.fbs", "AUX1")],
          }),
        ],
        outputPorts: [],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  });
  const triggerDependency = {
    ...triggerDependencyBase,
    guestLink: null,
    artifactBytes: triggerArtifact.bytes,
    publisherRecord: triggerArtifact.publisher,
  };
  const flow = {
    programId: "test.trigger-type-identity-flow",
    name: "Trigger type identity flow",
    version: "0.1.0",
    nodes: [
      {
        nodeId: "target",
        pluginId: triggerDependency.pluginId,
        methodId: "run",
        kind: "transform",
        dispatchModel: "isomorphic",
        artifact: {
          path: "nodes/target/module.wasm",
          sha256: triggerArtifact.sha256,
          publisher: "nodes/target/publisher.json",
        },
      },
    ],
    edges: [],
    triggers: [{ triggerId: "startup", kind: "startup" }],
    triggerBindings: [
      { triggerId: "startup", targetNodeId: "target", targetPortId: "start" },
    ],
    requiredPlugins: [triggerDependency.pluginId],
  };
  const result = await compileFlowProgram({
    flow,
    dependencies: dependencyMap(triggerDependency),
    catalog: catalogForManifests(triggerDependency.manifest),
  });
  const host = await createFlowRuntimeHost({ wasmSource: result.wasmBytes });

  assert.equal(host.edgeCount, 0, "trigger descriptors must not become routing edges");
  assert.equal(host.typeDescriptorCount, 1);
  const triggerDescriptor = host.getEdgeDescriptor(0);
  assert.deepEqual(
    {
      fromNode: triggerDescriptor.fromNode,
      fromPort: triggerDescriptor.fromPort,
      toNode: triggerDescriptor.toNode,
      toPort: triggerDescriptor.toPort,
      schemaName: triggerDescriptor.schemaName,
      fileIdentifier: triggerDescriptor.fileIdentifier,
      schemaVersion: triggerDescriptor.schemaVersion,
      schemaHash: Array.from(triggerDescriptor.schemaHash),
      rootTypeName: triggerDescriptor.rootTypeName,
    },
    {
      fromNode: 0,
      fromPort: "@trigger:startup:0",
      toNode: 0,
      toPort: "start",
      schemaName: "TriggerStart.fbs",
      fileIdentifier: "TRG1",
      schemaVersion: "4.2.0",
      schemaHash: [0xaa, 0xbb, 0xcc, 0xdd],
      rootTypeName: "TriggerStart",
    },
  );

  host.enqueueTrigger(0);
  const received = [];
  await host.drain(
    {
      "test.trigger-type-identity:run": ({ frames }) => {
        received.push(...frames);
        return { statusCode: 0 };
      },
    },
    { maxIterations: 4 },
  );

  assert.equal(received.length, 1);
  assert.deepEqual(received[0].typeRef, {
    schemaName: "TriggerStart.fbs",
    fileIdentifier: "TRG1",
    schemaVersion: "4.2.0",
    schemaHash: Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd]),
    rootTypeName: "TriggerStart",
    wireFormat: "flatbuffer",
  });

  host.resetState();
  host.enqueueTriggerFrame(0, {
    portId: "spoofed-port",
    bytes: new TextEncoder().encode("target-bound"),
  });
  const targetBound = [];
  await host.drain(
    {
      "test.trigger-type-identity:run": ({ frames }) => {
        targetBound.push(...frames);
        return { statusCode: 0 };
      },
    },
    { maxIterations: 4 },
  );
  assert.equal(targetBound.length, 1);
  assert.equal(targetBound[0].portId, "start");
  assert.equal(new TextDecoder().decode(targetBound[0].bytes), "target-bound");
});

test("explicit trigger type queues the target-bound descriptor instead of an equivalent real edge", async () => {
  const triggerArtifact = await signedEmptyArtifact("4a", "trigger-target-descriptor-test");
  const dependencyBase = makeDependency({
    pluginId: "test.trigger-target-descriptor",
    methods: [
      {
        methodId: "run",
        inputPorts: [
          port("start", {
            typeSets: [dualTypeSet("start", "SharedTrigger.fbs", "SHRD")],
          }),
        ],
        outputPorts: [
          port("forward", {
            typeSets: [dualTypeSet("forward", "SharedTrigger.fbs", "SHRD")],
          }),
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  });
  const dependency = {
    ...dependencyBase,
    guestLink: null,
    artifactBytes: triggerArtifact.bytes,
    publisherRecord: triggerArtifact.publisher,
  };
  const flow = {
    programId: "test.trigger-target-descriptor-flow",
    name: "Trigger target descriptor flow",
    version: "0.1.0",
    nodes: [
      {
        nodeId: "target",
        pluginId: dependency.pluginId,
        methodId: "run",
        kind: "transform",
        dispatchModel: "isomorphic",
        artifact: {
          path: "nodes/target/module.wasm",
          sha256: triggerArtifact.sha256,
          publisher: "nodes/target/publisher.json",
        },
      },
      { nodeId: "sink", pluginId: "test.sink", methodId: "collect", kind: "sink" },
    ],
    edges: [
      { fromNodeId: "target", fromPortId: "forward", toNodeId: "sink", toPortId: "in" },
    ],
    triggers: [{ triggerId: "startup", kind: "startup" }],
    triggerBindings: [
      { triggerId: "startup", targetNodeId: "target", targetPortId: "start" },
    ],
    requiredPlugins: [dependency.pluginId],
  };
  const result = await compileFlowProgram({
    flow,
    dependencies: dependencyMap(dependency),
    catalog: catalogForManifests(dependency.manifest),
  });
  const host = await createFlowRuntimeHost({ wasmSource: result.wasmBytes });
  const canonicalInput = dependency.manifest.methods[0].inputPorts[0]
    .acceptedTypeSets[0].allowedTypes.find(
      (typeRef) => typeRef.wireFormat === "flatbuffer",
    );

  host.enqueueTriggerFrame(0, {
    portId: "start",
    bytes: new TextEncoder().encode("target"),
    typeRef: canonicalInput,
  });
  const runtimeExport = (name) =>
    host.instance.exports[`space_data_module_runtime_${name}`] ??
    host.instance.exports[`_space_data_module_runtime_${name}`];
  assert.equal(runtimeExport("get_ready_node_index")(), 0);
  assert.equal(runtimeExport("begin_node_invocation")(0, 64), 1);
  const invocationPtr = runtimeExport("get_current_invocation_descriptor")();
  const invocationView = new DataView(host.memory.buffer);
  const framesPtr = invocationView.getUint32(invocationPtr + 16, true);
  const queuedTypeDescriptorIndex = invocationView.getUint32(framesPtr + 4, true);

  assert.equal(host.edgeCount, 1);
  assert.equal(host.typeDescriptorCount, 2);
  assert.equal(queuedTypeDescriptorIndex, 1);
  assert.deepEqual(
    {
      toNode: host.getEdgeDescriptor(queuedTypeDescriptorIndex).toNode,
      toPort: host.getEdgeDescriptor(queuedTypeDescriptorIndex).toPort,
    },
    { toNode: 0, toPort: "start" },
  );
  runtimeExport("complete_node_invocation")(0);
});

test("trigger descriptor sentinel cannot collide with or route a declared output port", async () => {
  const triggerArtifact = await signedEmptyArtifact("4b", "trigger-sentinel-test");
  const collidingPortId = "@trigger:startup:0";
  const dependencyBase = makeDependency({
    pluginId: "test.trigger-sentinel",
    methods: [
      {
        methodId: "run",
        inputPorts: [
          port("start", {
            typeSets: [dualTypeSet("start", "SentinelFrame.fbs", "SNTL")],
          }),
        ],
        outputPorts: [
          port(collidingPortId, {
            typeSets: [dualTypeSet("collision", "SentinelFrame.fbs", "SNTL")],
          }),
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  });
  const dependency = {
    ...dependencyBase,
    guestLink: null,
    artifactBytes: triggerArtifact.bytes,
    publisherRecord: triggerArtifact.publisher,
  };
  const flow = {
    programId: "test.trigger-sentinel-flow",
    name: "Trigger sentinel flow",
    version: "0.1.0",
    nodes: [
      {
        nodeId: "target",
        pluginId: dependency.pluginId,
        methodId: "run",
        kind: "transform",
        dispatchModel: "isomorphic",
        artifact: {
          path: "nodes/target/module.wasm",
          sha256: triggerArtifact.sha256,
          publisher: "nodes/target/publisher.json",
        },
      },
    ],
    edges: [],
    triggers: [{ triggerId: "startup", kind: "startup" }],
    triggerBindings: [
      { triggerId: "startup", targetNodeId: "target", targetPortId: "start" },
    ],
    requiredPlugins: [dependency.pluginId],
  };
  const result = await compileFlowProgram({
    flow,
    dependencies: dependencyMap(dependency),
    catalog: catalogForManifests(dependency.manifest),
  });
  const host = await createFlowRuntimeHost({ wasmSource: result.wasmBytes });
  const canonicalInput = dependency.manifest.methods[0].inputPorts[0]
    .acceptedTypeSets[0].allowedTypes.find(
      (typeRef) => typeRef.wireFormat === "flatbuffer",
    );

  assert.equal(host.edgeCount, 0);
  assert.equal(host.typeDescriptorCount, 1);
  assert.equal(host.getEdgeDescriptor(0).fromPort, `${collidingPortId}:1`);

  host.enqueueTrigger(0);
  await host.drain(
    {
      "test.trigger-sentinel:run": () => ({
        outputs: [
          {
            portId: collidingPortId,
            bytes: new TextEncoder().encode("must-not-route"),
            typeRef: canonicalInput,
          },
        ],
      }),
    },
    { maxIterations: 4 },
  );
  assert.equal(host.getNodeState(0).invocationCount, 1n);
  assert.equal(host.getNodeState(0).queuedFrames, 0);
  assert.equal(host.getRoutingState().canonicalRoutes, 0n);
});

test("explicit trigger type validation is all-or-nothing across fanout bindings", async () => {
  const triggerArtifact = await signedEmptyArtifact("4c", "trigger-fanout-test");
  const makeTarget = (pluginId, schemaName, fileIdentifier) => {
    const base = makeDependency({
      pluginId,
      methods: [
        {
          methodId: "run",
          inputPorts: [
            port("start", {
              typeSets: [dualTypeSet("start", schemaName, fileIdentifier)],
            }),
          ],
          outputPorts: [],
          maxBatch: 1,
          drainPolicy: "single-shot",
        },
      ],
    });
    return {
      ...base,
      guestLink: null,
      artifactBytes: triggerArtifact.bytes,
      publisherRecord: triggerArtifact.publisher,
    };
  };
  const first = makeTarget("test.trigger-fanout-first", "FanoutA.fbs", "FNOA");
  const second = makeTarget("test.trigger-fanout-second", "FanoutB.fbs", "FNOB");
  const flow = {
    programId: "test.trigger-fanout-flow",
    name: "Trigger fanout flow",
    version: "0.1.0",
    nodes: [
      ...[first, second].map((dependency, index) => ({
        nodeId: `target-${index}`,
        pluginId: dependency.pluginId,
        methodId: "run",
        kind: "transform",
        dispatchModel: "isomorphic",
        artifact: {
          path: `nodes/target-${index}/module.wasm`,
          sha256: triggerArtifact.sha256,
          publisher: `nodes/target-${index}/publisher.json`,
        },
      })),
    ],
    edges: [],
    triggers: [{ triggerId: "startup", kind: "startup" }],
    triggerBindings: [
      { triggerId: "startup", targetNodeId: "target-0", targetPortId: "start" },
      { triggerId: "startup", targetNodeId: "target-1", targetPortId: "start" },
    ],
    requiredPlugins: [first.pluginId, second.pluginId],
  };
  const result = await compileFlowProgram({
    flow,
    dependencies: dependencyMap(first, second),
    catalog: catalogForManifests(first.manifest, second.manifest),
  });
  const host = await createFlowRuntimeHost({ wasmSource: result.wasmBytes });
  const firstCanonical = first.manifest.methods[0].inputPorts[0]
    .acceptedTypeSets[0].allowedTypes.find(
      (typeRef) => typeRef.wireFormat === "flatbuffer",
    );

  assert.throws(
    () =>
      host.enqueueTriggerFrame(0, {
        portId: "start",
        bytes: new TextEncoder().encode("must-not-partially-enqueue"),
        typeRef: firstCanonical,
      }),
    /Flow runtime rejected trigger frame \(-53\)/,
  );
  assert.equal(host.getNodeState(0).queuedFrames, 0);
  assert.equal(host.getNodeState(1).queuedFrames, 0);
  assert.equal(host.getIngressState(0).totalReceived, 0n);
  assert.equal(host.getRoutingState().rejectedFrames, 1n);
});

test("non-empty untyped trigger fanout rejects incompatible SDS identities atomically", async () => {
  const triggerArtifact = await signedEmptyArtifact("4d", "untyped-trigger-fanout-test");
  const makeTarget = (pluginId, schemaName, fileIdentifier) => {
    const base = makeDependency({
      pluginId,
      methods: [
        {
          methodId: "run",
          inputPorts: [
            port("start", {
              typeSets: [dualTypeSet("start", schemaName, fileIdentifier)],
            }),
          ],
          outputPorts: [],
          maxBatch: 1,
          drainPolicy: "single-shot",
        },
      ],
    });
    return {
      ...base,
      guestLink: null,
      artifactBytes: triggerArtifact.bytes,
      publisherRecord: triggerArtifact.publisher,
    };
  };
  const first = makeTarget("test.untyped-fanout-first", "FanoutA.fbs", "FNOA");
  const second = makeTarget("test.untyped-fanout-second", "FanoutB.fbs", "FNOB");
  const flow = {
    programId: "test.untyped-trigger-fanout-flow",
    name: "Untyped trigger fanout flow",
    version: "0.1.0",
    nodes: [first, second].map((dependency, index) => ({
      nodeId: `target-${index}`,
      pluginId: dependency.pluginId,
      methodId: "run",
      kind: "transform",
      dispatchModel: "isomorphic",
      artifact: {
        path: `nodes/target-${index}/module.wasm`,
        sha256: triggerArtifact.sha256,
        publisher: `nodes/target-${index}/publisher.json`,
      },
    })),
    edges: [],
    triggers: [{ triggerId: "startup", kind: "startup" }],
    triggerBindings: [
      { triggerId: "startup", targetNodeId: "target-0", targetPortId: "start" },
      { triggerId: "startup", targetNodeId: "target-1", targetPortId: "start" },
    ],
    requiredPlugins: [first.pluginId, second.pluginId],
  };
  const result = await compileFlowProgram({
    flow,
    dependencies: dependencyMap(first, second),
    catalog: catalogForManifests(first.manifest, second.manifest),
  });
  const host = await createFlowRuntimeHost({ wasmSource: result.wasmBytes });

  assert.throws(
    () => host.enqueueTriggerFrame(0, {
      portId: "start",
      bytes: new TextEncoder().encode("ambiguous"),
    }),
    /Flow runtime rejected trigger frame \(-54\)/,
  );
  assert.equal(host.getNodeState(0).queuedFrames, 0);
  assert.equal(host.getNodeState(1).queuedFrames, 0);
  assert.equal(host.getIngressState(0).totalReceived, 0n);
  assert.equal(host.getRoutingState().rejectedFrames, 1n);

  assert.doesNotThrow(() => host.enqueueTriggerFrame(0, {
    portId: "start",
    bytes: new Uint8Array(),
  }));
  assert.equal(host.getNodeState(0).queuedFrames, 1);
  assert.equal(host.getNodeState(1).queuedFrames, 1);
});

test("flow compile rejects an unsigned isomorphic child even when its SHA lock matches", async () => {
  const rawWasm = Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  ]);
  const signed = await signedEmptyArtifact("43", "unsigned-rejection-test");
  const dependency = {
    ...producerDependency,
    guestLink: null,
    artifactBytes: rawWasm,
    publisherRecord: signed.publisher,
  };
  const flow = singleNodeFlow(dependency, {
    dispatchModel: "isomorphic",
    artifact: {
      path: "nodes/unsigned/module.wasm",
      sha256: createHash("sha256").update(rawWasm).digest("hex"),
      publisher: "nodes/unsigned/publisher.json",
    },
  });

  await assert.rejects(
    () =>
      compileFlowProgram({
        flow,
        dependencies: dependencyMap(dependency),
        catalog: catalogForManifests(dependency.manifest),
      }),
    /unsigned|signature/i,
  );
});

test("flow check rejects dependency ports without dual representations", () => {
  const dependency = makeDependency({
    pluginId: "test.canonical-only",
    methods: [
      {
        methodId: "run",
        inputPorts: [
          port("request", {
            typeSets: [
              {
                setId: "request",
                allowedTypes: [
                  {
                    schemaName: "OMM.fbs",
                    fileIdentifier: "$OMM",
                    schemaVersion: "1.0.0",
                    schemaHash: [0x10, 0x20, 0x30, 0x40],
                    rootTypeName: "OMM",
                    wireFormat: "flatbuffer",
                  },
                ],
              },
            ],
          }),
        ],
        outputPorts: [],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  });

  const check = checkFlowProgram({
    flow: singleNodeFlow(dependency),
    dependencies: dependencyMap(dependency),
  });

  // Canonical-only is legal — the aligned peer is the shared-arena
  // optimization, not a conformance obligation — and the flow simply never
  // takes the aligned route for this port.
  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.ok(
    check.warnings.some((issue) => issue.code === "no-aligned-peer"),
    JSON.stringify(check.issues),
  );
});

test("flow check requires an exact SDS identity intersection on every edge", () => {
  const producer = makeDependency({
    pluginId: "test.identity-producer",
    methods: [
      {
        methodId: "produce",
        inputPorts: [
          port("request", {
            typeSets: [dualTypeSet("request", "Request.fbs", "RQST")],
          }),
        ],
        outputPorts: [
          port("records", {
            typeSets: [dualTypeSet("records", "OMM.fbs", "$OMM")],
          }),
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  });
  const consumer = makeDependency({
    pluginId: "test.identity-consumer",
    methods: [
      {
        methodId: "consume",
        inputPorts: [
          port("records", {
            typeSets: [dualTypeSet("records", "OMM.fbs", "DIFF")],
          }),
        ],
        outputPorts: [],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  });
  const flow = {
    programId: "test.identity-edge",
    nodes: [
      { nodeId: "producer", pluginId: producer.pluginId, methodId: "produce" },
      { nodeId: "consumer", pluginId: consumer.pluginId, methodId: "consume" },
    ],
    edges: [
      {
        fromNodeId: "producer",
        fromPortId: "records",
        toNodeId: "consumer",
        toPortId: "records",
      },
    ],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [
      {
        triggerId: "manual",
        targetNodeId: "producer",
        targetPortId: "request",
      },
    ],
    requiredPlugins: [producer.pluginId, consumer.pluginId],
  };

  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(producer, consumer),
  });

  assert.equal(check.ok, false);
  assert.ok(
    check.errors.some(
      (issue) => issue.code === "edge-missing-canonical-fallback",
    ),
    JSON.stringify(check.issues),
  );
});

test("flow check preserves hex schema hashes and rejects unequal values", () => {
  const producer = makeDependency({
    pluginId: "test.hash-producer",
    methods: [
      {
        methodId: "produce",
        inputPorts: [
          port("start", {
            typeSets: [dualTypeSet("start", "Start.fbs", "STRT")],
          }),
        ],
        outputPorts: [
          port("records", {
            typeSets: [
              dualTypeSet("records", "OMM.fbs", "$OMM", {
                schemaHash: "10",
              }),
            ],
          }),
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  });
  const consumer = makeDependency({
    pluginId: "test.hash-consumer",
    methods: [
      {
        methodId: "consume",
        inputPorts: [
          port("records", {
            typeSets: [
              dualTypeSet("records", "OMM.fbs", "$OMM", {
                schemaHash: "20",
              }),
            ],
          }),
        ],
        outputPorts: [],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  });
  const flow = {
    programId: "test.hash-edge",
    nodes: [
      { nodeId: "producer", pluginId: producer.pluginId, methodId: "produce" },
      { nodeId: "consumer", pluginId: consumer.pluginId, methodId: "consume" },
    ],
    edges: [
      {
        fromNodeId: "producer",
        fromPortId: "records",
        toNodeId: "consumer",
        toPortId: "records",
      },
    ],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [
      {
        triggerId: "manual",
        targetNodeId: "producer",
        targetPortId: "start",
      },
    ],
    requiredPlugins: [producer.pluginId, consumer.pluginId],
  };

  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(producer, consumer),
  });

  assert.equal(check.ok, false);
  assert.ok(
    check.errors.some((issue) => issue.code === "edge-type-mismatch"),
    JSON.stringify(check.issues),
  );
});

test("flow check rejects incompatible aligned layouts", () => {
  const producer = makeDependency({
    pluginId: "test.layout-producer",
    methods: [
      {
        methodId: "produce",
        inputPorts: [
          port("start", {
            typeSets: [dualTypeSet("start", "Start.fbs", "STRT")],
          }),
        ],
        outputPorts: [
          port("records", {
            typeSets: [
              dualTypeSet("records", "OMM.fbs", "$OMM", {
                byteLength: 64,
                requiredAlignment: 8,
              }),
            ],
          }),
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  });
  const consumer = makeDependency({
    pluginId: "test.layout-consumer",
    methods: [
      {
        methodId: "consume",
        inputPorts: [
          port("records", {
            typeSets: [
              dualTypeSet("records", "OMM.fbs", "$OMM", {
                byteLength: 64,
                requiredAlignment: 16,
              }),
            ],
          }),
        ],
        outputPorts: [],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  });
  const flow = {
    programId: "test.layout-fallback",
    nodes: [
      { nodeId: "producer", pluginId: producer.pluginId, methodId: "produce" },
      { nodeId: "consumer", pluginId: consumer.pluginId, methodId: "consume" },
    ],
    edges: [
      {
        fromNodeId: "producer",
        fromPortId: "records",
        toNodeId: "consumer",
        toPortId: "records",
      },
    ],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [
      {
        triggerId: "manual",
        targetNodeId: "producer",
        targetPortId: "start",
      },
    ],
    requiredPlugins: [producer.pluginId, consumer.pluginId],
  };

  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(producer, consumer),
  });

  assert.equal(check.ok, false);
  assert.ok(
    check.errors.some(
      (issue) => issue.code === "edge-aligned-layout-mismatch",
    ),
    JSON.stringify(check.issues),
  );
});

test("flow check rejects an unresolved host node used as a schema bridge", () => {
  const producer = makeDependency({
    pluginId: "test.host-bridge-producer",
    methods: [
      {
        methodId: "produce",
        inputPorts: [
          port("start", {
            typeSets: [dualTypeSet("start", "Start.fbs", "STRT")],
          }),
        ],
        outputPorts: [
          port("records", {
            typeSets: [dualTypeSet("records", "OMM.fbs", "$OMM")],
          }),
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  });
  const consumer = makeDependency({
    pluginId: "test.host-bridge-consumer",
    methods: [
      {
        methodId: "consume",
        inputPorts: [
          port("records", {
            typeSets: [dualTypeSet("records", "OCM.fbs", "$OCM")],
          }),
        ],
        outputPorts: [],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  });
  const flow = {
    programId: "test.host-schema-bridge",
    nodes: [
      { nodeId: "producer", pluginId: producer.pluginId, methodId: "produce" },
      {
        nodeId: "bridge",
        pluginId: "test.unresolved-host-bridge",
        methodId: "route",
        kind: "sink",
      },
      { nodeId: "consumer", pluginId: consumer.pluginId, methodId: "consume" },
    ],
    edges: [
      {
        fromNodeId: "producer",
        fromPortId: "records",
        toNodeId: "bridge",
        toPortId: "in",
      },
      {
        fromNodeId: "bridge",
        fromPortId: "out",
        toNodeId: "consumer",
        toPortId: "records",
      },
    ],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [
      {
        triggerId: "manual",
        targetNodeId: "producer",
        targetPortId: "start",
      },
    ],
    requiredPlugins: [producer.pluginId, consumer.pluginId],
  };

  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(producer, consumer),
  });

  assert.equal(check.ok, false);
  assert.ok(
    check.errors.some((issue) => issue.code === "host-node-schema-bridge"),
    JSON.stringify(check.issues),
  );
});

test("flow check records aligned eligibility only for identical dual layouts", () => {
  const sharedTypeSet = dualTypeSet("records", "OMM.fbs", "$OMM", {
    byteLength: 64,
    requiredAlignment: 8,
  });
  const producer = makeDependency({
    pluginId: "test.exact-layout-producer",
    methods: [
      {
        methodId: "produce",
        inputPorts: [
          port("start", {
            typeSets: [dualTypeSet("start", "Start.fbs", "STRT")],
          }),
        ],
        outputPorts: [port("records", { typeSets: [sharedTypeSet] })],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  });
  const consumer = makeDependency({
    pluginId: "test.exact-layout-consumer",
    methods: [
      {
        methodId: "consume",
        inputPorts: [port("records", { typeSets: [sharedTypeSet] })],
        outputPorts: [],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  });
  const flow = {
    programId: "test.exact-layout",
    nodes: [
      { nodeId: "producer", pluginId: producer.pluginId, methodId: "produce" },
      { nodeId: "consumer", pluginId: consumer.pluginId, methodId: "consume" },
    ],
    edges: [
      {
        fromNodeId: "producer",
        fromPortId: "records",
        toNodeId: "consumer",
        toPortId: "records",
      },
    ],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [
      {
        triggerId: "manual",
        targetNodeId: "producer",
        targetPortId: "start",
      },
    ],
    requiredPlugins: [producer.pluginId, consumer.pluginId],
  };

  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(producer, consumer),
  });

  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.deepEqual(check.edgeTypeContracts[0].compatibleWireFormats, [
    "flatbuffer",
    "aligned-binary",
  ]);
});

test("flow check rejects a mix of wasi-threads and single-thread guest objects", () => {
  const threadedProducer = {
    ...producerDependency,
    guestLink: {
      ...producerDependency.guestLink,
      metadata: {
        ...producerDependency.guestLink.metadata,
        threadModel: "wasi-threads",
      },
    },
  };
  const singleThreadConsumer = {
    ...consumerDependency,
    guestLink: {
      ...consumerDependency.guestLink,
      metadata: {
        ...consumerDependency.guestLink.metadata,
        threadModel: "single-thread",
      },
    },
  };

  const check = checkFlowProgram({
    flow: makeFlow(),
    dependencies: dependencyMap(threadedProducer, singleThreadConsumer),
  });

  assert.equal(check.ok, false);
  assert.ok(check.errors.some((issue) => issue.code === "mixed-guest-thread-models"));
});

test("explicit node capabilities take precedence and preserve an empty capability slice", () => {
  const dependency = makeDependency({
    pluginId: "test.precise-empty",
    capabilities: ["http", "crypto_sign"],
    guestCapabilities: ["http"],
    methods: producerDependency.manifest.methods,
  });
  const check = checkFlowProgram({
    flow: singleNodeFlow(dependency, { capabilities: [] }),
    dependencies: dependencyMap(dependency),
  });

  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.deepEqual(check.capabilities, []);
});

test("guest-link capabilities override broad root-manifest capabilities", () => {
  const dependency = makeDependency({
    pluginId: "test.precise-guest",
    capabilities: ["http", "crypto_sign"],
    guestCapabilities: ["http"],
    methods: producerDependency.manifest.methods,
  });
  const check = checkFlowProgram({
    flow: singleNodeFlow(dependency),
    dependencies: dependencyMap(dependency),
  });

  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.deepEqual(check.capabilities, ["http"]);
});

test("root-manifest capabilities remain the conservative fallback", () => {
  const dependency = makeDependency({
    pluginId: "test.capability-fallback",
    capabilities: ["http", "crypto_sign"],
    methods: producerDependency.manifest.methods,
  });
  const check = checkFlowProgram({
    flow: singleNodeFlow(dependency),
    dependencies: dependencyMap(dependency),
  });

  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.deepEqual(check.capabilities, ["crypto_sign", "http"]);
});

test("flow check rejects a node capability escalation beyond its root manifest", () => {
  const dependency = makeDependency({
    pluginId: "test.capability-escalation",
    capabilities: ["http"],
    guestCapabilities: ["http"],
    methods: producerDependency.manifest.methods,
  });
  const check = checkFlowProgram({
    flow: singleNodeFlow(dependency, { capabilities: ["http", "process_exec"] }),
    dependencies: dependencyMap(dependency),
  });

  assert.equal(check.ok, false);
  assert.ok(check.errors.some((issue) => issue.code === "capability-escalation"));
});

test("flow compile rejects an invalid DEPENDENCY manifest before writing outputs", async (t) => {
  // The node's OWN manifest is the defect here: it declares the browser
  // alongside a capability the browser cannot serve. That is caught at the
  // per-dependency standards pass, BEFORE the composed manifest exists — which
  // is why the composed-manifest pre-bake path needs its own test below rather
  // than borrowing this one's name.
  const dependency = makeDependency({
    pluginId: "test.invalid-browser-capability",
    capabilities: ["process_exec"],
    methods: producerDependency.manifest.methods,
  });
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "flow-invalid-output-test-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const outDir = path.join(tempRoot, "dist");

  await assert.rejects(
    () =>
      compileFlowProgram({
        flow: singleNodeFlow(dependency),
        dependencies: dependencyMap(dependency),
        outDir,
      }),
    (error) =>
      error?.report?.errors?.some(
        (issue) => issue.code === "capability-runtime-conflict",
      ) === true || /capability-runtime-conflict/.test(error?.message ?? ""),
  );
  assert.equal(existsSync(outDir), false, "failed compliance must not leave a dist tree");
});

test("flow compile rejects an invalid COMPOSED manifest before writing outputs", async (t) => {
  // A defect that exists ONLY on the composed manifest and that the runtime-
  // target derivation cannot launder: the flow's own blank name, which
  // `checkFlowProgram` does not police (it validates programId) and which no
  // dependency can cause. Every dependency here is valid, so reaching this
  // failure proves the composed manifest is compliance-validated before
  // anything is baked. The compiler does NOT quietly substitute programId for
  // a name the author blanked — putting words in the flow's mouth is the
  // defect class this whole change exists to remove.
  const dependency = makeDependency({
    pluginId: "test.valid-node",
    capabilities: [],
    methods: producerDependency.manifest.methods,
  });
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "flow-invalid-composed-test-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const outDir = path.join(tempRoot, "dist");

  const flow = { ...singleNodeFlow(dependency), name: "" };
  await assert.rejects(
    () =>
      compileFlowProgram({
        flow,
        dependencies: dependencyMap(dependency),
        outDir,
        catalog: catalogForManifests(dependency.manifest),
      }),
    (error) => {
      assert.match(error?.message ?? "", /Flow manifest compliance validation failed/);
      assert.ok(
        (error?.report?.errors ?? []).length > 0,
        JSON.stringify(error?.report?.issues ?? []),
      );
      return true;
    },
  );
  assert.equal(existsSync(outDir), false, "failed compliance must not leave a dist tree");
});

test("flow compile standards-validates internal dependency ports before linking", async () => {
  const fabricatedOmm = dualTypeSet("omm", "OMM.fbs", "$OMM", {
    schemaVersion: "9.9.9",
    schemaHash: [0xff, 0xee, 0xdd, 0xcc],
    rootTypeName: "FabricatedOMM",
    byteLength: 64,
    requiredAlignment: 8,
  });
  const producer = makeDependency({
    pluginId: "test.false-omm-producer",
    methods: [
      {
        methodId: "produce",
        inputPorts: [
          port("start", {
            typeSets: [dualTypeSet("start", "Start.fbs", "STRT")],
          }),
        ],
        outputPorts: [port("records", { typeSets: [fabricatedOmm] })],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  });
  const consumer = makeDependency({
    pluginId: "test.false-omm-consumer",
    methods: [
      {
        methodId: "consume",
        inputPorts: [port("records", { typeSets: [fabricatedOmm] })],
        outputPorts: [
          port("result", {
            typeSets: [dualTypeSet("result", "Result.fbs", "RSLT")],
          }),
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  });
  const flow = {
    programId: "test.false-omm-flow",
    nodes: [
      { nodeId: "producer", pluginId: producer.pluginId, methodId: "produce" },
      { nodeId: "consumer", pluginId: consumer.pluginId, methodId: "consume" },
      { nodeId: "sink", pluginId: "test.sink", methodId: "collect", kind: "sink" },
    ],
    edges: [
      {
        fromNodeId: "producer",
        fromPortId: "records",
        toNodeId: "consumer",
        toPortId: "records",
      },
      {
        fromNodeId: "consumer",
        fromPortId: "result",
        toNodeId: "sink",
        toPortId: "result",
      },
    ],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [
      { triggerId: "manual", targetNodeId: "producer", targetPortId: "start" },
    ],
    requiredPlugins: [producer.pluginId, consumer.pluginId],
  };
  const dependencies = dependencyMap(producer, consumer);
  const structuralCheck = checkFlowProgram({ flow, dependencies });
  assert.equal(structuralCheck.ok, true, JSON.stringify(structuralCheck.issues));

  const catalog = [
    {
      schemaCode: "START",
      schemaName: "Start.fbs",
      fileIdentifier: "STRT",
      version: "1.0.0",
      hash: "10203040",
      rootTypeName: "Start",
      idl: "",
      files: [],
    },
    {
      schemaCode: "OMM",
      schemaName: "OMM.fbs",
      fileIdentifier: "$OMM",
      version: "1.0.0",
      hash: "10203040",
      rootTypeName: "OMM",
      idl: "",
      files: [],
    },
    {
      schemaCode: "RESULT",
      schemaName: "Result.fbs",
      fileIdentifier: "RSLT",
      version: "1.0.0",
      hash: "10203040",
      rootTypeName: "Result",
      idl: "",
      files: [],
    },
  ];

  await assert.rejects(
    () => compileFlowProgram({ flow, dependencies, catalog }),
    (error) =>
      error?.report?.errors?.some(
        (issue) => issue.code === "standards-root-type-mismatch",
      ) === true,
  );
});

test("flow compile routes an all-wasi guest set through the wasi-threads linker", async (t) => {
  if (!wasiThreadsAvailable()) {
    t.skip("wasi-threads toolchain (wasm32-wasip1-threads) is not available.");
    return;
  }

  const manifest = {
    pluginId: "test.threaded-flow-node",
    name: "Threaded flow node",
    version: "1.0.0",
    pluginFamily: "analysis",
    capabilities: [],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    runtimeTargets: ["wasmedge"],
    methods: [
      {
        methodId: "threaded_echo",
        displayName: "Threaded echo",
        inputPorts: [
          port("request", {
            typeSets: [typedTypeSet("request", "Request.fbs", "RQST")],
          }),
        ],
        outputPorts: [],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
    schemasUsed: [],
    abiVersion: 1,
  };
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode:
      '#include <atomic>\n#include <thread>\n' +
      'extern "C" int threaded_echo(void) {\n' +
      '  std::atomic<int> value{0};\n' +
      '  std::thread worker([&]{ value.fetch_add(1, std::memory_order_seq_cst); });\n' +
      '  worker.join();\n' +
      '  return value.load();\n' +
      '}\n',
    language: "c++",
    threadModel: ModuleThreadModel.EMSCRIPTEN_PTHREADS,
    catalog: catalogForManifests(manifest),
  });
  t.after(() => cleanupCompilation(compilation));

  const dependency = {
    pluginId: manifest.pluginId,
    manifest,
    normalized: normalizeManifestForSdnFlow(manifest),
    guestLink: {
      objectBytes: compilation.guestLink.objectBytes,
      metadata: {
        symbolPrefix: compilation.guestLink.symbolPrefix,
        methodSymbols: compilation.guestLink.methodSymbols,
        threadModel: compilation.guestLink.threadModel,
        capabilities: [],
      },
    },
    wasmPath: compilation.outputPath,
  };
  const result = await compileFlowProgram({
    flow: singleNodeFlow(dependency, { capabilities: [] }),
    dependencies: dependencyMap(dependency),
    catalog: catalogForManifests(manifest),
  });
  const analysis = analyzeWasmThreadFeatures(result.wasmBytes);

  assert.equal(compilation.guestLink.threadModel, "emscripten-pthreads");
  assert.equal(result.check.threadModel, "wasi-threads");
  assert.match(result.artifact.compiler, /wasi-threads/i);
  assert.equal(analysis.isIsomorphicPthreads, true, JSON.stringify(analysis));
  assertPthreadArtifact(result.wasmBytes, { source: "all-wasi flow test" });
  const module = new WebAssembly.Module(result.wasmBytes);
  assert.ok(
    WebAssembly.Module.exports(module).some(
      (entry) => entry.kind === "memory" && entry.name === "memory",
    ),
    "flow runtime requires the imported shared memory to be re-exported",
  );
});

test("flow check fails on an unknown plugin", () => {
  const check = checkFlowProgram({
    flow: makeFlow(),
    dependencies: dependencyMap(consumerDependency),
  });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((issue) => issue.code === "unknown-plugin"));
});

test("flow check fails on an unknown method", () => {
  const flow = makeFlow();
  flow.nodes[0].methodId = "no_such_method";
  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(producerDependency, consumerDependency),
  });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((issue) => issue.code === "unknown-method"));
});

test("flow check fails on edge port type mismatch and unknown ports", () => {
  const flow = makeFlow();
  // $OMM producer output wired into the $CAQ-typed request port: type error.
  flow.edges[0] = {
    fromNodeId: "producer",
    fromPortId: "stream",
    toNodeId: "producer",
    toPortId: "request",
  };
  flow.edges.push({
    fromNodeId: "producer",
    fromPortId: "missing-port",
    toNodeId: "consumer",
    toPortId: "stream",
  });
  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(producerDependency, consumerDependency),
  });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((issue) => issue.code === "edge-type-mismatch"));
  assert.ok(check.errors.some((issue) => issue.code === "unknown-output-port"));
});

test("flow check rejects acceptsAnyFlatbuffer wildcard ports", () => {
  const flow = makeFlow();
  flow.edges.push({
    fromNodeId: "producer",
    fromPortId: "stream",
    toNodeId: "consumer",
    toPortId: "aux",
  });
  const wildcardConsumer = makeDependency({
    pluginId: consumerDependency.pluginId,
    capabilities: ["http"],
    methods: [
      {
        ...consumerDependency.manifest.methods[0],
        inputPorts: [
          consumerDependency.manifest.methods[0].inputPorts[0],
          port("aux", {
            required: false,
            typeSets: [wildcardTypeSet("aux-any")],
          }),
        ],
      },
    ],
  });
  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(producerDependency, wildcardConsumer),
  });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((issue) => issue.code === "wildcard-port-type"));
});

test("flow check validates trigger bindings", () => {
  const flow = makeFlow();
  flow.triggerBindings.push({ triggerId: "ghost", targetNodeId: "producer", targetPortId: "request" });
  flow.triggerBindings.push({ triggerId: "manual", targetNodeId: "producer", targetPortId: "no-port" });
  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(producerDependency, consumerDependency),
  });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((issue) => issue.code === "unknown-trigger"));
  assert.ok(check.errors.some((issue) => issue.code === "unknown-binding-port"));
});

test("flow check propagates transitive component dependencies into the union and bundle DEPENDENCIES", () => {
  // node module -> declares engine in its manifest DEPENDENCIES (component,
  // not a graph node); engine -> declares a nested component of its own.
  const engineDependency = makeDependency({
    pluginId: "test.flatsql-engine",
    version: "0.4.2",
    capabilities: ["database"],
    methods: [
      {
        methodId: "noop",
        inputPorts: [
          port("in", { typeSets: [typedTypeSet("in", "Engine.fbs", "ENGN")] }),
        ],
        outputPorts: [
          port("out", { typeSets: [typedTypeSet("out", "Engine.fbs", "ENGN")] }),
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
    dependencies: [{ pluginId: "test.vfs", minVersion: "2.0.0" }],
  });
  const producerWithComponent = makeDependency({
    pluginId: "test.producer",
    capabilities: ["storage_query"],
    methods: producerDependency.manifest.methods,
    dependencies: [{ PLUGIN_ID: "test.flatsql-engine", MIN_VERSION: "0.4.2" }],
  });
  const dependencies = dependencyMap(producerWithComponent, consumerDependency, engineDependency);
  const flow = makeFlow();
  const check = checkFlowProgram({ flow, dependencies });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  // Component capabilities join the union.
  assert.deepEqual(check.capabilities, ["database", "http", "storage_query"]);
  // Transitive, deduped, version-bound; unresolved nested component is
  // propagated with a warning.
  assert.deepEqual(
    check.componentDependencies.map((component) => [component.pluginId, component.minVersion, component.resolved]),
    [
      ["test.flatsql-engine", "0.4.2", true],
      ["test.vfs", "2.0.0", false],
    ],
  );
  assert.ok(check.warnings.some((issue) => issue.code === "unresolved-component-dependency"));

  // Both kinds land in the emitted flow manifest DEPENDENCIES (node deps
  // pinned to the resolved version, components carrying their bindings).
  const manifest = buildFlowModuleManifest({ flow, check, dependencies });
  assert.deepEqual(manifest.capabilities, ["database", "http", "storage_query"]);
  assert.deepEqual(manifest.dependencies, [
    { pluginId: "test.producer", minVersion: "1.0.0", maxVersion: "1.0.0" },
    { pluginId: "test.consumer", minVersion: "1.0.0", maxVersion: "1.0.0" },
    { pluginId: "test.flatsql-engine", minVersion: "0.4.2", maxVersion: null },
    { pluginId: "test.vfs", minVersion: "2.0.0", maxVersion: null },
  ]);
});

test("legacy FLOW codec retains topology for compatibility", () => {
  const decoded = decodeFlowProgram(encodeFlowDocumentProgram(makeFlow()));
  assert.equal(decoded.programId, "test.check-flow");
  assert.equal(decoded.nodes.length, 3);
  assert.equal(decoded.edges.length, 2);
  assert.equal(decoded.triggerBindings.length, 1);
});

test("canonical flow PLG round-trip binds graph topology and full boundary port identities", () => {
  const flow = makeFlow();
  const dependencies = dependencyMap(producerDependency, consumerDependency);
  const check = checkFlowProgram({ flow, dependencies });
  assert.equal(check.ok, true, JSON.stringify(check.issues));

  const manifest = buildFlowModuleManifest({ flow, check, dependencies });
  const decoded = decodePluginManifest(encodePluginManifest(manifest));

  assert.deepEqual(
    decoded.flowNodes.map((node) => node.nodeId),
    ["producer", "consumer", "egress"],
  );
  assert.deepEqual(
    decoded.flowEdges.map((edge) => [
      edge.fromNodeId,
      edge.fromPortId,
      edge.toNodeId,
      edge.toPortId,
    ]),
    [
      ["producer", "stream", "consumer", "stream"],
      ["consumer", "done", "egress", "response"],
    ],
  );
	assert.deepEqual(
	  decoded.flowEdges.map((edge) => ({
	    schemaName: edge.contract.canonicalType.schemaName,
	    canonicalWireFormat: edge.contract.canonicalType.wireFormat,
	    alignedWireFormat: edge.contract.alignedType?.wireFormat ?? null,
	    alignedByteLength: edge.contract.alignedType?.byteLength ?? null,
	    alignedRequiredAlignment:
	      edge.contract.alignedType?.requiredAlignment ?? null,
	    canonicalFallbackAvailable:
	      edge.contract.canonicalFallbackAvailable,
	    alignedEligible: edge.contract.alignedEligible,
	    routePolicy: edge.contract.routePolicy,
	  })),
	  [
	    {
	      schemaName: "OMM.fbs",
	      canonicalWireFormat: "flatbuffer",
	      alignedWireFormat: "aligned-binary",
	      alignedByteLength: 64,
	      alignedRequiredAlignment: 8,
	      canonicalFallbackAvailable: true,
	      alignedEligible: true,
	      routePolicy: "aligned-shared-arena-or-canonical",
	    },
	    {
	      schemaName: "HttpResponseAbi.fbs",
	      canonicalWireFormat: "flatbuffer",
	      alignedWireFormat: null,
	      alignedByteLength: null,
	      alignedRequiredAlignment: null,
	      canonicalFallbackAvailable: true,
	      alignedEligible: false,
	      routePolicy: "canonical-only",
	    },
	  ],
	  "signed PLG edge contracts must bind exact identity, layout, fallback, and routing policy",
	);
  assert.deepEqual(
    decoded.flowTriggers.map((trigger) => trigger.triggerId),
    ["manual"],
  );
  const ingressPair = decoded.methods[0].inputPorts[0].acceptedTypeSets[0]
    .allowedTypes;
  assert.deepEqual(
    ingressPair.map((typeRef) => ({
      schemaVersion: typeRef.schemaVersion,
      schemaHash: [...typeRef.schemaHash],
      rootTypeName: typeRef.rootTypeName,
      wireFormat: typeRef.wireFormat,
    })),
    [
      {
        schemaVersion: "1.0.0",
        schemaHash: [0x10, 0x20, 0x30, 0x40],
        rootTypeName: "CAQ",
        wireFormat: "flatbuffer",
      },
      {
        schemaVersion: "1.0.0",
        schemaHash: [0x10, 0x20, 0x30, 0x40],
        rootTypeName: "CAQ",
        wireFormat: "aligned-binary",
      },
    ],
  );
});

// ---------------------------------------------------------------------------
// Golden compile — compile a two-node passthrough module with emception, link
// both methods directly into a flow bundle, prove the exact validated internal
// edge contract is resident in the runtime WASM, and drain it in the JS host.
// ---------------------------------------------------------------------------

test("flow compile binds exact edge contracts into the emitted runtime WASM", async () => {
  const internalTypeSet = dualTypeSet(
    "intermediate",
    "Intermediate.fbs",
    "MID1",
    {
      schemaVersion: "7.1.2",
      schemaHash: [0xde, 0xad, 0xbe, 0xef],
      rootTypeName: "IntermediateRecord",
      byteLength: 96,
      fixedStringLength: 24,
      requiredAlignment: 16,
    },
  );
  const chainManifest = {
    pluginId: "test.contract-chain",
    name: "Contract chain",
    version: "1.0.0",
    pluginFamily: "foundation",
    capabilities: [],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    runtimeTargets: ["browser"],
    methods: [
      {
        methodId: "first",
        displayName: "First",
        inputPorts: [
          port("start", {
            typeSets: [
              dualTypeSet("start", "OMM.fbs", "$OMM", {
                schemaVersion: null,
                schemaHash: null,
              }),
            ],
          }),
        ],
        outputPorts: [
          port("intermediate", { typeSets: [internalTypeSet] }),
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
      {
        methodId: "second",
        displayName: "Second",
        inputPorts: [
          port("intermediate", { typeSets: [internalTypeSet] }),
        ],
        outputPorts: [
          port("out", {
            typeSets: [
              dualTypeSet("out", "CAT.fbs", "$CAT", {
                schemaVersion: null,
                schemaHash: null,
              }),
            ],
          }),
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
    schemasUsed: [],
    abiVersion: 1,
  };
  const compilation = await compileModuleFromSource({
    manifest: chainManifest,
    // Explicit since browser targeting no longer implies a toolchain.
    threadModel: "single-thread",
    sourceCode: `
#include <stdint.h>
#include "space_data_module_invoke.h"

extern "C" int first(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) { plugin_set_error("no-input", "first requires a frame"); return 400; }
  plugin_push_output("intermediate", 0, 0, frame->payload, frame->payload_length);
  return 0;
}

extern "C" int second(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) { plugin_set_error("no-input", "second requires a frame"); return 400; }
  plugin_push_output("out", 0, 0, frame->payload, frame->payload_length);
  return 0;
}
`,
    language: "c++",
    outputPath: path.join(await mkdtemp(path.join(os.tmpdir(), "flow-compiler-test-")), "module.wasm"),
    catalog: catalogForManifests(chainManifest),
  });
  assert.ok(compilation.guestLink?.objectBytes?.length > 0);

  const dependencies = dependencyMap({
    pluginId: "test.contract-chain",
    manifest: chainManifest,
    normalized: normalizeManifestForSdnFlow(chainManifest),
    guestLink: {
      objectBytes: compilation.guestLink.objectBytes,
      metadata: {
        symbolPrefix: compilation.guestLink.symbolPrefix,
        methodSymbols: compilation.guestLink.methodSymbols,
      },
    },
    wasmPath: compilation.outputPath,
  });

  const flow = {
    programId: "test.contract-chain-flow",
    name: "Contract chain flow",
    version: "0.1.0",
    nodes: [
      { nodeId: "first", pluginId: "test.contract-chain", methodId: "first", kind: "transform" },
      { nodeId: "second", pluginId: "test.contract-chain", methodId: "second", kind: "transform" },
      { nodeId: "sink", pluginId: "test.sink", methodId: "collect", kind: "sink" },
    ],
    edges: [
      {
        fromNodeId: "first",
        fromPortId: "intermediate",
        toNodeId: "second",
        toPortId: "intermediate",
      },
      { fromNodeId: "second", fromPortId: "out", toNodeId: "sink", toPortId: "result" },
    ],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [{ triggerId: "manual", targetNodeId: "first", targetPortId: "start" }],
    requiredPlugins: ["test.contract-chain"],
  };

  const outDir = path.join(await mkdtemp(path.join(os.tmpdir(), "flow-compiler-out-")), "dist");
  const result = await compileFlowProgram({
    flow,
    dependencies,
    outDir,
    catalog: catalogForManifests(chainManifest),
  });
  assert.equal(result.report.ok, true, JSON.stringify(result.report.issues));
  assert.deepEqual(result.check.capabilities, []);
  assert.equal(result.artifact.dependencies[0].kind, "node");
  assert.equal(result.artifact.dependencies[0].pluginId, "test.contract-chain");

  // The emitted bundle is a legal SDK module: the shipped CLI check passes.
  const manifestPath = path.join(outDir, "plugin-manifest.json");
  const wasmPath = path.join(outDir, "isomorphic", "module.wasm");
  const flowPlgPath = path.join(outDir, "flow.plg");
  assert.equal(existsSync(flowPlgPath), true);
  const decodedFlowPlg = decodePluginManifest(await readFile(flowPlgPath));
  assert.deepEqual(
    decodedFlowPlg.flowNodes.map((node) => node.nodeId),
    ["first", "second", "sink"],
  );
  assert.deepEqual(
    decodedFlowPlg.flowEdges.map((edge) => edge.edgeId),
    ["edge-0", "edge-1"],
  );
  const { stdout } = await execFileAsync(process.execPath, [
    CLI_PATH,
    "check",
    "--manifest",
    manifestPath,
    "--wasm",
    wasmPath,
  ]);
  assert.match(stdout, /^PASS /);

  // Loadable by the JS flow host: both linked nodes drain before host egress.
  const wasmBytes = new Uint8Array(await readFile(wasmPath));
  const host = await createFlowRuntimeHost({ wasmSource: wasmBytes });
  assert.equal(host.nodeCount, 3);
  assert.equal(host.dependencyCount, 1);
  assert.equal(host.getNodeDispatchDescriptor(0).dispatchModel, "linked-direct");
  assert.equal(host.getNodeDispatchDescriptor(1).dispatchModel, "linked-direct");
  assert.equal(host.getNodeDispatchDescriptor(2).dispatchModel, "host");

  assert.deepEqual(
    decodedFlowPlg.flowEdges.map((edge, index) => {
      const signed = edge.contract;
      const runtime = host.getEdgeDescriptor(index);
      return {
        signed: {
          schemaName: signed.canonicalType.schemaName,
          fileIdentifier: signed.canonicalType.fileIdentifier,
          schemaVersion: signed.canonicalType.schemaVersion ?? null,
          schemaHash: Array.from(signed.canonicalType.schemaHash ?? []),
          rootTypeName: signed.canonicalType.rootTypeName,
          alignedByteLength: signed.alignedType?.byteLength ?? 0,
          alignedFixedStringLength: signed.alignedType?.fixedStringLength ?? 0,
          alignedRequiredAlignment: signed.alignedType?.requiredAlignment ?? 0,
          canonicalFallbackAvailable: signed.canonicalFallbackAvailable,
          alignedEligible: signed.alignedEligible,
          routePolicy: signed.routePolicy,
        },
        runtime: {
          schemaName: runtime.schemaName,
          fileIdentifier: runtime.fileIdentifier,
          schemaVersion: runtime.schemaVersion,
          schemaHash: [...runtime.schemaHash],
          rootTypeName: runtime.rootTypeName,
          alignedByteLength: runtime.alignedByteLength,
          alignedFixedStringLength: runtime.alignedFixedStringLength,
          alignedRequiredAlignment: runtime.alignedRequiredAlignment,
          canonicalFallbackAvailable: runtime.canonicalFallbackAvailable === 1,
          alignedEligible: runtime.alignedEligible === 1,
          routePolicy: runtime.alignedEligible === 1
            ? "aligned-shared-arena-or-canonical"
            : "canonical-only",
        },
      };
    }),
    decodedFlowPlg.flowEdges.map((edge) => {
      const signed = edge.contract;
      const contract = {
        schemaName: signed.canonicalType.schemaName,
        fileIdentifier: signed.canonicalType.fileIdentifier,
        schemaVersion: signed.canonicalType.schemaVersion ?? null,
        schemaHash: Array.from(signed.canonicalType.schemaHash ?? []),
        rootTypeName: signed.canonicalType.rootTypeName,
        alignedByteLength: signed.alignedType?.byteLength ?? 0,
        alignedFixedStringLength: signed.alignedType?.fixedStringLength ?? 0,
        alignedRequiredAlignment: signed.alignedType?.requiredAlignment ?? 0,
        canonicalFallbackAvailable: signed.canonicalFallbackAvailable,
        alignedEligible: signed.alignedEligible,
        routePolicy: signed.routePolicy,
      };
      return { signed: contract, runtime: contract };
    }),
    "the signed PLG and compiled runtime must carry identical edge contracts",
  );

  const exports = host.instance.exports;
  const edgeDescriptorPtr = exports.space_data_module_runtime_get_edge_descriptors();
  const edgeView = new DataView(host.memory.buffer, edgeDescriptorPtr, 68);
  const u32 = (offset) => edgeView.getUint32(offset, true);
  const readCString = (ptr) => {
    const heap = new Uint8Array(host.memory.buffer);
    let end = ptr;
    while (end < heap.length && heap[end] !== 0) end += 1;
    return new TextDecoder().decode(heap.subarray(ptr, end));
  };
  assert.deepEqual(
    {
      fromNode: u32(0),
      fromPort: readCString(u32(4)),
      toNode: u32(8),
      toPort: readCString(u32(12)),
      schemaName: readCString(u32(16)),
      fileIdentifier: readCString(u32(20)),
      schemaVersion: readCString(u32(24)),
      schemaHash: [
        ...new Uint8Array(host.memory.buffer, u32(28), u32(32)),
      ],
      rootTypeName: readCString(u32(36)),
      canonicalFallbackAvailable: u32(40),
      alignedEligible: u32(44),
      alignedLayoutFields: u32(48),
      alignedByteLength: u32(52),
      alignedFixedStringLength: u32(56),
      alignedRequiredAlignment: u32(60),
      opaque: u32(64),
    },
    {
      fromNode: 0,
      fromPort: "intermediate",
      toNode: 1,
      toPort: "intermediate",
      schemaName: "Intermediate.fbs",
      fileIdentifier: "MID1",
      schemaVersion: "7.1.2",
      schemaHash: [0xde, 0xad, 0xbe, 0xef],
      rootTypeName: "IntermediateRecord",
      canonicalFallbackAvailable: 1,
      alignedEligible: 1,
      alignedLayoutFields: 0b111,
      alignedByteLength: 96,
      alignedFixedStringLength: 24,
      alignedRequiredAlignment: 16,
      opaque: 0,
    },
  );

  host.enqueueTriggerFrame(0, { portId: "start", bytes: new TextEncoder().encode("golden") });
  const sinkFrames = [];
  await host.drain(
    {
      "test.sink:collect": ({ frames }) => {
        sinkFrames.push(...frames);
        return { statusCode: 0 };
      },
    },
    { maxIterations: 20 },
  );
  assert.equal(host.getNodeState(0).invocationCount, 1n);
  assert.equal(host.getNodeState(1).invocationCount, 1n);
  assert.equal(host.getRoutingState().canonicalRoutes, 2n);
  assert.equal(sinkFrames.length, 1);
  assert.equal(sinkFrames[0].portId, "result");
  assert.equal(new TextDecoder().decode(sinkFrames[0].bytes), "golden");

  // flow_get_manifest_flatbuffer exposes the encoded FLOW program.
  const ptr = exports.flow_get_manifest_flatbuffer();
  const size = exports.flow_get_manifest_flatbuffer_size();
  const decoded = decodeFlowProgram(new Uint8Array(host.memory.buffer, ptr, size).slice());
  assert.equal(decoded.programId, "test.contract-chain-flow");

  // Change only the internal edge contract. Both the canonical signed flow PLG
  // and the runtime artifact must change because neither is allowed to carry
  // an unsigned or divergent routing contract.
  const changedManifest = structuredClone(chainManifest);
  const changedInternalTypeSet = dualTypeSet(
    "intermediate",
    "Intermediate.fbs",
    "MID1",
    {
      schemaVersion: "7.1.3",
      schemaHash: [0xde, 0xad, 0xfa, 0xce],
      rootTypeName: "IntermediateRecord",
      byteLength: 112,
      fixedStringLength: 28,
      requiredAlignment: 16,
    },
  );
  changedManifest.methods[0].outputPorts[0].acceptedTypeSets = [changedInternalTypeSet];
  changedManifest.methods[1].inputPorts[0].acceptedTypeSets = [changedInternalTypeSet];
  const originalDependency = dependencies.get("test.contract-chain");
  const changedResult = await compileFlowProgram({
    flow,
    dependencies: dependencyMap({
      ...originalDependency,
      manifest: changedManifest,
      normalized: normalizeManifestForSdnFlow(changedManifest),
    }),
    catalog: catalogForManifests(changedManifest),
  });
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert.notEqual(digest(changedResult.flowPlgBytes), digest(result.flowPlgBytes));
  const changedPlg = decodePluginManifest(changedResult.flowPlgBytes);
  assert.deepEqual(
    {
      schemaVersion: changedPlg.flowEdges[0].contract.canonicalType.schemaVersion,
      schemaHash: Array.from(
        changedPlg.flowEdges[0].contract.canonicalType.schemaHash ?? [],
      ),
      byteLength: changedPlg.flowEdges[0].contract.alignedType.byteLength,
      fixedStringLength:
        changedPlg.flowEdges[0].contract.alignedType.fixedStringLength,
    },
    {
      schemaVersion: "7.1.3",
      schemaHash: [0xde, 0xad, 0xfa, 0xce],
      byteLength: 112,
      fixedStringLength: 28,
    },
  );
  assert.notEqual(digest(changedResult.wasmBytes), digest(result.wasmBytes));
});

test("yielded linked work resumes fairly so downstream drains between batches", async (t) => {
  const manifest = {
    pluginId: "test.paged-producer",
    name: "Paged producer",
    version: "1.0.0",
    pluginFamily: "foundation",
    capabilities: [],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    runtimeTargets: ["browser"],
    methods: [
      {
        methodId: "produce",
        displayName: "Produce bounded pages",
        inputPorts: [
          port("start", {
            typeSets: [typedTypeSet("start", "Start.fbs", "STRT")],
          }),
        ],
        outputPorts: [
          port("page", { typeSets: [typedTypeSet("page", "Page.fbs", "PAGE")] }),
        ],
        maxBatch: 1,
        drainPolicy: "drain-until-yield",
      },
    ],
    schemasUsed: [],
    abiVersion: 1,
  };
  const compilation = await compileModuleFromSource({
    manifest,
    // Explicit since browser targeting no longer implies a toolchain.
    threadModel: "single-thread",
    sourceCode: `
#include <stdint.h>
#include "space_data_module_invoke.h"

static uint8_t page_number = 0;
extern "C" int produce(void) {
  ++page_number;
  plugin_push_output("page", 0, 0, &page_number, 1);
  const uint32_t remaining = 3u - page_number;
  plugin_set_yielded(remaining > 0 ? 1 : 0);
  plugin_set_backlog_remaining(remaining);
  return 0;
}
`,
    language: "c++",
    outputPath: path.join(await mkdtemp(path.join(os.tmpdir(), "flow-yield-source-")), "module.wasm"),
    catalog: catalogForManifests(manifest),
  });
  t.after(() => cleanupCompilation(compilation));

  const dependencies = dependencyMap({
    pluginId: manifest.pluginId,
    manifest,
    normalized: normalizeManifestForSdnFlow(manifest),
    guestLink: {
      objectBytes: compilation.guestLink.objectBytes,
      metadata: {
        symbolPrefix: compilation.guestLink.symbolPrefix,
        methodSymbols: compilation.guestLink.methodSymbols,
      },
    },
    wasmPath: compilation.outputPath,
  });
  const flow = {
    programId: "test.paged-producer-flow",
    name: "Paged producer flow",
    version: "0.1.0",
    nodes: [
      { nodeId: "source", pluginId: manifest.pluginId, methodId: "produce", kind: "source" },
      { nodeId: "sink", pluginId: "test.sink", methodId: "collect", kind: "sink" },
    ],
    edges: [{ fromNodeId: "source", fromPortId: "page", toNodeId: "sink", toPortId: "page" }],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [{ triggerId: "manual", targetNodeId: "source", targetPortId: "start" }],
    requiredPlugins: [manifest.pluginId],
  };
  const result = await compileFlowProgram({
    flow,
    dependencies,
    catalog: catalogForManifests(manifest),
  });
  const host = await createFlowRuntimeHost({ wasmSource: result.wasmBytes });
  host.enqueueTrigger(0);
  const sinkBatchSizes = [];
  const pages = [];
  await host.drain(
    {
      "test.sink:collect": ({ frames }) => {
        sinkBatchSizes.push(frames.length);
        pages.push(...frames.map((frame) => frame.bytes[0]));
        return { statusCode: 0 };
      },
    },
    { maxIterations: 20 },
  );

  assert.deepEqual(pages, [1, 2, 3], "yielded internal backlog must resume without a new trigger");
  assert.deepEqual(sinkBatchSizes, [1, 1, 1], "round-robin scheduling must drain downstream between source pages");
  assert.equal(host.getNodeState(0).invocationCount, 3n);
  assert.equal(host.getRoutingState().canonicalRoutes, 3n);
  assert.equal(host.getNodeState(0).yielded, false);
  assert.equal(host.getNodeState(0).backlogRemaining, 0);
});

test("flow check fails on a graph cycle by default", () => {
  const flow = makeFlow();
  // consumer feeds back into producer: producer -> consumer -> producer.
  flow.edges.push({ fromNodeId: "consumer", fromPortId: "done", toNodeId: "producer", toPortId: "request" });
  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(producerDependency, consumerDependency),
  });
  assert.equal(check.ok, false);
  const cycleIssue = check.errors.find((issue) => issue.code === "flow-cycle");
  assert.ok(cycleIssue, "expected flow-cycle error");
  assert.match(cycleIssue.message, /producer -> consumer -> producer/);
});

test("flow check fails on a self-loop", () => {
  const flow = makeFlow();
  flow.edges.push({ fromNodeId: "consumer", fromPortId: "done", toNodeId: "consumer", toPortId: "stream" });
  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(producerDependency, consumerDependency),
  });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((issue) => issue.code === "flow-cycle"));
});

test("allowCycles admits bounded feedback with a warning, rejects unbounded", () => {
  const flow = makeFlow({ allowCycles: true });
  // Bounded feedback edge: finite queue.
  flow.edges.push({
    fromNodeId: "consumer",
    fromPortId: "done",
    toNodeId: "producer",
    toPortId: "request",
    backpressurePolicy: "drop-oldest",
    queueDepth: 8,
  });
  const bounded = checkFlowProgram({
    flow,
    dependencies: dependencyMap(producerDependency, consumerDependency),
  });
  assert.ok(!bounded.errors.some((issue) => issue.code === "flow-cycle" || issue.code === "unbounded-cycle"),
    "bounded sanctioned cycle must not error");
  assert.ok(bounded.issues.some((issue) => issue.code === "sanctioned-cycle"), "expected sanctioned-cycle warning");

  // Same cycle but unbounded (block policy): rejected even with allowCycles.
  const unboundedFlow = makeFlow({ allowCycles: true });
  unboundedFlow.edges.push({
    fromNodeId: "consumer",
    fromPortId: "done",
    toNodeId: "producer",
    toPortId: "request",
    backpressurePolicy: "block",
  });
  const unbounded = checkFlowProgram({
    flow: unboundedFlow,
    dependencies: dependencyMap(producerDependency, consumerDependency),
  });
  assert.equal(unbounded.ok, false);
  assert.ok(unbounded.errors.some((issue) => issue.code === "unbounded-cycle"));
});

// ---------------------------------------------------------------------------
// Flow-manifest `api` block validation (gateway loop G.2).
// ---------------------------------------------------------------------------

function makeAPIRoute(overrides = {}) {
  return {
    path: "peers/{peerId}",
    method: "GET",
    operationId: "getPeer",
    summary: "One peer",
    anonymous: true,
    params: [
      { name: "peerId", in: "path", required: true, schema: { type: "string" } },
      { name: "format", in: "query", schema: { type: "string" } },
    ],
    responses: {
      200: {
        description: "ok",
        recordStream: true,
        content: {
          "application/vnd.sdn.flatbuffers.stream": { description: "fb" },
          "application/json": { schema: { type: "array" }, description: "bare array" },
        },
      },
      404: { description: "unknown peer" },
    },
    ...overrides,
  };
}

function checkWithAPI(api) {
  return checkFlowProgram({
    flow: makeFlow({ api }),
    dependencies: dependencyMap(producerDependency, consumerDependency),
  });
}

test("flow check passes a well-formed api block", () => {
  const check = checkWithAPI({ basePath: "/api/v1/peers", tag: "discovery", routes: [makeAPIRoute()] });
  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.ok(!check.issues.some((issue) => issue.code.startsWith("api-")), JSON.stringify(check.issues));
});

test("flow check tolerates an absent api block", () => {
  const check = checkWithAPI(undefined);
  assert.equal(check.ok, true, JSON.stringify(check.issues));
});

test("api block must be an object with non-empty routes", () => {
  assert.ok(checkWithAPI([]).errors.some((issue) => issue.code === "api-invalid"));
  assert.ok(checkWithAPI({}).errors.some((issue) => issue.code === "api-missing-routes"));
  assert.ok(checkWithAPI({ routes: [] }).errors.some((issue) => issue.code === "api-missing-routes"));
});

test("api basePath must start with a slash", () => {
  const check = checkWithAPI({ basePath: "api/v1/peers", routes: [makeAPIRoute()] });
  assert.ok(check.errors.some((issue) => issue.code === "api-invalid-base-path"));
});

test("api route path templates are validated", () => {
  const malformed = checkWithAPI({ routes: [makeAPIRoute({ path: "peers/{peer id}" })] });
  assert.ok(malformed.errors.some((issue) => issue.code === "api-invalid-route-path"));
  const strayBrace = checkWithAPI({ routes: [makeAPIRoute({ path: "peers/{peerId" })] });
  assert.ok(strayBrace.errors.some((issue) => issue.code === "api-invalid-route-path"));
});

test("api route method must be a known HTTP method", () => {
  const check = checkWithAPI({ routes: [makeAPIRoute({ method: "FETCH" })] });
  assert.ok(check.errors.some((issue) => issue.code === "api-invalid-route-method"));
});

test("api duplicate method+path routes are rejected", () => {
  const check = checkWithAPI({ routes: [makeAPIRoute(), makeAPIRoute()] });
  assert.ok(check.errors.some((issue) => issue.code === "api-duplicate-route"));
});

test("api params must be parameter objects with valid name/in", () => {
  const badIn = checkWithAPI({ routes: [makeAPIRoute({ params: [{ name: "x", in: "body" }] })] });
  assert.ok(badIn.errors.some((issue) => issue.code === "api-invalid-params"));
  const badName = checkWithAPI({ routes: [makeAPIRoute({ params: [{ in: "query" }] })] });
  assert.ok(badName.errors.some((issue) => issue.code === "api-invalid-params"));
});

test("api path template without a declared path param warns", () => {
  const check = checkWithAPI({
    routes: [makeAPIRoute({ params: [{ name: "format", in: "query" }] })],
  });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  assert.ok(check.warnings.some((issue) => issue.code === "api-undeclared-path-param"));
});

test("api responses shape is validated", () => {
  const badStatus = checkWithAPI({
    routes: [makeAPIRoute({ responses: { ok: { description: "x" } } })],
  });
  assert.ok(badStatus.errors.some((issue) => issue.code === "api-invalid-responses"));
  const badMedia = checkWithAPI({
    routes: [makeAPIRoute({ responses: { 200: { content: { json: {} } } } })],
  });
  assert.ok(badMedia.errors.some((issue) => issue.code === "api-invalid-responses"));
  const badRecordStream = checkWithAPI({
    routes: [makeAPIRoute({ responses: { 200: { recordStream: "yes" } } })],
  });
  assert.ok(badRecordStream.errors.some((issue) => issue.code === "api-invalid-responses"));
});

test("the real data-retrieval api block shape passes validation", () => {
  // Mirror of the shipped flows/data-retrieval.flow.json api block (subset):
  // regression-guards the validator against the first real carrier.
  const check = checkWithAPI({
    basePath: "/api/v1/data",
    tag: "data",
    routes: [
      makeAPIRoute({ path: "omm/bulk", operationId: "getOmmBulk", deprecated: true, params: [{ name: "format", in: "query" }] }),
      makeAPIRoute({
        path: "query",
        method: "POST",
        operationId: "postDataQuery",
        anonymous: false,
        params: [{ name: "format", in: "query" }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
      }),
    ],
  });
  assert.equal(check.ok, true, JSON.stringify(check.issues));
});

// ---------------------------------------------------------------------------
// WHICH SIGNATURES THE FLOW LANE ADMITS
//
// Driven by the SHARED statement-domain vectors — the same file the node's two
// Go verifiers read, byte for byte. Until 2026-07-30 this gate demanded
// signatureScope === "bundle" and therefore threw out EVERY artifact the node's
// signing endpoint can produce, one line after verifying it, blaming the
// signature rather than the policy (graph/tasks/sdk-flow-compiler-refuses-node-signed.md).
//
// `flowNodeAdmissible` in the vector file is the pinned answer for each
// artifact, so the flow lane cannot drift away from the three verifiers
// silently: a bundle-scope signature is admissible, a module signature under
// SDN-MODULE-PUBLICATION-V1 is admissible, and a bare-digest module signature
// is verified but NOT admissible for composition.
// ---------------------------------------------------------------------------

const STATEMENT_DOMAIN_VECTORS = JSON.parse(
  await readFile(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "support",
      "statement-domain-vectors.json",
    ),
    "utf8",
  ),
);

function vectorHexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function flowLaneAdmits(vector) {
  const artifactBytes = vectorHexToBytes(vector.sdkArtifactHex);
  const dependency = {
    ...producerDependency,
    guestLink: null,
    artifactBytes,
    publisherRecord: {
      algorithm: "ed25519",
      keyId: "janus-vector-key",
      // The flow lane's trust set IS the node's publisher record, so the
      // vector's own trustedPublicKeysHex has to drive it. A vector that
      // trusts nobody must reach this gate trusting nobody — otherwise the
      // "untrusted signer" vectors would be silently re-trusted here and would
      // prove the opposite of what they were written to prove.
      publicKeyHex:
        vector.trustedPublicKeysHex[0] ??
        "00000000000000000000000000000000000000000000000000000000000000ff",
      developmentOnly: false,
    },
  };
  const flow = singleNodeFlow(dependency, {
    dispatchModel: "isomorphic",
    artifact: {
      path: "nodes/vector/module.wasm",
      sha256: createHash("sha256").update(artifactBytes).digest("hex"),
      publisher: "nodes/vector/publisher.json",
    },
  });
  const dependencies = dependencyMap(dependency);
  const check = checkFlowProgram({ flow, dependencies });
  try {
    await __testables.verifyIsomorphicNodeArtifacts({
      flow,
      check,
      dependencies,
    });
    return { admitted: true, message: "" };
  } catch (error) {
    return { admitted: false, message: String(error?.message ?? error) };
  }
}

for (const vector of STATEMENT_DOMAIN_VECTORS.artifacts) {
  test(`flow lane admissibility: ${vector.name}`, async () => {
    const expected = vector.expect.flowNodeAdmissible === true;
    const outcome = await flowLaneAdmits(vector);
    assert.equal(
      outcome.admitted,
      expected,
      expected
        ? `${vector.name} must compile as an isomorphic flow node — ${vector.why} (rejected with: ${outcome.message})`
        : `${vector.name} must NOT be admitted for composition — ${vector.why}`,
    );
  });
}

test("a bare-digest module signature verifies but is refused for composition", async () => {
  // Minted here rather than looked up: the shared vector set carries no
  // verified bare-digest artifact today, and the contract must be tested, not
  // asserted about a fixture that might stop existing.
  const portable = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const legacySigned = await signModuleArtifact(portable, {
    privateKeySeedHex: "44".repeat(32),
    keyId: "legacy-bare-digest",
    signatureScope: "module",
  });
  assert.equal(legacySigned.signature.statementDomain, undefined);

  const verified = await verifyModuleArtifact(legacySigned.wasmBytes, {
    trustedPublicKeys: [legacySigned.signature.publicKeyHex],
    requireSignature: true,
  });
  assert.equal(verified.verified, true, "the legacy form must still VERIFY");
  assert.equal(verified.signatureScope, "module");
  assert.equal(verified.statementDomain, null);

  const outcome = await flowLaneAdmits({
    name: "legacy-bare-digest",
    why: "no domain separation: a signature minted over another protocol's digest could be replayed into a lane that compiles what it admits",
    sdkArtifactHex: Buffer.from(legacySigned.wasmBytes).toString("hex"),
    trustedPublicKeysHex: [legacySigned.signature.publicKeyHex],
  });
  assert.equal(outcome.admitted, false, "verified is not the same as admissible");
  assert.match(outcome.message, /SDN-MODULE-PUBLICATION-V1/);
});

// ---------------------------------------------------------------------------
// Composed runtimeTargets are DERIVED, not asserted
// (upstream-module-sdk-4). The composed manifest used to hardcode
// runtimeTargets ["browser","wasmedge"], and that manifest is compliance-
// validated before the bake — so any flow containing a node with a
// browser-incompatible capability (wallet_sign, tcp, storage_write, …) died on
// `capability-runtime-conflict`. wallet_sign is the ONLY gate on
// keyslot.unwrap, so the hardcode meant NO composed flow could ever unwrap a
// host-held key. The fix: intersect the parts' declared targets. The invariant
// it must not weaken: a browser-incompatible capability and a browser target
// remain impossible together.
// ---------------------------------------------------------------------------

const BROWSER_INCOMPATIBLE_CAPABILITY = "wallet_sign";

function credentialMediatorDependency(overrides = {}) {
  return makeDependency({
    pluginId: "test.credential-mediator",
    capabilities: [BROWSER_INCOMPATIBLE_CAPABILITY],
    runtimeTargets: ["wasmedge"],
    methods: [
      {
        methodId: "mediate",
        inputPorts: [
          port("stream", { typeSets: [typedTypeSet("in", "OMM.fbs", "$OMM")] }),
        ],
        outputPorts: [
          port("done", {
            typeSets: [typedTypeSet("resp", "HttpResponseAbi.fbs", "$HTR")],
          }),
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
    ...overrides,
  });
}

function mediatorFlow() {
  return makeFlow({
    programId: "test.credential-flow",
    nodes: [
      { nodeId: "producer", pluginId: "test.producer", methodId: "produce", kind: "transform" },
      {
        nodeId: "mediator",
        pluginId: "test.credential-mediator",
        methodId: "mediate",
        kind: "transform",
      },
      { nodeId: "egress", pluginId: "test.sink", methodId: "collect", kind: "sink" },
    ],
    edges: [
      { fromNodeId: "producer", fromPortId: "stream", toNodeId: "mediator", toPortId: "stream" },
      { fromNodeId: "mediator", fromPortId: "done", toNodeId: "egress", toPortId: "response" },
    ],
    requiredPlugins: ["test.producer", "test.credential-mediator"],
  });
}

test("a flow of fully isomorphic nodes keeps both runtime targets", () => {
  const isomorphicProducer = makeDependency({
    pluginId: "test.producer",
    capabilities: ["storage_query"],
    runtimeTargets: ["browser", "wasmedge"],
    methods: producerDependency.manifest.methods,
  });
  const isomorphicConsumer = makeDependency({
    pluginId: "test.consumer",
    capabilities: ["http"],
    runtimeTargets: ["browser", "wasmedge"],
    methods: consumerDependency.manifest.methods,
  });
  const check = checkFlowProgram({
    flow: makeFlow(),
    dependencies: dependencyMap(isomorphicProducer, isomorphicConsumer),
  });
  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.deepEqual(check.runtimeTargets, ["browser", "wasmedge"]);

  const manifest = buildFlowModuleManifest({
    flow: makeFlow(),
    check,
    dependencies: dependencyMap(isomorphicProducer, isomorphicConsumer),
  });
  assert.deepEqual(manifest.runtimeTargets, ["browser", "wasmedge"]);
  assert.equal(manifest.buildArtifacts[0].target, "browser,wasmedge");
});

test("one wasmedge-only node makes the whole composition wasmedge-only", () => {
  const producer = makeDependency({
    pluginId: "test.producer",
    capabilities: ["storage_query"],
    runtimeTargets: ["browser", "wasmedge"],
    methods: producerDependency.manifest.methods,
  });
  const mediator = credentialMediatorDependency();
  const flow = mediatorFlow();
  const dependencies = dependencyMap(producer, mediator);
  const check = checkFlowProgram({ flow, dependencies });

  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.deepEqual(check.runtimeTargets, ["wasmedge"]);
  assert.ok(check.capabilities.includes(BROWSER_INCOMPATIBLE_CAPABILITY));

  const manifest = buildFlowModuleManifest({ flow, check, dependencies });
  assert.deepEqual(manifest.runtimeTargets, ["wasmedge"]);
  assert.equal(manifest.buildArtifacts[0].target, "wasmedge");

  // THE REGRESSION: this exact manifest is what compileFlowProgram validates
  // before baking. With the derived target set it is compliant; with the old
  // hardcoded pair it is not.
  const derived = validatePluginManifest(manifest, { sourceName: "flow" });
  assert.equal(
    derived.issues.some((issue) => issue.code === "capability-runtime-conflict"),
    false,
    JSON.stringify(derived.issues.filter((issue) => issue.severity === "error")),
  );

  const hardcoded = validatePluginManifest(
    { ...manifest, runtimeTargets: ["browser", "wasmedge"] },
    { sourceName: "flow" },
  );
  assert.ok(
    hardcoded.issues.some(
      (issue) =>
        issue.code === "capability-runtime-conflict" && issue.severity === "error",
    ),
    "the browser-incompatible capability must still be refused against a browser target",
  );
});

test("a resolved component dependency constrains the composition's targets too", () => {
  const wasmedgeOnlyComponent = makeDependency({
    pluginId: "test.component.wasmedge-only",
    capabilities: ["storage_write"],
    runtimeTargets: ["wasmedge"],
    methods: producerDependency.manifest.methods,
  });
  const producer = makeDependency({
    pluginId: "test.producer",
    capabilities: ["storage_query"],
    runtimeTargets: ["browser", "wasmedge"],
    methods: producerDependency.manifest.methods,
    dependencies: [
      { pluginId: "test.component.wasmedge-only", minVersion: "1.0.0", maxVersion: "1.0.0" },
    ],
  });
  const consumer = makeDependency({
    pluginId: "test.consumer",
    capabilities: ["http"],
    runtimeTargets: ["browser", "wasmedge"],
    methods: consumerDependency.manifest.methods,
  });
  const check = checkFlowProgram({
    flow: makeFlow(),
    dependencies: dependencyMap(producer, consumer, wasmedgeOnlyComponent),
  });
  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.deepEqual(check.runtimeTargets, ["wasmedge"]);
  assert.ok(check.capabilities.includes("storage_write"));
});

test("a node that declares no runtime targets constrains nothing", () => {
  const silentProducer = makeDependency({
    pluginId: "test.producer",
    capabilities: ["storage_query"],
    runtimeTargets: [],
    methods: producerDependency.manifest.methods,
  });
  const consumer = makeDependency({
    pluginId: "test.consumer",
    capabilities: ["http"],
    runtimeTargets: ["browser", "wasmedge"],
    methods: consumerDependency.manifest.methods,
  });
  const check = checkFlowProgram({
    flow: makeFlow(),
    dependencies: dependencyMap(silentProducer, consumer),
  });
  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.deepEqual(check.runtimeTargets, ["browser", "wasmedge"]);
});

test("a composition with no shared runtime is refused, naming the constraints", () => {
  const browserOnly = makeDependency({
    pluginId: "test.producer",
    capabilities: ["storage_query"],
    runtimeTargets: ["browser"],
    methods: producerDependency.manifest.methods,
  });
  const wasmedgeOnly = makeDependency({
    pluginId: "test.consumer",
    capabilities: ["http"],
    runtimeTargets: ["wasmedge"],
    methods: consumerDependency.manifest.methods,
  });
  const check = checkFlowProgram({
    flow: makeFlow(),
    dependencies: dependencyMap(browserOnly, wasmedgeOnly),
  });
  assert.equal(check.ok, false);
  const issue = check.errors.find(
    (entry) => entry.code === "empty-runtime-target-intersection",
  );
  assert.ok(issue, JSON.stringify(check.errors));
  assert.match(issue.message, /"test\.producer" declares runtimeTargets \[browser\]/);
  assert.match(issue.message, /"test\.consumer" declares runtimeTargets \[wasmedge\]/);
  assert.deepEqual(check.runtimeTargets, []);
});

test("the composed artifact BAKES, RUNS and is refused by the browser with a wasmedge-only node holding wallet_sign", async () => {
  // THE END-TO-END REGRESSION. Before the fix this composition could not be
  // baked AT ALL: compileFlowProgram stamped ["browser","wasmedge"] on the
  // composed manifest, compliance saw a browser target next to wallet_sign,
  // and the compile died before it ever reached the linker. Since wallet_sign
  // is the only gate on keyslot.unwrap, that made host-side key unwrapping
  // unreachable from any flow.
  const stageArtifact = await signedEmptyArtifact("4a", "iso-stage-test");
  const mediatorArtifact = await signedEmptyArtifact("4b", "wasmedge-mediator-test");

  const stage = {
    ...makeDependency({
      pluginId: "test.iso-stage",
      capabilities: ["storage_query"],
      runtimeTargets: ["browser", "wasmedge"],
      methods: producerDependency.manifest.methods,
    }),
    guestLink: null,
    artifactBytes: stageArtifact.bytes,
    publisherRecord: stageArtifact.publisher,
  };
  const mediator = {
    ...makeDependency({
      pluginId: "test.wasmedge-only-mediator",
      capabilities: [BROWSER_INCOMPATIBLE_CAPABILITY],
      runtimeTargets: ["wasmedge"],
      methods: [
        {
          methodId: "mediate",
          inputPorts: [
            port("stream", { typeSets: [typedTypeSet("in", "OMM.fbs", "$OMM")] }),
          ],
          outputPorts: [
            port("done", {
              typeSets: [typedTypeSet("resp", "HttpResponseAbi.fbs", "$HTR")],
            }),
          ],
          maxBatch: 1,
          drainPolicy: "single-shot",
        },
      ],
    }),
    guestLink: null,
    artifactBytes: mediatorArtifact.bytes,
    publisherRecord: mediatorArtifact.publisher,
  };

  const flow = {
    programId: "test.wasmedge-only-composition",
    name: "WasmEdge-only composition",
    version: "0.1.0",
    nodes: [
      {
        nodeId: "stage",
        pluginId: stage.pluginId,
        methodId: "produce",
        kind: "transform",
        dispatchModel: "isomorphic",
        artifact: {
          path: "nodes/stage/module.wasm",
          sha256: stageArtifact.sha256,
          publisher: "nodes/stage/publisher.json",
        },
      },
      {
        nodeId: "mediator",
        pluginId: mediator.pluginId,
        methodId: "mediate",
        kind: "transform",
        dispatchModel: "isomorphic",
        artifact: {
          path: "nodes/mediator/module.wasm",
          sha256: mediatorArtifact.sha256,
          publisher: "nodes/mediator/publisher.json",
        },
      },
      { nodeId: "egress", pluginId: "test.sink", methodId: "collect", kind: "sink" },
    ],
    edges: [
      { fromNodeId: "stage", fromPortId: "stream", toNodeId: "mediator", toPortId: "stream" },
      { fromNodeId: "mediator", fromPortId: "done", toNodeId: "egress", toPortId: "response" },
    ],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [
      { triggerId: "manual", targetNodeId: "stage", targetPortId: "request" },
    ],
    requiredPlugins: [stage.pluginId, mediator.pluginId],
  };

  const dependencies = dependencyMap(stage, mediator);
  const result = await compileFlowProgram({
    flow,
    dependencies,
    catalog: catalogForManifests(stage.manifest, mediator.manifest),
  });

  assert.deepEqual(result.check.runtimeTargets, ["wasmedge"]);
  assert.deepEqual(result.manifest.runtimeTargets, ["wasmedge"]);
  assert.equal(result.manifest.buildArtifacts[0].target, "wasmedge");
  assert.ok(
    result.manifest.capabilities.includes(BROWSER_INCOMPATIBLE_CAPABILITY),
    JSON.stringify(result.manifest.capabilities),
  );
  assert.equal(result.report.ok, true, JSON.stringify(result.report.errors ?? []));

  // The declaration travels IN the artifact, so a loader handed nothing but
  // bytes can still refuse it.
  const embedded = locateEmbeddedPlgManifest(result.wasmBytes);
  assert.deepEqual(embedded?.decoded?.runtimeTargets, ["wasmedge"]);

  // It RUNS on the runtime it claims: instantiate the composed artifact and
  // drive one frame through the whole graph, mediator included.
  const host = await createFlowRuntimeHost({ wasmSource: result.wasmBytes });
  const canonicalType = (manifest, methodId, direction, portId) =>
    manifest.methods
      .find((method) => method.methodId === methodId)[direction]
      .find((candidate) => candidate.portId === portId)
      .acceptedTypeSets[0].allowedTypes.find(
        (typeRef) => typeRef.wireFormat === "flatbuffer",
      );
  const seen = [];
  host.enqueueTriggerFrame(0, {
    portId: "request",
    bytes: new TextEncoder().encode("request"),
  });
  await host.drain(
    {
      "test.iso-stage:produce": () => {
        seen.push("stage");
        return {
          outputs: [
            {
              portId: "stream",
              bytes: new TextEncoder().encode("orbit"),
              typeRef: canonicalType(stage.manifest, "produce", "outputPorts", "stream"),
            },
          ],
        };
      },
      "test.wasmedge-only-mediator:mediate": ({ frames }) => {
        seen.push("mediator");
        assert.equal(new TextDecoder().decode(frames[0].bytes), "orbit");
        return {
          outputs: [
            {
              portId: "done",
              bytes: new TextEncoder().encode("stored"),
              typeRef: canonicalType(mediator.manifest, "mediate", "outputPorts", "done"),
            },
          ],
        };
      },
      "test.sink:collect": ({ frames }) => {
        seen.push("sink");
        assert.equal(new TextDecoder().decode(frames[0].bytes), "stored");
        return { statusCode: 0 };
      },
    },
    { maxIterations: 10 },
  );
  assert.deepEqual(seen, ["stage", "mediator", "sink"]);

  // B1: the COMPOSED FLOW'S OWN DOOR. createFlowRuntimeHost is what actually
  // loads a composed artifact in a browser page; gating only the single-module
  // harness would have let this artifact in through the front entrance while
  // the side door was locked. It is runtime-agnostic, so the leg is stated —
  // and stating "browser" must refuse.
  await assert.rejects(
    () =>
      createFlowRuntimeHost({
        wasmSource: result.wasmBytes,
        runtimeTarget: "browser",
      }),
    (error) => {
      assert.equal(error.name, "RuntimeTargetError");
      assert.equal(error.declarationSource, "embedded");
      assert.deepEqual(error.declaredTargets, ["wasmedge"]);
      assert.match(error.message, /composed flow artifact/);
      return true;
    },
  );
  // The isomorphic flow host stands for the browser leg by construction (it
  // mounts every child through the browser module harness), so it refuses the
  // parent without being told.
  await assert.rejects(
    () =>
      createIsomorphicFlowRuntimeHost({
        wasmSource: result.wasmBytes,
        children: [],
      }),
    (error) => {
      assert.equal(error.name, "RuntimeTargetError");
      return true;
    },
  );

  // And the browser leg refuses it loudly rather than silently skipping — both
  // from the supplied manifest and from the artifact's own embedded record.
  await assert.rejects(
    () =>
      createBrowserModuleHarness({
        wasmSource: result.wasmBytes,
        manifest: result.manifest,
      }),
    /does not target "browser"[\s\S]*runtimeTargets \[wasmedge\]/,
  );
  await assert.rejects(
    () => createBrowserModuleHarness({ wasmSource: result.wasmBytes }),
    /does not target "browser"[\s\S]*runtimeTargets \[wasmedge\]/,
  );
});

test("a capability the browser cannot serve drops the browser target even when NO node declares one", () => {
  // The commonest manifest shape, and the one that would have re-created the
  // original defect: a plugin that carries a browser-incompatible capability
  // and simply omits runtimeTargets. Declarations alone say nothing here; the
  // capability union does.
  const producer = makeDependency({
    pluginId: "test.producer",
    capabilities: ["storage_query"],
    runtimeTargets: [],
    methods: producerDependency.manifest.methods,
  });
  const mediator = {
    ...credentialMediatorDependency(),
    manifest: {
      ...credentialMediatorDependency().manifest,
      runtimeTargets: undefined,
    },
  };
  mediator.normalized = normalizeManifestForSdnFlow(mediator.manifest);
  const flow = mediatorFlow();
  const dependencies = dependencyMap(producer, mediator);
  const check = checkFlowProgram({ flow, dependencies });

  assert.equal(check.ok, true, JSON.stringify(check.errors));
  assert.deepEqual(check.runtimeTargets, ["wasmedge"]);
  const warning = check.warnings.find(
    (issue) => issue.code === "narrowed-runtime-targets",
  );
  assert.ok(warning, JSON.stringify(check.warnings));
  assert.match(warning.message, /"wallet_sign"/);

  // And the composed manifest that comes out is compliant, which is the whole
  // point — the compiler no longer stamps a target its own compliance rejects.
  const manifest = buildFlowModuleManifest({ flow, check, dependencies });
  assert.deepEqual(manifest.runtimeTargets, ["wasmedge"]);
  const report = validatePluginManifest(manifest, { sourceName: "flow" });
  assert.equal(
    report.issues.some((issue) => issue.code === "capability-runtime-conflict"),
    false,
    JSON.stringify(report.errors),
  );
});

test("dropping a runtime target is never silent", () => {
  const producer = makeDependency({
    pluginId: "test.producer",
    capabilities: ["storage_query"],
    methods: producerDependency.manifest.methods,
  });
  const consumer = makeDependency({
    pluginId: "test.consumer",
    capabilities: ["http"],
    runtimeTargets: ["wasmedge"],
    methods: consumerDependency.manifest.methods,
  });
  const check = checkFlowProgram({
    flow: makeFlow(),
    dependencies: dependencyMap(producer, consumer),
  });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  assert.deepEqual(check.runtimeTargets, ["wasmedge"]);
  const warning = check.warnings.find(
    (issue) => issue.code === "narrowed-runtime-targets",
  );
  assert.ok(warning, JSON.stringify(check.warnings));
  assert.match(warning.message, /"test\.consumer" declares runtimeTargets \[wasmedge\]/);
});

test("a legacy check record with no shared runtime THROWS instead of declaring nothing", () => {
  const browserOnly = makeDependency({
    pluginId: "test.producer",
    capabilities: ["storage_query"],
    runtimeTargets: ["browser"],
    methods: producerDependency.manifest.methods,
  });
  const wasmedgeOnly = makeDependency({
    pluginId: "test.consumer",
    capabilities: ["http"],
    runtimeTargets: ["wasmedge"],
    methods: consumerDependency.manifest.methods,
  });
  const flow = makeFlow();
  const dependencies = dependencyMap(browserOnly, wasmedgeOnly);
  const check = checkFlowProgram({ flow, dependencies });
  // Simulate a check record produced by an SDK that predates the derivation:
  // the field simply is not there.
  const legacyCheck = { ...check };
  delete legacyCheck.runtimeTargets;

  assert.throws(
    () => buildFlowModuleManifest({ flow, check: legacyCheck, dependencies }),
    /has no runtime target/,
  );
});

test("wasi is the portability baseline, not a fourth runtime", () => {
  const wasiProducerBase = makeDependency({
    pluginId: "test.producer",
    // A `wasi`-declaring artifact must satisfy the standalone-WASI rules:
    // the `command` invoke surface and the pure WASI capability subset.
    capabilities: [],
    runtimeTargets: ["wasi", "wasmedge"],
    methods: producerDependency.manifest.methods,
  });
  const wasiProducer = {
    ...wasiProducerBase,
    manifest: {
      ...wasiProducerBase.manifest,
      invokeSurfaces: ["direct", "command"],
    },
  };
  wasiProducer.normalized = normalizeManifestForSdnFlow(wasiProducer.manifest);
  const consumer = makeDependency({
    pluginId: "test.consumer",
    capabilities: ["http"],
    methods: consumerDependency.manifest.methods,
  });
  const check = checkFlowProgram({
    flow: makeFlow(),
    dependencies: dependencyMap(wasiProducer, consumer),
  });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  // `wasi` is the portability baseline and it ADMITS the browser leg — the
  // compiler and the loaders answer this with one rule, so a part declaring
  // ["wasi","wasmedge"] must not have the browser stripped from every flow it
  // joins while the browser harness happily admits the same declaration.
  assert.deepEqual(check.runtimeTargets, ["browser", "wasmedge"]);
  assert.equal(
    check.warnings.some((issue) => issue.code === "narrowed-runtime-targets"),
    false,
    JSON.stringify(check.warnings),
  );
});

test("the wasi baseline admits a leg only for capabilities that leg can serve", () => {
  // `pipe` is in BOTH the standalone-WASI subset and the browser-incompatible
  // set. runtimeTargets:["wasi"] + capabilities:["pipe"] passes compliance —
  // it names no browser target for the rule to fire on — so without the
  // capability check the baseline would admit it to the browser leg against
  // the SDK's own policy.
  const pipeProducerBase = makeDependency({
    pluginId: "test.producer",
    capabilities: ["pipe"],
    runtimeTargets: ["wasi"],
    methods: producerDependency.manifest.methods,
  });
  const pipeProducer = {
    ...pipeProducerBase,
    manifest: {
      ...pipeProducerBase.manifest,
      invokeSurfaces: ["direct", "command"],
    },
  };
  pipeProducer.normalized = normalizeManifestForSdnFlow(pipeProducer.manifest);
  const consumer = makeDependency({
    pluginId: "test.consumer",
    capabilities: ["http"],
    methods: consumerDependency.manifest.methods,
  });
  const check = checkFlowProgram({
    flow: makeFlow(),
    dependencies: dependencyMap(pipeProducer, consumer),
  });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  assert.deepEqual(check.runtimeTargets, ["wasmedge"]);
});

test("a wasi-only plugin makes a portability statement, not an exclusion", () => {
  const wasiOnlyBase = makeDependency({
    pluginId: "test.producer",
    capabilities: [],
    runtimeTargets: ["wasi"],
    methods: producerDependency.manifest.methods,
  });
  const wasiOnly = {
    ...wasiOnlyBase,
    manifest: { ...wasiOnlyBase.manifest, invokeSurfaces: ["direct", "command"] },
  };
  wasiOnly.normalized = normalizeManifestForSdnFlow(wasiOnly.manifest);
  const consumer = makeDependency({
    pluginId: "test.consumer",
    capabilities: ["http"],
    methods: consumerDependency.manifest.methods,
  });
  const check = checkFlowProgram({
    flow: makeFlow(),
    dependencies: dependencyMap(wasiOnly, consumer),
  });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  // `wasi` is the portable subset both legs serve — it must not silently cost
  // the composition every runtime it has.
  assert.deepEqual(check.runtimeTargets, ["browser", "wasmedge"]);
});

test("a plugin that targets no runtime a flow can reach empties the set on purpose", () => {
  const offRoad = makeDependency({
    pluginId: "test.producer",
    capabilities: ["storage_query"],
    runtimeTargets: ["node", "desktop"],
    methods: producerDependency.manifest.methods,
  });
  const consumer = makeDependency({
    pluginId: "test.consumer",
    capabilities: ["http"],
    methods: consumerDependency.manifest.methods,
  });
  const check = checkFlowProgram({
    flow: makeFlow(),
    dependencies: dependencyMap(offRoad, consumer),
  });
  assert.equal(check.ok, false);
  assert.ok(
    check.errors.some(
      (issue) => issue.code === "empty-runtime-target-intersection",
    ),
    JSON.stringify(check.errors),
  );
});
