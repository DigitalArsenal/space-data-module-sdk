import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";

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
import { resolveWasiThreadsToolchain } from "../src/compiler/wasiThreadsToolchain.js";
import { parseWasmModuleSections, decodeUnsignedLeb128 } from "../src/bundle/wasm.js";

function wasiThreadsAvailable() {
  try {
    resolveWasiThreadsToolchain();
    return true;
  } catch {
    return false;
  }
}

function emscriptenAvailable() {
  try {
    execFileSync("em++", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function dualTypeSet(setId, schemaName, fileIdentifier, rootTypeName) {
  const identity = { schemaName, fileIdentifier, rootTypeName };
  return {
    setId,
    allowedTypes: [
      { ...identity, wireFormat: "flatbuffer" },
      {
        ...identity,
        wireFormat: "aligned-binary",
        byteLength: 64,
        requiredAlignment: 8,
      },
    ],
  };
}

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
              dualTypeSet("omm", "OMM.fbs", "$OMM", "OMM"),
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
              dualTypeSet("cat", "CAT.fbs", "$CAT", "CAT"),
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
// accumulator — the proven conjunction-assessment shape.
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
// and memory load/store instructions so the atomics decoder is exercised
// against false positives. `volatile` blocks constant folding under -O3.
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
 * Compile a browser-only Emscripten `-pthread` standalone artifact directly with
 * em++. It has shared memory + atomics but imports env.__pthread_create_js and
 * the _emscripten_* worker/mailbox hooks (no wasi thread-spawn) — the exact
 * artifact the guardrail must REJECT.
 */
function compileEmscriptenBrowserPthread() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "empthread-"));
  const src = path.join(dir, "m.cpp");
  const out = path.join(dir, "m.wasm");
  // em++ treats `.c` as C++ (mangling), so use extern "C" for a clean export.
  writeFileSync(src, 'extern "C" int propagate(void){return 7;}\n');
  execFileSync(
    "em++",
    [
      "-O3",
      "--no-entry",
      "-pthread",
      "-s",
      "STANDALONE_WASM=1",
      "-s",
      "IMPORTED_MEMORY=1",
      "-Wl,--export=propagate",
      src,
      "-o",
      out,
    ],
    { stdio: "ignore" },
  );
  return new Uint8Array(readFileSync(out));
}

