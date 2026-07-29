/*
 * The OPAQUE byte route, compiled and RUN.
 *
 * Three defects shipped together and made every byte-edge flow inert after its
 * first node; each of them is pinned here against a really-compiled artifact,
 * because none of them is visible in a type check:
 *
 *  1. ROUTING. An OPAQUE edge (SDS $PLG 1.0.13: no CANONICAL_TYPE, OPAQUE=true)
 *     carries neither a canonical FlatBuffer type nor an aligned layout, so the
 *     compiled router rejected it on BOTH wire formats (-25 / -26). Opacity has
 *     to be a route, not a hole.
 *  2. PAYLOAD LIFETIME. The invoke shim kept the guest's raw output pointer and
 *     copied only after the entry returned — a use-after-free for every plugin
 *     that pushes from a temporary. It corrupted payloads silently; the test
 *     below frees the buffer deliberately so the corruption is deterministic.
 *  3. UNSPECIFIED ALIGNMENT. A frame descriptor with alignment 0 was refused
 *     (-30). The browser host defaults the field to 1 and the WasmEdge/Go host
 *     leaves it zeroed, so the SAME artifact started in one runtime and died in
 *     the other. Both encodings must be admitted identically.
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";

import { compileModuleFromSource } from "../src/compiler/compileModule.js";
import { compileFlowProgram } from "../src/flow/flowCompiler.js";
import { createFlowRuntimeHost } from "../src/flow/flowRuntimeHost.js";
import { normalizeManifestForSdnFlow } from "../src/flow/normalize.js";

const FLOW_INVALID_INDEX = 0xffffffff;

function opaqueTypeSet(setId) {
  return {
    setId,
    allowedTypes: [{ acceptsAnyFlatbuffer: true }],
    wildcardJustification: {
      kind: "foreign-wire-format",
      detail:
        "UTF-8 JSON request/response bytes exchanged with a host connector; no SDS identity exists for them.",
      mediaType: "application/json",
    },
  };
}

function port(portId, setId, required = true) {
  return {
    portId,
    required,
    minStreams: 1,
    maxStreams: 1,
    acceptedTypeSets: [opaqueTypeSet(setId)],
  };
}

const manifest = {
  pluginId: "test.opaque-byte-chain",
  name: "Opaque byte chain",
  version: "1.0.0",
  pluginFamily: "foundation",
  capabilities: [],
  externalInterfaces: [],
  invokeSurfaces: ["direct"],
  runtimeTargets: ["browser"],
  methods: [
    {
      methodId: "emit",
      displayName: "Emit",
      inputPorts: [port("tick", "tick")],
      outputPorts: [port("bytes", "bytes")],
      maxBatch: 1,
      drainPolicy: "single-shot",
    },
    {
      methodId: "echo",
      displayName: "Echo",
      inputPorts: [port("bytes", "bytes")],
      outputPorts: [port("out", "out")],
      maxBatch: 1,
      drainPolicy: "single-shot",
    },
  ],
  schemasUsed: [],
  abiVersion: 1,
};

// Nothing in this flow names an SDS type — that is the point — so the
// standards catalog it validates against is legitimately empty.
function catalog() {
  return [];
}

// `emit` pushes from a buffer it destroys BEFORE returning and then overwrites
// the freed block, which is exactly the shape every shipped data-source plugin
// has (`push_json(port, build_json(...))` binds a temporary). If the shim
// borrows instead of owning, `echo` sees the poison, not the payload.
const SOURCE = `
#include <stdint.h>
#include <string>
#include "space_data_module_invoke.h"

extern "C" int emit(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) { plugin_set_error("no-input", "emit requires a frame"); return 400; }
  {
    std::string payload = "{\\"url\\":\\"https://example.invalid/catalog.csv\\",\\"timeoutMs\\":90000}";
    plugin_push_output_ex("bytes", 0, 0, PLUGIN_PAYLOAD_WIRE_FORMAT_ALIGNED_BINARY, 0,
                          0, 1,
                          reinterpret_cast<const uint8_t *>(payload.data()),
                          static_cast<uint32_t>(payload.size()));
  }
  {
    std::string poison(512, 'Z');
    if (poison[0] != 'Z') return 500;
  }
  return 0;
}

extern "C" int echo(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) { plugin_set_error("no-input", "echo requires a frame"); return 400; }
  plugin_push_output_ex("out", 0, 0, PLUGIN_PAYLOAD_WIRE_FORMAT_ALIGNED_BINARY, 0,
                        0, 1, frame->payload, frame->payload_length);
  return 0;
}
`;

const EXPECTED = '{"url":"https://example.invalid/catalog.csv","timeoutMs":90000}';

async function buildOpaqueFlow() {
  const compilation = await compileModuleFromSource({
    // Explicit: browser targeting no longer implies a toolchain (wasi-sequential
    // model). This fixture wants the legacy Emscripten path — the same one the
    // removed browser->emcc inference used to select, so the opaque byte route
    // is proven over exactly the artifact this test was written against.
    threadModel: "single-thread",
    manifest,
    sourceCode: SOURCE,
    language: "c++",
    outputPath: path.join(
      await mkdtemp(path.join(os.tmpdir(), "opaque-byte-mod-")),
      "module.wasm",
    ),
    catalog: catalog(),
  });
  assert.ok(compilation.guestLink?.objectBytes?.length > 0);

  const dependencies = new Map([
    [
      manifest.pluginId,
      {
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
      },
    ],
  ]);

  const flow = {
    programId: "test.opaque-byte-flow",
    name: "Opaque byte flow",
    version: "0.1.0",
    nodes: [
      { nodeId: "emit", pluginId: manifest.pluginId, methodId: "emit", kind: "transform" },
      { nodeId: "echo", pluginId: manifest.pluginId, methodId: "echo", kind: "transform" },
      { nodeId: "sink", pluginId: "test.sink", methodId: "collect", kind: "sink" },
    ],
    edges: [
      {
        fromNodeId: "emit",
        fromPortId: "bytes",
        toNodeId: "echo",
        toPortId: "bytes",
        opaque: true,
      },
      {
        fromNodeId: "echo",
        fromPortId: "out",
        toNodeId: "sink",
        toPortId: "result",
        opaque: true,
      },
    ],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [
      { triggerId: "manual", targetNodeId: "emit", targetPortId: "tick" },
    ],
    requiredPlugins: [manifest.pluginId],
  };

  const outDir = path.join(
    await mkdtemp(path.join(os.tmpdir(), "opaque-byte-flow-")),
    "dist",
  );
  const result = await compileFlowProgram({
    flow,
    dependencies,
    outDir,
    catalog: catalog(),
  });
  assert.equal(result.report.ok, true, JSON.stringify(result.report.issues));
  return new Uint8Array(await readFile(path.join(outDir, "isomorphic", "module.wasm")));
}

// The compile is the expensive part; every case below reuses the one artifact,
// which is also the point — ONE module.wasm, every host encoding.
const wasmBytes = await buildOpaqueFlow();

async function newHost() {
  return createFlowRuntimeHost({ wasmSource: wasmBytes });
}

// Write the tick descriptor the way the Go/WasmEdge host writes it: 48 bytes,
// `alignment` left at whatever the caller supplies (that host supplies 0).
function enqueueRawTick(host, { alignment }) {
  const exports = host.instance.exports;
  const enqueue =
    exports.space_data_module_runtime_enqueue_trigger_frame ??
    exports._space_data_module_runtime_enqueue_trigger_frame;
  const malloc = exports.malloc ?? exports._malloc;
  const tick = new TextEncoder().encode('{"trigger":"manual"}');
  const portId = new TextEncoder().encode("tick\0");
  const ptr = malloc(48 + portId.length + tick.length) >>> 0;
  const heap = new Uint8Array(host.memory.buffer);
  const view = new DataView(host.memory.buffer);
  heap.fill(0, ptr, ptr + 48 + portId.length + tick.length);
  heap.set(portId, ptr + 48);
  heap.set(tick, ptr + 48 + portId.length);
  view.setUint32(ptr + 4, FLOW_INVALID_INDEX, true);
  view.setUint32(ptr + 8, ptr + 48, true);
  view.setUint32(ptr + 12, alignment, true);
  view.setUint32(ptr + 16, ptr + 48 + portId.length, true);
  view.setUint32(ptr + 20, tick.length, true);
  view.setUint8(ptr + 41, 1);
  return enqueue(0, ptr) | 0;
}

async function drainToSink(host) {
  const collected = [];
  await host.drain({
    "test.sink:collect": ({ frames }) => {
      for (const frame of frames) collected.push(new TextDecoder().decode(frame.bytes));
      return { statusCode: 0 };
    },
  });
  return collected;
}

test("an OPAQUE edge is a route, not a hole: byte frames cross it", async () => {
  const host = await newHost();
  for (let index = 0; index < host.edgeCount; index += 1) {
    const edge = host.getEdgeDescriptor(index);
    assert.equal(edge.opaque, 1, `edge ${index} must compile as OPAQUE`);
    assert.equal(edge.canonicalFallbackAvailable, 0);
    assert.equal(edge.alignedEligible, 0);
  }

  host.enqueueTriggerFrame(0, {
    portId: "tick",
    bytes: new TextEncoder().encode('{"trigger":"manual"}'),
  });
  assert.deepEqual(await drainToSink(host), [EXPECTED]);

  const routing = host.getRoutingState();
  assert.equal(routing.rejectedFrames, 0n, "no frame may be rejected on an opaque edge");
  assert.equal(routing.alignedSharedRoutes + routing.alignedCopiedRoutes, 0n,
    "an opaque payload never claims the aligned route");
});

test("a pushed payload outlives the guest entry that pushed it", async () => {
  // `emit` frees its buffer and overwrites the block before returning. The
  // bytes that reach the sink must still be the pushed ones, not the poison.
  const host = await newHost();
  host.enqueueTriggerFrame(0, {
    portId: "tick",
    bytes: new TextEncoder().encode('{"trigger":"manual"}'),
  });
  const collected = await drainToSink(host);
  assert.deepEqual(collected, [EXPECTED]);
  assert.ok(!collected[0].includes("Z"), "a borrowed pointer would deliver the poison");
});

test("an unspecified frame alignment means 1 in EVERY host encoding", async () => {
  // alignment 0 is what the Go/WasmEdge host writes; alignment 1 is what the
  // browser host writes. Same artifact, same tick, same result — or the flow is
  // not isomorphic.
  const results = [];
  for (const alignment of [0, 1]) {
    const host = await newHost();
    const rc = enqueueRawTick(host, { alignment });
    assert.equal(rc >= 0, true, `alignment ${alignment} must be admitted, got ${rc}`);
    results.push({ alignment, rc, collected: await drainToSink(host) });
  }
  assert.deepEqual(results[0].collected, [EXPECTED]);
  assert.deepEqual(
    results[0].collected,
    results[1].collected,
    "an unset alignment and an explicit 1 must produce identical output",
  );
  assert.equal(results[0].rc, results[1].rc);
});

test("a host refuses an artifact whose descriptor ABI generation it does not share", async () => {
  // Growing FlowEdge from 64 to 68 bytes is invisible from the outside: an
  // older artifact's edge table is the same pointer, the same count, and every
  // field past the first edge is read at the wrong offset. The artifact states
  // its generation and the host refuses a mismatch, because a binary interface
  // whose only failure mode is "believable garbage" is not an interface.
  const host = await newHost();
  assert.equal(host.descriptorAbiGeneration, 2);
  assert.deepEqual(host.getEdgeDescriptor(0).opaque, 1);

  host.descriptorAbiGeneration = 1; // what a pre-OPAQUE artifact reports
  assert.throws(
    () => host.getEdgeDescriptor(0),
    /descriptor ABI generation 1 does not match this host's 2/,
    "a stride mismatch must fail loudly, never silently misread",
  );
});
