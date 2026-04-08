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

  // --- Compile the module ---
  let wasmModule;
  const source = options.wasmSource;
  if (source instanceof WebAssembly.Module) {
    wasmModule = source;
  } else if (source instanceof Response) {
    wasmModule = await WebAssembly.compileStreaming(source);
  } else if (typeof source === "string") {
    wasmModule = await WebAssembly.compileStreaming(fetch(source));
  } else {
    const bytes =
      source instanceof ArrayBuffer ? new Uint8Array(source) : source;
    wasmModule = await WebAssembly.compile(bytes);
  }

  const profile = detectArtifactProfile(wasmModule);
  const moduleExports = WebAssembly.Module.exports(wasmModule);
  const exportNames = new Set(moduleExports.map((e) => e.name));

  const hasDirectInvoke = exportNames.has(DefaultInvokeExports.invokeSymbol);
  const hasCommand = exportNames.has(DefaultInvokeExports.commandSymbol);
  const surface =
    options.surface ?? (hasDirectInvoke ? "direct" : hasCommand ? "command" : "direct");

  // --- Build import object ---
  const wasi = createBrowserWasiShim({
    args: options.args ?? [],
    env: options.env ?? {},
  });

  const importObject = { ...wasi.imports };

  // Add sdn_host bridge if the module imports it
  let bridge = null;
  const moduleImports = WebAssembly.Module.imports(wasmModule);
  const needsHostBridge = moduleImports.some(
    (i) => i.module === DEFAULT_HOSTCALL_IMPORT_MODULE,
  );

  if (needsHostBridge) {
    const dispatch = createNodeHostSyncDispatcher(host);
    bridge = createJsonHostcallBridge({
      dispatch,
      getMemory: () => instance.exports.memory,
    });
    Object.assign(importObject, bridge.imports);
  }

  // --- Instantiate ---
  const { instance } = await WebAssembly.instantiate(wasmModule, importObject);
  wasi.setMemory(instance.exports.memory);

  // Call _initialize for WASI reactors (standalone modules that export it)
  if (instance.exports._initialize) {
    instance.exports._initialize();
  }

  // --- Invoke helpers ---

  const alloc = instance.exports[DefaultInvokeExports.allocSymbol];
  const free = instance.exports[DefaultInvokeExports.freeSymbol];
  const invokeStream = instance.exports[DefaultInvokeExports.invokeSymbol];
  const memory = () => instance.exports.memory;

  function invokeDirectRaw(requestBytes) {
    const reqLen = requestBytes.length;
    const reqPtr = alloc(reqLen);
    if (!reqPtr) throw new Error("plugin_alloc returned null for request.");

    new Uint8Array(memory().buffer, reqPtr, reqLen).set(requestBytes);

    // Allocate space for the response length output
    const outLenPtr = alloc(4);
    if (!outLenPtr) throw new Error("plugin_alloc returned null for response length.");

    new DataView(memory().buffer).setUint32(outLenPtr, 0, true);

    const resPtr = invokeStream(reqPtr, reqLen, outLenPtr);
    const resLen = new DataView(memory().buffer).getUint32(outLenPtr, true);

    free(reqPtr, reqLen);
    free(outLenPtr, 4);

    if (!resPtr || !resLen) {
      throw new Error("plugin_invoke_stream returned null response.");
    }

    const responseBytes = new Uint8Array(memory().buffer, resPtr, resLen).slice();
    free(resPtr, resLen);
    return responseBytes;
  }

  function invokeCommandRaw(stdinBytes) {
    // For command-surface modules, we re-instantiate with stdin piped in
    // This is a simplified approach; command modules read stdin and write stdout
    throw new Error(
      "Command-surface browser invoke requires module re-instantiation. " +
        "Use direct-surface modules for browser harness, or use the server-side harness.",
    );
  }

  // --- Public API ---

  function invokeRaw(requestBytes) {
    if (surface === "command") {
      return invokeCommandRaw(requestBytes);
    }
    return invokeDirectRaw(requestBytes);
  }

  function invoke(request) {
    const requestBytes = encodePluginInvokeRequest(request);
    const responseBytes = invokeRaw(requestBytes);
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

    return new Uint8Array(memory().buffer, ptr, size).slice();
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
