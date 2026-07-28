// Guardrail tests for the wasi-sequential thread model.
//
// The model exists for guests that are inherently sequential (a stateful codec
// whose item k depends on state from item k-1) but must still be built by the
// sanctioned clang wasm32-wasip1-threads toolchain rather than falling back to
// Emscripten. Its whole value is that it is NARROW: a declaration, never an
// inference, and held to a mirror-image artifact guard.

import test from "node:test";
import assert from "node:assert/strict";

import {
  assertSequentialArtifact,
  compileModuleFromSource,
  ModuleThreadModel,
  SANCTIONED_WASI_TARGET,
} from "../src/compiler/index.js";
import { resolveWasiThreadsToolchain } from "../src/compiler/wasiThreadsToolchain.js";

const STANDARDS_ROOT = new URL(
  "../../../main-packages/spacedatastandards.org/",
  import.meta.url,
).pathname;
process.env.SPACE_DATA_STANDARDS_ROOT ??= STANDARDS_ROOT;

function toolchainAvailable() {
  try {
    resolveWasiThreadsToolchain();
    return true;
  } catch {
    return false;
  }
}

const TIM_TYPE_PAIR = [
  { schemaName: "TIM.fbs", fileIdentifier: "$TIM", rootTypeName: "TIM" },
  {
    schemaName: "TIM.fbs",
    fileIdentifier: "$TIM",
    rootTypeName: "TIM",
    wireFormat: "aligned-binary",
    requiredAlignment: 8,
    byteLength: 64,
  },
];

