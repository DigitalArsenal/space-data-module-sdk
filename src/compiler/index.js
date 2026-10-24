export {
  cleanupCompilation,
  compileModuleFromSource,
  createRecipientKeypairHex,
  deriveGuestLinkObject,
  ModuleThreadModel,
  protectModuleArtifact,
} from "./compileModule.js";

export {
  analyzeWasmThreadFeatures,
  assertPthreadArtifact,
  assertSequentialArtifact,
  assertSequentialFlagsAbsent,
  SANCTIONED_WASI_TARGET,
  assertPthreadFlagsPresent,
  PTHREAD_FINAL_LINK_FLAGS,
} from "./pthreadArtifactGuard.js";

export {
  analyzeWasmSimdFeatures,
  assertSimdArtifact,
  SIMD128_COMPILE_FLAG,
  SIMD128_UNDECLARED_WARNING_CODE,
} from "./simdArtifactGuard.js";

export { resolveWasiThreadsToolchain } from "./wasiThreadsToolchain.js";
export { writeGuestLinkFiles } from "./guestLinkFiles.js";

export {
  pruneCompileCache,
  resolveCompileCacheRoot,
} from "./compileCache.js";

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
