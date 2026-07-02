/**
 * Browser-side module harness.
 *
 * Loads the same standalone WASI .wasm artifact that WasmEdge runs,
 * instantiating it in the browser with the WASI shim + optional space_data_module_host
 * bridge. Matches the createModuleHarness() API surface.
 *
 * Supports two invoke paths:
 *   1. "direct" — call plugin_invoke_stream(ptr, len, &outLen) and read
 *      the FlatBuffer response from WASM memory.
 *   2. "command" — call _start() with stdin piped via WASI shim, read
 *      stdout for the response bytes.
 */

import { createBrowserWasiShim, WasiExitError } from "../host/wasiShim.js";
import { createBrowserHost } from "../host/browserHost.js";
import { getWasmWallet } from "../utils/wasmCrypto.js";
import {
  createHostcallBridge,
  createAsyncHostDispatcher,
  createHostSyncDispatcher,
  DEFAULT_HOSTCALL_IMPORT_MODULE,
} from "../host/abi.js";
import {
  DefaultInvokeExports,
  DefaultManifestExports,
} from "../runtime/constants.js";
import {
  INVOKE_ARENA_ALIGNMENT,
  encodePluginInvokeRequest,
  decodePluginInvokeResponse,
  writePluginInvokeRequestToArena,
} from "../invoke/codec.js";
import { toUint8Array } from "../runtime/bufferLike.js";
import {
  ModuleSignatureError,
  resolveModuleSignaturePolicy,
  verifyModuleArtifact,
} from "../bundle/signing.js";
import { extractPublicationRecordCollection } from "../transport/records.js";

/**
 * Reduce a module artifact to the bytes a wasm engine can compile.
 *
 * Signed/published artifacts carry an appended publication record collection
 * (MBL bundle with the sds.signature entry, PNM/REC trailers). Wasm engines
 * reject those trailing bytes ("unknown section code"), so the canonical
 * module payload must be extracted before compile. ENC-protected payloads
 * cannot be loaded here — decryption is a host concern.
 *
 * @param {Uint8Array} bytes - raw artifact bytes
 * @returns {Uint8Array} compilable wasm bytes
 */
export function toLoadableWasmBytes(bytes) {
  const publication = extractPublicationRecordCollection(bytes);
  if (!publication) {
    return bytes;
  }
  if (publication.enc) {
    throw new ModuleSignatureError(
      "encrypted_artifact",
      "Module artifact payload is ENC-protected; decrypt it before loading.",
    );
  }
  return publication.payloadBytes;
}

const STANDALONE_SHARED_MEMORY_ENV_STUBS = Object.freeze({
  _emscripten_init_main_thread_js: () => 0,
  _emscripten_notify_mailbox_postmessage: () => 0,
  _emscripten_receive_on_main_thread_js: () => 0,
  _emscripten_thread_cleanup: () => 0,
  _emscripten_thread_mailbox_await: () => 0,
  _emscripten_thread_set_strongref: () => 0,
  emscripten_check_blocking_allowed: () => 0,
  emscripten_exit_with_live_runtime: () => 0,
  pthread_mutex_lock: () => 0,
  pthread_mutex_unlock: () => 0,
  pthread_cond_broadcast: () => 0,
  pthread_cond_wait: () => 0,
  emscripten_thread_sleep: () => {},
  __do_set_thread_state: () => {},
  __get_tp: () => 0,
});
const STANDALONE_SHARED_MEMORY_ENV_IMPORTS = new Set([
  "memory",
  ...Object.keys(STANDALONE_SHARED_MEMORY_ENV_STUBS),
]);

function isStandaloneSharedMemoryEnvImport(entry) {
  return (
    entry.module === "env" &&
    STANDALONE_SHARED_MEMORY_ENV_IMPORTS.has(entry.name) &&
    (entry.name === "memory"
      ? entry.kind === "memory"
      : entry.kind === "function")
  );
}

function usesOnlyStandaloneSharedMemoryEnvImports(envImports) {
  return (
    envImports.length > 0 &&
    envImports.every((entry) => isStandaloneSharedMemoryEnvImport(entry))
  );
}