function baseManifest(overrides = {}) {
  return {
    pluginId: "com.digitalarsenal.test.wasi-sequential",
    name: "Sequential Fixture",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: [],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    runtimeTargets: ["browser", "wasmedge"],
    methods: [
      {
        methodId: "go",
        displayName: "Go",
        inputPorts: [
          {
            portId: "in",
            acceptedTypeSets: [{ setId: "tim", allowedTypes: TIM_TYPE_PAIR }],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        outputPorts: [],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
    schemasUsed: [],
    abiVersion: 1,
    ...overrides,
  };
}

const VALID_JUSTIFICATION = {
  kind: "inherently-sequential-algorithm",
  detail: "Stateful codec: decoding item k requires decoder state from item k-1.",
};

const SOURCE = `#include "space_data_module_invoke.h"\nint go(void){ return 0; }\n`;

async function compileSequential(manifestOverrides = {}, options = {}) {
  return compileModuleFromSource({
    manifest: baseManifest(manifestOverrides),
    sourceCode: SOURCE,
    language: "c",
    threadModel: ModuleThreadModel.WASI_SEQUENTIAL,
    ...options,
  });
}

// --- C1: never inferable, always justified -----------------------------------

test("wasi-sequential is rejected without a justification", async (t) => {
  if (!toolchainAvailable()) {
    t.skip("wasi-threads toolchain (wasm32-wasip1-threads) is not available.");
    return;
  }
  await assert.rejects(
    () => compileSequential(),
    /requires an explicit justification/,
    "an unjustified sequential exemption must not compile",
  );
});

test("wasi-sequential rejects an unrecognised justification kind", async (t) => {
  if (!toolchainAvailable()) {
    t.skip("wasi-threads toolchain (wasm32-wasip1-threads) is not available.");
    return;
  }
  await assert.rejects(
    () =>
      compileSequential({
        sequentialJustification: { kind: "because-i-said-so", detail: "x".repeat(40) },
      }),
    /is not recognised/,
  );
});

test("wasi-sequential rejects a token justification detail", async (t) => {
  if (!toolchainAvailable()) {
    t.skip("wasi-threads toolchain (wasm32-wasip1-threads) is not available.");
    return;
  }
  await assert.rejects(
    () =>
      compileSequential({
        sequentialJustification: { kind: "pure-transform", detail: "no threads" },
      }),
    /substantive explanation/,
  );
});

test("browser targeting no longer implies the Emscripten toolchain", async (t) => {
  if (!toolchainAvailable()) {
    t.skip("wasi-threads toolchain (wasm32-wasip1-threads) is not available.");
    return;
  }
  // The historical bug: runtimeTargets ["browser","wasmedge"] matched "browser"
  // FIRST and silently selected emcc, so the more isomorphic a module declared
  // itself, the worse it was treated.
  await assert.rejects(
    () =>
      compileModuleFromSource({
        manifest: baseManifest({ runtimeTargets: ["browser"] }),
        sourceCode: SOURCE,
        language: "c",
      }),
    /Cannot infer a thread model from runtimeTargets \[browser\]/,
  );
});

test("declaring wasmedge selects the clang wasi toolchain, not Emscripten", async (t) => {
  if (!toolchainAvailable()) {
    t.skip("wasi-threads toolchain (wasm32-wasip1-threads) is not available.");
    return;
  }
  const compilation = await compileSequential({
    sequentialJustification: VALID_JUSTIFICATION,
  });
  assert.match(compilation.compiler, /wasm32-wasi-clang/);
  assert.equal(compilation.threadModel, ModuleThreadModel.WASI_SEQUENTIAL);
});

// --- C2: the mirror guard ----------------------------------------------------

test("a sequential artifact owns its memory and carries no thread contract", async (t) => {
  if (!toolchainAvailable()) {
    t.skip("wasi-threads toolchain (wasm32-wasip1-threads) is not available.");
    return;
  }
  const compilation = await compileSequential({
    sequentialJustification: VALID_JUSTIFICATION,
  });
  const module = await WebAssembly.compile(compilation.wasmBytes);
  const imports = WebAssembly.Module.imports(module);
  const exports = WebAssembly.Module.exports(module);

  // Owning the memory is the load-bearing property: importing env.memory
  // without exporting wasi_thread_start is an incomplete wasi-threads contract
  // that WasmEdge refuses to instantiate.
  assert.ok(
    exports.some((entry) => entry.kind === "memory"),
    "sequential artifact must export its own memory",
  );
  assert.ok(
    !imports.some((entry) => entry.kind === "memory"),
    "sequential artifact must not import a memory",
  );
  assert.ok(
    !imports.some((entry) => entry.name === "thread-spawn"),
    "sequential artifact must not import wasi thread-spawn",
  );
  assert.ok(
    !exports.some((entry) => entry.name === "wasi_thread_start"),
    "sequential artifact must not export wasi_thread_start",
  );
});

test("the sequential guard rejects a real wasi-threads artifact", async (t) => {
  if (!toolchainAvailable()) {
    t.skip("wasi-threads toolchain (wasm32-wasip1-threads) is not available.");
    return;
  }
  // A genuinely threaded module must never pass the sequential guard, or the
  // model would become a way to skip the pthreads validation entirely.
  const threaded = await compileModuleFromSource({
    manifest: baseManifest({ pluginId: "com.digitalarsenal.test.threaded" }),
    sourceCode: `#include <pthread.h>\n#include "space_data_module_invoke.h"\n` +
      `static void *w(void *a){ (void)a; return 0; }\n` +
      `int go(void){ pthread_t t; pthread_create(&t,0,w,0); pthread_join(t,0); return 0; }\n`,
    language: "c",
    threadModel: ModuleThreadModel.EMSCRIPTEN_PTHREADS,
  });
  assert.throws(
    () => assertSequentialArtifact(threaded.wasmBytes, { source: "threaded fixture" }),
    /wasi-sequential artifact validation REJECTED/,
  );
});

test("the sequential guard refuses a non-sanctioned target", async () => {
  // SDN_WASI_TARGET must not be an unpoliced route to a plain wasm32-wasip1
  // object: the sequential model is a concurrency exemption, not a toolchain one.
  const minimal = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  assert.throws(
    () => assertSequentialArtifact(minimal, { target: "wasm32-wasip1" }),
    /concurrency exemption, NOT a toolchain exemption/,
  );
  assert.doesNotThrow(() =>
    assertSequentialArtifact(minimal, { target: SANCTIONED_WASI_TARGET }),
  );
});

// --- C4 (partial): stack size is validated -----------------------------------

test("stackSize is validated rather than trusted", async (t) => {
  if (!toolchainAvailable()) {
    t.skip("wasi-threads toolchain (wasm32-wasip1-threads) is not available.");
    return;
  }
  const justified = { sequentialJustification: VALID_JUSTIFICATION };
  await assert.rejects(
    () => compileSequential(justified, { stackSize: 12345 }),
    /out of range|multiple of 16/,
  );
  await assert.rejects(
    () => compileSequential(justified, { stackSize: 1024 }),
    /out of range/,
  );
  await assert.rejects(
    () => compileSequential(justified, { stackSize: "4mb" }),
    /must be an integer/,
  );
  const ok = await compileSequential(justified, { stackSize: 4 * 1024 * 1024 });
  assert.equal(ok.threadModel, ModuleThreadModel.WASI_SEQUENTIAL);
});
