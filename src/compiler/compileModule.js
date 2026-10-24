import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  createDeploymentAuthorization,
  createHdWalletSigner,
  signAuthorization,
} from "../auth/index.js";
import { validateArtifactWithStandards } from "../compliance/index.js";
import { generateEmbeddedManifestSource } from "../embeddedManifest.js";
import {
  generateInvokeSupportHeader,
  generateInvokeSupportSource,
  resolveInvokeSurfaces,
} from "./invokeGlue.js";
import {
  getFlatbuffersCppRuntimeHeaders,
  getInvokeCppSchemaHeaders,
} from "./flatcSupport.js";
import { getEmceptionCompileIdentity, runWithEmceptionLock } from "./emceptionNode.js";
import {
  COMPILE_CACHE_FORMAT,
  describeExternalDependencies,
  digestFiles,
  digestOf,
  getNativeClangIdentity,
  getSdkCompileIdentity,
  getSystemEmscriptenIdentity,
  openCompileCache,
  parseDepfile,
  sha256Hex,
} from "./compileCache.js";
import { listWasmObjectSymbols, renameWasmObjectSymbols } from "./wasmObjectSymbols.js";
import {
  assertPthreadArtifact,
  assertPthreadFlagsPresent,
  assertSequentialArtifact,
  assertSequentialFlagsAbsent,
  PTHREAD_FINAL_LINK_FLAGS,
} from "./pthreadArtifactGuard.js";
import {
  SIMD128_COMPILE_FLAG,
  SIMD128_UNDECLARED_WARNING_CODE,
  assertSimdArtifact,
} from "./simdArtifactGuard.js";
import { resolveWasiThreadsToolchain } from "./wasiThreadsToolchain.js";
import { encodePluginManifest, toEmbeddedPluginManifest } from "../manifest/index.js";
import {
  DefaultInvokeExports,
  InvokeSurface,
  RuntimeTarget,
} from "../runtime/constants.js";
import {
  appendPublicationRecordCollection,
  createEncryptedEnvelopePayload,
  createPublicationNotice,
  encodePublicationRecordCollection,
  encryptBytesForRecipient,
  extractPublicationRecordCollection,
  generateX25519Keypair,
} from "../transport/index.js";
import { createSingleFileBundle } from "../bundle/index.js";
import {
  SDS_GUEST_LINK_MEDIA_TYPE,
  SDS_GUEST_LINK_METADATA_ENTRY_ID,
  SDS_GUEST_LINK_OBJECT_ENTRY_ID,
  SDS_GUEST_LINK_SECTION_NAME,
  SDS_MANIFEST_SECTION_NAME,
} from "../bundle/constants.js";
import { appendWasmCustomSection } from "../bundle/wasm.js";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
} from "../utils/encoding.js";
import { sha256Bytes } from "../utils/crypto.js";
import { getWasmWallet } from "../utils/wasmCrypto.js";

const C_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const execFileAsync = promisify(execFile);
const EMSCRIPTEN_MEMORY_GROWTH_NOTIFY_SHIM = `
extern "C" __attribute__((weak)) void emscripten_notify_memory_growth(int) {}
`;

export const ModuleThreadModel = Object.freeze({
  SINGLE_THREAD: "single-thread",
  EMSCRIPTEN_PTHREADS: "emscripten-pthreads",
  // Inherently-sequential guests that must still be built by the sanctioned
  // clang wasm32-wasip1-threads toolchain. NOT an optimisation and NOT
  // inferable: see resolveThreadModel + assertSequentialArtifact.
  WASI_SEQUENTIAL: "wasi-sequential",
});

// The wasi-sequential model is a DECLARATION, never a deduction. A module that
// selects it is asserting "this guest can never spawn a thread", which the
// emitted artifact is then held to by assertSequentialArtifact. Because that
// assertion is a permanent architectural claim about the guest, the manifest
// must carry a machine-readable reason for it.
const SEQUENTIAL_JUSTIFICATION_MIN_LENGTH = 24;
const SEQUENTIAL_JUSTIFICATION_KINDS = Object.freeze([
  // The algorithm carries state from item k-1 into item k (e.g. a stateful codec).
  "inherently-sequential-algorithm",
  // The guest is a pure transform with no work to fan out.
  "pure-transform",
  // Threading exists, but only ACROSS independent invocations, driven by the caller.
  "caller-level-parallelism",
]);

function resolveGuestLinkCapabilities(manifest, explicitCapabilities) {
  const source = Array.isArray(explicitCapabilities)
    ? explicitCapabilities
    : (Array.isArray(manifest?.capabilities) ? manifest.capabilities : []);
  const capabilities = [];
  const seen = new Set();
  for (const capability of source) {
    const id = String(
      typeof capability === "string" ? capability : capability?.capability ?? "",
    ).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    capabilities.push(id);
  }
  return capabilities;
}

function selectCompiler(language) {
  const normalized = String(language ?? "c").trim().toLowerCase();
  if (normalized === "c++" || normalized === "cpp" || normalized === "cxx") {
    return { command: "em++", extension: "cpp", language: "c++" };
  }
  return { command: "emcc", extension: "c", language: "c" };
}

function ensureExportableMethodIds(manifest) {
  const invalidMethod = (Array.isArray(manifest?.methods) ? manifest.methods : []).find(
    (method) => !C_IDENTIFIER.test(String(method?.methodId ?? "")),
  );
  if (invalidMethod) {
    throw new Error(
      `Method id "${invalidMethod.methodId}" is not a valid C export name. ` +
        "Source compilation requires methodId values to be valid C identifiers.",
    );
  }
}

function usesPthreadCompileFlags(options = {}) {
  return (
    options.threadModel === ModuleThreadModel.EMSCRIPTEN_PTHREADS ||
    options.sharedMemory === true
  );
}

// wasm-ld's default main stack is 64 KiB. That is far too small for guests with
// large caller-allocated frames: the vendored CCSDS 124 reference codec has a
// MEASURED worst-case call chain of ~631 KB on wasm32
// (ccsds124_decompress -> _packet_internal 335,888 B -> bit_insert 262,144 B)
// and traps with "memory access out of bounds" on its first input under the
// default.
//
// This must be an explicit, validated number rather than a default anyone can
// drift off: the stack size is a link-time constant baked into the single
// artifact, so pinning it is what makes the overflow boundary identical in
// every runtime.
const MIN_STACK_SIZE_BYTES = 64 * 1024;
const MAX_STACK_SIZE_BYTES = 1024 * 1024 * 1024;

// The wasi-sequential heap contract. 16 MiB initial matches what the previous
// (Emscripten) sequential artifacts shipped with; the 2 GiB ceiling is the SAME
// number PTHREAD_FINAL_LINK_FLAGS pins, so the two thread models differ in
// their threading contract and NOTHING else. wasm-ld defaults the maximum to
// the computed minimum when neither flag is given, which is what made a
// sequential guest unable to grow its heap by a single page.
const SEQUENTIAL_INITIAL_MEMORY_BYTES = 16 * 1024 * 1024;
const SEQUENTIAL_MAX_MEMORY_BYTES = 2147483648;

// Those are DEFAULTS, not a contract. On wasm32-wasip1-threads the memory a
// sequential guest defines is SHARED (the triple implies atomics; see
// assertSequentialArtifact), and a browser reserves a shared memory's whole
// maximum up front because it can never move: three 2 GiB guests on one page
// are 6 GiB of address space, which a phone refuses. `initialMemoryBytes` /
// `maximumMemoryBytes` (declared in index.d.ts) size a guest to its measured
// need. Whole 64 KiB pages, initial <= maximum <= 4 GiB (wasm32).
const WASM_PAGE_BYTES = 64 * 1024;
const WASM32_MAX_MEMORY_BYTES = 4 * 1024 * 1024 * 1024;

