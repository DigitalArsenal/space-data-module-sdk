/**
 * Isomorphic module loader.
 *
 * Unified entry point that detects the runtime environment and artifact
 * profile, then loads the module through the appropriate path:
 *   - Browser: createBrowserModuleHarness (WASI shim + optional sdn_host)
 *   - Node/WasmEdge: createModuleHarness (subprocess)
 *
 * The same compiled .wasm artifact works in both environments.
 */

import {
  createBrowserModuleHarness,
  detectArtifactProfile,
} from "../testing/browserModuleHarness.js";

const isBrowser =
  typeof globalThis.window !== "undefined" &&
  typeof globalThis.document !== "undefined";

/**
 * Load a WASM module isomorphically.
 *
 * @param {Object} options
 * @param {Uint8Array|ArrayBuffer|Response|string|WebAssembly.Module} options.wasmSource
 *   The WASM artifact — same binary for all runtimes.
 * @param {Object} [options.host] - Host instance (BrowserHost or NodeHost).
 * @param {string[]} [options.args] - WASI args.
 * @param {Object} [options.env] - WASI environment variables.
 * @param {string} [options.surface] - "direct" or "command".
 * @param {Object} [options.runtimeHost] - Runtime host for row/region ops.
 * @returns {Promise<Object>} Harness with invoke(), readManifest(), destroy().
 */
export async function loadModule(options = {}) {
  if (isBrowser) {
    return createBrowserModuleHarness(options);
  }

  // Server-side: dynamically import the process-based harness
  const { createModuleHarness } = await import("../testing/moduleHarness.js");

  // If we got raw bytes/URL, we need to figure out the launch plan
  const source = options.wasmSource;
  let wasmPath;

  if (typeof source === "string") {
    // Assume it's a file path on the server side
    wasmPath = source;
  } else {
    throw new TypeError(
      "Server-side isomorphic loader expects a file path string for wasmSource.",
    );
  }

  const runtimeKind = options.runtimeKind ?? "wasmedge";

  return createModuleHarness({
    runtime: {
      kind: runtimeKind,
      command: runtimeKind === "wasmedge" ? "wasmedge" : "node",
      args:
        runtimeKind === "wasmedge"
          ? [wasmPath]
          : [wasmPath],
      hostProfile: options.hostProfile,
      modules: options.modules,
      defaultModuleId: options.defaultModuleId,
    },
  });
}

/**
 * Inspect a WASM module's artifact profile without instantiating it.
 *
 * @param {Uint8Array|ArrayBuffer|WebAssembly.Module} source
 * @returns {Promise<{profile: string, exports: string[], imports: Array}>}
 */
export async function inspectModule(source) {
  let wasmModule;
  if (source instanceof WebAssembly.Module) {
    wasmModule = source;
  } else {
    const bytes =
      source instanceof ArrayBuffer ? new Uint8Array(source) : source;
    wasmModule = await WebAssembly.compile(bytes);
  }

  const profile = detectArtifactProfile(wasmModule);
  const exports = WebAssembly.Module.exports(wasmModule).map((e) => e.name);
  const imports = WebAssembly.Module.imports(wasmModule);

  return { profile, exports, imports };
}
