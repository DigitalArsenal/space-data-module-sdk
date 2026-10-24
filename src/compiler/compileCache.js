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
export const COMPILE_CACHE_FORMAT = "sdm-compile-cache-v2";
// v2 (0.9.14): binary keys and a fixed binary entry layout. A v1 entry (0.9.12)
// has another magic and is a miss.
const ENTRY_MAGIC = new TextEncoder().encode("SDMCC2\n");
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

// A stable digest of a value made of null, booleans, numbers, strings, byte
// arrays, arrays and plain objects. Each field is fed into the sha256 as a type
// tag and length-prefixed bytes (object keys sorted, undefined members
// skipped), so distinct values never share an encoding.
const DIGEST_TAG = Object.freeze({ NULL: 0, FALSE: 1, TRUE: 2, NUMBER: 3, STRING: 4, BYTES: 5, ARRAY: 6, OBJECT: 7 });
const textEncoder = new TextEncoder();

function u32(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0, 0);
  return out;
}

function feedLengthPrefixed(hash, tag, bytes) {
  hash.update(Uint8Array.of(tag));
  hash.update(u32(bytes.length));
  hash.update(bytes);
}

function feedDigestValue(hash, value) {
  if (value === null || value === undefined) {
    hash.update(Uint8Array.of(DIGEST_TAG.NULL));
  } else if (typeof value === "boolean") {
    hash.update(Uint8Array.of(value ? DIGEST_TAG.TRUE : DIGEST_TAG.FALSE));
  } else if (typeof value === "number") {
    const bytes = Buffer.alloc(8);
    bytes.writeDoubleLE(value, 0);
    hash.update(Uint8Array.of(DIGEST_TAG.NUMBER));
    hash.update(bytes);
  } else if (typeof value === "string") {
    feedLengthPrefixed(hash, DIGEST_TAG.STRING, textEncoder.encode(value));
  } else if (value instanceof Uint8Array) {
    feedLengthPrefixed(hash, DIGEST_TAG.BYTES, value);
  } else if (Array.isArray(value)) {
    hash.update(Uint8Array.of(DIGEST_TAG.ARRAY));
    hash.update(u32(value.length));
    for (const item of value) feedDigestValue(hash, item);
  } else if (typeof value === "object") {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    hash.update(Uint8Array.of(DIGEST_TAG.OBJECT));
    hash.update(u32(keys.length));
    for (const key of keys) {
      feedLengthPrefixed(hash, DIGEST_TAG.STRING, textEncoder.encode(key));
      feedDigestValue(hash, value[key]);
    }
  } else {
    throw new TypeError(`digestOf cannot encode a ${typeof value}.`);
  }
}

