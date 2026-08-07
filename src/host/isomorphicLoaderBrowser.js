/**
 * Isomorphic module loader — BROWSER leg.
 *
 * The target of the `browser` export condition on
 * `space-data-module-sdk/host/isomorphic`, and the loader re-exported by the
 * package's own `browser` entry (`src/browser.js`).
 *
 * Same public surface as the Node leg — `loadModule` and `inspectModule` — and
 * for a browser it does EXACTLY what the Node leg's `isBrowser` branch did
 * before the split: hand the artifact to `createBrowserModuleHarness`. What it
 * does not carry is the WasmEdge subprocess path, because a browser can never
 * take it and a bundler resolves it anyway.
 *
 * Asking this leg for a server runtime is a defect, not a fallback: it throws.
 * A caller that legitimately needs both is running under Node and resolves the
 * Node leg through the same subpath.
 */

import { createBrowserModuleHarness } from "./browserModuleHarness.js";
import { resolveModuleSignaturePolicy } from "../bundle/signing.js";
import { attachHostDispatch, inspectModule } from "./isomorphicLoaderCore.js";

export { inspectModule, attachHostDispatch };

/**
 * Load a WASM module in the browser.
 *
 * @param {Object} options - see the Node leg for the full option list; the
 *   browser leg accepts the same object and honours the browser-relevant keys.
 * @returns {Promise<Object>} Harness with invoke(), readManifest(), destroy().
 */
export async function loadModule(options = {}) {
  // Resolved for the same reason the Node leg resolves it: an invalid policy is
  // a caller error that must surface identically in every runtime, before any
  // artifact work happens.
  resolveModuleSignaturePolicy(options);

  const runtimeKind = options.runtimeKind;
  if (typeof runtimeKind === "string" && runtimeKind !== "browser") {
    throw new Error(
      `The browser isomorphic loader cannot run runtimeKind "${runtimeKind}"; ` +
        "that artifact must be loaded from a Node/WasmEdge host.",
    );
  }

  return createBrowserModuleHarness(options);
}
