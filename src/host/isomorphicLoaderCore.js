/**
 * Isomorphic loader — the runtime-independent half.
 *
 * Everything here is byte-identical work that every runtime does: reduce the
 * artifact, compile it, read its profile/exports/imports, attach the host
 * dispatcher. `isomorphicLoader.js` (Node/WasmEdge) and
 * `isomorphicLoaderBrowser.js` (browser) both build on this, so the two legs of
 * `./host/isomorphic` cannot drift apart on the parts that must not differ.
 *
 * The split exists because a browser BUNDLER resolves every branch statically:
 * one file holding both legs put node:child_process/os/path/fs into every
 * browser bundle of the SDK's own `browser` export condition
 * (`module-sdk-browser-entry-node-builtins`). The runtime difference is now
 * absorbed by the package's export conditions — a host-shim concern — instead
 * of by a runtime check inside one file.
 */

import { detectArtifactProfile } from "./browserModuleHarness.js";
import { createAsyncHostDispatcher } from "./abi.js";
import { toLoadableWasmBytes } from "../bundle/artifactBytes.js";

export function attachHostDispatch(harness, host) {
  if (!host || typeof host !== "object") {
    return harness;
  }
  const dispatchHost = createAsyncHostDispatcher(host);
  return {
    ...harness,
    host,
    async callHost(operation, params = {}) {
      return dispatchHost(operation, params);
    },
  };
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
    // Tolerate signed/published artifacts (appended publication records).
    wasmModule = await WebAssembly.compile(toLoadableWasmBytes(bytes));
  }

  const profile = detectArtifactProfile(wasmModule);
  const exports = WebAssembly.Module.exports(wasmModule).map((e) => e.name);
  const imports = WebAssembly.Module.imports(wasmModule);

  return { profile, exports, imports };
}