export function digestOf(value) {
  const hash = createHash("sha256");
  feedDigestValue(hash, value);
  return hash.digest("hex");
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

// One entry, a fixed little-endian layout:
//
//   magic   "SDMCC2\n"
//   key     32 bytes (the sha256 key the entry is stored under)
//   u32     dependency count, then per dependency:
//             u32 path length, path (utf-8), f64 size, f64 mtimeMs, 32-byte sha256
//   u32     blob count, then per blob (sorted by name):
//             u16 name length, name (utf-8), u32 size, 32-byte sha256
//   blob bytes, in the same order
function encodeEntry(key, blobs, externalDeps = []) {
  const parts = [ENTRY_MAGIC, Buffer.from(key, "hex"), u32(externalDeps.length)];
  for (const dep of externalDeps) {
    const pathBytes = textEncoder.encode(dep.path);
    const stats = Buffer.alloc(16);
    stats.writeDoubleLE(dep.size, 0);
    stats.writeDoubleLE(dep.mtimeMs, 8);
    parts.push(u32(pathBytes.length), pathBytes, stats, Buffer.from(dep.sha256, "hex"));
  }
  const names = Object.keys(blobs).sort();
  parts.push(u32(names.length));
  for (const name of names) {
    const nameBytes = textEncoder.encode(name);
    const nameLength = Buffer.alloc(2);
    nameLength.writeUInt16LE(nameBytes.length, 0);
    parts.push(nameLength, nameBytes, u32(blobs[name].length), Buffer.from(sha256Hex(blobs[name]), "hex"));
  }
  return Buffer.concat([...parts, ...names.map((name) => blobs[name])]);
}

function decodeEntry(bytes) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  let offset = 0;
  const need = (count) => {
    if (offset + count > buffer.length) throw new RangeError("truncated cache entry");
  };
  need(ENTRY_MAGIC.length + 32);
  for (let index = 0; index < ENTRY_MAGIC.length; index += 1) {
    if (buffer[index] !== ENTRY_MAGIC[index]) return null;
  }
  offset = ENTRY_MAGIC.length;
  const key = buffer.subarray(offset, offset + 32).toString("hex");
  offset += 32;
  need(4);
  const depCount = buffer.readUInt32LE(offset);
  offset += 4;
  const externalDeps = [];
  for (let index = 0; index < depCount; index += 1) {
    need(4);
    const pathLength = buffer.readUInt32LE(offset);
    offset += 4;
    need(pathLength + 48);
    const depPath = buffer.subarray(offset, offset + pathLength).toString("utf8");
    offset += pathLength;
    const size = buffer.readDoubleLE(offset);
    const mtimeMs = buffer.readDoubleLE(offset + 8);
    const sha256 = buffer.subarray(offset + 16, offset + 48).toString("hex");
    offset += 48;
    externalDeps.push({ path: depPath, size, mtimeMs, sha256 });
  }
  need(4);
  const blobCount = buffer.readUInt32LE(offset);
  offset += 4;
  const index = [];
  for (let blob = 0; blob < blobCount; blob += 1) {
    need(2);
    const nameLength = buffer.readUInt16LE(offset);
    offset += 2;
    need(nameLength + 36);
    const name = buffer.subarray(offset, offset + nameLength).toString("utf8");
    offset += nameLength;
    const size = buffer.readUInt32LE(offset);
    const sha256 = buffer.subarray(offset + 4, offset + 36).toString("hex");
    offset += 36;
    index.push({ name, size, sha256 });
  }
  const blobs = {};
  for (const { name, size, sha256 } of index) {
    need(size);
    const blob = new Uint8Array(buffer.subarray(offset, offset + size));
    if (sha256Hex(blob) !== sha256) return null;
    blobs[name] = blob;
    offset += size;
  }
  if (offset !== buffer.length) return null;
  return { key, externalDeps, blobs };
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

  /** The stored entry for `key` ({ key, externalDeps, blobs }), or null. */
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
    if (!entry || entry.key !== key || !(await externalDependenciesUnchanged(entry.externalDeps))) {
      this.stats.misses += 1;
      return null;
    }
    // Recency for pruning; best effort.
    const now = new Date();
    await utimes(file, now, now).catch(() => {});
    this.stats.hits += 1;
    return entry;
  }

  /**
   * Store `blobs` ({ name: Uint8Array }) under `key`, atomically, with the
   * external header dependencies a lookup re-checks (`{ externalDeps }`).
   */
  async put(key, blobs, { externalDeps = [] } = {}) {
    const file = this.entryPath(key);
    const dir = path.dirname(file);
    try {
      await mkdir(dir, { recursive: true });
      const temp = path.join(dir, `.${key}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
      await writeFile(temp, encodeEntry(key, blobs, externalDeps));
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
    const packageJson = require(path.join(compilerDir, "..", "..", "package.json"));
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
  const cacheKey = ["native-clang", drivers.join("\u0001"), toolchainArgs.join("\u0001"), roots.join("\u0001")].join("\u0000");
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
  const cacheKey = ["system-emscripten", ...commands].join("\u0000");
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
          const pkg = require(path.join(packageRoot, "package.json"));
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
