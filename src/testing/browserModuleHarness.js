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
  createJsonHostcallBridge,
  createAsyncHostDispatcher,
  createHostSyncDispatcher,
  DEFAULT_HOSTCALL_IMPORT_MODULE,
} from "../host/abi.js";
import {
  DefaultInvokeExports,
  DefaultManifestExports,
} from "../runtime/constants.js";
import {
  encodePluginInvokeRequest,
  decodePluginInvokeResponse,
} from "../invoke/codec.js";

const STANDALONE_SHARED_MEMORY_ENV_STUBS = Object.freeze({
  pthread_mutex_lock: () => 0,
  pthread_mutex_unlock: () => 0,
  pthread_cond_broadcast: () => 0,
  pthread_cond_wait: () => 0,
  emscripten_thread_sleep: () => {},
  __do_set_thread_state: () => {},
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
  if (source instanceof Response) {
    return WebAssembly.compileStreaming(source);
  }
  if (typeof source === "string") {
    return WebAssembly.compileStreaming(fetch(source));
  }
  const bytes = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
  return WebAssembly.compile(bytes);
}

const WASM_PAGE_BYTES = 65536;
const DEFAULT_IMPORTED_MEMORY_INITIAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_IMPORTED_MEMORY_MAXIMUM_BYTES = 2 * 1024 * 1024 * 1024;

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
    const dispatch = createHostSyncDispatcher(options.host);
    bridge = createJsonHostcallBridge({
      dispatch,
      getMemory: () => memory ?? instance?.exports?.memory,
    });
    Object.assign(importObject, bridge.imports);
  }

  instance = await WebAssembly.instantiate(options.wasmModule, importObject);
  memory = instance.exports.memory ?? providedMemory;
  if (memory) {
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
 * @param {string} [options.surface] - "direct" or "command" (default: auto-detect).
 * @param {WebAssembly.Memory} [options.wasmMemory] - Explicit imported memory.
 * @param {WebAssembly.Memory} [options.memory] - Alias for wasmMemory.
 * @param {boolean} [options.sharedMemory] - Create SharedArrayBuffer-backed imported memory.
 * @param {number} [options.initialMemoryBytes] - Initial imported memory size.
 * @param {number} [options.maximumMemoryBytes] - Maximum imported memory size.
 */
export async function createBrowserModuleHarness(options = {}) {
  const wasmModule = await compileWasmModule(options.wasmSource);
  const moduleImports = WebAssembly.Module.imports(wasmModule);
  const needsHostBridge = moduleImports.some(
    (entry) => entry.module === DEFAULT_HOSTCALL_IMPORT_MODULE,
  );
  const hostOptions =
    !options.host && needsHostBridge && !options.hostOptions?.wasmWallet
      ? {
          ...options.hostOptions,
          wasmWallet: await getWasmWallet(),
        }
      : options.hostOptions;
  const host = options.host ?? createBrowserHost(hostOptions);
  const dispatchHost = createAsyncHostDispatcher(host);

  const profile = detectArtifactProfile(wasmModule);
  const moduleExports = WebAssembly.Module.exports(wasmModule);
  const exportNames = new Set(moduleExports.map((e) => e.name));

  const hasDirectInvoke = exportNames.has(DefaultInvokeExports.invokeSymbol);
  const hasCommand = exportNames.has(DefaultInvokeExports.commandSymbol);
  const surface =
    options.surface ?? (hasDirectInvoke ? "direct" : hasCommand ? "command" : "direct");
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

  // --- Invoke helpers ---
  function invokeDirectRaw(requestBytes) {
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
    const reqLen = requestBytes.length;
    const reqPtr = alloc(reqLen);
    if (!reqPtr) throw new Error("plugin_alloc returned null for request.");

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

    const responseBytes = new Uint8Array(memory.buffer, resPtr, resLen).slice();
    free(resPtr, resLen);
    return responseBytes;
  }

  async function invokeCommandRaw(stdinBytes) {
    const commandContext = await instantiateBrowserModule({
      wasmModule,
      host,
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

  async function invoke(request) {
    const requestBytes = encodePluginInvokeRequest(request);
    const responseBytes = await invokeRaw(requestBytes);
    return decodePluginInvokeResponse(responseBytes);
  }

  async function callHost(operation, params = {}) {
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
    invoke,
    invokeRaw,
    readManifest,
    destroy,
  };
}
