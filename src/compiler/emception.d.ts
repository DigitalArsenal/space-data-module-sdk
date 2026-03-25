export interface EmceptionCommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type SharedEmceptionFileContent =
  | string
  | Uint8Array
  | ArrayBuffer
  | ArrayBufferView;

export interface SharedEmceptionHandle {
  getRaw(): unknown;
  exists(targetPath: string): boolean;
  mkdirTree(directoryPath: string): void;
  writeFile(filePath: string, content: SharedEmceptionFileContent): void;
  writeFiles(
    rootDir: string,
    files: Record<string, SharedEmceptionFileContent>,
  ): void;
  readFile(filePath: string): Uint8Array;
  readFile(filePath: string, options: { encoding: "utf8" }): string;
  removeTree(targetPath: string): void;
  run(
    command: string,
    options?: { throwOnNonZero?: boolean },
  ): EmceptionCommandResult;
}

export interface SharedEmceptionSession {
  load(): Promise<unknown>;
  withLock<T>(
    task: (handle: SharedEmceptionHandle) => T | Promise<T>,
  ): Promise<T>;
  exists(targetPath: string): Promise<boolean>;
  mkdirTree(directoryPath: string): Promise<void>;
  writeFile(
    filePath: string,
    content: SharedEmceptionFileContent,
  ): Promise<void>;
  writeFiles(
    rootDir: string,
    files: Record<string, SharedEmceptionFileContent>,
  ): Promise<void>;
  readFile(filePath: string): Promise<Uint8Array>;
  readFile(filePath: string, options: { encoding: "utf8" }): Promise<string>;
  removeTree(targetPath: string): Promise<void>;
  run(
    command: string,
    options?: { throwOnNonZero?: boolean },
  ): Promise<EmceptionCommandResult>;
}

export function createSharedEmceptionSession(): SharedEmceptionSession;
export function createIsolatedEmceptionSession(): SharedEmceptionSession;
export function loadSharedEmception(): Promise<unknown>;
export function withSharedEmception<T>(
  task: (handle: SharedEmceptionHandle) => T | Promise<T>,
): Promise<T>;
