export * from "./manifest/browser.js";
export * from "./auth/index.js";
export * from "./transport/index.js";
export * from "./licensing/index.js";
export * from "./bundle/index.js";
export * from "./capabilities.js";
export * from "./deployment/index.js";
export * from "./invoke/index.js";
export * from "./runtime/index.js";
export * from "./runtime-host/index.js";
export * from "./host/browserHost.js";
export * from "./host/browserEdgeShims.js";
export * from "./host/wasiShim.js";
export * from "./host/abi.js";
export * from "./host/sabHostcallChannel.js";
export * from "./host/timerDriver.js";
export * from "./flow/index.js";
export * from "./compat/index.js";
// The browser leg of `./host/isomorphic`. NEVER isomorphicLoader.js: that is
// the Node leg, and a bundler resolves its node:* branches even though a
// browser can never take them.
export * from "./host/isomorphicLoaderBrowser.js";
// Browser module hosts. These are runtime surface and live in src/host/;
// nothing under src/testing/ is reachable from this entry.
export {
  assertBrowserRuntimeTarget,
  createBrowserModuleHarness,
  detectArtifactProfile,
  zeroWasmBytes,
  isSharedArrayBufferLike,
} from "./host/browserModuleHarness.js";
// The runtime-target gate is reachable so a consumer can catch the refusal by
// CLASS (`error instanceof RuntimeTargetError`) rather than by matching a
// message string, and can ask the same question the loaders ask before it
// offers a module to a leg.
export {
  RuntimeTargetError,
  runtimeTargetSatisfies,
  resolveRuntimeTargetRefusal,
  embeddedRuntimeTargets,
} from "./host/runtimeTargetGate.js";
export { createWorkerModuleHarness } from "./host/workerModuleHarness.js";
export { createModuleFlatBufferStreamPump } from "./host/moduleFlatbufferStreamPump.js";
