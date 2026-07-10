import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { compileModuleFromSource } from "../src/compiler/compileModule.js";
import {
  buildFlowModuleManifest,
  checkFlowProgram,
  compileFlowProgram,
  encodeFlowDocumentProgram,
} from "../src/flow/flowCompiler.js";
import { decodeFlowProgram } from "../src/flow/flowCodec.js";
import { createFlowRuntimeHost } from "../src/flow/flowRuntimeHost.js";
import { normalizeManifestForSdnFlow } from "../src/flow/normalize.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../bin/space-data-module.js", import.meta.url));

function wildcardTypeSet(setId) {
  return { setId, allowedTypes: [{ acceptsAnyFlatbuffer: true }] };
}

function typedTypeSet(setId, schemaName, fileIdentifier) {
  return { setId, allowedTypes: [{ schemaName, fileIdentifier, rootTypeName: schemaName.replace(".fbs", "") }] };
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

function makeDependency({ pluginId, version = "1.0.0", capabilities = [], methods, dependencies }) {
  const manifest = {
    pluginId,
    name: pluginId,
    version,
    pluginFamily: "foundation",
    capabilities,
    externalInterfaces: [],
    runtimeTargets: ["browser"],
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
        port("aux", { required: false, typeSets: [wildcardTypeSet("aux-any")] }),
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

test("flow check accepts acceptsAnyFlatbuffer wildcard ports", () => {
  const flow = makeFlow();
  flow.edges.push({
    fromNodeId: "producer",
    fromPortId: "stream",
    toNodeId: "consumer",
    toPortId: "aux",
  });
  const check = checkFlowProgram({
    flow,
    dependencies: dependencyMap(producerDependency, consumerDependency),
  });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
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
        inputPorts: [port("in", { typeSets: [wildcardTypeSet("any")] })],
        outputPorts: [port("out", { typeSets: [wildcardTypeSet("any-out")] })],
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

test("encodeFlowDocumentProgram round-trips through the FLOW codec", () => {
  const decoded = decodeFlowProgram(encodeFlowDocumentProgram(makeFlow()));
  assert.equal(decoded.programId, "test.check-flow");
  assert.equal(decoded.nodes.length, 3);
  assert.equal(decoded.edges.length, 2);
  assert.equal(decoded.triggerBindings.length, 1);
});

// ---------------------------------------------------------------------------
// Golden compile — the degenerate single-node flow: compile a trivial echo
// module with emception, link it linked-direct into a flow bundle, prove the
// bundle is a legal SDK module (CLI check passes) and drains in the JS host.
// ---------------------------------------------------------------------------

test("flow compile emits a linked-direct bundle for the degenerate single-node flow", async () => {
  const echoManifest = {
    pluginId: "test.echo",
    name: "Echo",
    version: "1.0.0",
    pluginFamily: "foundation",
    capabilities: [],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    runtimeTargets: ["browser"],
    methods: [
      {
        methodId: "echo",
        displayName: "Echo",
        inputPorts: [port("in", { typeSets: [wildcardTypeSet("in-any")] })],
        outputPorts: [port("out", { typeSets: [wildcardTypeSet("out-any")] })],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
    schemasUsed: [],
    abiVersion: 1,
  };
  const compilation = await compileModuleFromSource({
    manifest: echoManifest,
    sourceCode: `
#include <stdint.h>
#include "space_data_module_invoke.h"

extern "C" int echo(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) { plugin_set_error("no-input", "echo requires a frame"); return 400; }
  plugin_push_output("out", 0, 0, frame->payload, frame->payload_length);
  return 0;
}
`,
    language: "c++",
    outputPath: path.join(await mkdtemp(path.join(os.tmpdir(), "flow-compiler-test-")), "module.wasm"),
  });
  assert.ok(compilation.guestLink?.objectBytes?.length > 0);

  const dependencies = dependencyMap({
    pluginId: "test.echo",
    manifest: echoManifest,
    normalized: normalizeManifestForSdnFlow(echoManifest),
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
    programId: "test.echo-flow",
    name: "Echo flow",
    version: "0.1.0",
    nodes: [
      { nodeId: "echo", pluginId: "test.echo", methodId: "echo", kind: "transform" },
      { nodeId: "sink", pluginId: "test.sink", methodId: "collect", kind: "sink" },
    ],
    edges: [{ fromNodeId: "echo", fromPortId: "out", toNodeId: "sink", toPortId: "result" }],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [{ triggerId: "manual", targetNodeId: "echo", targetPortId: "in" }],
    requiredPlugins: ["test.echo"],
  };

  const outDir = path.join(await mkdtemp(path.join(os.tmpdir(), "flow-compiler-out-")), "dist");
  const result = await compileFlowProgram({ flow, dependencies, outDir });
  assert.equal(result.report.ok, true, JSON.stringify(result.report.issues));
  assert.deepEqual(result.check.capabilities, []);
  assert.equal(result.artifact.dependencies[0].kind, "node");
  assert.equal(result.artifact.dependencies[0].pluginId, "test.echo");

  // The emitted bundle is a legal SDK module: the shipped CLI check passes.
  const manifestPath = path.join(outDir, "plugin-manifest.json");
  const wasmPath = path.join(outDir, "isomorphic", "module.wasm");
  const { stdout } = await execFileAsync(process.execPath, [
    CLI_PATH,
    "check",
    "--manifest",
    manifestPath,
    "--wasm",
    wasmPath,
  ]);
  assert.match(stdout, /^PASS /);

  // Loadable by the JS flow host: the degenerate flow drains linked-direct.
  const wasmBytes = new Uint8Array(await readFile(wasmPath));
  const host = await createFlowRuntimeHost({ wasmSource: wasmBytes });
  assert.equal(host.nodeCount, 2);
  assert.equal(host.dependencyCount, 1);
  assert.equal(host.getNodeDispatchDescriptor(0).dispatchModel, "linked-direct");
  assert.equal(host.getNodeDispatchDescriptor(1).dispatchModel, "host");

  host.enqueueTriggerFrame(0, { portId: "in", bytes: new TextEncoder().encode("golden") });
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
  assert.equal(sinkFrames.length, 1);
  assert.equal(sinkFrames[0].portId, "result");
  assert.equal(new TextDecoder().decode(sinkFrames[0].bytes), "golden");

  // flow_get_manifest_flatbuffer exposes the encoded FLOW program.
  const exports = host.instance.exports;
  const ptr = exports.flow_get_manifest_flatbuffer();
  const size = exports.flow_get_manifest_flatbuffer_size();
  const decoded = decodeFlowProgram(new Uint8Array(host.memory.buffer, ptr, size).slice());
  assert.equal(decoded.programId, "test.echo-flow");
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