function resolveMemoryBytes(name, value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < WASM_PAGE_BYTES ||
    value > WASM32_MAX_MEMORY_BYTES ||
    value % WASM_PAGE_BYTES !== 0
  ) {
    throw new Error(
      `${name} must be a whole number of 64 KiB pages between ${WASM_PAGE_BYTES} and ` +
        `${WASM32_MAX_MEMORY_BYTES} bytes, got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

function resolveSequentialMemory(options) {
  const maximum = resolveMemoryBytes(
    "maximumMemoryBytes",
    options.maximumMemoryBytes,
    SEQUENTIAL_MAX_MEMORY_BYTES,
  );
  const initial = resolveMemoryBytes(
    "initialMemoryBytes",
    options.initialMemoryBytes,
    Math.min(SEQUENTIAL_INITIAL_MEMORY_BYTES, maximum),
  );
  if (initial > maximum) {
    throw new Error(
      `initialMemoryBytes ${initial} exceeds maximumMemoryBytes ${maximum}.`,
    );
  }
  return { initial, maximum };
}

function resolveStackSize(stackSize) {
  if (stackSize === undefined || stackSize === null) {
    return null;
  }
  if (typeof stackSize !== "number" || !Number.isInteger(stackSize)) {
    throw new Error(
      `stackSize must be an integer number of bytes, got ${JSON.stringify(stackSize)}.`,
    );
  }
  if (stackSize < MIN_STACK_SIZE_BYTES || stackSize > MAX_STACK_SIZE_BYTES) {
    throw new Error(
      `stackSize ${stackSize} is out of range — expected ${MIN_STACK_SIZE_BYTES}..${MAX_STACK_SIZE_BYTES} bytes.`,
    );
  }
  if (stackSize % 16 !== 0) {
    throw new Error(
      `stackSize ${stackSize} must be a multiple of 16 (wasm stack alignment).`,
    );
  }
  return stackSize;
}

function buildCompilerArgs(exportedSymbols, options = {}) {
  const linkerExports = exportedSymbols.map(
    (symbol) => "-Wl,--export=" + symbol,
  );
  // wasi-sequential: the SAME clang toolchain and the same target as the
  // pthreads model, but WITHOUT the wasi-threads contract. It must own an
  // unshared memory: an artifact that imports env.memory while exporting no
  // wasi_thread_start is an incomplete wasi-threads contract, and WasmEdge
  // refuses to instantiate it ("unknown import: env.memory"). Held to that
  // shape by assertSequentialArtifact.
  if (options.threadModel === ModuleThreadModel.WASI_SEQUENTIAL) {
    // A sequential guest still needs a HEAP. Without an explicit ceiling the
    // sequential link emitted a memory whose maximum equalled its minimum (18
    // pages for a status node), so the guest could not grow at all and
    // plugin_alloc returned null for the first frame larger than ~1 MiB — while
    // the SAME source on the pthreads profile got a 2 GiB-growable memory.
    // Two thread models must differ in their THREADING contract only; a guest
    // that cannot allocate is not "sequential", it is broken. Same ceiling as
    // PTHREAD_FINAL_LINK_FLAGS' --max-memory, unshared and unimported so the
    // browser needs no cross-origin isolation to load it.
    const sequentialMemory = resolveSequentialMemory(options);
    const sequentialArgs = [
      "-O3",
      "-mbulk-memory",
      `-Wl,--initial-memory=${sequentialMemory.initial}`,
      `-Wl,--max-memory=${sequentialMemory.maximum}`,
    ];
    if (options.noEntry === true) {
      sequentialArgs.push("-mexec-model=reactor");
    }
    const sequentialStackSize = resolveStackSize(options.stackSize);
    if (sequentialStackSize !== null) {
      sequentialArgs.push(`-Wl,-z,stack-size=${sequentialStackSize}`);
    }
    if (options.allowUndefinedImports === true) {
      sequentialArgs.push("-Wl,--allow-undefined");
    }
    sequentialArgs.push(...linkerExports);
    // Defensive invariant, mirroring assertPthreadFlagsPresent: a future edit
    // that reuses PTHREAD_FINAL_LINK_FLAGS here must fail at flag time, not
    // ship a "sequential" guest that needs cross-origin isolation to load.
    assertSequentialFlagsAbsent(sequentialArgs, { threadModel: options.threadModel });
    return sequentialArgs;
  }

  const isPthreads = options.threadModel === ModuleThreadModel.EMSCRIPTEN_PTHREADS;
  if (isPthreads) {
    // Non-bypassable enforced pthreads final-LINK flag set (source of truth:
    // PTHREAD_FINAL_LINK_FLAGS). These are wasi-threads (wasm-ld) flags, NOT
    // Emscripten -s settings: they import a shared memory and select the
    // atomics/bulk-memory features so the artifact is a wasi-threads wasm
    // (imports wasi.thread-spawn, exports wasi_thread_start) that threads in
    // both the browser (via a SharedArrayBuffer/Worker shim) and WasmEdge. The
    // toolchain args (--target/--sysroot/-resource-dir) are prepended by
    // compileWithWasiThreads. The emitted wasm is validated by
    // assertPthreadArtifact() in compileModuleFromSource.
    const pthreadArgs = ["-O3"];
    if (options.noEntry === true) {
      // No command surface → emit a wasi REACTOR: exports `_initialize` (which
      // runs global constructors + WASI init) and NO `_start`. This makes the
      // artifact directly invocable exactly like the single-thread build. Plain
      // `-Wl,--no-entry` is wrong for wasi-clang: it still links crt1-command,
      // whose `_start` traps (unreachable) at the missing user `main`, leaving
      // the module uninitialized and un-invocable for the direct surface.
      pthreadArgs.push("-mexec-model=reactor");
    }
    pthreadArgs.push(...PTHREAD_FINAL_LINK_FLAGS);
    const pthreadStackSize = resolveStackSize(options.stackSize);
    if (pthreadStackSize !== null) {
      pthreadArgs.push(`-Wl,-z,stack-size=${pthreadStackSize}`);
    }
    if (options.allowUndefinedImports === true) {
      pthreadArgs.push("-Wl,--allow-undefined");
    }
    pthreadArgs.push(...linkerExports);
    // Defensive invariant: the pthreads model must never lose a mandated flag.
    assertPthreadFlagsPresent(pthreadArgs, { threadModel: options.threadModel });
    return pthreadArgs;
  }
  // Single-thread / Emscripten-shared-memory-browser path (emception or system
  // emscripten). Uses Emscripten -s settings.
  const args = ["-O3"];
  if (options.noEntry === true) {
    args.push("--no-entry");
  }
  // Bulk-memory ops: memcpy/memset in module code lower to native
  // memory.copy/memory.fill instead of byte loops — WITHOUT this, large
  // aligned-stream frames crawl (~10 MB/s) under interpreted hosts
  // (loop C.5 wirespeed gate). Baseline wasm feature, supported by every
  // target host (WasmEdge + all browsers).
  args.push("-mbulk-memory");
  if (usesPthreadCompileFlags(options)) {
    args.push("-pthread");
  }
  args.push("-s", "STANDALONE_WASM=1");
  if (options.importedMemory === true) {
    args.push("-s", "IMPORTED_MEMORY=1");
  }
  if (options.sharedMemory === true) {
    args.push("-s", "SHARED_MEMORY=1");
  }
  if (options.allowUndefinedImports === true) {
    args.push("-s", "ERROR_ON_UNDEFINED_SYMBOLS=0", "-Wl,--allow-undefined");
  }
  args.push("-s", "ALLOW_MEMORY_GROWTH=1");
  args.push(...linkerExports);
  return args;
}

function buildSourceCompilerArgs(options = {}) {
  const isPthreads = options.threadModel === ModuleThreadModel.EMSCRIPTEN_PTHREADS;
  // -mbulk-memory: see buildCompilerArgs — memcpy/memset become native
  // memory.copy/memory.fill (loop C.5).
  const args = ["-O3", "-mbulk-memory", "-DNDEBUG"];
  if (options.threadModel === ModuleThreadModel.WASI_SEQUENTIAL) {
    // -fno-exceptions for the same reason as the pthreads model: the wasi
    // libc++ is built without exception support, so the generated C++ invoke
    // bridge otherwise fails to link on __cxa_allocate_exception.
    //
    // But deliberately NO -matomics and NO -pthread: a sequential guest must
    // not emit atomics, or the artifact acquires the shared-memory shape that
    // assertSequentialArtifact rejects.
    args.push("-fno-exceptions");
    for (const define of Array.isArray(options.defines) ? options.defines : []) {
      const text = String(define ?? "").trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*(=[^\s]*)?$/.test(text)) {
        args.push(`-D${text}`);
      }
    }
    return args;
  }
  if (isPthreads) {
    // wasi-threads object compile: enable atomics and disable C++ exceptions
    // (the wasi-threads libc++ is built without exception support, so throwing
    // code otherwise fails to link on __cxa_throw / __cxa_allocate_exception).
    args.push("-matomics", "-fno-exceptions", "-pthread");
  } else if (usesPthreadCompileFlags(options)) {
    args.push("-pthread");
  }
  // Caller-supplied preprocessor defines (e.g. SDN_FLATSQL_LINKED=1 for the
  // engine-linked guest-link object variant, loop C.7). NAME or NAME=VALUE.
  for (const define of Array.isArray(options.defines) ? options.defines : []) {
    const text = String(define ?? "").trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*(=[^\s]*)?$/.test(text)) {
      args.push(`-D${text}`);
    }
  }
  return args;
}

// WebAssembly SIMD is an OPT-IN of the module, never a default: a module that does
// not ask for it compiles with exactly the flags it always has. It is a flag of the
// sanctioned clang wasm32-wasip1-threads toolchain, so the legacy single-thread
// (Emscripten) model refuses it rather than ship a lane no guard or runtime proof
// covers. See simdArtifactGuard.js for what the emitted artifact is held to.
function resolveSimd128(value, threadModel) {
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (value !== true) {
    throw new Error(`simd128 must be true or false, got "${String(value)}".`);
  }
  if (threadModel === ModuleThreadModel.SINGLE_THREAD) {
    throw new Error(
      `simd128 requires threadModel "${ModuleThreadModel.WASI_SEQUENTIAL}" or ` +
        `"${ModuleThreadModel.EMSCRIPTEN_PTHREADS}": SIMD is built by the clang ` +
        `wasm32-wasip1-threads toolchain, not the legacy Emscripten "${ModuleThreadModel.SINGLE_THREAD}" model.`,
    );
  }
  return true;
}

// The flags that apply to the module's OWN code - its source and its `libraries` -
// and not to the SDK's generated manifest exports and invoke bridge, which are the
// same objects (and the same compile-cache entries) with or without SIMD.
function moduleCodeCompilerArgs(options = {}) {
  return options.simd128 === true ? [SIMD128_COMPILE_FLAG] : [];
}

function normalizeThreadModel(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === ModuleThreadModel.SINGLE_THREAD) {
    return ModuleThreadModel.SINGLE_THREAD;
  }
  if (normalized === ModuleThreadModel.EMSCRIPTEN_PTHREADS) {
    return ModuleThreadModel.EMSCRIPTEN_PTHREADS;
  }
  if (normalized === ModuleThreadModel.WASI_SEQUENTIAL) {
    return ModuleThreadModel.WASI_SEQUENTIAL;
  }
  throw new Error(
    `Unsupported threadModel "${value}". Expected one of ` +
      `"${ModuleThreadModel.SINGLE_THREAD}", "${ModuleThreadModel.EMSCRIPTEN_PTHREADS}", ` +
      `"${ModuleThreadModel.WASI_SEQUENTIAL}".`,
  );
}

/**
 * The wasi-sequential model must be justified in the manifest, in a
 * machine-readable form, or the compile fails. "It happens not to thread today"
 * is not a reason — the guest is being permanently exempted from the threading
 * contract, and a future edit that adds a thread must fail loudly rather than
 * silently re-shape the artifact.
 *
 * manifest.sequentialJustification = { kind, detail }
 */
function assertSequentialJustification(manifest) {
  const justification = manifest?.sequentialJustification;
  const declare =
    'Declare manifest.sequentialJustification = { "kind": <one of ' +
    `${JSON.stringify(SEQUENTIAL_JUSTIFICATION_KINDS)}>, "detail": "<why this guest can never spawn a thread>" }.`;

  if (justification === undefined || justification === null) {
    throw new Error(
      `threadModel "${ModuleThreadModel.WASI_SEQUENTIAL}" requires an explicit justification. ${declare}`,
    );
  }
  if (typeof justification !== "object" || Array.isArray(justification)) {
    throw new Error(
      `manifest.sequentialJustification must be an object, got ${Array.isArray(justification) ? "an array" : typeof justification}. ${declare}`,
    );
  }
  const kind = String(justification.kind ?? "").trim();
  if (!SEQUENTIAL_JUSTIFICATION_KINDS.includes(kind)) {
    throw new Error(
      `manifest.sequentialJustification.kind ${JSON.stringify(kind)} is not recognised. ` +
        `Expected one of ${JSON.stringify(SEQUENTIAL_JUSTIFICATION_KINDS)}.`,
    );
  }
  const detail = String(justification.detail ?? "").trim();
  if (detail.length < SEQUENTIAL_JUSTIFICATION_MIN_LENGTH) {
    throw new Error(
      `manifest.sequentialJustification.detail must be a substantive explanation ` +
        `(at least ${SEQUENTIAL_JUSTIFICATION_MIN_LENGTH} characters), got ${detail.length}. ${declare}`,
    );
  }
  return { kind, detail };
}

function resolveThreadModel({ manifest, threadModel } = {}) {
  const explicit = normalizeThreadModel(threadModel);
  if (explicit) {
    return explicit;
  }
  const runtimeTargets = Array.isArray(manifest?.runtimeTargets)
    ? manifest.runtimeTargets
        .map((target) => String(target ?? "").trim().toLowerCase())
        .filter(Boolean)
    : [];

  // BROWSER MUST NOT IMPLY EMCC.
  //
  // This test used to run BEFORE the wasmedge test and return SINGLE_THREAD,
  // which routes to Emscripten. The effect was that the MORE isomorphic a
  // module declared itself to be, the worse it was treated: a manifest saying
  // runtimeTargets ["browser","wasmedge"] matched on "browser" first and was
  // silently compiled by emcc, even though it had explicitly asked to run under
  // WasmEdge. Targeting a browser says nothing about whether a guest threads —
  // it is a deployment fact, not a concurrency fact — so it must never select a
  // toolchain.
  if (runtimeTargets.includes(RuntimeTarget.WASMEDGE)) {
    return ModuleThreadModel.EMSCRIPTEN_PTHREADS;
  }
  if (runtimeTargets.includes(RuntimeTarget.BROWSER)) {
    throw new Error(
      "Cannot infer a thread model from runtimeTargets [browser]: targeting a " +
        "browser does not say whether the guest threads, and it must never imply " +
        "the Emscripten toolchain. Declare threadModel explicitly — " +
        `"${ModuleThreadModel.EMSCRIPTEN_PTHREADS}" (real wasi-threads), ` +
        `"${ModuleThreadModel.WASI_SEQUENTIAL}" (clang wasi, provably never spawns a thread; ` +
        "requires manifest.sequentialJustification), or " +
        `"${ModuleThreadModel.SINGLE_THREAD}" (legacy Emscripten).`,
    );
  }
  return ModuleThreadModel.SINGLE_THREAD;
}

function requiresSystemEmscripten(threadModel, options = {}) {
  return (
    threadModel === ModuleThreadModel.EMSCRIPTEN_PTHREADS ||
    options.sharedMemory === true
  );
}

// Guest-link symbols are namespaced by the FULL lowercase-hex encoding of the
// pluginId's UTF-8 bytes. Hex encoding is injective, so distinct pluginIds always
// map to distinct prefixes. Do NOT truncate: a prior `.slice(0, 24)` (12 bytes)
// collided real plugin ids that share a 12-byte stem — e.g. `com.orbpro.iss-source`
// and `com.orbpro.intelsat-source` both truncated to hex("com.orbpro.i")
// (`636f6d2e6f726270726f2e69`), which would silently merge/clash their symbols at
// `wasm-ld -r` compose time. Wasm symbol names have no meaningful length limit, so
// the full hex is safe. The emitted prefix (and the per-method `methodSymbols`) is
// recorded in the guest-link metadata; that metadata is the AUTHORITATIVE source
// consumers read at compose time (see src/flow/flowCompiler.js) — consumers must
// never re-derive the prefix from pluginId, which keeps already-committed artifacts
// (including any that carry a legacy truncated prefix) compatible.
export function guestLinkSymbolPrefix(pluginId) {
  const normalized = String(pluginId ?? "module");
  const hex = Array.from(new TextEncoder().encode(normalized))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sdm_guest_${hex}_`;
}

function parseStrongDefinedIdentifiers(nmOutput = "") {
  const identifiers = new Set();
  for (const line of String(nmOutput).split(/\r?\n/)) {
    const match = line.match(/^\S+\s+([A-Za-z])\s+(.+)$/);
    if (!match) {
      continue;
    }
    const symbolType = match[1];
    if (!"TDBCGRSV".includes(symbolType)) {
      continue;
    }
    const demangled = match[2].trim();
    const baseName = demangled
      .replace(/\(.*$/, "")
      .split("::")
      .at(-1)
      ?.trim();
    if (!C_IDENTIFIER.test(baseName ?? "")) {
      continue;
    }
    identifiers.add(baseName);
  }
  return Array.from(identifiers).sort();
}

// The guest-link symbol set: every strong, global symbol module.o DEFINES with
// a C identifier for a name, plus the manifest's method ids. The guest-link
// object is module.o with each of those renamed to `<prefix><name>`. Until
// 0.9.11 that object came from a second compile of the source with one
// `-D<name>=<prefix><name>` per symbol; it is now the one module.o, renamed in
// its symbol table (src/compiler/wasmObjectSymbols.js), which is what the
// macros achieved without the second compile.
function definedGuestLinkIdentifiers(objectBytes) {
  const identifiers = new Set();
  for (const symbol of listWasmObjectSymbols(objectBytes)) {
    if (!symbol.defined || symbol.local || symbol.weak) continue;
    if (!C_IDENTIFIER.test(symbol.name)) continue;
    identifiers.add(symbol.name);
  }
  return Array.from(identifiers).sort();
}

function deriveGuestLinkRenames({
  objectBytes,
  pluginId,
  methodIds = [],
} = {}) {
  const identifiers = definedGuestLinkIdentifiers(objectBytes);
  const prefix = guestLinkSymbolPrefix(pluginId);
  const renamedIdentifiers = Array.from(
    new Set([...identifiers, ...methodIds.filter((value) => C_IDENTIFIER.test(value))]),
  ).sort();
  return {
    prefix,
    identifiers: renamedIdentifiers,
    renames: new Map(renamedIdentifiers.map((identifier) => [identifier, `${prefix}${identifier}`])),
    methodSymbols: Object.fromEntries(
      methodIds.map((methodId) => [methodId, `${prefix}${methodId}`]),
    ),
  };
}

/**
 * The guest-link object of a compiled module object: its guest-link symbols
 * renamed under the plugin's prefix. Exported for tooling that holds a
 * module.o; compileModuleFromSource does this itself.
 */
export function deriveGuestLinkObject({ objectBytes, pluginId, methodIds = [] } = {}) {
  const guestLink = deriveGuestLinkRenames({ objectBytes, pluginId, methodIds });
  return {
    symbolPrefix: guestLink.prefix,
    methodSymbols: guestLink.methodSymbols,
    renamedSymbols: guestLink.identifiers,
    objectBytes: renameWasmObjectSymbols(objectBytes, guestLink.renames),
  };
}

function createGuestLinkBundleEntries(guestLink) {
  if (!guestLink?.objectBytes || guestLink.objectBytes.length === 0) {
    return [];
  }
  return [
    {
      entryId: SDS_GUEST_LINK_OBJECT_ENTRY_ID,
      role: "auxiliary",
      sectionName: SDS_GUEST_LINK_SECTION_NAME,
      payloadEncoding: "raw-bytes",
      mediaType: "application/wasm",
      payload: guestLink.objectBytes,
      description: "Prefixed guest-link wasm object for monolithic flow linking.",
    },
    {
      entryId: SDS_GUEST_LINK_METADATA_ENTRY_ID,
      role: "auxiliary",
      sectionName: SDS_GUEST_LINK_SECTION_NAME,
      payloadEncoding: "json-utf8",
      mediaType: SDS_GUEST_LINK_MEDIA_TYPE,
      payload: {
        version: 1,
        format: "wasm-object",
        symbolPrefix: guestLink.symbolPrefix,
        methodSymbols: guestLink.methodSymbols,
        methodIds: Object.keys(guestLink.methodSymbols ?? {}),
        language: guestLink.language,
        threadModel: guestLink.threadModel ?? ModuleThreadModel.SINGLE_THREAD,
        ...(Array.isArray(guestLink.capabilities)
          ? { capabilities: [...guestLink.capabilities] }
          : {}),
        ...(guestLink.simd128 === true ? { simd128: true } : {}),
      },
      description: "Guest-link metadata for monolithic flow linking.",
    },
  ];
}

// The typed module runtime for C++ guests, staged in every compile: `#include "typedHostcall.hpp"` (sdm_piv::call,
// the SDS $PIV hostcall) with the HostOps aligned records it sends and reads, and the runtime types a module's
// ports carry (HttpRequest_generated.h, IngestRequest_generated.h, FlowNotice_generated.h, ...).
const RUNTIME_CPP_DIR = new URL("../generated/runtime/cpp/", import.meta.url);
const HOSTCALL_HPP = new URL("../host/cpp/typedHostcall.hpp", import.meta.url);
let hostcallCppHeaders = null;
async function getHostcallCppHeaders() {
  hostcallCppHeaders ??= (async () => {
    const names = (await readdir(RUNTIME_CPP_DIR)).filter((name) => name.endsWith(".h")).sort();
    const headers = { "typedHostcall.hpp": await readFile(HOSTCALL_HPP, "utf8") };
    for (const name of names) headers[name] = await readFile(new URL(name, RUNTIME_CPP_DIR), "utf8");
    return headers;
  })();
  return hostcallCppHeaders;
}

async function getInvokeCppSupportFiles() {
  const [runtimeHeaders, schemaHeaders, hostcallHeaders] = await Promise.all([
    getFlatbuffersCppRuntimeHeaders(),
    getInvokeCppSchemaHeaders(),
    getHostcallCppHeaders(),
  ]);
  return { runtimeHeaders, schemaHeaders: { ...schemaHeaders, ...hostcallHeaders } };
}

function removeEmceptionDirectory(emception, directoryPath) {
  if (!emception.FS.analyzePath(directoryPath).exists) {
    return;
  }
  const entries = emception.FS.readdir(directoryPath).filter(
    (entry) => entry !== "." && entry !== "..",
  );
  for (const entry of entries) {
    const entryPath = path.posix.join(directoryPath, entry);
    const stat = emception.FS.stat(entryPath);
    if (emception.FS.isDir(stat.mode)) {
      removeEmceptionDirectory(emception, entryPath);
      emception.FS.rmdir(entryPath);
    } else {
      emception.FS.unlink(entryPath);
    }
  }
  emception.FS.rmdir(directoryPath);
}

async function ensureSystemCompilerAvailable(command) {
  try {
    await execFileAsync(command, ["--version"]);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `System Emscripten toolchain is required for "${ModuleThreadModel.EMSCRIPTEN_PTHREADS}" builds, but "${command}" was not found on PATH.`,
      );
    }
    throw error;
  }
}