function addStandaloneSharedMemoryEnvStubs(importObject, moduleImports) {
  const envImports = moduleImports.filter((entry) => entry.module === "env");
  if (!usesOnlyStandaloneSharedMemoryEnvImports(envImports)) {
    return;
  }

  const envNamespace = {
    ...(importObject.env ?? {}),
  };
  for (const entry of envImports) {
    if (entry.kind !== "function") {
      continue;
    }
    if (typeof envNamespace[entry.name] !== "function") {
      envNamespace[entry.name] = STANDALONE_SHARED_MEMORY_ENV_STUBS[entry.name];
    }
  }
  importObject.env = envNamespace;
}

/**
 * Detect artifact profile from WebAssembly.Module imports.
 * Returns "standalone" (WASI-only), "module-host-abi" (WASI + space_data_module_host),
 * or "emscripten" (env.* with invoke trampolines).
 */
export function detectArtifactProfile(wasmModule) {
  const imports = WebAssembly.Module.imports(wasmModule);
  const moduleNames = new Set(imports.map((i) => i.module));
  const envImports = imports.filter((i) => i.module === "env");
  const usesStandaloneSharedMemoryEnv =
    usesOnlyStandaloneSharedMemoryEnvImports(envImports);

  if (moduleNames.has("env")) {
    if (!usesStandaloneSharedMemoryEnv) {
      const hasInvokeTrampolines = envImports.some((i) =>
        i.name.startsWith("invoke_"),
      );
      const hasPthreads = envImports.some(
        (i) => i.name.includes("pthread") || i.name.includes("thread"),
      );
      if (hasInvokeTrampolines || hasPthreads) {
        return "emscripten";
      }
    }
  }

  if (moduleNames.has(DEFAULT_HOSTCALL_IMPORT_MODULE)) {
    return "module-host-abi";
  }

  if (moduleNames.has("wasi_snapshot_preview1") || moduleNames.has("wasi_unstable")) {
    return "standalone";
  }

  if (usesStandaloneSharedMemoryEnv) {
    return "standalone";
  }

  return "unknown";
}

