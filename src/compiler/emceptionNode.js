import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import {
  cp,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants, createReadStream, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
// Bump when the patched tree's layout or meaning changes. The patch transform's
// own source text is part of the cache key as well (see
// computeEmceptionIdentity), so editing patchEmceptionModuleSource cannot reuse
// a tree patched by an older transform even if this string is left alone.
const PATCH_VERSION = "space-data-module-sdk-emception-node-v1";
const PATCH_KEY_TAG = "node-v1";
const PATCH_MARKER_FILENAME = ".space-data-module-sdk-emception-patch";
// One shared root per (patch, emception build) lives at
// <tmpdir>/space-data-module-sdk-emception-<tag>-<version>-<fingerprint>-u<uid>.
// Every process of every consumer run by that user reuses it. Builds happen in a sibling
// staging dir that is renamed into place only once it is complete.
const PATCHED_ROOT_PREFIX = "space-data-module-sdk-emception-";
const STAGING_MARKER = ".staging-";
const STALE_MARKER = ".stale-";
const ORPHAN_NAME_PATTERN = new RegExp(
  `^${PATCHED_ROOT_PREFIX.replaceAll("-", "\\-")}.+\\.(?:staging|stale)-(\\d+)-[A-Za-z0-9]+$`,
);
const RENAME_COLLISION_CODES = new Set(["ENOTEMPTY", "EEXIST", "EPERM", "EBUSY"]);
const MAX_PUBLISH_ATTEMPTS = 4;
const FILE_URL_FETCH_PATCH_FLAG =
  "__spaceDataModuleSdkFileUrlFetchPatched";

let patchedEmceptionRootPromise = null;

function installNodeRuntimeShims() {
  if (typeof globalThis.require !== "function") {
    globalThis.require = require;
  }

  if (!globalThis.XMLHttpRequest) {
    class FileUrlXMLHttpRequest {
      open(method, url, async = true) {
        this.method = method;
        this.url = url;
        this.async = async;
        this.status = 0;
        this.response = null;
      }

      overrideMimeType() {}

      send() {
        if (this.async) {
          throw new Error("Async file XMLHttpRequest is not supported.");
        }
        const target =
          typeof this.url === "string" && this.url.startsWith("file:")
            ? new URL(this.url)
            : this.url;
        const data = readFileSync(target);
        this.status = 200;
        this.response = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        );
      }
    }

    globalThis.XMLHttpRequest = FileUrlXMLHttpRequest;
  }

  if (!globalThis[FILE_URL_FETCH_PATCH_FLAG]) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input?.url ?? String(input);
      if (!url.startsWith("file:")) {
        if (typeof originalFetch !== "function") {
          throw new Error("fetch is not available for non-file URLs.");
        }
        return originalFetch(input, init);
      }
      const bytes = await readFile(new URL(url));
      return {
        ok: true,
        status: 200,
        url,
        async arrayBuffer() {
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          );
        },
      };
    };
    globalThis[FILE_URL_FETCH_PATCH_FLAG] = true;
  }
}

// Pure transform of one emception .mjs file. Its source text is hashed into
// the cache key, so any edit here yields a fresh patched root.
function patchEmceptionModuleSource(fileName, source) {
  let patched = source.replaceAll(
    'scriptDirectory=__dirname+"/"',
    'scriptDirectory=(new URL(".", import.meta.url)).pathname',
  );

  if (fileName === "emception.mjs") {
    patched = patched.replace(
      "this.#fs = await new FileSystem();",
      [
        "this.#fs = await new FileSystem({",
        "      locateFile: (file, scriptDirectory) => scriptDirectory + file,",
        '      cache: "/tmp/emception-cache",',
        "    });",
      ].join("\n"),
    );
    patched = patched.replace(
      "const config = {",
      [
        "const config = {",
        "      locateFile: (file, scriptDirectory) => scriptDirectory + file,",
      ].join("\n"),
    );
  }

  if (fileName === "FileSystem.mjs") {
    patched = patched.replace(
      [
        "        if (!this.exists(cache)) {",
        "            this.persist(cache);",
        "        }",
        "        await this.pull();",
      ].join("\n"),
      [
        '        if (typeof indexedDB !== "undefined") {',
        "            if (!this.exists(cache)) {",
        "                this.persist(cache);",
        "            }",
        "            await this.pull();",
        "        }",
      ].join("\n"),
    );
  }

  return patched;
}

