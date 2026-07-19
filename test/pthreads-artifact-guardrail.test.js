import test from "node:test";
import assert from "node:assert/strict";

import {
  compileModuleFromSource,
  ModuleThreadModel,
} from "../src/index.js";
import {
  analyzeWasmThreadFeatures,
  assertPthreadArtifact,
  assertPthreadFlagsPresent,
  PTHREAD_FINAL_LINK_FLAGS,
} from "../src/compiler/pthreadArtifactGuard.js";
import { parseWasmModuleSections, decodeUnsignedLeb128 } from "../src/bundle/wasm.js";

function createTestManifest(overrides = {}) {
  return {
    pluginId: "com.digitalarsenal.examples.pthreads-guardrail",
    name: "Pthreads Guardrail Propagator",
    version: "0.1.0",
    pluginFamily: "propagator",
    capabilities: ["clock"],
    externalInterfaces: [],
    runtimeTargets: ["wasmedge"],
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
                allowedTypes: [{ schemaName: "OMM.fbs", fileIdentifier: "$OMM" }],
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
                allowedTypes: [{ schemaName: "CAT.fbs", fileIdentifier: "$CAT" }],
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        maxBatch: 32,
        drainPolicy: "drain-to-empty",
      },
    ],
    ...overrides,
  };
}

// A real pthreads module that spawns std::thread workers over a std::atomic
// accumulator — the proven conjunction-assessment shape. VERIFIED to compile
// through the SDK pthreads path and emit a shared-memory/atomics wasm.
const THREADED_CPP_SOURCE = `#include <atomic>
#include <thread>
#include <vector>
extern "C" int propagate(void) {
  std::atomic<int> acc{0};
  std::vector<std::thread> workers;
  for (int i = 0; i < 4; ++i) {
    workers.emplace_back([&acc, i]() { acc.fetch_add(i + 1, std::memory_order_relaxed); });
  }
  for (auto& w : workers) w.join();
  return acc.load(std::memory_order_relaxed);
}
`;

// A single-thread C module that deliberately embeds 0xFE-valued i32 constants
// and memory load/store instructions (whose offsets can contain 0xFE bytes) so
// the atomics decoder is exercised against false positives. `volatile` blocks
// constant folding so the 0xFE bytes survive -O3.
const FALSE_POSITIVE_C_SOURCE = `#include <stdint.h>
static volatile uint32_t g_table[256];
int propagate(void) {
  uint32_t acc = 0xFEFEFEFEu;
  for (int i = 0; i < 256; ++i) { g_table[i] = acc; acc = acc * 0x12FE34FEu + (uint32_t)i; }
  uint32_t sum = 0x00FE00FEu;
  for (int i = 0; i < 256; ++i) sum ^= g_table[(i * 0xFEu) & 255];
  return (int)(sum ^ acc);
}
`;

let cachedPthreadCompile = null;
function compilePthreadModule() {
  if (!cachedPthreadCompile) {
    cachedPthreadCompile = compileModuleFromSource({
      manifest: createTestManifest(),
      sourceCode: THREADED_CPP_SOURCE,
      language: "c++",
      threadModel: ModuleThreadModel.EMSCRIPTEN_PTHREADS,
    });
  }
  return cachedPthreadCompile;
}

/**
 * Return the absolute byte offset of the (first) imported memory's limits flags
 * byte, so a test can deterministically flip the shared bit. Returns -1 if no
 * imported memory is present.
 */
function findImportedMemoryFlagsOffset(wasmBytes) {
  const parsed = parseWasmModuleSections(wasmBytes);
  const section = parsed.sections.find((s) => s.id === 2);
  if (!section) return -1;
  const bytes = parsed.bytes;
  const dec = new TextDecoder();
  let cursor = section.payloadStart;
  const count = decodeUnsignedLeb128(bytes, cursor);
  cursor = count.nextOffset;
  for (let i = 0; i < count.value; i += 1) {
    const modLen = decodeUnsignedLeb128(bytes, cursor);
    cursor = modLen.nextOffset + modLen.value;
    const nameLen = decodeUnsignedLeb128(bytes, cursor);
    cursor = nameLen.nextOffset + nameLen.value;
    const kind = bytes[cursor++];
    if (kind === 0x00) {
      cursor = decodeUnsignedLeb128(bytes, cursor).nextOffset;
    } else if (kind === 0x01) {
      cursor += 1;
      const flags = bytes[cursor++];
      cursor = decodeUnsignedLeb128(bytes, cursor).nextOffset;
      if (flags & 0x01) cursor = decodeUnsignedLeb128(bytes, cursor).nextOffset;
    } else if (kind === 0x02) {
      return cursor; // the flags byte
    } else if (kind === 0x03) {
      cursor += 2;
    } else {
      return -1;
    }
  }
  return -1;
}

function codeSectionContainsByte(wasmBytes, byteValue) {
  const parsed = parseWasmModuleSections(wasmBytes);
  const code = parsed.sections.find((s) => s.id === 10);
  if (!code) return false;
  for (let i = code.payloadStart; i < code.payloadEnd; i += 1) {
    if (parsed.bytes[i] === byteValue) return true;
  }
  return false;
}