async function compileWasmModule(source) {
  if (source instanceof WebAssembly.Module) {
    return source;
  }
  let bytes;
  if (source instanceof Response) {
    bytes = new Uint8Array(await source.arrayBuffer());
  } else if (typeof source === "string") {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch module artifact: ${response.status}`);
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    bytes = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
  }
  // Strip any appended publication record collection (signature/PNM/REC
  // trailers) — wasm engines reject trailing non-section bytes.
  return WebAssembly.compile(toLoadableWasmBytes(bytes));
}

const WASM_PAGE_BYTES = 65536;
const DEFAULT_IMPORTED_MEMORY_INITIAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_IMPORTED_MEMORY_MAXIMUM_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_DIRECT_INVOKE_REQUEST_ARENA_BYTES = 64 * 1024;
const SHARED_ARRAY_BUFFER_TAG = "[object SharedArrayBuffer]";

export function isSharedArrayBufferLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    ((typeof SharedArrayBuffer === "function" &&
      value instanceof SharedArrayBuffer) ||
      Object.prototype.toString.call(value) === SHARED_ARRAY_BUFFER_TAG)
  );
}

function bytesToPages(value, fallbackBytes) {
  const bytes =
    Number.isFinite(value) && value > 0 ? Number(value) : fallbackBytes;
  return Math.ceil(bytes / WASM_PAGE_BYTES);
}

function createImportedMemory(options = {}) {
  const initialPages = bytesToPages(
    options.initialMemoryBytes,
    DEFAULT_IMPORTED_MEMORY_INITIAL_BYTES,
  );
  const maximumPages = Math.max(
    initialPages,
    bytesToPages(
      options.maximumMemoryBytes,
      DEFAULT_IMPORTED_MEMORY_MAXIMUM_BYTES,
    ),
  );
  const descriptor = {
    initial: initialPages,
    maximum: maximumPages,
  };

  if (options.sharedMemory === true) {
    if (typeof SharedArrayBuffer !== "function") {
      throw new Error(
        "Browser module harness shared imported memory requires SharedArrayBuffer.",
      );
    }
    descriptor.shared = true;
  }

  return new WebAssembly.Memory(descriptor);
}

function resolveManifestSurface(manifest) {
  const surfaces = Array.isArray(manifest?.invokeSurfaces)
    ? manifest.invokeSurfaces
    : [];
  if (surfaces.includes("command")) {
    return "command";
  }
  if (surfaces.includes("direct")) {
    return "direct";
  }
  return null;
}

async function instantiateBrowserModule(options = {}) {
  let providedMemory = options.wasmMemory ?? options.memory ?? null;
  if (
    providedMemory !== null &&
    !(providedMemory instanceof WebAssembly.Memory)
  ) {
    throw new TypeError(
      "Browser module harness memory must be a WebAssembly.Memory.",
    );
  }
  const wasi = createBrowserWasiShim({
    args: options.args ?? [],
    env: options.env ?? {},
    stdinBytes: options.stdinBytes ?? new Uint8Array(),
    logOutput: options.logOutput === true,
    performance: options.performance,
  });
  const importObject = { ...wasi.imports };
  const moduleImports = WebAssembly.Module.imports(options.wasmModule);
  const needsHostBridge = moduleImports.some(
    (entry) => entry.module === DEFAULT_HOSTCALL_IMPORT_MODULE,
  );
  const memoryImports = moduleImports.filter((entry) => entry.kind === "memory");
  if (!providedMemory && memoryImports.length > 0) {
    providedMemory = createImportedMemory(options);
  }
  for (const entry of memoryImports) {
    if (!providedMemory) {
      throw new Error(
        `Browser module imports ${entry.module}.${entry.name} memory; pass a WebAssembly.Memory as the memory option.`,
      );
    }
    importObject[entry.module] = {
      ...(importObject[entry.module] ?? {}),
      [entry.name]: providedMemory,
    };
  }
  addStandaloneSharedMemoryEnvStubs(importObject, moduleImports);

  let instance = null;
  let bridge = null;
  let memory = providedMemory;
  if (needsHostBridge) {
    // hostcallDispatch overrides the default sync dispatcher — used by the
    // worker harness to route guest hostcalls through the SAB channel so
    // async host capabilities (http/ipfs/storage/pubsub) become reachable.
    const dispatch =
      typeof options.hostcallDispatch === "function"
        ? options.hostcallDispatch
        : createHostSyncDispatcher(options.host);
    bridge = createHostcallBridge({
      dispatch,
      getMemory: () => memory ?? instance?.exports?.memory,
    });
    Object.assign(importObject, bridge.imports);
  }

  instance = await WebAssembly.instantiate(options.wasmModule, importObject);
  memory = instance.exports.memory ?? providedMemory;
  if (memory) {
    if (
      options.sharedMemory === true &&
      !isSharedArrayBufferLike(memory.buffer)
    ) {
      throw new Error(
        "Browser module harness sharedMemory requires shared WebAssembly.Memory backing.",
      );
    }
    wasi.setMemory(memory);
  }
  if (instance.exports._initialize) {
    instance.exports._initialize();
  }

  return {
    instance,
    bridge,
    wasi,
    memory,
  };
}

/**
 * Create a browser-side module harness for a standalone WASI artifact.
 *
 * @param {Object} options
 * @param {Uint8Array|ArrayBuffer|Response|string} options.wasmSource
 *   WASM bytes, ArrayBuffer, fetch Response, or URL string.
 * @param {Object} [options.host] - BrowserHost instance (created if omitted).
 * @param {string[]} [options.args] - WASI args passed to the module.
 * @param {Object} [options.env] - WASI environment variables.
 * @param {Object} [options.manifest] - Plugin manifest used to choose the invoke surface.
 * @param {string} [options.surface] - "direct" or "command" (default: auto-detect).
 * @param {WebAssembly.Memory} [options.wasmMemory] - Explicit imported memory.
 * @param {WebAssembly.Memory} [options.memory] - Alias for wasmMemory.
 * @param {boolean} [options.sharedMemory] - Create SharedArrayBuffer-backed imported memory.
 * @param {boolean} [options.allowRawInvoke] - Permit direct-surface raw byte-frame invoke.
 * @param {number} [options.initialMemoryBytes] - Initial imported memory size.
 * @param {number} [options.maximumMemoryBytes] - Maximum imported memory size.
 */
export async function createBrowserModuleHarness(options = {}) {
  let wasmSource = options.wasmSource;
  const signaturePolicy = resolveModuleSignaturePolicy(options);
  if (signaturePolicy) {
    if (wasmSource instanceof WebAssembly.Module) {
      throw new ModuleSignatureError(
        "unverifiable_source",
        "Cannot verify a precompiled WebAssembly.Module; pass bytes, a URL, or a Response when signature verification is enabled.",
      );
    }
    let artifactBytes;
    if (wasmSource instanceof Response) {
      artifactBytes = new Uint8Array(await wasmSource.arrayBuffer());
    } else if (typeof wasmSource === "string") {
      const response = await fetch(wasmSource);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch module artifact for verification: ${response.status}`,
        );
      }
      artifactBytes = new Uint8Array(await response.arrayBuffer());
    } else {
      artifactBytes =
        wasmSource instanceof ArrayBuffer
          ? new Uint8Array(wasmSource)
          : new Uint8Array(wasmSource);
    }
    await verifyModuleArtifact(artifactBytes, signaturePolicy);
    wasmSource = artifactBytes;
  }
  const wasmModule = await compileWasmModule(wasmSource);
  const moduleImports = WebAssembly.Module.imports(wasmModule);
  const needsHostBridge = moduleImports.some(
    (entry) => entry.module === DEFAULT_HOSTCALL_IMPORT_MODULE,
  );
  const hasHostcallDispatch = typeof options.hostcallDispatch === "function";
  const hostOptions =
    !options.host &&
    needsHostBridge &&
    !hasHostcallDispatch &&
    !options.hostOptions?.wasmWallet
      ? {
          ...options.hostOptions,
          wasmWallet: await getWasmWallet(),
        }
      : options.hostOptions;
  // With an external hostcallDispatch (worker harness), the host lives on the
  // controlling thread — skip constructing a default local host.
  const host =
    options.host ?? (hasHostcallDispatch ? null : createBrowserHost(hostOptions));
  const dispatchHost = host ? createAsyncHostDispatcher(host) : null;

  const profile = detectArtifactProfile(wasmModule);
  const moduleExports = WebAssembly.Module.exports(wasmModule);
  const exportNames = new Set(moduleExports.map((e) => e.name));

  const hasDirectInvoke = exportNames.has(DefaultInvokeExports.invokeSymbol);
  const hasCommand = exportNames.has(DefaultInvokeExports.commandSymbol);
  const manifestSurface = resolveManifestSurface(options.manifest);
  const surface =
    options.surface ??
    manifestSurface ??
    (hasDirectInvoke ? "direct" : hasCommand ? "command" : "direct");
  if (profile === "emscripten") {
    throw new Error(
      "Browser harness only supports standalone WASI or space_data_module_host artifacts. " +
        'Compile shared browser/WasmEdge modules with runtimeTargets: ["browser", "wasmedge"] ' +
        'or override threadModel to "single-thread".',
    );
  }

  const activeContext = await instantiateBrowserModule({
    wasmModule,
    host,
    hostcallDispatch: options.hostcallDispatch,
    args: options.args,
    env: options.env,
    performance: options.performance ?? host?.performance,
    logOutput: options.logOutput === true,
    wasmMemory: options.wasmMemory,
    memory: options.memory,
    sharedMemory: options.sharedMemory,
    initialMemoryBytes: options.initialMemoryBytes,
    maximumMemoryBytes: options.maximumMemoryBytes,
  });
  const { instance, bridge, wasi, memory } = activeContext;
  const allowRawInvoke = options.allowRawInvoke !== false;

  // --- Invoke helpers ---
  function directInvokeRuntime() {
    const alloc = instance.exports[DefaultInvokeExports.allocSymbol];
    const free = instance.exports[DefaultInvokeExports.freeSymbol];
    const invokeStream = instance.exports[DefaultInvokeExports.invokeSymbol];
    if (
      typeof alloc !== "function" ||
      typeof free !== "function" ||
      typeof invokeStream !== "function" ||
      !memory
    ) {
      throw new Error(
        "Direct browser invoke requires plugin_alloc, plugin_free, plugin_invoke_stream, and memory exports.",
      );
    }
    return { alloc, free, invokeStream, memory };
  }

  function invokeDirectRaw(requestBytes) {
    if (!allowRawInvoke) {
      throw new Error(
        "Browser module harness raw direct invoke is disabled; use a SharedArrayBuffer-backed externalArena descriptor.",
      );
    }
    const { alloc, free, invokeStream, memory } = directInvokeRuntime();
    const reqLen = requestBytes.length;
    const reqPtr = alloc(reqLen);
    if (!reqPtr) throw new Error("plugin_alloc returned null for request.");
    if (reqPtr % INVOKE_ARENA_ALIGNMENT !== 0) {
      throw new Error(
        `plugin_alloc returned a request pointer (${reqPtr}) that is not ${INVOKE_ARENA_ALIGNMENT}-byte aligned.`,
      );
    }

    new Uint8Array(memory.buffer, reqPtr, reqLen).set(requestBytes);

    // Allocate space for the response length output
    const outLenPtr = alloc(4);
    if (!outLenPtr) throw new Error("plugin_alloc returned null for response length.");

    new DataView(memory.buffer).setUint32(outLenPtr, 0, true);

    const resPtr = invokeStream(reqPtr, reqLen, outLenPtr);
    const resLen = new DataView(memory.buffer).getUint32(outLenPtr, true);

    free(reqPtr, reqLen);
    free(outLenPtr, 4);

    if (!resPtr || !resLen) {
      throw new Error("plugin_invoke_stream returned null response.");
    }
    if (resPtr % INVOKE_ARENA_ALIGNMENT !== 0) {
      throw new Error(
        `plugin_invoke_stream returned a response pointer (${resPtr}) that is not ${INVOKE_ARENA_ALIGNMENT}-byte aligned.`,
      );
    }

    const responseBytes = new Uint8Array(memory.buffer, resPtr, resLen).slice();
    free(resPtr, resLen);
    return responseBytes;
  }

  function writeDirectInvokeRequestToModuleMemory(request) {
    const { alloc, free, memory } = directInvokeRuntime();
    const allocationSize = Number(
      request?.requestEnvelopeCapacityBytes ??
        options.directInvokeRequestArenaBytes ??
        DEFAULT_DIRECT_INVOKE_REQUEST_ARENA_BYTES,
    );
    if (!Number.isInteger(allocationSize) || allocationSize <= 0) {
      throw new Error(
        "Direct browser invoke request arena capacity must be a positive integer.",
      );
    }
    const allocationPtr = alloc(allocationSize);
    if (!allocationPtr) {
      throw new Error("plugin_alloc returned null for direct invoke request.");
    }
    if (allocationPtr % INVOKE_ARENA_ALIGNMENT !== 0) {
      free(allocationPtr, allocationSize);
      throw new Error(
        `plugin_alloc returned a direct invoke request pointer (${allocationPtr}) that is not ${INVOKE_ARENA_ALIGNMENT}-byte aligned.`,
      );
    }
    try {
      const arena = new Uint8Array(memory.buffer, allocationPtr, allocationSize);
      const payload = writePluginInvokeRequestToArena(request, arena);
      if (payload.buffer !== memory.buffer) {
        throw new Error(
          "Direct browser invoke request was not authored in module memory.",
        );
      }
      if (payload.byteOffset % INVOKE_ARENA_ALIGNMENT !== 0) {
        throw new Error(
          `Direct browser invoke request pointer (${payload.byteOffset}) is not ${INVOKE_ARENA_ALIGNMENT}-byte aligned.`,
        );
      }
      return {
        ptr: payload.byteOffset,
        size: payload.byteLength,
        allocationPtr,
        allocationSize,
      };
    } catch (error) {
      free(allocationPtr, allocationSize);
      throw error;
    }
  }

  function freeDirectInvokeRequest({ allocationPtr, allocationSize } = {}) {
    if (
      Number.isInteger(allocationPtr) &&
      Number.isInteger(allocationSize) &&
      allocationPtr > 0 &&
      allocationSize > 0
    ) {
      const { free } = directInvokeRuntime();
      free(allocationPtr, allocationSize);
    }
  }

  function invokeDirectModuleMemoryRequest({ ptr, size }) {
    const { alloc, free, invokeStream, memory } = directInvokeRuntime();
    if (
      !Number.isInteger(ptr) ||
      !Number.isInteger(size) ||
      ptr <= 0 ||
      size <= 0
    ) {
      throw new Error("Direct browser invoke requires a module-memory request descriptor.");
    }
    if (ptr % INVOKE_ARENA_ALIGNMENT !== 0) {
      throw new Error(
        `Direct browser invoke request pointer (${ptr}) is not ${INVOKE_ARENA_ALIGNMENT}-byte aligned.`,
      );
    }

    const outLenPtr = alloc(4);
    if (!outLenPtr) throw new Error("plugin_alloc returned null for response length.");

    new DataView(memory.buffer).setUint32(outLenPtr, 0, true);

    const resPtr = invokeStream(ptr, size, outLenPtr);
    const resLen = new DataView(memory.buffer).getUint32(outLenPtr, true);

    free(outLenPtr, 4);

    if (!resPtr || !resLen) {
      throw new Error("plugin_invoke_stream returned null response.");
    }
    if (resPtr % INVOKE_ARENA_ALIGNMENT !== 0) {
      throw new Error(
        `plugin_invoke_stream returned a response pointer (${resPtr}) that is not ${INVOKE_ARENA_ALIGNMENT}-byte aligned.`,
      );
    }

    const responseBytes = new Uint8Array(memory.buffer, resPtr, resLen).slice();
    free(resPtr, resLen);
    return responseBytes;
  }

  function assertModuleMemoryExternalArena(externalArena, memory) {
    if (!externalArena) {
      throw new TypeError(
        "Direct external arena invoke requires request.externalArena bytes.",
      );
    }
    if (!isSharedArrayBufferLike(memory.buffer)) {
      throw new Error(
        "Direct externalArena invoke requires SharedArrayBuffer-backed module memory.",
      );
    }
    if (
      externalArena.buffer !== memory.buffer ||
      externalArena.byteOffset !== 0 ||
      externalArena.byteLength !== memory.buffer.byteLength
    ) {
      throw new Error(
        "Direct externalArena invoke requires request.externalArena to be a full Uint8Array view of module memory.",
      );
    }
  }

  function externalArenaFrameDescriptor(frame, externalArena) {
    if (frame?.payload !== undefined && frame?.payload !== null) {
      throw new Error(
        "Direct externalArena input frames must use offset/size descriptors, not payload bytes.",
      );
    }
    const offset = Number(frame?.offset ?? frame?.OFFSET ?? 0);
    const size = Number(frame?.size ?? frame?.SIZE ?? frame?.byteLength ?? 0);
    if (
      !Number.isInteger(offset) ||
      !Number.isInteger(size) ||
      offset < 0 ||
      size < 0 ||
      offset > externalArena.length ||
      size > externalArena.length - offset
    ) {
      throw new Error("Direct external arena frame range exceeds externalArena.");
    }
    return { offset, size };
  }

  function externalArenaInputFrames(request) {
    return Array.isArray(request?.inputs)
      ? request.inputs
      : request?.inputFrames ?? [];
  }

  function invokeDirectExternalArena(request) {
    const { memory } = directInvokeRuntime();
    const externalArena = toUint8Array(request?.externalArena);
    assertModuleMemoryExternalArena(externalArena, memory);
    const inputs = externalArenaInputFrames(request).map((frame) => {
      const { offset, size } = externalArenaFrameDescriptor(frame, externalArena);
      const nextFrame = {
        ...frame,
        offset,
        size,
      };
      delete nextFrame.payload;
      return nextFrame;
    });
    const requestDescriptor = writeDirectInvokeRequestToModuleMemory({
      ...request,
      inputs,
      inputFrames: undefined,
      externalArena,
    });
    try {
      return invokeDirectModuleMemoryRequest(requestDescriptor);
    } finally {
      freeDirectInvokeRequest(requestDescriptor);
    }
  }

  async function invokeCommandRaw(stdinBytes) {
    const commandContext = await instantiateBrowserModule({
      wasmModule,
      host,
      hostcallDispatch: options.hostcallDispatch,
      args: options.args,
      env: options.env,
      stdinBytes,
      performance: options.performance ?? host?.performance,
      logOutput: false,
      wasmMemory: options.wasmMemory,
      memory: options.memory,
      sharedMemory: options.sharedMemory,
      initialMemoryBytes: options.initialMemoryBytes,
      maximumMemoryBytes: options.maximumMemoryBytes,
    });
    try {
      const commandExport = commandContext.instance.exports[DefaultInvokeExports.commandSymbol];
      if (typeof commandExport !== "function") {
        throw new Error(
          `Command-surface browser invoke requires the ${DefaultInvokeExports.commandSymbol} export.`,
        );
      }
      commandExport();
    } catch (error) {
      if (!(error instanceof WasiExitError) || error.code !== 0) {
        throw error;
      }
    }
    return commandContext.wasi.stdout;
  }

  // --- Public API ---

  async function invokeRaw(requestBytes) {
    if (surface === "command") {
      return invokeCommandRaw(requestBytes);
    }
    return invokeDirectRaw(requestBytes);
  }

  async function invokeDirect(request) {
    if (surface !== "direct") {
      throw new Error(
        "Browser module harness direct invoke requires the direct surface.",
      );
    }
    if (request?.externalArena !== undefined) {
      const responseBytes = invokeDirectExternalArena(request);
      const { memory } = directInvokeRuntime();
      const externalArena = new Uint8Array(memory.buffer);
      assertModuleMemoryExternalArena(externalArena, memory);
      return decodePluginInvokeResponse(responseBytes, { externalArena });
    }
    const requestBytes = encodePluginInvokeRequest(request);
    const responseBytes = invokeDirectRaw(requestBytes);
    return decodePluginInvokeResponse(responseBytes);
  }

  async function invoke(request) {
    if (request?.externalArena !== undefined && surface === "direct") {
      return invokeDirect(request);
    }
    if (request?.externalArena !== undefined) {
      throw new Error(
        "Browser module harness externalArena invoke requires the direct surface.",
      );
    }
    const requestBytes = encodePluginInvokeRequest(request);
    const responseBytes = await invokeRaw(requestBytes);
    return decodePluginInvokeResponse(responseBytes);
  }

  async function callHost(operation, params = {}) {
    if (!dispatchHost) {
      throw new Error(
        "callHost is unavailable: this harness routes hostcalls through an external hostcallDispatch (no local host).",
      );
    }
    return dispatchHost(operation, params);
  }

  function readManifest() {
    const getBytesExport =
      instance.exports[DefaultManifestExports.pluginBytesSymbol];
    const getSizeExport =
      instance.exports[DefaultManifestExports.pluginSizeSymbol];
    if (!getBytesExport || !getSizeExport) return null;

    const ptr = getBytesExport();
    const size = getSizeExport();
    if (!ptr || !size) return null;

    if (!memory) return null;

    return new Uint8Array(memory.buffer, ptr, size).slice();
  }

  function destroy() {
    wasi.flushOutput();
  }

  return {
    runtime: {
      kind: "browser",
      profile,
      surface,
    },
    instance,
    module: wasmModule,
    host,
    bridge,
    wasi,
    memory,
    callHost,
    invokeDirect,
    invoke,
    invokeRaw,
    readManifest,
    destroy,
  };
}
