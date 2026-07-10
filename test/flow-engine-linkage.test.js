// Direct FlatSQL engine linkage (loop C.7): compile a flow in LINKED mode
// (flow.engineLinkage = "flatsql") and prove the artifact's query submission
// happens through direct wasm imports — module "flatsql" (engine function
// exports) + module "flatsql_link" (the memory-crossing shim) — with ZERO
// hostcalls. The engine here is a JS mock implementing the exact C ABI
// surface the linked runtime imports, which pins the contract without
// needing the real engine (the real-engine e2e lives in
// space-data-network-modules/flows/data-retrieval, and the Go host proves
// the same artifact against the live store engine).

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";

import { compileModuleFromSource } from "../src/compiler/compileModule.js";
import { compileFlowProgram, checkFlowProgram, ENGINE_LINK_CAPABILITY } from "../src/flow/flowCompiler.js";
import { createFlowRuntimeHost } from "../src/flow/flowRuntimeHost.js";
import { isEngineBodyRefToken } from "../src/flow/flatsqlLinkShim.js";
import { normalizeManifestForSdnFlow } from "../src/flow/normalize.js";
import { fnv1a64Hex } from "../src/http/index.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function wildcardPort(portId, { required = true } = {}) {
  return {
    portId,
    required,
    minStreams: required ? 1 : 0,
    maxStreams: 1,
    acceptedTypeSets: [{ setId: `${portId}-any`, allowedTypes: [{ acceptsAnyFlatbuffer: true }] }],
  };
}

// A canned "materialized aligned stream" the mock engine serves: two
// size-prefixed frames.
function cannedStream() {
  const frames = [encoder.encode("frame-one"), encoder.encode("frame-two-longer")];
  const total = frames.reduce((sum, frame) => sum + 4 + frame.length, 0);
  const stream = new Uint8Array(total);
  const view = new DataView(stream.buffer);
  let offset = 0;
  for (const frame of frames) {
    view.setUint32(offset, frame.length, true);
    stream.set(frame, offset + 4);
    offset += 4 + frame.length;
  }
  return stream;
}

// Mock FlatSQL engine: the exact import surface the linked flow runtime
// binds (function exports + memory). Deliberately JS — the contract under
// test is the ARTIFACT's, not the engine's.
function createMockEngine(streamBytes) {
  const memory = new WebAssembly.Memory({ initial: 16 });
  let brk = 65536;
  const calls = [];
  let artifact = { ptr: 0, size: 0 };
  const exports = {
    memory,
    malloc: (n) => {
      const ptr = brk;
      brk += (n + 7) & ~7;
      return ptr;
    },
    free: () => {},
    flatsql_query_raw_flatbuffer_stream: (db, sqlPtr, blobPtr, blobLen, paramCount) => {
      const heap = new Uint8Array(memory.buffer);
      let end = sqlPtr;
      while (heap[end] !== 0) end += 1;
      calls.push({
        db,
        sql: decoder.decode(heap.slice(sqlPtr, end)),
        params: blobLen > 0 ? heap.slice(blobPtr, blobPtr + blobLen) : new Uint8Array(0),
        paramCount,
      });
      const ptr = exports.malloc(streamBytes.length);
      new Uint8Array(memory.buffer).set(streamBytes, ptr);
      artifact = { ptr, size: streamBytes.length };
      return 1;
    },
    flatsql_response_artifact_data: () => artifact.ptr,
    flatsql_response_artifact_size: () => artifact.size,
    flatsql_response_artifact_row_count: () => 2,
    flatsql_response_artifact_column_count: () => 1,
    flatsql_response_artifact_cache_hit: () => 0,
    flatsql_query_cache_generation: () => 7,
    flatsql_get_error: () => 0,
  };
  return { exports, calls, memory };
}

