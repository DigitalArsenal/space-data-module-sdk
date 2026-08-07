/**
 * `space-data-module-sdk/testing/browser` — browser-safe alias, kept honest.
 *
 * RULING 2026-08-07 (`orbpro-engine-bundle-ships-node-builtins`): `testing/*`
 * is HARNESS surface. Production browser code must NOT reach for it to load a
 * module. The two things callers actually wanted moved to runtime surfaces:
 *
 *   toLoadableWasmBytes, ... -> space-data-module-sdk/bundle
 *   createBrowserModuleHarness,
 *   createWorkerModuleHarness,
 *   detectArtifactProfile,
 *   zeroWasmBytes             -> space-data-module-sdk/host/browser-module
 *
 * This file exists so that subpath stays browser-SAFE for the tests and
 * consumers still pointed at it: it re-exports the runtime surfaces and nothing
 * else. It can never reach a Node harness again — the whole `src/testing/`
 * neighbourhood is off the browser graph now, and
 * test/browser-reachable-node-builtins.test.js plus
 * test/browser-bundle-node-builtins.test.js enforce that at module level AND at
 * bundled-artifact level, with no exception list.
 *
 * New browser code: import from the runtime subpaths above.
 */

export {
  createBrowserModuleHarness,
  detectArtifactProfile,
  toLoadableWasmBytes,
  zeroWasmBytes,
  isSharedArrayBufferLike,
} from "../host/browserModuleHarness.js";
export { createWorkerModuleHarness } from "../host/workerModuleHarness.js";
