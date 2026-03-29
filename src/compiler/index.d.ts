export type {
  CompilationResult,
  GuestLinkArtifact,
  ModuleThreadModelName,
  ProtectedArtifact,
} from "../index.js";

export {
  cleanupCompilation,
  compileModuleFromSource,
  createRecipientKeypairHex,
  ModuleThreadModel,
  protectModuleArtifact,
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
