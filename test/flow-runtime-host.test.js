import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import * as flatbuffers from "flatbuffers";

import { createFlowRuntimeHost, FLOW_INVALID_INDEX } from "../src/flow/flowRuntimeHost.js";
import {
  cleanupCompilation,
  compileModuleFromSource,
} from "../src/compiler/compileModule.js";
import { compileFlowProgram } from "../src/flow/flowCompiler.js";
import { normalizeManifestForSdnFlow } from "../src/flow/normalize.js";
import { ATM } from "spacedatastandards.org/lib/js/ATM/ATM.js";

const ATM_SCHEMA_HASH = Object.freeze([
  0x0f, 0xef, 0xdc, 0xa4, 0xbb, 0xcb, 0x78, 0x57,
  0xe9, 0x34, 0x03, 0xdd, 0x11, 0xf2, 0x9a, 0x67,
  0x8d, 0x45, 0x4a, 0xb7, 0x1b, 0x14, 0x38, 0x57,
  0x15, 0xc5, 0x2f, 0x6a, 0x72, 0xdd, 0x77, 0xec,
]);

const ATM_IDENTITY = Object.freeze({
  schemaName: "ATM.fbs",
  fileIdentifier: "$ATM",
  schemaVersion: "1.0.2",
  schemaHash: ATM_SCHEMA_HASH,
  rootTypeName: "ATM",
});

function atmTypeSet() {
  return {
    setId: "atm",
    allowedTypes: [
      { ...ATM_IDENTITY, wireFormat: "flatbuffer" },
      {
        ...ATM_IDENTITY,
        wireFormat: "aligned-binary",
        byteLength: 8,
        requiredAlignment: 4,
      },
    ],
  };
}

function atmPort(portId, required = true) {
  return {
    portId,
    acceptedTypeSets: [atmTypeSet()],
    minStreams: required ? 1 : 0,
    maxStreams: 1,
    required,
  };
}

function canonicalAtmBytes() {
  const builder = new flatbuffers.Builder(64);
  const root = ATM.createATM(builder, 0, 2026);
  ATM.finishATMBuffer(builder, root);
  return builder.asUint8Array().slice();
}