async function runSystemCompiler(command, args, options = {}) {
  try {
    await execFileAsync(command, args, {
      cwd: options.cwd,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
    const detail = stderr || stdout || error?.message || "unknown error";
    throw new Error(
      `Compilation failed with ${command} (system emscripten): ${detail}`,
    );
  }
}

async function runWasiCompiler(command, args, options = {}) {
  try {
    await execFileAsync(command, args, {
      cwd: options.cwd,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `Compilation failed: wasi-threads driver "${command}" was not found on PATH.`,
      );
    }
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
    const detail = stderr || stdout || error?.message || "unknown error";
    throw new Error(`Compilation failed with ${command} (wasi-threads): ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// The compile pipeline
//
// One translation unit -> module.o (ONE compile), plus the generated embedded
// manifest and invoke bridge objects, linked into module.wasm. The guest-link
// object (module-link.o) is module.o with its guest-link symbols renamed; it
// is not compiled again. Each compile and the link is a step with a content
// key (compileCache.js): a step whose key is in the cache is not run, and a
// compile whose every step hits never starts a toolchain at all.
//
// Three toolchains run the same steps:
//   emception          single-thread: the vendored Emscripten, in-process wasm
//   system-emscripten  shared-memory single-thread builds: em++ on PATH
//   wasi               emscripten-pthreads and wasi-sequential: clang
//                      --target=wasm32-wasip1-threads
// ---------------------------------------------------------------------------

const EMCEPTION_WORK_DIR = "/working/space-data-module-sdk-compile";
const WORK_DIR_TOKEN = "<work>";

function normalizeArgv(argv, workDir) {
  return argv.map((arg) => String(arg).split(workDir).join(WORK_DIR_TOKEN));
}

// The toolchain profile: the commands and flags of every step, and the driver
// that runs them.
async function resolveToolchainProfile(kind, { language, sourceCompilerCommand, compileOptions, tempDir }) {
  const sourceCompilerArgs = buildSourceCompilerArgs(compileOptions);
  const moduleCodeArgs = moduleCodeCompilerArgs(compileOptions);
  if (kind === "wasi") {
    const toolchain = resolveWasiThreadsToolchain();
    const isCpp = String(language ?? "").toLowerCase().startsWith("c++");
    const workDir = tempDir;
    const includeArgs = [`-I${workDir}`, `-I${path.join(workDir, "flatbuffers-runtime")}`];
    return {
      kind,
      workDir,
      join: path.join,
      supportsDepfile: true,
      identity: () =>
        getNativeClangIdentity({
          drivers: Array.from(new Set([toolchain.clang, toolchain.clangxx])),
          toolchainArgs: toolchain.toolchainArgs,
          roots: [toolchain.sysroot, toolchain.resourceDir],
        }).then((id) => digestOf({ id, env: nativeCompilerEnv() })),
      compileArgv: (role, sourcePath, objectPath, extra = [], libraryLanguage = "c") =>
        role === "library"
          ? [
              libraryLanguage === "c++" ? toolchain.clangxx : toolchain.clang,
              ...toolchain.toolchainArgs,
              "-c",
              sourcePath,
              ...includeArgs,
              ...(libraryLanguage === "c++" ? ["-std=c++17"] : []),
              ...extra,
              ...sourceCompilerArgs,
              ...moduleCodeArgs,
              "-o",
              objectPath,
            ]
          : role === "module"
          ? [
              isCpp ? toolchain.clangxx : toolchain.clang,
              ...toolchain.toolchainArgs,
              "-c",
              sourcePath,
              ...includeArgs,
              ...(isCpp ? ["-std=c++17"] : []),
              ...extra,
              ...sourceCompilerArgs,
              ...moduleCodeArgs,
              "-o",
              objectPath,
            ]
          : [
              toolchain.clangxx,
              ...toolchain.toolchainArgs,
              "-c",
              sourcePath,
              "-std=c++17",
              ...includeArgs,
              ...extra,
              ...sourceCompilerArgs,
              "-o",
              objectPath,
            ],
      linkArgv: (objectPaths, outputPath, linkArgs) => [
        toolchain.clangxx,
        ...toolchain.toolchainArgs,
        ...objectPaths,
        ...linkArgs,
        "-o",
        outputPath,
      ],
      withDriver: (task) => task(createNativeDriver(workDir, runWasiCompiler)),
    };
  }

  const emscriptenProfile = (workDir) => {
    const includeArgs = [`-I${workDir}`, `-I${path.posix.join(workDir, "flatbuffers-runtime")}`];
    return {
      compileArgv: (role, sourcePath, objectPath, extra = [], libraryLanguage = "c") =>
        role === "library"
          ? [libraryLanguage === "c++" ? "em++" : "emcc", "-c", sourcePath, ...includeArgs, ...extra, ...sourceCompilerArgs, "-o", objectPath]
          : role === "module"
          ? [sourceCompilerCommand, "-c", sourcePath, ...includeArgs, ...extra, ...sourceCompilerArgs, "-o", objectPath]
          : ["em++", "-c", sourcePath, "-std=c++17", ...includeArgs, ...extra, ...sourceCompilerArgs, "-o", objectPath],
      linkArgv: (objectPaths, outputPath, linkArgs) => ["em++", ...objectPaths, ...linkArgs, "-o", outputPath],
    };
  };

  if (kind === "system-emscripten") {
    const workDir = tempDir;
    await ensureSystemCompilerAvailable(sourceCompilerCommand);
    await ensureSystemCompilerAvailable("em++");
    return {
      kind,
      workDir,
      join: path.join,
      supportsDepfile: true,
      identity: () =>
        getSystemEmscriptenIdentity(Array.from(new Set(["emcc", "em++", sourceCompilerCommand]))).then((id) =>
          digestOf({ id, env: nativeCompilerEnv() }),
        ),
      ...emscriptenProfile(workDir),
      withDriver: (task) => task(createNativeDriver(workDir, runSystemCompiler)),
    };
  }

  const workDir = EMCEPTION_WORK_DIR;
  return {
    kind,
    workDir,
    join: path.posix.join,
    supportsDepfile: false,
    identity: () => getEmceptionCompileIdentity(),
    ...emscriptenProfile(workDir),
    withDriver: (task) =>
      runWithEmceptionLock(async (emception) => {
        try {
          return await task(createEmceptionDriver(emception, workDir));
        } finally {
          try {
            removeEmceptionDirectory(emception, workDir);
          } catch {
            // Best-effort cleanup only; the shared emception instance remains usable.
          }
        }
      }),
  };
}

// Environment a native compiler reads besides its arguments.
function nativeCompilerEnv() {
  const names = ["CPATH", "C_INCLUDE_PATH", "CPLUS_INCLUDE_PATH", "OBJC_INCLUDE_PATH", "EMCC_CFLAGS", "SDN_WASI_TARGET"];
  return Object.fromEntries(names.map((name) => [name, process.env[name] ?? null]));
}

function createNativeDriver(workDir, run) {
  return {
    async writeFile(filePath, content) {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    },
    async readFile(filePath) {
      return new Uint8Array(await readFile(filePath));
    },
    async readText(filePath) {
      return readFile(filePath, "utf8");
    },
    async exec(argv) {
      await run(argv[0], argv.slice(1), { cwd: workDir });
    },
  };
}

function createEmceptionDriver(emception, workDir) {
  emception.FS.mkdirTree(workDir);
  return {
    async writeFile(filePath, content) {
      emception.FS.mkdirTree(path.posix.dirname(filePath));
      emception.writeFile(filePath, content);
    },
    async readFile(filePath) {
      return new Uint8Array(emception.readFile(filePath));
    },
    async readText(filePath) {
      return emception.readFile(filePath, { encoding: "utf8" });
    },
    async exec(argv) {
      const result = emception.run(argv.join(" "));
      if (result.returncode !== 0) {
        throw new Error(
          `Compilation failed with ${argv[0]} (emception): ${result.stderr || result.stdout}`,
        );
      }
    },
  };
}

// Shared libraries (compile option `libraries`): code several modules carry
// (ERFA, miniz, SGP4, ...) compiled ONCE per (source, flags, toolchain) into
// its own object, whose strong global symbols are renamed into a versioned
// namespace, sdm_lib_<name>_<version>_<digest>_<symbol>. The module object's
// references to those symbols are renamed to match; the module source only
// declares them. The standalone module.wasm links the library object; the
// guest-link metadata lists it, and a flow links each namespace once however
// many of its modules use it (src/flow/flowCompiler.js), instead of every
// module carrying an internal-linkage copy.
const LIBRARY_NAME = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const LIBRARY_VERSION = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const PREPROCESSOR_DEFINE = /^[A-Za-z_][A-Za-z0-9_]*(=[^\s]*)?$/;

function normalizeLibraries(libraries) {
  if (libraries === undefined || libraries === null) return [];
  if (!Array.isArray(libraries)) {
    throw new Error("libraries must be an array of { name, version, sourceCode, language?, defines? }.");
  }
  const seen = new Set();
  return libraries.map((library, index) => {
    const name = String(library?.name ?? "");
    const version = String(library?.version ?? "");
    if (!LIBRARY_NAME.test(name) || !LIBRARY_VERSION.test(version)) {
      throw new Error(
        `libraries[${index}] needs a name and a version of letters, digits, '.', '_' or '-' ` +
          `(got name "${String(library?.name)}", version "${String(library?.version)}").`,
      );
    }
    if (seen.has(name)) {
      throw new Error(`libraries[${index}]: library "${name}" is listed twice.`);
    }
    seen.add(name);
    const sourceCode = String(library?.sourceCode ?? "");
    if (!sourceCode.trim()) {
      throw new Error(`libraries[${index}] ("${name}") has no sourceCode.`);
    }
    const language = String(library?.language ?? "c").trim().toLowerCase();
    if (!["c", "c++", "cpp", "cxx"].includes(language)) {
      throw new Error(`libraries[${index}] ("${name}"): language must be "c" or "c++", got "${String(library?.language)}".`);
    }
    const defines = (Array.isArray(library?.defines) ? library.defines : []).map((define) => {
      const text = String(define ?? "").trim();
      if (!PREPROCESSOR_DEFINE.test(text)) {
        throw new Error(`libraries[${index}] ("${name}"): define "${String(define)}" is not NAME or NAME=VALUE.`);
      }
      return text;
    });
    const safe = (text) => text.replace(/[^A-Za-z0-9]/g, "_");
    const stem = `library-${safe(name)}`;
    return {
      name,
      version,
      language: language === "c" ? "c" : "c++",
      defines,
      sourceCode,
      safeName: safe(name),
      safeVersion: safe(version),
      source: `${stem}.${language === "c" ? "c" : "cpp"}`,
      object: `${stem}.o`,
    };
  });
}

// The library object with its strong global definitions in its namespace, and
// the old-name -> new-name map the module's references follow.
function namespaceLibraryObject(library, objectBytes, digest) {
  const namespace = `sdm_lib_${library.safeName}_${library.safeVersion}_${digest.slice(0, 12)}_`;
  const renames = new Map();
  for (const symbol of listWasmObjectSymbols(objectBytes)) {
    if (!symbol.defined || symbol.local || symbol.weak || !symbol.name) continue;
    renames.set(symbol.name, `${namespace}${symbol.name}`);
  }
  return {
    namespace,
    renames,
    objectBytes: renameWasmObjectSymbols(objectBytes, renames),
  };
}

async function compileWithToolchain(kind, options = {}) {
  const {
    manifest,
    language,
    sourceCompilerCommand,
    sourceExtension,
    sourceCode,
    manifestSource,
    invokeHeaderSource,
    invokeSource,
    exportedSymbols,
    outputPath,
    tempDir,
    compileOptions,
    cache,
  } = options;
  const resolvedOutputPath = path.resolve(
    outputPath ?? path.join(tempDir, "module.wasm"),
  );
  const libraries = normalizeLibraries(compileOptions.libraries);
  const profile = await resolveToolchainProfile(kind, {
    language,
    sourceCompilerCommand,
    compileOptions,
    tempDir,
  });
  const { workDir, join } = profile;
  const at = (name) => join(workDir, name);

  const { runtimeHeaders, schemaHeaders } = await getInvokeCppSupportFiles();
  const supportFiles = {
    ...Object.fromEntries(
      Object.entries(runtimeHeaders).map(([name, content]) => [`flatbuffers-runtime/${name}`, content]),
    ),
    ...schemaHeaders,
    "space_data_module_invoke.h": invokeHeaderSource,
  };
  const sourceFiles = {
    [`module.${sourceExtension}`]: sourceCode,
    "plugin-manifest-exports.cpp": manifestSource,
    "plugin-invoke-bridge.cpp": invokeSource,
    ...Object.fromEntries(libraries.map((library) => [library.source, library.sourceCode])),
  };
  const linkArgs = buildCompilerArgs(exportedSymbols, compileOptions);

  const compileSteps = [
    { name: "module", role: "module", source: `module.${sourceExtension}`, object: "module.o" },
    { name: "manifest", role: "support", source: "plugin-manifest-exports.cpp", object: "plugin-manifest-exports.o" },
    { name: "invoke", role: "support", source: "plugin-invoke-bridge.cpp", object: "plugin-invoke-bridge.o" },
    ...libraries.map((library) => ({
      name: `library:${library.name}`,
      role: "library",
      source: library.source,
      object: library.object,
      library,
      extra: library.defines.map((define) => `-D${define}`),
    })),
  ].map((step) => ({
    ...step,
    argv: profile.compileArgv(step.role, at(step.source), at(step.object), step.extra ?? [], step.library?.language),
  }));
  const linkOutput = "module.wasm";
  const linkObjects = compileSteps.map((step) => step.object);
  const linkArgv = profile.linkArgv(linkObjects.map(at), at(linkOutput), linkArgs);

  const cacheReport = { enabled: Boolean(cache), dir: cache?.root ?? null, hits: [], misses: [], stepMs: {} };
  let keyBase = null;
  if (cache) {
    const sdk = await getSdkCompileIdentity();
    keyBase = {
      format: COMPILE_CACHE_FORMAT,
      sdk,
      toolchain: { kind, id: await profile.identity() },
      support: digestFiles(supportFiles),
    };
  }
  const compileKey = (step) =>
    digestOf({
      ...keyBase,
      step: step.name,
      argv: normalizeArgv(step.argv, workDir),
      source: sha256Hex(new TextEncoder().encode(sourceFiles[step.source])),
    });
  const linkKey = (objects) =>
    digestOf({
      ...keyBase,
      step: "link",
      argv: normalizeArgv(linkArgv, workDir),
      objects: objects.map((bytes) => sha256Hex(bytes)),
    });

  // The objects as compiled, then as linked: library objects namespaced and the
  // module object's references to them renamed to match.
  const objects = new Map();
  let linked = null;
  const prepareLinkInputs = () => {
    if (libraries.length === 0) {
      return { inputs: new Map(objects), libraries: [] };
    }
    const inputs = new Map(objects);
    const references = new Map();
    const namespaced = libraries.map((library) => {
      const step = compileSteps.find((entry) => entry.library === library);
      // The namespace is part of the library's identity: its name, version,
      // language, defines, source and flags, and the toolchain kind. Two
      // modules compiling the same library the same way share it in a flow.
      const digest = digestOf({
        name: library.name,
        version: library.version,
        language: library.language,
        defines: library.defines,
        source: sha256Hex(new TextEncoder().encode(library.sourceCode)),
        argv: normalizeArgv(step.argv, workDir),
        kind,
      });
      const result = namespaceLibraryObject(library, objects.get(library.object), digest);
      for (const [from, to] of result.renames) {
        if (references.has(from)) {
          throw new Error(
            `Libraries "${references.get(from).library}" and "${library.name}" both define the symbol "${from}".`,
          );
        }
        references.set(from, { to, library: library.name });
      }
      inputs.set(library.object, result.objectBytes);
      return { library, ...result };
    });
    inputs.set(
      "module.o",
      renameWasmObjectSymbols(
        objects.get("module.o"),
        new Map(Array.from(references, ([from, { to }]) => [from, to])),
        { undefinedOnly: true },
      ),
    );
    return { inputs, libraries: namespaced };
  };

  if (cache) {
    for (const step of compileSteps) {
      step.key = compileKey(step);
      const entry = await cache.get(step.key);
      if (entry?.blobs?.object) objects.set(step.object, entry.blobs.object);
    }
  }
  let wasmBytes = null;
  let linkCacheKey = null;
  if (cache && objects.size === compileSteps.length) {
    linked = prepareLinkInputs();
    linkCacheKey = linkKey(linkObjects.map((name) => linked.inputs.get(name)));
    wasmBytes = (await cache.get(linkCacheKey))?.blobs?.wasm ?? null;
  }

  if (!wasmBytes) {
    wasmBytes = await profile.withDriver(async (driver) => {
      for (const [name, content] of Object.entries(supportFiles)) {
        await driver.writeFile(at(name), content);
      }
      for (const [name, content] of Object.entries(sourceFiles)) {
        await driver.writeFile(at(name), content);
      }
      for (const step of compileSteps) {
        if (objects.has(step.object)) {
          cacheReport.hits.push(step.name);
          continue;
        }
        cacheReport.misses.push(step.name);
        const depfile = at(`${step.object}.d`);
        const useDepfile = Boolean(cache) && profile.supportsDepfile;
        const started = performance.now();
        await driver.exec(useDepfile ? [...step.argv, "-MD", "-MF", depfile] : step.argv);
        cacheReport.stepMs[step.name] = Math.round(performance.now() - started);
        const objectBytes = await driver.readFile(at(step.object));
        objects.set(step.object, objectBytes);
        if (cache) {
          const externalDeps = useDepfile
            ? await describeExternalDependencies(
                parseDepfile(await driver.readText(depfile))
                  .map((dep) => path.resolve(workDir, dep))
                  .filter((dep) => !dep.startsWith(workDir + path.sep) && dep !== workDir),
              )
            : [];
          await cache.put(step.key, { object: objectBytes }, { step: step.name, externalDeps });
        }
      }
      linked = prepareLinkInputs();
      const objectBytesList = linkObjects.map((name) => linked.inputs.get(name));
      for (const name of linkObjects) {
        await driver.writeFile(at(name), linked.inputs.get(name));
      }
      if (cache) {
        linkCacheKey = linkKey(objectBytesList);
        const entry = await cache.get(linkCacheKey);
        if (entry?.blobs?.wasm) {
          cacheReport.hits.push("link");
          return entry.blobs.wasm;
        }
      }
      cacheReport.misses.push("link");
      const linkStarted = performance.now();
      await driver.exec(linkArgv);
      cacheReport.stepMs.link = Math.round(performance.now() - linkStarted);
      const linkedBytes = await driver.readFile(at(linkOutput));
      if (cache) await cache.put(linkCacheKey, { wasm: linkedBytes }, { step: "link" });
      return linkedBytes;
    });
  } else {
    cacheReport.hits.push(...compileSteps.map((step) => step.name), "link");
  }

  const guestLink = deriveGuestLinkObject({
    objectBytes: linked.inputs.get("module.o"),
    pluginId: manifest?.pluginId,
    methodIds: Array.isArray(manifest?.methods)
      ? manifest.methods.map((method) => String(method?.methodId ?? ""))
      : [],
  });
  await writeFile(resolvedOutputPath, wasmBytes);
  return {
    wasmBytes,
    outputPath: resolvedOutputPath,
    cache: cacheReport,
    guestLink: {
      format: "wasm-object",
      language,
      symbolPrefix: guestLink.symbolPrefix,
      methodSymbols: guestLink.methodSymbols,
      threadModel: compileOptions.threadModel ?? ModuleThreadModel.SINGLE_THREAD,
      capabilities: compileOptions.guestLinkCapabilities,
      objectBytes: guestLink.objectBytes,
      ...(linked.libraries.length > 0
        ? {
            libraries: linked.libraries.map(({ library, namespace, objectBytes }) => ({
              name: library.name,
              version: library.version,
              language: library.language,
              namespace,
              sha256: sha256Hex(objectBytes),
              objectBytes,
            })),
          }
        : {}),
    },
  };
}

export async function compileModuleFromSource(options = {}) {
  const manifest = options.manifest ?? {};
  const sourceCode = String(options.sourceCode ?? "");
  if (!sourceCode.trim()) {
    throw new Error("compileModuleFromSource requires sourceCode.");
  }

  ensureExportableMethodIds(manifest);

  const standardsOptions = {
    catalog: options.catalog,
    standardsRoot: options.standardsRoot,
  };
  const validation = await validateArtifactWithStandards({
    manifest,
    ...standardsOptions,
  });
  if (!validation.ok) {
    const error = new Error("Manifest validation failed.");
    error.report = validation;
    throw error;
  }

  const compiler = selectCompiler(options.language);
  const invokeSurfaces = resolveInvokeSurfaces(manifest);
  const includeCommandMain = invokeSurfaces.includes(InvokeSurface.COMMAND);
  const { warnings } = toEmbeddedPluginManifest(manifest);
  const manifestSource = generateEmbeddedManifestSource({
    // Embed the canonical raw PLG shape so fields that do not exist in the
    // legacy PMAN object model (notably schemaVersion) remain byte-identical
    // to the signed custom-section manifest.
    manifest,
  });
  const invokeHeaderSource = generateInvokeSupportHeader();
  const invokeSource =
    EMSCRIPTEN_MEMORY_GROWTH_NOTIFY_SHIM +
    generateInvokeSupportSource({
      manifest,
      includeCommandMain,
    });

  const exportedSymbols = [
    "plugin_get_manifest_flatbuffer",
    "plugin_get_manifest_flatbuffer_size",
    DefaultInvokeExports.invokeSymbol,
    DefaultInvokeExports.allocSymbol,
    DefaultInvokeExports.freeSymbol,
    ...(includeCommandMain ? [DefaultInvokeExports.commandSymbol] : []),
    ...new Set(
      (Array.isArray(manifest.methods) ? manifest.methods : [])
        .map((method) => String(method?.methodId ?? "").trim())
        .filter(Boolean),
    ),
  ];

  const threadModel = resolveThreadModel({
    manifest,
    threadModel: options.threadModel,
  });
  const simd128 = resolveSimd128(options.simd128, threadModel);
  const compileOptions = {
    ...options,
    noEntry: includeCommandMain !== true,
    threadModel,
    simd128,
    guestLinkCapabilities: resolveGuestLinkCapabilities(
      manifest,
      options.guestLinkCapabilities,
    ),
  };
  if (threadModel === ModuleThreadModel.WASI_SEQUENTIAL) {
    // Fails the compile when the manifest has not justified the exemption.
    assertSequentialJustification(manifest);
  }
  // BOTH wasi models use the sanctioned clang wasm32-wasip1-threads toolchain.
  // The difference is the link shape and which artifact guard applies.
  const useWasiThreads =
    threadModel === ModuleThreadModel.EMSCRIPTEN_PTHREADS ||
    threadModel === ModuleThreadModel.WASI_SEQUENTIAL;
  const useSystemEmscripten =
    !useWasiThreads && requiresSystemEmscripten(threadModel, compileOptions);
  const toolchainKind = useWasiThreads
    ? "wasi"
    : useSystemEmscripten
      ? "system-emscripten"
      : "emception";
  const cache = openCompileCache(options.compileCache);
  // Scratch for the toolchain and, without an explicit outputPath, the home of
  // the emitted artifact. Removed in finally on success, failure and throw.
  // `keepTempDir: true` hands it to the caller on success instead
  // (result.tempDir, freed by cleanupCompilation); a failed compile never
  // hands anything off, so its dir is always removed.
  const keepTempDir = options.keepTempDir === true;
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "space-data-module-sdk-compile-"),
  );
  let handedOff = false;
  try {
    const result = await compileWithToolchain(toolchainKind, {
      manifest,
      language: compiler.language,
      sourceCompilerCommand: compiler.command,
      sourceExtension: compiler.extension,
      sourceCode,
      manifestSource,
      invokeHeaderSource,
      invokeSource,
      exportedSymbols,
      outputPath: options.outputPath,
      tempDir,
      compileOptions,
      cache,
    });
    const wasmBytes = appendWasmCustomSection(
      result.wasmBytes,
      SDS_MANIFEST_SECTION_NAME,
      encodePluginManifest(manifest),
    );
    const resolvedOutputPath = result.outputPath;
    await writeFile(resolvedOutputPath, wasmBytes);

    // Enforce the isomorphic-pthreads guardrail on the EMITTED artifact: a build
    // that claims the pthreads thread model but did not emit a shared-memory /
    // atomics wasm must FAIL the compile here rather than ship. See
    // docs/isomorphic-pthreads.md.
    let threadFeatures = null;
    if (threadModel === ModuleThreadModel.EMSCRIPTEN_PTHREADS) {
      threadFeatures = assertPthreadArtifact(wasmBytes, {
        source: resolvedOutputPath,
      });
    } else if (threadModel === ModuleThreadModel.WASI_SEQUENTIAL) {
      // Mirror guard. The target is passed so that SDN_WASI_TARGET cannot be used
      // to quietly build a plain wasm32-wasip1 object under the sequential model:
      // it is a concurrency exemption, not a toolchain exemption.
      threadFeatures = assertSequentialArtifact(wasmBytes, {
        source: resolvedOutputPath,
        target: resolveWasiThreadsToolchain().target,
      });
    }

    // The SIMD guard holds the artifact to the build's declaration: never relaxed-SIMD,
    // every function body decodable, and simd128 in target_features when the module
    // opted in. SIMD without the opt-in is recorded as if declared, with a warning
    // (it becomes an error in a later release). See simdArtifactGuard.js.
    const { warning: simd128Warning, ...simd128Report } = assertSimdArtifact(wasmBytes, {
      optedIn: simd128,
      // A path only when the caller asked for one: otherwise the artifact is in a temp dir that is gone.
      source: options.outputPath != null ? resolvedOutputPath : `the module "${manifest.pluginId ?? "unnamed"}"`,
    });
    const buildWarnings = [];
    if (simd128Warning) {
      buildWarnings.push(simd128Warning);
      process.emitWarning(simd128Warning, {
        type: "DeprecationWarning",
        code: SIMD128_UNDECLARED_WARNING_CODE,
      });
    }
    // Present only for a module that uses SIMD (declared or not): any other module has
    // a guest-link record byte-identical to what it always had.
    const guestLink =
      result.guestLink && (simd128 || simd128Report.undeclared)
        ? { ...result.guestLink, simd128: true }
        : result.guestLink;

    // Validate the compiled artifact
    const report = await validateArtifactWithStandards({
      manifest,
      wasmPath: resolvedOutputPath,
      ...standardsOptions,
    });

    handedOff = keepTempDir;
    return {
      compiler: useWasiThreads
        ? threadModel === ModuleThreadModel.WASI_SEQUENTIAL
          ? "wasm32-wasi-clang++ (wasi-sequential)"
          : "wasm32-wasi-clang++ (wasi-threads)"
        : useSystemEmscripten
          ? "em++ (system emscripten pthreads)"
          : "em++ (emception)",
      language: compiler.language,
      threadModel,
      // Without an explicit outputPath the artifact lived in tempDir, which is
      // gone unless the caller kept it.
      outputPath:
        options.outputPath != null || keepTempDir ? resolvedOutputPath : null,
      tempDir: keepTempDir ? tempDir : null,
      wasmBytes,
      guestLink,
      compileCache: result.cache,
      manifestWarnings: warnings,
      warnings: buildWarnings,
      threadFeatures,
      simd128: simd128Report,
      report,
    };
  } finally {
    if (!handedOff) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

export async function cleanupCompilation(result) {
  if (result?.tempDir) {
    await rm(result.tempDir, { recursive: true, force: true });
  }
}

async function deriveSigningIdentity(mnemonic) {
  const wallet = await getWasmWallet();
  const resolvedMnemonic =
    mnemonic && wallet.mnemonic.validate(mnemonic)
      ? mnemonic
      : wallet.mnemonic.generate(12);
  const seed = wallet.mnemonic.toSeed(resolvedMnemonic);
  const root = wallet.hdkey.fromSeed(seed);
  const signingKey = wallet.getSigningKey(root, 0, 0, 0);
  return {
    wallet,
    mnemonic: resolvedMnemonic,
    signingKey,
  };
}

export async function protectModuleArtifact(options = {}) {
  const manifest = options.manifest ?? {};
  const wasmBytes =
    options.wasmBytes instanceof Uint8Array
      ? options.wasmBytes
      : base64ToBytes(options.wasmBase64 ?? "");
  if (wasmBytes.length === 0) {
    throw new Error("protectModuleArtifact requires wasmBytes or wasmBase64.");
  }

  const manifestBytes = encodePluginManifest(manifest);
  const wasmHashHex = bytesToHex(await sha256Bytes(wasmBytes));
  const manifestHashHex = bytesToHex(await sha256Bytes(manifestBytes));
  const artifactId = options.artifactId ?? `module-${wasmHashHex.slice(0, 16)}`;
  const programId = manifest.pluginId ?? artifactId;

  const identity = await deriveSigningIdentity(options.mnemonic ?? null);
  const signer = createHdWalletSigner({
    publicKeyHex: bytesToHex(identity.signingKey.publicKey),
    derivationPath: identity.signingKey.path,
    keyId: artifactId,
    // the digest as given: signRecoverable signs its 32-byte input, secp256k1.sign would hash it again
    async signDigest(digest) {
      return identity.wallet.curves.secp256k1.signRecoverable(
        digest,
        identity.signingKey.privateKey,
      ).signature;
    },
  });

  const authorization = await createDeploymentAuthorization({
    artifactId,
    programId,
    manifestHash: manifestHashHex,
    graphHash: wasmHashHex,
    target: options.targetUrl ?? options.target ?? null,
    capabilities: options.capabilities ?? [],
  });
  const signedAuthorization = await signAuthorization({
    authorization,
    signer,
  });

  const payload = {
    version: 1,
    format: "space-data-module-package",
    artifactId,
    programId,
    manifest,
    manifestBase64: bytesToBase64(manifestBytes),
    wasmBase64: bytesToBase64(wasmBytes),
    wasmHashHex,
    manifestHashHex,
    authorization: signedAuthorization,
  };
  const publicationNoticeOptions = {
    publishTimestamp: options.publishTimestamp,
    publishTimestampMs: options.publishTimestampMs,
  };

  let singleFileBundle = null;
  let singleFileBundleRecords = null;
  if (options.singleFileBundle === true) {
    const additionalEntries = [
      ...(Array.isArray(options.bundleEntries) ? options.bundleEntries : []),
      ...createGuestLinkBundleEntries(options.guestLink),
    ];
    singleFileBundle = await createSingleFileBundle({
      wasmBytes,
      manifest,
      authorization: signedAuthorization,
      entries: additionalEntries,
    });
    singleFileBundleRecords = extractPublicationRecordCollection(
      singleFileBundle.wasmBytes,
    );
  }

  const bundleBytes = singleFileBundleRecords?.payloadBytes ?? wasmBytes;
  const bundleRecord = singleFileBundleRecords?.mbl ?? null;
  let publicationNotice = null;
  let publicationRecordsBytes = null;
  let protectedArtifactBytes = null;
  let encryptedEnvelope = null;

  if (options.recipientPublicKeyHex) {
    const encryptedBase = await encryptBytesForRecipient({
      plaintext: bundleBytes,
      recipientPublicKey: hexToBytes(options.recipientPublicKeyHex),
      context: "space-data-module-sdk/package",
      rootType: "WASM",
    });
    const encryptedBaseBytes = base64ToBytes(encryptedBase.protectedBlobBase64);
    const parsedEncryptedBase = extractPublicationRecordCollection(encryptedBaseBytes);
    publicationNotice = await createPublicationNotice({
      ...publicationNoticeOptions,
      payloadBytes: parsedEncryptedBase.payloadBytes,
      artifactId,
      programId,
      fileName: `${artifactId}.wasm`,
      fileId: programId,
      signer,
    });
    publicationRecordsBytes = encodePublicationRecordCollection({
      mbl: bundleRecord,
      enc: parsedEncryptedBase.enc,
      pnm: publicationNotice,
    });
    protectedArtifactBytes = appendPublicationRecordCollection(
      parsedEncryptedBase.payloadBytes,
      publicationRecordsBytes,
    );
    encryptedEnvelope = createEncryptedEnvelopePayload({
      protectedBlobBytes: protectedArtifactBytes,
      parsedProtectedBlob: {
        payloadBytes: parsedEncryptedBase.payloadBytes,
        recordCollectionBytes: publicationRecordsBytes,
        mbl: bundleRecord,
        enc: parsedEncryptedBase.enc,
        pnm: publicationNotice,
      },
      enc: parsedEncryptedBase.enc,
      context: parsedEncryptedBase.enc?.context,
    });
  } else {
    publicationNotice = await createPublicationNotice({
      ...publicationNoticeOptions,
      payloadBytes: bundleBytes,
      artifactId,
      programId,
      fileName: `${artifactId}.wasm`,
      fileId: programId,
      signer,
    });
    publicationRecordsBytes = encodePublicationRecordCollection({
      mbl: bundleRecord,
      pnm: publicationNotice,
    });
    protectedArtifactBytes = appendPublicationRecordCollection(
      bundleBytes,
      publicationRecordsBytes,
    );
  }

  if (singleFileBundle) {
    singleFileBundle = {
      ...singleFileBundle,
      wasmBytes: protectedArtifactBytes,
    };
  }

  return {
    mnemonic: identity.mnemonic,
    signingPublicKeyHex: bytesToHex(identity.signingKey.publicKey),
    signingPath: identity.signingKey.path,
    payload,
    publicationNotice,
    publicationRecordsBytes,
    protectedArtifactBytes,
    protectedArtifactBase64: bytesToBase64(protectedArtifactBytes),
    encrypted: Boolean(options.recipientPublicKeyHex),
    encryptedEnvelope,
    singleFileBundle,
    bundledWasmBytes: singleFileBundle?.wasmBytes ?? protectedArtifactBytes,
  };
}

export async function createRecipientKeypairHex() {
  const keypair = await generateX25519Keypair();
  return {
    publicKeyHex: bytesToHex(keypair.publicKey),
    privateKeyHex: bytesToHex(keypair.privateKey),
  };
}