test("linked-mode flow submits queries via direct engine imports (zero hostcalls)", async (t) => {
  const queryManifest = {
    pluginId: "test.linkedquery",
    name: "Linked query",
    version: "1.0.0",
    pluginFamily: "foundation",
    capabilities: ["storage_query"],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    runtimeTargets: ["browser"],
    methods: [
      {
        methodId: "run_query",
        displayName: "Run query",
        inputPorts: [wildcardPort("sql")],
        outputPorts: [wildcardPort("ref"), wildcardPort("bytes", { required: false })],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
    schemasUsed: [],
    abiVersion: 1,
  };

  // The module body exercises BOTH delivery shapes of the linked helper:
  // reference (engine body-ref token + fnv metadata) and byte materialization
  // into flow memory (json-branch shape).
  const compilation = await compileModuleFromSource({
    manifest: queryManifest,
    sourceCode: `
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "space_data_module_invoke.h"

struct SdnFlatsqlLinkedResult {
  uint64_t generation;
  uint64_t fnv1a64;
  uint64_t token;
  uint32_t engine_ptr;
  uint32_t size;
  int32_t rows;
  int32_t cols;
  int32_t cache_hit;
  int32_t frames;
};

extern "C" int32_t sdn_flatsql_linked_query_raw_stream(
    const char *sql, uint32_t sql_len, const uint8_t *params_tlv, uint32_t tlv_len,
    uint32_t param_count, int32_t want_ref, SdnFlatsqlLinkedResult *out);
extern "C" int32_t sdn_flatsql_linked_read(uint8_t *dst, uint32_t engine_ptr, uint32_t len);
extern "C" const char *sdn_flatsql_linked_error(void);

extern "C" int run_query(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) { plugin_set_error("no-input", "run_query requires a SQL frame"); return 400; }

  // TLV params: one int64 (42) — [tag 2][u32le len 8][8-byte LE payload].
  uint8_t tlv[13];
  tlv[0] = 2; tlv[1] = 8; tlv[2] = 0; tlv[3] = 0; tlv[4] = 0;
  uint64_t v = 42; memcpy(tlv + 5, &v, 8);

  SdnFlatsqlLinkedResult result;
  const int32_t status = sdn_flatsql_linked_query_raw_stream(
      reinterpret_cast<const char *>(frame->payload), frame->payload_length,
      tlv, sizeof(tlv), 1, /*want_ref=*/1, &result);
  if (status != 0) { plugin_set_error("linked-query-failed", sdn_flatsql_linked_error()); return 502; }

  char descriptor[256];
  snprintf(descriptor, sizeof(descriptor),
           "{\\"$sdnbodyref\\":1,\\"token\\":%llu,\\"size\\":%u,\\"frames\\":%d,"
           "\\"fnv1a64\\":\\"%016llx\\",\\"gen\\":%llu,\\"rows\\":%d}",
           (unsigned long long)result.token, result.size, result.frames,
           (unsigned long long)result.fnv1a64, (unsigned long long)result.generation,
           result.rows);
  plugin_push_output("ref", 0, 0, reinterpret_cast<const uint8_t *>(descriptor),
                     (uint32_t)strlen(descriptor));

  // Byte materialization (the json-branch shape): engine -> flow memory.
  uint8_t *copy = (uint8_t *)malloc(result.size);
  sdn_flatsql_linked_read(copy, result.engine_ptr, result.size);
  plugin_push_output("bytes", 0, 0, copy, result.size);
  free(copy);
  return 0;
}
`,
    language: "c++",
    outputPath: path.join(await mkdtemp(path.join(os.tmpdir(), "flow-linked-test-")), "module.wasm"),
    allowUndefinedImports: true,
  });

  const dependencies = new Map([
    [
      "test.linkedquery",
      {
        pluginId: "test.linkedquery",
        manifest: queryManifest,
        normalized: normalizeManifestForSdnFlow(queryManifest),
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
    programId: "test.linked-flow",
    name: "Linked flow",
    version: "0.1.0",
    engineLinkage: "flatsql",
    nodes: [
      { nodeId: "query", pluginId: "test.linkedquery", methodId: "run_query", kind: "transform" },
      { nodeId: "sink", pluginId: "test.sink", methodId: "collect", kind: "sink" },
    ],
    edges: [
      { fromNodeId: "query", fromPortId: "ref", toNodeId: "sink", toPortId: "ref" },
      { fromNodeId: "query", fromPortId: "bytes", toNodeId: "sink", toPortId: "bytes" },
    ],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [{ triggerId: "manual", targetNodeId: "query", targetPortId: "sql" }],
    requiredPlugins: ["test.linkedquery"],
  };

  // check stamps the engine-link capability.
  const check = checkFlowProgram({ flow, dependencies });
  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.equal(check.engineLinkage, "flatsql");
  assert.ok(check.capabilities.includes(ENGINE_LINK_CAPABILITY));

  const outDir = path.join(await mkdtemp(path.join(os.tmpdir(), "flow-linked-out-")), "dist");
  const result = await compileFlowProgram({ flow, dependencies, outDir });
  assert.equal(result.report.ok, true, JSON.stringify(result.report.issues));
  assert.equal(result.artifact.engineLinkage, "flatsql-direct");
  assert.ok(result.manifest.capabilities.includes(ENGINE_LINK_CAPABILITY));
  assert.ok(result.outputs.linkShimPath, "linked bundles ship the flatsql-link shim");

  // The artifact's engine-facing surface is IMPORTS, not hostcalls.
  const wasmBytes = new Uint8Array(await readFile(result.outputs.moduleWasmPath));
  const wasmModule = await WebAssembly.compile(
    // strip the sds.manifest custom section noise by compiling directly —
    // custom sections are ignored by compile.
    wasmBytes.slice().buffer,
  );
  const importModules = WebAssembly.Module.imports(wasmModule).map((i) => `${i.module}.${i.name}`);
  assert.ok(importModules.includes("flatsql.malloc"));
  assert.ok(importModules.includes("flatsql.flatsql_query_raw_flatbuffer_stream"));
  assert.ok(importModules.includes("flatsql_link.poke8"));
  assert.ok(importModules.includes("flatsql_link.fnv1a64"));
  const exportNames = WebAssembly.Module.exports(wasmModule).map((e) => e.name);
  assert.ok(exportNames.includes("sdn_flatsql_link_init"));
  assert.ok(exportNames.includes("sdn_flatsql_link_ref_table"));

  // Instantiate against the mock engine and drain: the query crosses as
  // direct in-wasm calls; NO space_data_module_host import is needed at all.
  const engine = createMockEngine(cannedStream());
  const host = await createFlowRuntimeHost({
    wasmSource: wasmBytes,
    wasmModule,
    engineLink: { exports: engine.exports, dbHandle: 1234 },
  });

  const sql = "SELECT _data FROM OMM WHERE rowid > ?";
  host.enqueueTriggerFrame(0, { portId: "sql", bytes: encoder.encode(sql) });
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

  // The mock engine received the EXACT query submission, in engine memory.
  assert.equal(engine.calls.length, 1);
  assert.equal(engine.calls[0].db, 1234, "db handle wired by sdn_flatsql_link_init");
  assert.equal(engine.calls[0].sql, sql);
  assert.equal(engine.calls[0].paramCount, 1);
  assert.deepEqual(
    Array.from(engine.calls[0].params.subarray(0, 5)),
    [2, 8, 0, 0, 0],
    "TLV param header crossed into engine memory intact",
  );

  // Byte-path output: byte-identical to the engine artifact.
  const bytesFrame = sinkFrames.find((frame) => frame.portId === "bytes");
  assert.ok(bytesFrame);
  assert.deepEqual(bytesFrame.bytes, cannedStream());

  // Reference-path output: descriptor with an SDNE token; the host resolves
  // it straight out of ENGINE memory, and the fnv1a64 is the canonical hash.
  const refFrame = sinkFrames.find((frame) => frame.portId === "ref");
  assert.ok(refFrame);
  const descriptorText = decoder.decode(refFrame.bytes);
  const descriptor = JSON.parse(descriptorText);
  // u64 tokens exceed Number precision — extract from the raw text (the real
  // consumers parse u64s exactly: http-respond in C++, $HTR fields in Go/JS).
  const token = BigInt(descriptorText.match(/"token":(\d+)/)[1]);
  assert.equal(descriptor.$sdnbodyref, 1);
  assert.equal(descriptor.size, cannedStream().length);
  assert.equal(descriptor.frames, 2);
  assert.equal(descriptor.gen, 7);
  assert.equal(descriptor.rows, 2);
  assert.equal(descriptor.fnv1a64, fnv1a64Hex(cannedStream()));
  assert.ok(isEngineBodyRefToken(token));

  const resolved = host.resolveEngineBodyRef(token);
  assert.ok(resolved, "engine body-ref must resolve from the exported table");
  assert.deepEqual(resolved.bytes, cannedStream());
  assert.equal(resolved.generation, 7n);
  assert.equal(`${resolved.fnv1a64.toString(16).padStart(16, "0")}`, descriptor.fnv1a64);

  t.diagnostic("linked flow: query submission + result identity fully in-wasm");
});
