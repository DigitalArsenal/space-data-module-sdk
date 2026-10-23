// Content-addressed compile cache.
//
// Every compile and link step of compileModuleFromSource (and of the
// precompiled headers and library objects it builds) is keyed on what decides
// its output:
//
//   - the input bytes: the translation unit, every header the SDK stages beside
//     it, and every other header the compiler read (recorded from its depfile
//     and checked again on each lookup: path, size, mtime, and sha256 when the
//     stat differs);
//   - the exact command and flags (temp-dir paths normalized away);
//   - the toolchain identity (driver, version, binary and sysroot stats, or the
//     emception package fingerprint);
//   - the SDK identity (package version and the bytes of src/compiler/*.js).
//
// A hit returns the stored output bytes without starting a toolchain. Entries
// are single files written to a temp name and renamed into place, so any number
// of concurrent builds can share one cache: a reader sees a complete entry or
// none, and every blob is checked against its sha256 before it is used.
//
// Location: SPACE_DATA_MODULE_SDK_CACHE_DIR, else $XDG_CACHE_HOME/space-data-module-sdk,
// else ~/.cache/space-data-module-sdk. SPACE_DATA_MODULE_SDK_COMPILE_CACHE=0 (or
// off/false/no) or the compile option `compileCache: false` turns it off.

import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

// Bump when the entry layout or the meaning of a key changes.
export const COMPILE_CACHE_FORMAT = "sdm-compile-cache-v1";
const ENTRY_MAGIC = new TextEncoder().encode("SDMCC1\n");
const ENTRY_SUFFIX = ".entry";
const DISABLED_VALUES = new Set(["0", "off", "false", "no", "disabled"]);
const DEFAULT_MAX_BYTES = 4 * 1024 ** 3;

export function resolveCompileCacheRoot(explicitDir) {
  if (explicitDir) return path.resolve(explicitDir);
  if (process.env.SPACE_DATA_MODULE_SDK_CACHE_DIR) {
    return path.resolve(process.env.SPACE_DATA_MODULE_SDK_CACHE_DIR);
  }
  const base = process.env.XDG_CACHE_HOME
    ? path.resolve(process.env.XDG_CACHE_HOME)
    : path.join(os.homedir(), ".cache");
  return path.join(base, "space-data-module-sdk");
}

/**
 * Resolve the compile option `compileCache` (`undefined`, `true`, `false`, or
 * `{ dir }`) and the environment into a cache handle, or null when caching is
 * off.
 */
