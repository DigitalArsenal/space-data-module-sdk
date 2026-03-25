export type {
  CompilationResult,
  ProtectedArtifact,
} from "../index.js";

export {
  cleanupCompilation,
  compileModuleFromSource,
  createRecipientKeypairHex,
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
