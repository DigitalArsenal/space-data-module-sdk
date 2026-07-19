export {
  cleanupCompilation,
  compileModuleFromSource,
  createRecipientKeypairHex,
  ModuleThreadModel,
  protectModuleArtifact,
} from "./compileModule.js";

export {
  analyzeWasmThreadFeatures,
  assertPthreadArtifact,
  assertPthreadFlagsPresent,
  PTHREAD_FINAL_LINK_FLAGS,
} from "./pthreadArtifactGuard.js";

export { resolveWasiThreadsToolchain } from "./wasiThreadsToolchain.js";

export {
  getFlatbuffersCppRuntimeHeaders,
  getInvokeCppSchemaHeaders,
} from "./flatcSupport.js";

export {
  createIsolatedEmceptionSession,
  createSharedEmceptionSession,
  loadSharedEmception,
  withSharedEmception,
} from "./emception.js";
export { generateLegacySdnShimSource } from "./sdnShimGenerator.js";