export function openCompileCache(option) {
  if (option === false) return null;
  const envSetting = String(process.env.SPACE_DATA_MODULE_SDK_COMPILE_CACHE ?? "").trim().toLowerCase();
  if (option === undefined || option === null || option === true) {
    if (DISABLED_VALUES.has(envSetting)) return null;
  }
  const dir = typeof option === "object" && option !== null ? option.dir : undefined;
  return new CompileCache(resolveCompileCacheRoot(dir));
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// A stable digest of a JSON-able value (object keys sorted).
export function digestOf(value) {
  return sha256Hex(stableStringify(value));
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function toBytes(content) {
  if (content instanceof Uint8Array) return content;
  return new TextEncoder().encode(String(content));
}

// The digest of a set of named files ({ relativePath: string | Uint8Array }).
export function digestFiles(files) {
  const hash = createHash("sha256");
  for (const name of Object.keys(files).sort()) {
    const bytes = toBytes(files[name]);
    hash.update(`${name}\0${bytes.length}\0`);
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function encodeEntry(meta, blobs) {
  const names = Object.keys(blobs).sort();
  const header = {
    format: COMPILE_CACHE_FORMAT,
    meta,
    blobs: names.map((name) => ({ name, size: blobs[name].length, sha256: sha256Hex(blobs[name]) })),
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const lengthBytes = new Uint8Array(4);
  new DataView(lengthBytes.buffer).setUint32(0, headerBytes.length, true);
  return Buffer.concat([ENTRY_MAGIC, lengthBytes, headerBytes, ...names.map((name) => blobs[name])]);
}

function decodeEntry(bytes) {
  if (bytes.length < ENTRY_MAGIC.length + 4) return null;
  for (let index = 0; index < ENTRY_MAGIC.length; index += 1) {
    if (bytes[index] !== ENTRY_MAGIC[index]) return null;
  }
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset + ENTRY_MAGIC.length, 4).getUint32(0, true);
  const headerStart = ENTRY_MAGIC.length + 4;
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(headerStart, headerStart + headerLength)));
  if (header?.format !== COMPILE_CACHE_FORMAT || !Array.isArray(header.blobs)) return null;
  const blobs = {};
  let offset = headerStart + headerLength;
  for (const { name, size, sha256 } of header.blobs) {
    const blob = new Uint8Array(bytes.subarray(offset, offset + size));
    if (blob.length !== size || sha256Hex(blob) !== sha256) return null;
    blobs[name] = blob;
    offset += size;
  }
  if (offset !== bytes.length) return null;
  return { meta: header.meta ?? {}, blobs };
}

// Header dependencies outside the staged build dir: each is recorded with its
// size, mtime and sha256, and a lookup accepts the entry only while every one
// still has those bytes (a changed stat is re-hashed, so a touch is no miss).
export async function describeExternalDependencies(paths) {
  const unique = Array.from(new Set(paths)).sort();
  const deps = [];
  for (const file of unique) {
    const info = await stat(file);
    if (!info.isFile()) continue;
    deps.push({ path: file, size: info.size, mtimeMs: info.mtimeMs, sha256: sha256Hex(await readFile(file)) });
  }
  return deps;
}

async function externalDependenciesUnchanged(deps) {
  for (const dep of Array.isArray(deps) ? deps : []) {
    let info;
    try {
      info = await stat(dep.path);
    } catch {
      return false;
    }
    if (info.size === dep.size && info.mtimeMs === dep.mtimeMs) continue;
    if (info.size !== dep.size) return false;
    try {
      if (sha256Hex(await readFile(dep.path)) !== dep.sha256) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Parse a Makefile-style depfile (clang -MD -MF) into its prerequisite paths.
 */
export function parseDepfile(text) {
  const joined = String(text).replace(/\\\r?\n/g, " ");
  const colon = joined.search(/:(\s|$)/);
  const body = colon >= 0 ? joined.slice(colon + 1) : joined;
  const paths = [];
  let current = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "\\" && body[index + 1] === " ") {
      current += " ";
      index += 1;
    } else if (char === "$" && body[index + 1] === "$") {
      current += "$";
      index += 1;
    } else if (/\s/.test(char)) {
      if (current) paths.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) paths.push(current);
  return paths;
}

export class CompileCache {
  constructor(root) {
    this.root = root;
    this.entriesDir = path.join(root, "entries");
    this.stats = { hits: 0, misses: 0, stores: 0 };
  }

  entryPath(key) {
    return path.join(this.entriesDir, key.slice(0, 2), `${key}${ENTRY_SUFFIX}`);
  }

  /** The stored entry for `key` ({ meta, blobs }), or null. */
  async get(key) {
    const file = this.entryPath(key);
    let bytes;
    try {
      bytes = await readFile(file);
    } catch {
      this.stats.misses += 1;
      return null;
    }
    let entry = null;
    try {
      entry = decodeEntry(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
    } catch {
      entry = null;
    }
    if (!entry || entry.meta?.key !== key || !(await externalDependenciesUnchanged(entry.meta?.externalDeps))) {
      this.stats.misses += 1;
      return null;
    }
    // Recency for pruning; best effort.
    const now = new Date();
    await utimes(file, now, now).catch(() => {});
    this.stats.hits += 1;
    return entry;
  }

  /** Store `blobs` ({ name: Uint8Array }) under `key`, atomically. */
  async put(key, blobs, meta = {}) {
    const file = this.entryPath(key);
    const dir = path.dirname(file);
    try {
      await mkdir(dir, { recursive: true });
      const temp = path.join(dir, `.${key}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
      await writeFile(temp, encodeEntry({ ...meta, key }, blobs));
      try {
        await rename(temp, file);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
      this.stats.stores += 1;
    } catch {
      // A cache that cannot be written (read-only home, full disk) never fails a build.
      return;
    }
    await autoPrune(this.root);
  }
}

// Once per process, after its first store: keep the cache under
// SPACE_DATA_MODULE_SDK_CACHE_MAX_BYTES (default 4 GiB), least recently used first.
const prunedRoots = new Set();
async function autoPrune(root) {
  if (prunedRoots.has(root)) return;
  prunedRoots.add(root);
  const configured = Number(process.env.SPACE_DATA_MODULE_SDK_CACHE_MAX_BYTES);
  const maxBytes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES;
  await pruneCompileCache({ dir: root, maxBytes }).catch(() => {});
}

/**
 * Remove least-recently-used entries until the cache holds at most `maxBytes`
 * (default 4 GiB), and any temp file older than an hour. Returns
 * { removedEntries, removedBytes, keptBytes }.
 */
export async function pruneCompileCache({ dir, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const root = resolveCompileCacheRoot(dir);
  const entriesDir = path.join(root, "entries");
  const files = [];
  let shards = [];
  try {
    shards = await readdir(entriesDir);
  } catch {
    return { removedEntries: 0, removedBytes: 0, keptBytes: 0 };
  }
  const hourAgo = Date.now() - 3600 * 1000;
  for (const shard of shards) {
    const shardDir = path.join(entriesDir, shard);
    let names = [];
    try {
      names = await readdir(shardDir);
    } catch {
      continue;
    }
    for (const name of names) {
      const file = path.join(shardDir, name);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) continue;
      if (name.endsWith(".tmp")) {
        if (info.mtimeMs < hourAgo) await rm(file, { force: true });
        continue;
      }
      files.push({ file, size: info.size, mtimeMs: info.mtimeMs });
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  let kept = 0;
  let removedEntries = 0;
  let removedBytes = 0;
  for (const entry of files) {
    if (kept + entry.size <= maxBytes) {
      kept += entry.size;
      continue;
    }
    await rm(entry.file, { force: true });
    removedEntries += 1;
    removedBytes += entry.size;
  }
  return { removedEntries, removedBytes, keptBytes: kept };
}

// --- identities ------------------------------------------------------------

let sdkIdentityPromise = null;

/**
 * The SDK half of every key: the package version and the bytes of the compiler
 * sources (so an unreleased edit of the compile pipeline never reuses entries).
 */
export function getSdkCompileIdentity() {
  sdkIdentityPromise ??= (async () => {
    const compilerDir = path.dirname(fileURLToPath(import.meta.url));
    const packageJson = JSON.parse(
      await readFile(path.join(compilerDir, "..", "..", "package.json"), "utf8"),
    );
    const files = {};
    for (const name of (await readdir(compilerDir)).filter((entry) => entry.endsWith(".js")).sort()) {
      files[name] = await readFile(path.join(compilerDir, name));
    }
    return { sdkVersion: String(packageJson.version), compilerSources: digestFiles(files) };
  })();
  return sdkIdentityPromise;
}

async function statIdentity(file) {
  try {
    const resolved = await realpath(file);
    const info = await stat(resolved);
    return { path: resolved, size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return { path: file, missing: true };
  }
}

async function whichExecutable(command) {
  if (command.includes("/")) return command;
  for (const dir of String(process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // keep looking
    }
  }
  return command;
}

const toolchainIdentityCache = new Map();

/**
 * Identity of a native clang driver (the wasi toolchain): its --version text,
 * the resolved driver and clang binary (path, size, mtime), and the given
 * toolchain args and roots (sysroot, resource dir) with stats of their
 * libraries.
 */
export function getNativeClangIdentity({ drivers, toolchainArgs = [], roots = [] }) {
  const cacheKey = JSON.stringify({ drivers, toolchainArgs, roots });
  if (!toolchainIdentityCache.has(cacheKey)) {
    toolchainIdentityCache.set(cacheKey, (async () => {
      const driverIds = [];
      for (const driver of drivers) {
        const { stdout } = await execFileAsync(driver, ["--version"], { maxBuffer: 1024 * 1024 });
        const installedDir = /InstalledDir:\s*(.+)/.exec(stdout)?.[1]?.trim();
        driverIds.push({
          driver: await statIdentity(await whichExecutable(driver)),
          version: stdout.trim(),
          clang: installedDir ? await statIdentity(path.join(installedDir, "clang")) : null,
        });
      }
      const rootIds = [];
      for (const root of roots.filter(Boolean)) {
        rootIds.push({ root, libs: await describeLibraries(root) });
      }
      return digestOf({ kind: "native-clang", driverIds, toolchainArgs, rootIds });
    })());
  }
  return toolchainIdentityCache.get(cacheKey);
}

// Stats of the static libraries under a toolchain root (libc, libc++, compiler-rt):
// a reinstall that changes them changes the identity.
async function describeLibraries(root) {
  const out = [];
  const walk = async (dir, depth) => {
    if (depth > 4) return;
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.name.endsWith(".a")) {
        const info = await stat(full).catch(() => null);
        if (info) out.push([path.relative(root, full), info.size, info.mtimeMs]);
      }
    }
  };
  await walk(path.join(root, "lib"), 0);
  return out;
}

/** Identity of a system Emscripten (em++ / emcc on PATH). */
export function getSystemEmscriptenIdentity(commands) {
  const cacheKey = JSON.stringify({ emscripten: commands });
  if (!toolchainIdentityCache.has(cacheKey)) {
    toolchainIdentityCache.set(cacheKey, (async () => {
      const ids = [];
      for (const command of commands) {
        const { stdout } = await execFileAsync(command, ["--version"], { maxBuffer: 1024 * 1024 });
        ids.push({ command: await statIdentity(await whichExecutable(command)), version: stdout.trim() });
      }
      return digestOf({ kind: "system-emscripten", ids, emsdk: process.env.EMSDK ?? null });
    })());
  }
  return toolchainIdentityCache.get(cacheKey);
}

/**
 * Identity of the vendored sdn-emception: its package version and the path,
 * size and mtime of every file it ships (a stat walk, not a hash of 160 MB).
 */
export function getEmceptionPackageIdentity(extra = "") {
  const cacheKey = `emception\0${extra}`;
  if (!toolchainIdentityCache.has(cacheKey)) {
    toolchainIdentityCache.set(cacheKey, (async () => {
      const root = path.dirname(require.resolve("sdn-emception"));
      let packageRoot = root;
      let version = "unknown";
      for (;;) {
        try {
          const pkg = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
          if (pkg?.name === "sdn-emception") {
            version = String(pkg.version);
            break;
          }
        } catch {
          // keep walking up
        }
        const parent = path.dirname(packageRoot);
        if (parent === packageRoot) break;
        packageRoot = parent;
      }
      const files = [];
      const walk = async (dir) => {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) await walk(full);
          else if (entry.isFile()) {
            const info = await stat(full);
            files.push([path.relative(root, full), info.size, info.mtimeMs]);
          }
        }
      };
      await walk(root);
      return digestOf({ kind: "emception", version, files, extra });
    })());
  }
  return toolchainIdentityCache.get(cacheKey);
}
