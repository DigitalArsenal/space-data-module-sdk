/**
 * Browser-side module harness.
 *
 * Loads the same standalone WASI .wasm artifact that WasmEdge runs,
 * instantiating it in the browser with the WASI shim + optional sdn_host
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
import {
  createJsonHostcallBridge,
  createNodeHostSyncDispatcher,
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

/**
 * Detect artifact profile from WebAssembly.Module imports.
 * Returns "standalone" (WASI-only), "sdn-abi" (WASI + sdn_host),
 * or "emscripten" (env.* with invoke trampolines).
 */
export function detectArtifactProfile(wasmModule) {
  const imports = WebAssembly.Module.imports(wasmModule);
  const moduleNames = new Set(imports.map((i) => i.module));

  if (moduleNames.has("env")) {
    const envImports = imports.filter((i) => i.module === "env");
    const hasInvokeTrampolines = envImports.some((i) => i.name.startsWith("invoke_"));
    const hasPthreads = envImports.some(
      (i) => i.name.includes("pthread") || i.name.includes("thread"),
    );
    if (hasInvokeTrampolines || hasPthreads) {
      return "emscripten";
    }
  }

  if (moduleNames.has(DEFAULT_HOSTCALL_IMPORT_MODULE)) {
    return "sdn-abi";
  }

  if (moduleNames.has("wasi_snapshot_preview1") || moduleNames.has("wasi_unstable")) {
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

async function instantiateBrowserModule(options = {}) {
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

  let instance = null;
  let bridge = null;
  if (needsHostBridge) {
    const dispatch = createNodeHostSyncDispatcher(options.host);
    bridge = createJsonHostcallBridge({
      dispatch,
      getMemory: () => instance.exports.memory,
    });
    Object.assign(importObject, bridge.imports);
  }

  instance = await WebAssembly.instantiate(options.wasmModule, importObject);
  if (instance.exports.memory) {
    wasi.setMemory(instance.exports.memory);
  }
  if (instance.exports._initialize) {
    instance.exports._initialize();
  }

  return {
    instance,
    bridge,
    wasi,
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
 */
export async function createBrowserModuleHarness(options = {}) {
  const host = options.host ?? createBrowserHost(options.hostOptions);
  const wasmModule = await compileWasmModule(options.wasmSource);

  const profile = detectArtifactProfile(wasmModule);
  const moduleExports = WebAssembly.Module.exports(wasmModule);
  const exportNames = new Set(moduleExports.map((e) => e.name));

  const hasDirectInvoke = exportNames.has(DefaultInvokeExports.invokeSymbol);
  const hasCommand = exportNames.has(DefaultInvokeExports.commandSymbol);
  const surface =
    options.surface ?? (hasDirectInvoke ? "direct" : hasCommand ? "command" : "direct");
  if (profile === "emscripten") {
    throw new Error(
      "Browser harness only supports standalone WASI or sdn_host artifacts. " +
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
  });
  const { instance, bridge, wasi } = activeContext;

  // --- Invoke helpers ---
  function invokeDirectRaw(requestBytes) {
    const alloc = instance.exports[DefaultInvokeExports.allocSymbol];
    const free = instance.exports[DefaultInvokeExports.freeSymbol];
    const invokeStream = instance.exports[DefaultInvokeExports.invokeSymbol];
    const memory = instance.exports.memory;
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

  function readManifest() {
    const getBytesExport =
      instance.exports[DefaultManifestExports.pluginBytesSymbol];
    const getSizeExport =
      instance.exports[DefaultManifestExports.pluginSizeSymbol];
    if (!getBytesExport || !getSizeExport) return null;

    const ptr = getBytesExport();
    const size = getSizeExport();
    if (!ptr || !size) return null;

    return new Uint8Array(instance.exports.memory.buffer, ptr, size).slice();
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
    invoke,
    invokeRaw,
    readManifest,
    destroy,
  };
}
