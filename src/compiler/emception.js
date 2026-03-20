import path from "node:path";

import {
  getSharedEmceptionController,
  loadEmception,
  runWithEmceptionLock,
} from "./emceptionNode.js";

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

function normalizeFileContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (content instanceof Uint8Array) {
    return content;
  }
  if (content instanceof ArrayBuffer) {
    return new Uint8Array(content);
  }
  if (ArrayBuffer.isView(content)) {
    return new Uint8Array(
      content.buffer,
      content.byteOffset,
      content.byteLength,
    );
  }
  throw new TypeError(
    "Emception file content must be a string, Uint8Array, ArrayBuffer, or ArrayBufferView.",
  );
}

function cloneReadBytes(value) {
  if (typeof value === "string") {
    return TEXT_ENCODER.encode(value);
  }
  const bytes = normalizeFileContent(value);
  return new Uint8Array(bytes);
}

function removeTree(emception, targetPath) {
  const analysis = emception.FS.analyzePath(targetPath);
  if (!analysis.exists) {
    return;
  }
  const stat = emception.FS.stat(targetPath);
  if (!emception.FS.isDir(stat.mode)) {
    emception.FS.unlink(targetPath);
    return;
  }
  const entries = emception.FS.readdir(targetPath).filter(
    (entry) => entry !== "." && entry !== "..",
  );
  for (const entry of entries) {
    removeTree(emception, path.posix.join(targetPath, entry));
  }
  emception.FS.rmdir(targetPath);
}

function normalizeRunResult(command, result) {
  const normalized = {
    command,
    exitCode: Number(result?.returncode ?? 0) >>> 0,
    stdout: String(result?.stdout ?? ""),
    stderr: String(result?.stderr ?? ""),
  };
  return normalized;
}

function maybeThrowRunFailure(result, options = {}) {
  if (options.throwOnNonZero === false || result.exitCode === 0) {
    return result;
  }
  const detail = result.stderr || result.stdout || "unknown emception failure";
  throw new Error(
    `Emception command failed with exit code ${result.exitCode}: ${result.command}\n${detail}`,
  );
}

class SharedEmceptionHandle {
  constructor(emception) {
    this.emception = emception;
  }

  getRaw() {
    return this.emception;
  }

  exists(targetPath) {
    return this.emception.FS.analyzePath(targetPath).exists;
  }

  mkdirTree(directoryPath) {
    this.emception.FS.mkdirTree(directoryPath);
  }

  writeFile(filePath, content) {
    this.emception.FS.mkdirTree(path.posix.dirname(filePath));
    this.emception.writeFile(filePath, normalizeFileContent(content));
  }

  writeFiles(rootDir, files) {
    for (const [relativePath, content] of Object.entries(files ?? {})) {
      this.writeFile(path.posix.join(rootDir, relativePath), content);
    }
  }

  readFile(filePath, options = {}) {
    const bytes = cloneReadBytes(this.emception.readFile(filePath));
    if (options.encoding === "utf8") {
      return TEXT_DECODER.decode(bytes);
    }
    return bytes;
  }

  removeTree(targetPath) {
    removeTree(this.emception, targetPath);
  }

  run(command, options = {}) {
    const result = normalizeRunResult(command, this.emception.run(command));
    return maybeThrowRunFailure(result, options);
  }
}

class SharedEmceptionSession {
  constructor(controller = getSharedEmceptionController()) {
    this.controller = controller;
  }

  async load() {
    return this.controller.load();
  }

  async withLock(task) {
    return this.controller.withLock(
      (emception) => task(new SharedEmceptionHandle(emception)),
    );
  }

  async exists(targetPath) {
    return this.withLock((handle) => handle.exists(targetPath));
  }

  async mkdirTree(directoryPath) {
    await this.withLock((handle) => {
      handle.mkdirTree(directoryPath);
    });
  }

  async writeFile(filePath, content) {
    await this.withLock((handle) => {
      handle.writeFile(filePath, content);
    });
  }

  async writeFiles(rootDir, files) {
    await this.withLock((handle) => {
      handle.writeFiles(rootDir, files);
    });
  }

  async readFile(filePath, options = {}) {
    return this.withLock((handle) => handle.readFile(filePath, options));
  }

  async removeTree(targetPath) {
    await this.withLock((handle) => {
      handle.removeTree(targetPath);
    });
  }

  async run(command, options = {}) {
    return this.withLock((handle) => handle.run(command, options));
  }
}

export function createSharedEmceptionSession() {
  return new SharedEmceptionSession();
}

export async function loadSharedEmception() {
  return loadEmception();
}

export async function withSharedEmception(task) {
  return runWithEmceptionLock(
    (emception) => task(new SharedEmceptionHandle(emception)),
  );
}