async function buildNeutralRoutingFixture() {
  const canonicalBytes = canonicalAtmBytes();
  const canonicalInitializer = Array.from(canonicalBytes).join(", ");
  const manifest = {
    pluginId: "test.neutral-routing-node",
    name: "Neutral routing node",
    version: "1.0.0",
    pluginFamily: "foundation",
    capabilities: [],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    runtimeTargets: ["browser"],
    methods: [
      {
        methodId: "produce",
        displayName: "Produce",
        inputPorts: [atmPort("start")],
        outputPorts: [atmPort("middle")],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
      {
        methodId: "consume",
        displayName: "Consume",
        inputPorts: [atmPort("middle")],
        outputPorts: [atmPort("result")],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
    schemasUsed: [],
    abiVersion: 1,
  };
  const compilation = await compileModuleFromSource({
    manifest,
    language: "c++",
    sourceCode: `
#include <stdint.h>
#include <string.h>
#include "space_data_module_invoke.h"

static const uint8_t kAtmSchemaHash[] = {
  0x0f, 0xef, 0xdc, 0xa4, 0xbb, 0xcb, 0x78, 0x57,
  0xe9, 0x34, 0x03, 0xdd, 0x11, 0xf2, 0x9a, 0x67,
  0x8d, 0x45, 0x4a, 0xb7, 0x1b, 0x14, 0x38, 0x57,
  0x15, 0xc5, 0x2f, 0x6a, 0x72, 0xdd, 0x77, 0xec,
};

extern "C" int produce(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) return 400;
  int32_t status = 0;
  if (frame->wire_format == PLUGIN_PAYLOAD_WIRE_FORMAT_ALIGNED_BINARY) {
    status = plugin_push_output_typed(
      "middle", "ATM.fbs", "$ATM",
      PLUGIN_PAYLOAD_WIRE_FORMAT_ALIGNED_BINARY, "ATM",
      0, 8, 4, frame->payload, frame->payload_length
    );
  } else {
    status = plugin_push_output(
      "middle", "ATM.fbs", "$ATM", frame->payload, frame->payload_length
    );
  }
  if (status < 0) return status;
  return plugin_set_output_frame_id(0, 4242);
}

extern "C" int consume(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) return 400;
  if (!frame->schema_version || strcmp(frame->schema_version, "1.0.2") != 0) return 401;
  if (!frame->schema_hash || frame->schema_hash_length != sizeof(kAtmSchemaHash) ||
      memcmp(frame->schema_hash, kAtmSchemaHash, sizeof(kAtmSchemaHash)) != 0) return 402;
  if (frame->ownership != 0 || frame->mutability != 0 || frame->frame_id == 0) return 403;
  if (frame->frame_id != 4242) return 404;
  static const uint8_t canonical[] = { ${canonicalInitializer} };
  return plugin_push_output(
    "result", "ATM.fbs", "$ATM", canonical, sizeof(canonical)
  );
}
`,
  });
  const dependency = {
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
  };
  const flow = {
    programId: "test.neutral-routing-flow",
    name: "Neutral routing flow",
    version: "1.0.0",
    nodes: [
      { nodeId: "produce", pluginId: manifest.pluginId, methodId: "produce", kind: "transform" },
      { nodeId: "consume", pluginId: manifest.pluginId, methodId: "consume", kind: "transform" },
      { nodeId: "sink", pluginId: "test.sink", methodId: "collect", kind: "sink" },
    ],
    edges: [
      { fromNodeId: "produce", fromPortId: "middle", toNodeId: "consume", toPortId: "middle" },
      { fromNodeId: "consume", fromPortId: "result", toNodeId: "sink", toPortId: "result" },
    ],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [
      { triggerId: "manual", targetNodeId: "produce", targetPortId: "start" },
    ],
    requiredPlugins: [manifest.pluginId],
  };
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "neutral-flow-routing-"));
  const result = await compileFlowProgram({
    flow,
    dependencies: new Map([[manifest.pluginId, dependency]]),
    outDir: path.join(tempDir, "dist"),
  });
  return { canonicalBytes, compilation, result, tempDir };
}

let neutralRoutingFixturePromise;
function getNeutralRoutingFixture() {
  neutralRoutingFixturePromise ??= buildNeutralRoutingFixture();
  return neutralRoutingFixturePromise;
}

async function drainOne(host, frame) {
  const sinkFrames = [];
  host.enqueueTriggerFrame(0, frame);
  await host.drain({
    "test.sink:collect": ({ frames }) => {
      sinkFrames.push(...frames);
      return { statusCode: 0 };
    },
  });
  assert.equal(
    sinkFrames.length,
    1,
    `unexpected node states: ${JSON.stringify([
      host.getNodeState(0),
      host.getNodeState(1),
      host.getNodeState(2),
    ], (_key, value) => typeof value === "bigint" ? value.toString() : value)}`,
  );
  return sinkFrames[0];
}

test("compiled neutral router selects aligned sharing and deterministic canonical fallback", async () => {
  const fixture = await getNeutralRoutingFixture();
  const alignedHost = await createFlowRuntimeHost({ wasmSource: fixture.result.wasmBytes });
  const alignedBytes = new Uint8Array(8);
  new DataView(alignedBytes.buffer).setInt32(4, 2026, true);
  const alignedOutput = await drainOne(alignedHost, {
    portId: "start",
    bytes: alignedBytes,
    typeRef: {
      ...ATM_IDENTITY,
      wireFormat: "aligned-binary",
      byteLength: 8,
      requiredAlignment: 4,
    },
    alignment: 4,
    ownership: "host-owned",
    mutability: "immutable",
    frameId: 1n,
  });
  assert.deepEqual(alignedOutput.typeRef, {
    ...ATM_IDENTITY,
    schemaHash: Uint8Array.from(ATM_SCHEMA_HASH),
    wireFormat: "flatbuffer",
  });
  assert.deepEqual(alignedOutput.bytes, fixture.canonicalBytes);
  const nodeStates =
    alignedHost.instance.exports.space_data_module_runtime_get_node_states ??
    alignedHost.instance.exports._space_data_module_runtime_get_node_states;
  const nodeStateBase = nodeStates() >>> 0;
  assert.equal(
    new DataView(alignedHost.memory.buffer).getBigUint64(nodeStateBase + 32, true),
    1n,
    "FlowNodeRuntimeState retains the server-compatible 32-byte ABI stride",
  );
  const alignedState = alignedHost.getRoutingState();
  assert.equal(alignedState.alignedSharedRoutes, 1n);
  assert.equal(alignedState.canonicalRoutes, 1n);
  assert.equal(alignedState.rejectedFrames, 0n);

  const canonicalHost = await createFlowRuntimeHost({ wasmSource: fixture.result.wasmBytes });
  const canonicalOutput = await drainOne(canonicalHost, {
    portId: "start",
    bytes: fixture.canonicalBytes,
    typeRef: { ...ATM_IDENTITY, wireFormat: "flatbuffer" },
    ownership: "host-owned",
    mutability: "immutable",
    frameId: 2n,
  });
  assert.deepEqual(canonicalOutput.bytes, alignedOutput.bytes);
  const canonicalState = canonicalHost.getRoutingState();
  assert.equal(canonicalState.alignedSharedRoutes, 0n);
  assert.equal(canonicalState.canonicalRoutes, 2n);
  assert.equal(canonicalState.rejectedFrames, 0n);
});

test("compiled neutral router rejects malformed descriptor ranges and alignment", async () => {
  const fixture = await getNeutralRoutingFixture();
  const host = await createFlowRuntimeHost({ wasmSource: fixture.result.wasmBytes });
  const exports = host.instance.exports;
  const malloc = exports.malloc ?? exports._malloc;
  const enqueue =
    exports.space_data_module_runtime_enqueue_trigger_frame ??
    exports._space_data_module_runtime_enqueue_trigger_frame;
  assert.equal(typeof malloc, "function");
  assert.equal(typeof enqueue, "function");

  const writeDescriptor = ({ offset, size, alignment }) => {
    const ptr = malloc(48) >>> 0;
    const view = new DataView(host.memory.buffer);
    for (let byte = 0; byte < 48; byte += 1) view.setUint8(ptr + byte, 0);
    view.setUint32(ptr + 12, alignment, true);
    view.setUint32(ptr + 16, offset, true);
    view.setUint32(ptr + 20, size, true);
    view.setBigUint64(ptr + 32, 99n, true);
    view.setUint8(ptr + 40, 0);
    view.setUint8(ptr + 41, 1);
    view.setUint8(ptr + 42, 1); // aligned-binary
    view.setUint8(ptr + 43, 0); // host-owned
    view.setUint8(ptr + 44, 0); // immutable
    return ptr;
  };

  const wrapping = writeDescriptor({
    offset: 0xfffffff0,
    size: 64,
    alignment: 4,
  });
  assert.ok((enqueue(0, wrapping) | 0) < 0, "wrapping range must reject");

  const nullPayload = writeDescriptor({ offset: 0, size: 8, alignment: 4 });
  assert.ok((enqueue(0, nullPayload) | 0) < 0, "non-empty null payload must reject");

  const payload = malloc(16) >>> 0;
  const misaligned = writeDescriptor({ offset: payload + 1, size: 8, alignment: 4 });
  assert.ok((enqueue(0, misaligned) | 0) < 0, "misaligned payload must reject");

  const truncatedDescriptor = host.memory.buffer.byteLength - 16;
  assert.ok(
    (enqueue(0, truncatedDescriptor) | 0) < 0,
    "descriptor outside memory must reject",
  );
});

test("JS flow host rejects trigger frames with mismatched exact SDS identity", async () => {
  const fixture = await getNeutralRoutingFixture();
  const host = await createFlowRuntimeHost({ wasmSource: fixture.result.wasmBytes });
  assert.throws(
    () =>
      host.enqueueTriggerFrame(0, {
        portId: "start",
        bytes: fixture.canonicalBytes,
        typeRef: {
          ...ATM_IDENTITY,
          schemaVersion: "9.9.9",
          wireFormat: "flatbuffer",
        },
      }),
    /exact SDS identity/i,
  );
  assert.throws(
    () =>
      host.enqueueTriggerFrame(0, {
        portId: "start",
        bytes: fixture.canonicalBytes,
        typeRef: {
          ...ATM_IDENTITY,
          schemaHash: new Uint8Array(32).fill(0xff),
          wireFormat: "flatbuffer",
        },
      }),
    /exact SDS identity/i,
  );
  for (const invalidFrame of [
    { typeRef: { ...ATM_IDENTITY, wireFormat: "opaque" } },
    {
      typeRef: { ...ATM_IDENTITY, wireFormat: "flatbuffer" },
      ownership: "unowned",
    },
    {
      typeRef: { ...ATM_IDENTITY, wireFormat: "flatbuffer" },
      mutability: "racy",
    },
  ]) {
    assert.throws(
      () =>
        host.enqueueTriggerFrame(0, {
          portId: "start",
          bytes: fixture.canonicalBytes,
          ...invalidFrame,
        }),
      /unsupported frame (wire format|ownership|mutability)/i,
    );
  }
});

test("JS flow host releases transient frame allocations after each exchange", async () => {
  const fixture = await getNeutralRoutingFixture();
  const host = await createFlowRuntimeHost({ wasmSource: fixture.result.wasmBytes });
  const transientOutput = new Uint8Array(256 * 1024);
  const runExchange = async (frameId) => {
    host.enqueueTriggerFrame(0, {
      portId: "start",
      bytes: fixture.canonicalBytes,
      typeRef: { ...ATM_IDENTITY, wireFormat: "flatbuffer" },
      frameId,
    });
    await host.drain({
      "test.sink:collect": () => ({
        statusCode: 0,
        outputs: [
          {
            portId: "terminal",
            bytes: transientOutput,
            typeRef: { ...ATM_IDENTITY, wireFormat: "flatbuffer" },
          },
        ],
      }),
    });
  };

  await runExchange(1000n);
  const warmedMemoryBytes = host.memory.buffer.byteLength;
  for (let index = 0; index < 128; index += 1) {
    await runExchange(BigInt(1001 + index));
  }
  assert.equal(
    host.memory.buffer.byteLength,
    warmedMemoryBytes,
    "transient host descriptors and payloads must not grow WASM memory across exchanges",
  );
});

test("compiled neutral router enforces ownership, mutability, and frame lifetime", async (t) => {
  const fixture = await getNeutralRoutingFixture();
  t.after(async () => {
    if (neutralRoutingFixturePromise) {
      const built = await neutralRoutingFixturePromise;
      neutralRoutingFixturePromise = null;
      await cleanupCompilation(built.compilation);
      await rm(built.tempDir, { recursive: true, force: true });
    }
  });
  const host = await createFlowRuntimeHost({ wasmSource: fixture.result.wasmBytes });
  const exports = host.instance.exports;
  const malloc = exports.malloc ?? exports._malloc;
  const enqueue =
    exports.space_data_module_runtime_enqueue_trigger_frame ??
    exports._space_data_module_runtime_enqueue_trigger_frame;
  const ready =
    exports.space_data_module_runtime_get_ready_node_index ??
    exports._space_data_module_runtime_get_ready_node_index;
  const begin =
    exports.space_data_module_runtime_begin_node_invocation ??
    exports._space_data_module_runtime_begin_node_invocation;
  const generation =
    exports.space_data_module_runtime_get_current_invocation_generation ??
    exports._space_data_module_runtime_get_current_invocation_generation;
  const apply =
    exports.space_data_module_runtime_apply_node_invocation_result ??
    exports._space_data_module_runtime_apply_node_invocation_result;
  const complete =
    exports.space_data_module_runtime_complete_node_invocation ??
    exports._space_data_module_runtime_complete_node_invocation;

  assert.throws(
    () =>
      host.enqueueTriggerFrame(0, {
        bytes: new Uint8Array(8),
        typeRef: {
          ...ATM_IDENTITY,
          wireFormat: "aligned-binary",
          byteLength: 8,
          requiredAlignment: 4,
        },
        alignment: 3,
      }),
    /power of two/,
  );
  assert.throws(
    () =>
      host.enqueueTriggerFrame(0, {
        bytes: new Uint8Array(7),
        typeRef: {
          ...ATM_IDENTITY,
          wireFormat: "aligned-binary",
          byteLength: 8,
          requiredAlignment: 4,
        },
      }),
    /does not match payload length/,
  );
  assert.throws(
    () =>
      host.enqueueTriggerFrame(0, {
        bytes: new Uint8Array(8),
        typeRef: {
          ...ATM_IDENTITY,
          wireFormat: "aligned-binary",
          byteLength: 8,
          requiredAlignment: 4,
        },
        ownership: "plugin-owned",
        mutability: "mutable",
      }),
    /transferred ownership/,
  );

  const payloadPtr = malloc(12) >>> 0;
  const alignedPayloadPtr = Math.ceil(payloadPtr / 4) * 4;
  new Uint8Array(host.memory.buffer, alignedPayloadPtr, 8).fill(7);
  const framePtr = malloc(48) >>> 0;
  const descriptor = new DataView(host.memory.buffer);
  const writeRawFrame = ({
    ingressIndex = 0,
    frameId,
    ownership,
    mutability,
    portPtr = 0,
  }) => {
    for (let byte = 0; byte < 48; byte += 1) descriptor.setUint8(framePtr + byte, 0);
    descriptor.setUint32(framePtr + 0, ingressIndex, true);
    descriptor.setUint32(framePtr + 4, 0, true);
    descriptor.setUint32(framePtr + 8, portPtr, true);
    descriptor.setUint32(framePtr + 12, 4, true);
    descriptor.setUint32(framePtr + 16, alignedPayloadPtr, true);
    descriptor.setUint32(framePtr + 20, 8, true);
    descriptor.setBigUint64(framePtr + 32, frameId, true);
    descriptor.setUint8(framePtr + 41, 1);
    descriptor.setUint8(framePtr + 42, 1);
    descriptor.setUint8(framePtr + 43, ownership);
    descriptor.setUint8(framePtr + 44, mutability);
  };

  writeRawFrame({ frameId: 70n, ownership: 1, mutability: 1 });
  assert.ok((enqueue(0, framePtr) | 0) < 0, "plugin-owned mutable alias must reject");

  writeRawFrame({ frameId: 71n, ownership: 2, mutability: 1 });
  assert.ok((enqueue(0, framePtr) | 0) > 0, "single-consumer transfer must enqueue");
  assert.ok((enqueue(0, framePtr) | 0) < 0, "transferred frame ID must be single-use");
  assert.equal(ready() >>> 0, 0);
  assert.ok((begin(0, 64) | 0) > 0);
  complete(0);
  assert.ok(
    (enqueue(0, framePtr) | 0) > 0,
    "a transferred frame ID may be reused only after its prior frame lifetime ends",
  );

  host.resetState();
  host.enqueueTriggerFrame(0, {
    portId: "start",
    bytes: fixture.canonicalBytes,
    typeRef: { ...ATM_IDENTITY, wireFormat: "flatbuffer" },
    frameId: 80n,
  });
  const nodeIndex = ready() >>> 0;
  assert.equal(nodeIndex, 0);
  assert.ok((begin(nodeIndex, 64) | 0) > 0);
  const staleGeneration = generation() >>> 0;
  complete(nodeIndex);

  const portText = new TextEncoder().encode("middle\0");
  const portPtr = malloc(portText.length) >>> 0;
  new Uint8Array(host.memory.buffer).set(portText, portPtr);
  host.enqueueTriggerFrame(0, {
    portId: "start",
    bytes: fixture.canonicalBytes,
    typeRef: { ...ATM_IDENTITY, wireFormat: "flatbuffer" },
    frameId: 81n,
  });
  assert.equal(ready() >>> 0, 0);
  assert.ok((begin(0, 64) | 0) > 0);
  writeRawFrame({
    ingressIndex: staleGeneration,
    frameId: 82n,
    ownership: 0,
    mutability: 0,
    portPtr,
  });
  descriptor.setUint8(framePtr + 42, 0); // canonical fallback
  descriptor.setUint32(framePtr + 12, 1, true);
  assert.ok((apply(0, 0, 0, 0, framePtr, 1) | 0) < 0, "stale generation must reject");
  complete(0);
});

// WS3.2 — the JS flow host runs the SAME compiled flow artifact the Go host
// runs (starlink-flow runtime.wasm): linked-direct starlink-parser ->
// validator inside the artifact's linear memory, host-model sink handled by
// the JS handler map. Gated on SDN_STARLINK_FLOW_WASM (the built artifact).
const wasmPath = process.env.SDN_STARLINK_FLOW_WASM ?? "";

const MEME_FIXTURE = [
  "created: 2026-07-02T00:00:00Z",
  "ephemeris_start: 2026-07-02T00:00:00Z ephemeris_stop: 2026-07-03T00:00:00Z step_size: 60",
  "ephemeris_source: blend",
  "UVW",
  "2026185000000.000 6800.0 0.0 0.0 0.0 7.5 0.0",
  "2026185000060.000 6800.0 450.0 0.0 0.0 7.5 0.0",
  "2026185000120.000 6800.0 900.0 0.0 0.0 7.5 0.0",
  "",
].join("\n");

test(
  "JS flow host drains the linked-direct starlink chain",
  { skip: wasmPath === "" ? "set SDN_STARLINK_FLOW_WASM to the built runtime.wasm" : false },
  async () => {
    const host = await createFlowRuntimeHost({
      wasmSource: new Uint8Array(fs.readFileSync(wasmPath)),
    });

    assert.equal(host.nodeCount, 3);
    assert.equal(host.edgeCount, 2);
    assert.equal(host.triggerCount, 1);
    assert.equal(host.dependencyCount, 2);

    const parseDD = host.getNodeDispatchDescriptor(0);
    assert.equal(parseDD.nodeId, "parse");
    assert.equal(parseDD.pluginId, "org.digitalarsenal.ephem.starlink-parser");
    assert.equal(parseDD.dispatchModel, "linked-direct");
    assert.equal(host.getNodeDispatchDescriptor(2).dispatchModel, "host");
    assert.equal(
      host.getDependencyDescriptor(1).pluginId,
      "org.digitalarsenal.ephem.validator",
    );

    host.enqueueTriggerFrame(0, {
      portId: "raw",
      bytes: new TextEncoder().encode(MEME_FIXTURE),
    });
    assert.equal(host.getIngressState(0).totalReceived, 1n);

    const sinkFrames = [];
    const result = await host.drain(
      {
        "test.sink:collect": ({ frames }) => {
          sinkFrames.push(...frames);
          return { statusCode: 0 };
        },
      },
      { maxIterations: 50 },
    );
    assert.ok(result.nodesInvoked >= 3, `nodesInvoked = ${result.nodesInvoked}`);

    // Linked-direct nodes executed inside the artifact.
    assert.equal(host.getNodeState(0).invocationCount, 1n);
    assert.equal(host.getNodeState(1).invocationCount, 1n);

    assert.equal(sinkFrames.length, 1);
    assert.equal(sinkFrames[0].portId, "result");
    const verdict = JSON.parse(new TextDecoder().decode(sinkFrames[0].bytes));
    assert.equal(verdict.ok, true);
    assert.equal(verdict.stateCount, 3);

    // reset_state clears queues and states; no ready nodes remain.
    host.resetState();
    assert.equal(host.getNodeState(0).invocationCount, 0n);
    const idle = await host.drain({}, { maxIterations: 5 });
    assert.equal(idle.iterations, 0);
    assert.equal(FLOW_INVALID_INDEX, 0xffffffff);
  },
);