test("flag assembler carries the mandated pthreads flags and never -mthreads", () => {
  assert.ok(PTHREAD_FINAL_LINK_FLAGS.includes("-pthread"));
  assert.ok(PTHREAD_FINAL_LINK_FLAGS.includes("-matomics"));
  assert.ok(PTHREAD_FINAL_LINK_FLAGS.includes("-mbulk-memory"));
  for (const setting of ["STANDALONE_WASM=1", "IMPORTED_MEMORY=1", "ALLOW_MEMORY_GROWTH=1"]) {
    const present = PTHREAD_FINAL_LINK_FLAGS.some(
      (value, index) => value === "-s" && PTHREAD_FINAL_LINK_FLAGS[index + 1] === setting,
    );
    assert.ok(present, `expected -s ${setting} in PTHREAD_FINAL_LINK_FLAGS`);
  }
  // -mthreads is invalid for wasm32-unknown-emscripten and must never be added.
  assert.ok(!PTHREAD_FINAL_LINK_FLAGS.includes("-mthreads"));

  // The invariant guard passes on the full set and throws if a flag is dropped.
  assert.doesNotThrow(() =>
    assertPthreadFlagsPresent([...PTHREAD_FINAL_LINK_FLAGS], {
      threadModel: ModuleThreadModel.EMSCRIPTEN_PTHREADS,
    }),
  );
  const stripped = PTHREAD_FINAL_LINK_FLAGS.filter(
    (value, index) =>
      !(value === "-s" && PTHREAD_FINAL_LINK_FLAGS[index + 1] === "ALLOW_MEMORY_GROWTH=1") &&
      value !== "ALLOW_MEMORY_GROWTH=1",
  );
  assert.throws(
    () =>
      assertPthreadFlagsPresent(stripped, {
        threadModel: ModuleThreadModel.EMSCRIPTEN_PTHREADS,
      }),
    /ALLOW_MEMORY_GROWTH/,
  );
  // Non-pthreads models are not constrained by the assertion.
  assert.doesNotThrow(() =>
    assertPthreadFlagsPresent([], { threadModel: ModuleThreadModel.SINGLE_THREAD }),
  );
});

test("pthreads compile emits a validated shared-memory / atomics wasm", async () => {
  const result = await compilePthreadModule();
  assert.equal(result.threadModel, ModuleThreadModel.EMSCRIPTEN_PTHREADS);

  // The compile itself ran the guardrail and attached the analysis.
  assert.ok(result.threadFeatures);
  assert.equal(result.threadFeatures.hasSharedMemory, true);
  assert.equal(result.threadFeatures.usesAtomics, true);

  const analysis = analyzeWasmThreadFeatures(result.wasmBytes);
  assert.equal(analysis.hasSharedMemory, true);
  assert.equal(analysis.sharedMemory.source, "import");
  assert.equal(analysis.sharedMemory.shared, true);
  assert.equal(analysis.usesAtomics, true);
  assert.ok(analysis.atomicInstructionCount > 0);
  // ALLOW_MEMORY_GROWTH took effect: the shared memory is growable (max > min).
  assert.ok(analysis.sharedMemory.max > analysis.sharedMemory.min);
  assert.equal(analysis.isGrowableSharedMemory, true);

  // The explicit assertion accepts a genuine pthreads artifact.
  assert.doesNotThrow(() => assertPthreadArtifact(result.wasmBytes));
});

test("single-thread artifact is rejected by the pthreads validator", async () => {
  const result = await compileModuleFromSource({
    manifest: createTestManifest(),
    sourceCode: "int propagate(void) { return 7; }\n",
    language: "c",
    threadModel: ModuleThreadModel.SINGLE_THREAD,
  });
  assert.equal(result.threadModel, ModuleThreadModel.SINGLE_THREAD);

  const analysis = analyzeWasmThreadFeatures(result.wasmBytes);
  assert.equal(analysis.hasSharedMemory, false);

  assert.throws(
    () => assertPthreadArtifact(result.wasmBytes, { source: "single-thread.wasm" }),
    /shared memory/i,
  );
});

test("a shared-flag-stripped pthreads artifact is rejected", async () => {
  const result = await compilePthreadModule();
  const offset = findImportedMemoryFlagsOffset(result.wasmBytes);
  assert.ok(offset >= 0, "expected an imported memory in the pthreads artifact");
  assert.equal(result.wasmBytes[offset] & 0x02, 0x02, "expected the shared bit set before tampering");

  const tampered = result.wasmBytes.slice();
  tampered[offset] = tampered[offset] & ~0x02; // clear the shared bit (0x03 -> 0x01)

  const analysis = analyzeWasmThreadFeatures(tampered);
  assert.equal(analysis.hasSharedMemory, false);
  assert.throws(
    () => assertPthreadArtifact(tampered, { source: "stripped.wasm" }),
    /shared memory/i,
  );
});

test("atomics decoder does not false-positive on 0xFE immediates", async () => {
  const result = await compileModuleFromSource({
    manifest: createTestManifest(),
    sourceCode: FALSE_POSITIVE_C_SOURCE,
    language: "c",
    threadModel: ModuleThreadModel.SINGLE_THREAD,
  });
  // Prove the scenario is real: the single-thread code section actually contains
  // 0xFE bytes (from i32.const / memarg immediates), which a naive byte scan
  // would miscount as atomics.
  assert.equal(
    codeSectionContainsByte(result.wasmBytes, 0xfe),
    true,
    "expected 0xFE bytes in the single-thread code section to exercise the decoder",
  );

  const analysis = analyzeWasmThreadFeatures(result.wasmBytes);
  assert.equal(analysis.atomicInstructionCount, 0);
  assert.equal(analysis.usesAtomics, false);
  assert.equal(analysis.hasSharedMemory, false);
});
