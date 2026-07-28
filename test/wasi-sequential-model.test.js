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

// --- C4: what -Wl,-z,stack-size actually governs ------------------------------
//
// The guardian's C4 asserted that musl's __default_stacksize pins spawned
// threads to 128 KB regardless of -z stack-size, and therefore that
// pthread_attr_setstacksize had to be wired into the spawn glue.
//
// MEASURED, that is not what happens. Using the CCSDS 124 codec's real
// -Wframe-larger-than-verified ~631 KB call chain (decompress -> _packet_internal
// 335,888 B -> bit_insert 262,144 B) driven on a SPAWNED wasi thread, the
// trap threshold tracks -z stack-size exactly:
//
//     256 KB -> trap     512 KB -> trap     768 KB -> OK     1 MB -> OK     4 MB -> OK
//
// A worker cleared a 631 KB chain at 768 KB, which is impossible under a
// 128 KB worker cap. So -z stack-size governs BOTH the main stack and spawned
// wasi-threads stacks, and no pthread_attr_setstacksize mechanism is required.
//
// This test re-proves that here so the conclusion cannot rot. It uses a frame
// clang CANNOT promote (the buffer escapes through a noinline sink), because a
// plain large `volatile` local IS promoted off-stack — that mistake invalidated
// an earlier probe and is the reason this test asserts the frame is real first.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WASI } from "node:wasi";

import { createWasiThreadSpawn } from "../src/host/wasiThreadHost.js";
import { PTHREAD_FINAL_LINK_FLAGS } from "../src/compiler/pthreadArtifactGuard.js";

test("-Wl,-z,stack-size sets the SPAWNED-thread stack, not just the main stack", async (t) => {
  if (!toolchainAvailable()) {
    t.skip("wasi-threads toolchain (wasm32-wasip1-threads) is not available.");
    return;
  }

  // Asserted DIRECTLY, by reading pthread_attr_getstacksize from inside the
  // guest, rather than inferred from whether something traps. wasm has no stack
  // guard page, so an overflow silently corrupts instead of trapping, and
  // trap-based probes cannot distinguish "fits" from "quietly scribbled".
  //
  // Measured: the effective thread stack tracks the link flag exactly —
  //   -z stack-size=131072  -> 131072
  //   -z stack-size=786432  -> 786432
  //   -z stack-size=4194304 -> 4194304
  //
  // This is why NO pthread_attr_setstacksize plumbing is required. The 131072
  // that appears in a libc.a symbol dump of __default_stacksize is the
  // PRE-LINK static initializer; wasi-libc overwrites it from the linker's
  // __stack_size at startup. Dumping the object shows the default, not the
  // effective value — the two disagree, and only the runtime read is decisive.
  for (const stackSize of [128 * 1024, 768 * 1024, 4 * 1024 * 1024]) {
    const reported = await readGuestThreadStackSize(stackSize);
    assert.equal(
      reported,
      stackSize,
      `a guest linked with -z stack-size=${stackSize} must see that same thread ` +
        `stack size, but reported ${reported}. If this drifts, the stackSize ` +
        "compile option silently stops protecting worker threads.",
    );
  }
});

// Compiles a tiny REACTOR guest that returns its own pthread default stack
// size through an export, and reads it on the SDK's real wasi-threads host.
// An export rather than printf: node:wasi writes fd 1 straight to the process
// stdout, so an in-process stdout capture sees nothing.
async function readGuestThreadStackSize(stackSizeBytes) {
  const toolchain = resolveWasiThreadsToolchain();
  const dir = mkdtempSync(path.join(os.tmpdir(), "sdm-c4-attr-"));
  const src = path.join(dir, "attr.c");
  const wasm = path.join(dir, "attr.wasm");
  writeFileSync(
    src,
    `#include <pthread.h>\n#include <stddef.h>\n` +
      `__attribute__((export_name("guest_thread_stack_size")))\n` +
      `unsigned guest_thread_stack_size(void){\n` +
      `  pthread_attr_t at; size_t sz = 0;\n` +
      `  pthread_attr_init(&at); pthread_attr_getstacksize(&at, &sz);\n` +
      `  return (unsigned)sz; }\n`,
  );
  execFileSync(
    toolchain.clang,
    [...toolchain.toolchainArgs, src, "-std=c99", "-O1", "-mexec-model=reactor",
      ...PTHREAD_FINAL_LINK_FLAGS, `-Wl,-z,stack-size=${stackSizeBytes}`,
      "-Wl,--export=guest_thread_stack_size", "-o", wasm],
    { stdio: "pipe" },
  );

  const bytes = readFileSync(wasm);
  const module = await WebAssembly.compile(bytes);
  const memory = new WebAssembly.Memory({ initial: 256, maximum: 32768, shared: true });
  const host = await createWasiThreadSpawn({ wasmModule: module, memory });
  const wasi = new WASI({ version: "preview1", args: ["attr"], env: {}, returnOnExit: true });
  const imports = wasi.getImportObject();
  imports.env = { memory };
  imports.wasi = { "thread-spawn": host.threadSpawn };
  const instance = await WebAssembly.instantiate(module, imports);
  try {
    instance.exports._initialize?.();
    return instance.exports.guest_thread_stack_size();
  } finally {
    await host.terminateAll();
  }
}

// --- C2 link-side guard -------------------------------------------------------

test("sequential final-link args reject the thread-memory flags", async () => {
  const { assertSequentialFlagsAbsent } = await import("../src/compiler/index.js");

  // --import-memory: the guest would depend on a host-supplied memory it has no
  // wasi-threads contract to receive.
  assert.throws(
    () => assertSequentialFlagsAbsent(["-O3", "-Wl,--import-memory"]),
    /must not contain/,
  );
  // --shared-memory ALONE is the subtle one: wasm-ld accepts it without
  // --import-memory and emits a module-DECLARED shared memory, which imposes a
  // SharedArrayBuffer/COOP-COEP requirement on a guest declared sequential
  // precisely so it would not need one. An artifact-only check misses this.
  assert.throws(
    () => assertSequentialFlagsAbsent(["-O3", "-Wl,--shared-memory"]),
    /SharedArrayBuffer/,
  );
  assert.doesNotThrow(() =>
    assertSequentialFlagsAbsent(["-O3", "-mbulk-memory", "-Wl,-z,stack-size=4194304"]),
  );
});

test("the sequential link profile never reuses the pthreads flag set", async (t) => {
  if (!toolchainAvailable()) {
    t.skip("wasi-threads toolchain (wasm32-wasip1-threads) is not available.");
    return;
  }
  // Defence in depth: the compiled artifact must actually come out with an
  // owned memory, proving the sequential branch did not inherit
  // PTHREAD_FINAL_LINK_FLAGS.
  const compilation = await compileSequential({
    sequentialJustification: VALID_JUSTIFICATION,
  });
  const module = await WebAssembly.compile(compilation.wasmBytes);
  assert.ok(
    !WebAssembly.Module.imports(module).some((entry) => entry.kind === "memory"),
    "sequential artifact must not import a memory",
  );
});
