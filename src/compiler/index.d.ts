export type {
  CompilationResult,
  CompileCacheReport,
  GuestLinkArtifact,
  GuestLinkLibrary,
  ModuleLibrarySource,
  ModuleThreadModelName,
  ProtectedArtifact,
  Simd128Report,
} from "../index.js";

export {
  cleanupCompilation,
  compileModuleFromSource,
  createRecipientKeypairHex,
  deriveGuestLinkObject,
  ModuleThreadModel,
  pruneCompileCache,
  resolveCompileCacheRoot,
  writeGuestLinkFiles,
  protectModuleArtifact,
  getFlatbuffersCppRuntimeHeaders,
  getInvokeCppSchemaHeaders,
} from "../index.js";

export type {
  EmceptionCommandResult,
  SharedEmceptionFileContent,
  SharedEmceptionHandle,
  SharedEmceptionSession,
} from "./emception.js";

export {
  createIsolatedEmceptionSession,
  createSharedEmceptionSession,
  loadSharedEmception,
  withSharedEmception,
} from "./emception.js";

// --- Artifact guards (src/compiler/pthreadArtifactGuard.js, simdArtifactGuard.js) ---

type WasmBytes = Uint8Array | ArrayBuffer | ArrayBufferView;

/** One memory of a wasm module, imported or declared. */
export interface WasmMemoryLimits {
  source: "import" | "declared";
  /** Present for an imported memory. */
  module?: string;
  name?: string;
  flags: number;
  min: number;
  max: number | null;
  shared: boolean;
  growable: boolean;
}

/** What analyzeWasmThreadFeatures reads off a compiled artifact. */
export interface WasmThreadFeatures {
  hasSharedMemory: boolean;
  sharedMemory: WasmMemoryLimits | null;
  memories: WasmMemoryLimits[];
  usesAtomics: boolean;
  atomicInstructionCount: number;
  /** The names in the target_features section; null when the module has none. */
  declaredFeatures: string[] | null;
  isGrowableSharedMemory: boolean;
  hasWasiThreadSpawnImport: boolean;
  hasWasiThreadStartExport: boolean;
  emscriptenThreadHooks: string[];
  isIsomorphicPthreads: boolean;
}

export function analyzeWasmThreadFeatures(wasmBytes: WasmBytes): WasmThreadFeatures;
/** Throws unless the artifact is a real wasi-threads shared-memory/atomics module. */
export function assertPthreadArtifact(wasmBytes: WasmBytes, options?: { source?: string }): WasmThreadFeatures;
/** Throws unless the artifact is a self-contained wasi-sequential module built for the sanctioned target. */
export function assertSequentialArtifact(
  wasmBytes: WasmBytes,
  options?: { source?: string; target?: string },
): WasmThreadFeatures;
/** Throws when an assembled emscripten-pthreads final-link argument list lost a mandated flag. */
export function assertPthreadFlagsPresent(args: string[], context?: { threadModel?: string }): void;
/** Throws when an assembled wasi-sequential final-link argument list carries a thread-memory flag. */
export function assertSequentialFlagsAbsent(args: string[], context?: { threadModel?: string }): string[];
export const PTHREAD_FINAL_LINK_FLAGS: readonly string[];
export const SANCTIONED_WASI_TARGET: "wasm32-wasip1-threads";

/** What analyzeWasmSimdFeatures reads off a compiled artifact. */
export interface WasmSimdFeatures {
  /** target_features lists simd128 as used; null when the module has no target_features section. */
  declared: boolean | null;
  /** target_features lists relaxed-simd as used; null when the module has no target_features section. */
  declaredRelaxed: boolean | null;
  /** The code section holds fixed-width SIMD instructions. */
  used: boolean;
  instructionCount: number;
  /** SIMD instructions beyond the fixed-width set (relaxed-simd and later proposals). */
  relaxedInstructionCount: number;
  /** Function bodies the scanner could not decode; their instructions are not counted. */
  undecodableFunctions: number;
}

export function analyzeWasmSimdFeatures(wasmBytes: WasmBytes): WasmSimdFeatures;
/**
 * Hold an artifact's SIMD use to the build's declaration. Throws on relaxed-SIMD, on a function body
 * the scanner cannot decode, and on an opted-in build whose artifact does not declare simd128. SIMD
 * without the opt-in is returned as `undeclared` with a `warning`, not thrown (an error in a later release).
 */
export function assertSimdArtifact(
  wasmBytes: WasmBytes,
  options?: { optedIn?: boolean; source?: string },
): WasmSimdFeatures & { requested: boolean; undeclared: boolean; warning?: string };
/** The clang flag the `simd128` compile option adds to a module's own code. */
export const SIMD128_COMPILE_FLAG: "-msimd128";
/** The process warning code emitted for an artifact that carries SIMD its build did not declare. */
export const SIMD128_UNDECLARED_WARNING_CODE: "SDM_SIMD128_UNDECLARED";