/** Absolute byte offset of the first imported memory's limits flags byte. */
function findImportedMemoryFlagsOffset(wasmBytes) {
  const parsed = parseWasmModuleSections(wasmBytes);
  const section = parsed.sections.find((s) => s.id === 2);
  if (!section) return -1;
  const bytes = parsed.bytes;
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
      return cursor;
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

test("flag assembler carries the mandated wasi-threads link flags, no emscripten -s / -mthreads", () => {
  for (const flag of [
    "-pthread",
    "-matomics",
    "-mbulk-memory",
    "-Wl,--import-memory",
    "-Wl,--shared-memory",
  ]) {
    assert.ok(PTHREAD_FINAL_LINK_FLAGS.includes(flag), `expected ${flag}`);
  }
  assert.ok(
    PTHREAD_FINAL_LINK_FLAGS.some((f) => f.startsWith("-Wl,--max-memory=")),
    "expected a -Wl,--max-memory= flag",
  );
  // Must NOT carry Emscripten -s settings (those produce the browser-only build)
  // and must never add -mthreads (invalid for the wasm target).
  assert.ok(!PTHREAD_FINAL_LINK_FLAGS.includes("-mthreads"));
  assert.ok(!PTHREAD_FINAL_LINK_FLAGS.includes("-s"));

  assert.doesNotThrow(() =>
    assertPthreadFlagsPresent([...PTHREAD_FINAL_LINK_FLAGS], {
      threadModel: ModuleThreadModel.EMSCRIPTEN_PTHREADS,
    }),
  );
  const stripped = PTHREAD_FINAL_LINK_FLAGS.filter(
    (value) => value !== "-Wl,--shared-memory",
  );
  assert.throws(
    () =>
      assertPthreadFlagsPresent(stripped, {
        threadModel: ModuleThreadModel.EMSCRIPTEN_PTHREADS,
      }),
    /shared-memory/,
  );
  assert.doesNotThrow(() =>
    assertPthreadFlagsPresent([], { threadModel: ModuleThreadModel.SINGLE_THREAD }),
  );
});

test("pthreads compile emits a validated wasi-threads shared-memory/atomics wasm", async (t) => {
  if (!wasiThreadsAvailable()) {
    t.skip("wasi-threads toolchain (wasm32-wasip1-threads) is not available.");
    return;
  }
  const result = await compilePthreadModule();
  assert.equal(result.threadModel, ModuleThreadModel.EMSCRIPTEN_PTHREADS);
  assert.match(result.compiler, /wasi-threads/);

  assert.ok(result.threadFeatures);
  assert.equal(result.threadFeatures.isIsomorphicPthreads, true);

  const analysis = analyzeWasmThreadFeatures(result.wasmBytes);
  // shared memory
  assert.equal(analysis.hasSharedMemory, true);
  assert.equal(analysis.sharedMemory.source, "import");
  assert.equal(analysis.sharedMemory.shared, true);
  assert.ok(analysis.sharedMemory.max > analysis.sharedMemory.min);
  assert.equal(analysis.isGrowableSharedMemory, true);
  // atomics
  assert.equal(analysis.usesAtomics, true);
  assert.ok(analysis.atomicInstructionCount > 0);
  // the wasi-threads host contract
  assert.equal(analysis.hasWasiThreadSpawnImport, true);
  assert.equal(analysis.hasWasiThreadStartExport, true);
  // NOT an Emscripten Web-Worker build
  assert.deepEqual(analysis.emscriptenThreadHooks, []);

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
  assert.equal(analysis.isIsomorphicPthreads, false);

  assert.throws(
    () => assertPthreadArtifact(result.wasmBytes, { source: "single-thread.wasm" }),
    /shared memory|wasi/i,
  );
});

test("an Emscripten browser-only -pthread artifact is rejected (has shared memory + atomics but no wasi-threads contract)", async (t) => {
  if (!emscriptenAvailable()) {
    t.skip("Emscripten (em++) is not available to build the browser-only fixture.");
    return;
  }
  const wasmBytes = compileEmscriptenBrowserPthread();
  const analysis = analyzeWasmThreadFeatures(wasmBytes);

  // It DOES have shared memory + atomics — the necessary-but-insufficient case.
  assert.equal(analysis.hasSharedMemory, true);
  assert.equal(analysis.usesAtomics, true);
  // But it is the browser-only Web Worker build, not a wasi-threads artifact.
  assert.ok(analysis.emscriptenThreadHooks.length > 0);
  assert.equal(analysis.hasWasiThreadSpawnImport, false);
  assert.equal(analysis.hasWasiThreadStartExport, false);
  assert.equal(analysis.isIsomorphicPthreads, false);

  assert.throws(
    () => assertPthreadArtifact(wasmBytes, { source: "emscripten-browser.wasm" }),
    /Emscripten|wasi|thread-spawn|wasi_thread_start/i,
  );
});

test("a shared-flag-stripped pthreads artifact is rejected", async (t) => {
  if (!wasiThreadsAvailable()) {
    t.skip("wasi-threads toolchain (wasm32-wasip1-threads) is not available.");
    return;
  }
  const result = await compilePthreadModule();
  const offset = findImportedMemoryFlagsOffset(result.wasmBytes);
  assert.ok(offset >= 0, "expected an imported memory in the pthreads artifact");
  assert.equal(result.wasmBytes[offset] & 0x02, 0x02, "expected shared bit set before tampering");

  const tampered = result.wasmBytes.slice();
  tampered[offset] = tampered[offset] & ~0x02; // clear the shared bit (0x03 -> 0x01)

  const analysis = analyzeWasmThreadFeatures(tampered);
  assert.equal(analysis.hasSharedMemory, false);
  assert.equal(analysis.isIsomorphicPthreads, false);
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
