// Flow-tier barrel: the compiled-artifact wasm host (Go-parity ABI), the
// pure-JS FlowProgram interpreter, the flow/StreamInvoke/PMAN codecs, and the
// dependency stream bridge. normalize.js and vendor/ are internal.
export { createFlowRuntimeHost } from "./flowRuntimeHost.js";
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
// The flow compiler (flow check/compile) is node-only (emception + fs) and
// ships on the dedicated "./flow/compiler" subpath to keep this barrel
// browser-safe.
