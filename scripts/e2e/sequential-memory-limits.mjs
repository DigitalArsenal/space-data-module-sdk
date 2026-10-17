// E2E (sdk-sequential-memory-limits-20261017): a wasi-sequential compile honors
// initialMemoryBytes / maximumMemoryBytes.
//
// On wasm32-wasip1-threads a sequential guest DEFINES a shared memory, and a
// browser reserves a shared memory's whole maximum up front. Three guests at the
// fixed 2 GiB default put a phone past what it will reserve. This compiles real
// guests on the SDK's own toolchain and checks the artifact bytes and the
// running instance:
//   1. sized: initial 4 MiB, maximum 24 MiB declared exactly; still a sequential
//      artifact (no wasi-threads contract, memory owned not imported); it grows
//      page by page to 24 MiB and the next page is refused;
//   2. default: no options keeps 16 MiB / 2 GiB;
//   3. refused: a maximum that is not whole pages, and an initial above the
//      maximum, fail the compile with a message naming the option.
// usage: node scripts/e2e/sequential-memory-limits.mjs
import assert from "node:assert/strict";
import { compileModuleFromSource } from "../../src/compiler/compileModule.js";
import { analyzeWasmThreadFeatures } from "../../src/compiler/pthreadArtifactGuard.js";

const MiB = 1024 * 1024;
const PAGE = 65536;

const manifest = {
  pluginId: "com.digitalarsenal.examples.sequential-memory-limits",
  name: "Sequential Memory Limits",
  version: "0.1.0",
  pluginFamily: "analysis",
  capabilities: [],
  externalInterfaces: [],
  runtimeTargets: ["wasmedge"],
  sequentialJustification: {
    kind: "pure-transform",
    detail: "E2E fixture: one pure call that grows its own heap; it never fans out and never sizes a worker pool.",
  },
  methods: [{
    methodId: "propagate",
    displayName: "Propagate",
    inputPorts: [{ portId: "request", acceptedTypeSets: [typeSet("omm", "OMM.fbs", "$OMM", "OMM")], minStreams: 1, maxStreams: 1, required: true }],
    outputPorts: [{ portId: "state", acceptedTypeSets: [typeSet("cat", "CAT.fbs", "$CAT", "CAT")], minStreams: 1, maxStreams: 1, required: true }],
    maxBatch: 1,
    drainPolicy: "drain-to-empty",
  }],
};
function typeSet(setId, schemaName, fileIdentifier, rootTypeName) {
  return { setId, allowedTypes: [{ schemaName, fileIdentifier, rootTypeName, wireFormat: "flatbuffer" }] };
}

// grow(n) is memory.grow on the guest's own memory: the previous size in pages, or -1 when refused.
const sourceCode = [
  "int propagate(void) { return 7; }",
  '__attribute__((export_name("grow"))) int grow(int pages) { return __builtin_wasm_memory_grow(0, pages); }',
  '__attribute__((export_name("pages"))) int pages(void) { return __builtin_wasm_memory_size(0); }',
  "",
].join("\n");

function compile(options = {}) {
  return compileModuleFromSource({ manifest, sourceCode, language: "c", threadModel: "wasi-sequential", ...options });
}

function definedMemory(bytes) {
  const memories = [];
  const imported = WebAssembly.Module.imports(new WebAssembly.Module(bytes)).filter((entry) => entry.kind === "memory");
  let offset = 8;
  const leb = () => { let result = 0, shift = 0, byte; do { byte = bytes[offset++]; result += (byte & 0x7f) * 2 ** shift; shift += 7; } while (byte & 0x80); return result; };
  while (offset < bytes.length) {
    const id = bytes[offset++];
    const size = leb();
    const end = offset + size;
    if (id === 5) {
      for (let count = leb(), index = 0; index < count; index += 1) {
        const flags = bytes[offset++];
        const min = leb();
        memories.push({ flags, shared: Boolean(flags & 2), min, max: flags & 1 ? leb() : null });
      }
    }
    offset = end;
  }
  return { memories, imported };
}

function instantiate(bytes) {
  const module = new WebAssembly.Module(bytes);
  const imports = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    assert.equal(entry.kind, "function", `the guest imports a ${entry.kind} (${entry.module}.${entry.name})`);
    (imports[entry.module] ??= {})[entry.name] = () => 0;
  }
  const instance = new WebAssembly.Instance(module, imports);
  instance.exports._initialize?.();
  return instance.exports;
}

async function main() {
  const t0 = Date.now();

  const sized = await compile({ initialMemoryBytes: 4 * MiB, maximumMemoryBytes: 24 * MiB });
  assert.equal(sized.threadModel, "wasi-sequential");
  const features = analyzeWasmThreadFeatures(sized.wasmBytes);
  assert.equal(features.hasWasiThreadSpawnImport, false, "a sequential guest imports wasi.thread-spawn");
  assert.equal(features.hasWasiThreadStartExport, false, "a sequential guest exports wasi_thread_start");
  const sizedMemory = definedMemory(sized.wasmBytes);
  assert.equal(sizedMemory.imported.length, 0, "a sequential guest imports its memory");
  assert.equal(sizedMemory.memories.length, 1, "a sequential guest defines one memory");
  const [own] = sizedMemory.memories;
  assert.equal(own.min, (4 * MiB) / PAGE, `initial ${own.min} pages, asked for 4 MiB`);
  assert.equal(own.max, (24 * MiB) / PAGE, `maximum ${own.max} pages, asked for 24 MiB`);
  console.log(`sized: ${sized.wasmBytes.length} B, defined ${own.shared ? "shared" : "unshared"} memory ${own.min * PAGE / MiB}..${own.max * PAGE / MiB} MiB`);

  const guest = instantiate(sized.wasmBytes);
  assert.equal(guest.memory.buffer.byteLength, 4 * MiB);
  assert.equal(guest.memory.buffer instanceof SharedArrayBuffer, own.shared, "the running memory's sharing differs from its declaration");
  let grown = 0;
  while (guest.grow(16) !== -1) grown += 16;
  assert.equal(guest.pages(), (24 * MiB) / PAGE, `grew to ${guest.pages()} pages`);
  assert.equal(guest.grow(1), -1, "grew past the declared maximum");
  assert.equal(guest.memory.buffer.byteLength, 24 * MiB);
  console.log(`sized: grew ${grown} pages to ${guest.memory.buffer.byteLength / MiB} MiB; one page more is refused`);

  const plain = await compile();
  const [defaults] = definedMemory(plain.wasmBytes).memories;
  assert.equal(defaults.min, (16 * MiB) / PAGE, "the default initial moved off 16 MiB");
  assert.equal(defaults.max, 2147483648 / PAGE, "the default maximum moved off 2 GiB");
  console.log(`default: ${defaults.min * PAGE / MiB}..${defaults.max * PAGE / MiB} MiB`);

  await assert.rejects(compile({ maximumMemoryBytes: 24 * MiB + 1000 }), /maximumMemoryBytes must be a whole number of 64 KiB pages/);
  await assert.rejects(compile({ initialMemoryBytes: 32 * MiB, maximumMemoryBytes: 24 * MiB }), /initialMemoryBytes 33554432 exceeds maximumMemoryBytes 25165824/);
  console.log("refused: a maximum off the page grid; an initial above the maximum");

  console.log(`SEQUENTIAL-MEMORY-LIMITS PASS in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((error) => {
  console.log(`SEQUENTIAL-MEMORY-LIMITS FAIL: ${error?.stack ?? error}`);
  process.exit(1);
});