// Relative POSIX paths of every regular file under rootDir, sorted.
async function listTreeFiles(rootDir, relativeDir = "") {
  const entries = await readdir(path.join(rootDir, relativeDir), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries) {
    const relativePath = relativeDir
      ? path.posix.join(relativeDir, entry.name)
      : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listTreeFiles(rootDir, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort();
}

async function patchEmceptionModuleTree(rootDir, files) {
  for (const relativePath of files) {
    if (!relativePath.endsWith(".mjs")) {
      continue;
    }
    const fullPath = path.join(rootDir, relativePath);
    const source = await readFile(fullPath, "utf8");
    const patched = patchEmceptionModuleSource(
      path.posix.basename(relativePath),
      source,
    );
    if (patched !== source) {
      await writeFile(fullPath, patched, "utf8");
    }
  }
}

async function readEmceptionPackageVersion(sourceRoot) {
  let directory = sourceRoot;
  for (;;) {
    try {
      const packageJson = JSON.parse(
        await readFile(path.join(directory, "package.json"), "utf8"),
      );
      if (packageJson?.name === "sdn-emception") {
        return String(packageJson.version ?? "unknown");
      }
    } catch {
      // Keep walking up.
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return "unknown";
    }
    directory = parent;
  }
}

// The cache key: the patch version, the patch transform, the emception
// package version, and a sha256 over every source file's path, size and
// bytes. Two installs with the same version but different bytes never share
// a root.
async function computeEmceptionIdentity(sourceRoot) {
  const version = await readEmceptionPackageVersion(sourceRoot);
  const files = await listTreeFiles(sourceRoot);
  const hash = createHash("sha256");
  hash.update(`${PATCH_VERSION}\0${patchEmceptionModuleSource.toString()}\0`);
  hash.update(`${version}\0`);
  for (const relativePath of files) {
    const fullPath = path.join(sourceRoot, relativePath);
    const { size } = await stat(fullPath);
    hash.update(`${relativePath}\0${size}\0`);
    for await (const chunk of createReadStream(fullPath)) {
      hash.update(chunk);
    }
    hash.update("\0");
  }
  const fingerprint = hash.digest("hex");
  const safeVersion = version.replace(/[^A-Za-z0-9._]/g, "_");
  // Per user: where the tmp dir is shared (Linux /tmp), users never collide.
  const uid = currentUid();
  return {
    version,
    fingerprint,
    files,
    key: `${PATCH_KEY_TAG}-${safeVersion}-${fingerprint.slice(0, 16)}${uid === null ? "" : `-u${uid}`}`,
  };
}

// The content check on reuse. The marker is written last inside the staging
// dir, so a published root always has one; this also catches a root whose
// files were later deleted or truncated (tmp cleaners purge by age).
async function isPatchedRootValid(rootDir, identity) {
  // The root is imported as code, so it must be a real directory that this
  // user owns and nobody else can write. Anything else is never trusted.
  try {
    const rootStat = await lstat(rootDir);
    if (!rootStat.isDirectory()) {
      return false;
    }
    const uid = currentUid();
    if (uid !== null && (rootStat.uid !== uid || (rootStat.mode & 0o022) !== 0)) {
      return false;
    }
  } catch {
    return false;
  }
  let marker;
  try {
    marker = JSON.parse(
      await readFile(path.join(rootDir, PATCH_MARKER_FILENAME), "utf8"),
    );
  } catch {
    return false;
  }
  if (
    marker?.patchVersion !== PATCH_VERSION ||
    marker.emceptionVersion !== identity.version ||
    marker.fingerprint !== identity.fingerprint ||
    !Array.isArray(marker.files) ||
    marker.files.length !== identity.files.length
  ) {
    return false;
  }
  for (let index = 0; index < marker.files.length; index += 1) {
    const [relativePath, size] = marker.files[index] ?? [];
    if (relativePath !== identity.files[index]) {
      return false;
    }
    try {
      const entry = await stat(path.join(rootDir, relativePath));
      if (!entry.isFile() || entry.size !== size) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

// Staging and stale dirs carry their creator's pid. A process that died
// mid-build leaves one behind; nothing else would ever remove it.
async function removeOrphanedBuildDirs(cacheRoot) {
  let names;
  try {
    names = await readdir(cacheRoot);
  } catch {
    return;
  }
  for (const name of names) {
    const match = ORPHAN_NAME_PATTERN.exec(name);
    if (!match) {
      continue;
    }
    const pid = Number(match[1]);
    if (pid === process.pid || isProcessAlive(pid)) {
      continue;
    }
    const uid = currentUid();
    if (uid !== null) {
      const entry = await lstat(path.join(cacheRoot, name)).catch(() => null);
      if (!entry || entry.uid !== uid) {
        continue;
      }
    }
    await rm(path.join(cacheRoot, name), { recursive: true, force: true }).catch(
      () => {},
    );
  }
}

// rename(2) of a directory is atomic: the root either does not exist or is
// complete. Losing the race to another process is success when its root
// passes the content check.
async function publishPatchedRoot(stagingDir, finalDir, identity) {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_PUBLISH_ATTEMPTS; attempt += 1) {
    try {
      await rename(stagingDir, finalDir);
      return;
    } catch (error) {
      if (!RENAME_COLLISION_CODES.has(error?.code)) {
        throw error;
      }
      lastError = error;
    }
    if (await isPatchedRootValid(finalDir, identity)) {
      return;
    }
    // What sits at finalDir is incomplete. Move it aside in one rename so no
    // reader ever sees it half-deleted, then retry.
    const staleDir = `${finalDir}${STALE_MARKER}${process.pid}-${randomBytes(4).toString("hex")}`;
    try {
      await rename(finalDir, staleDir);
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    await rm(staleDir, { recursive: true, force: true });
  }
  throw new Error(
    `Could not publish the patched emception root at ${finalDir}.`,
    { cause: lastError },
  );
}

/**
 * Returns the shared patched emception root under `cacheRoot` (default
 * `os.tmpdir()`), building it first if it is missing or fails the content
 * check. Safe to call from any number of processes at once.
 */
export async function preparePatchedEmceptionRoot(options = {}) {
  const cacheRoot = options.cacheRoot ?? os.tmpdir();
  const sourceRoot =
    options.sourceRoot ?? path.dirname(require.resolve("sdn-emception"));
  const identity = await computeEmceptionIdentity(sourceRoot);
  const finalDir = path.join(cacheRoot, `${PATCHED_ROOT_PREFIX}${identity.key}`);
  if (await isPatchedRootValid(finalDir, identity)) {
    return finalDir;
  }

  await removeOrphanedBuildDirs(cacheRoot);
  const stagingDir = await mkdtemp(
    `${finalDir}${STAGING_MARKER}${process.pid}-`,
  );
  try {
    // Copy-on-write clone where the filesystem supports it (APFS, btrfs);
    // a plain copy elsewhere.
    await cp(sourceRoot, stagingDir, {
      recursive: true,
      mode: fsConstants.COPYFILE_FICLONE,
    });
    await patchEmceptionModuleTree(stagingDir, identity.files);
    const files = [];
    for (const relativePath of identity.files) {
      const { size } = await stat(path.join(stagingDir, relativePath));
      files.push([relativePath, size]);
    }
    await writeFile(
      path.join(stagingDir, PATCH_MARKER_FILENAME),
      `${JSON.stringify({
        patchVersion: PATCH_VERSION,
        emceptionVersion: identity.version,
        fingerprint: identity.fingerprint,
        files,
      })}\n`,
      "utf8",
    );
    await publishPatchedRoot(stagingDir, finalDir, identity);
  } finally {
    // A no-op after a successful rename; removes the copy after a lost race
    // or a failure.
    await rm(stagingDir, { recursive: true, force: true });
  }
  return finalDir;
}

function getPatchedEmceptionRoot() {
  if (!patchedEmceptionRootPromise) {
    patchedEmceptionRootPromise = preparePatchedEmceptionRoot().catch(
      (error) => {
        patchedEmceptionRootPromise = null;
        throw error;
      },
    );
  }

  return patchedEmceptionRootPromise;
}

class EmceptionController {
  #instancePromise = null;
  #executionQueue = Promise.resolve();

  async load() {
    if (!this.#instancePromise) {
      this.#instancePromise = (async () => {
        installNodeRuntimeShims();
        const patchedRoot = await getPatchedEmceptionRoot();
        const moduleUrl = pathToFileURL(path.join(patchedRoot, "emception.mjs")).href;
        const { default: Emception } = await import(moduleUrl);
        const emception = new Emception({
          baseUrl: pathToFileURL(`${patchedRoot}${path.sep}`).href,
        });
        await emception.init();
        return emception;
      })().catch((error) => {
        this.#instancePromise = null;
        throw error;
      });
    }

    return this.#instancePromise;
  }

  async withLock(task) {
    const previous = this.#executionQueue;
    let release = () => {};
    this.#executionQueue = new Promise((resolve) => {
      release = resolve;
    });
    await previous.catch(() => {});
    try {
      const emception = await this.load().catch((error) => {
        if (!error.code) {
          error.code = "EMCEPTION_LOAD_FAILED";
        }
        throw error;
      });
      return await task(emception);
    } finally {
      release();
    }
  }
}

const sharedEmceptionController = new EmceptionController();

export function getSharedEmceptionController() {
  return sharedEmceptionController;
}

export function createEmceptionController() {
  return new EmceptionController();
}

export async function loadEmception() {
  return sharedEmceptionController.load();
}

export async function runWithEmceptionLock(task) {
  return sharedEmceptionController.withLock(task);
}
