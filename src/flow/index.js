// Flow-tier barrel: the compiled-artifact wasm host (Go-parity ABI), the
// pure-JS FlowProgram interpreter, the flow/StreamInvoke/PMAN codecs, and the
// dependency stream bridge. normalize.js and vendor/ are internal.
export { FLOW_INVALID_INDEX, createFlowRuntimeHost } from "./flowRuntimeHost.js";
export { createIsomorphicFlowRuntimeHost } from "./isomorphicFlowHost.js";
export { FlowRuntime } from "./jsFlowRuntime.js";
export {
  decodeFlowProgram,
  encodeFlowProgram,
  decodePluginManifestPman,
  encodePluginManifestPman,
  decodeStreamInvokeRequest,
  encodeStreamInvokeRequest,
  decodeStreamInvokeResponse,
  encodeStreamInvokeResponse,
} from "./flowCodec.js";
export { createDependencyStreamBridge } from "./dependencyStreamBridge.js";
export {
  FLATSQL_LINK_SHIM_WASM,
  FLATSQL_ENGINE_IMPORT_MODULE,
  FLATSQL_LINK_IMPORT_MODULE,
  ENGINE_BODY_REF_TOKEN_MAGIC,
  ENGINE_REF_ENTRY_SIZE,
  buildFlatsqlLinkShimWasm,
  instantiateFlatsqlLinkShim,
  isEngineBodyRefToken,
  readEngineRefEntry,
} from "./flatsqlLinkShim.js";
// The flow compiler (flow check/compile) is node-only (emception + fs) and
// ships on the dedicated "./flow/compiler" subpath to keep this barrel
// browser-safe.
