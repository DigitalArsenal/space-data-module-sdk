/**
 * Stage a module artifact for an engine that only reads FILES — the WasmEdge
 * CLI, the SDK's WasmEdge runners, wasmedgec, a Docker container — through the
 * one load path (`openModuleArtifact`): the artifact is read ONCE, its
 * signature is checked, and exactly the checked payload is written to a fresh
 * private file. The engine is pointed at that file and never at the artifact
 * as delivered, so:
 *
 *  - a signed artifact loads (the engine never sees the trailer it refuses);
 *  - an artifact that fails the check never reaches a file an engine reads;
 *  - nothing re-reads the delivered path after the check (no swap between
 *    verify and load).
 *
 * Node-only (`node:fs`), published as `space-data-module-sdk/bundle/stage` so
 * the isomorphic `./bundle` entry stays free of Node builtins for browser
 * bundles.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { openModuleArtifact } from "./artifactBytes.js";

const stagedArtifacts = new WeakSet();

/**
 * @param {string|Uint8Array|ArrayBuffer} source - artifact path, or its bytes
 * @param {Object} [options] - loader options (`verifySignature`, see
 *   `openModuleArtifact`) plus:
 * @param {string} [options.directory] - parent directory for the private
 *   staging directory (default `os.tmpdir()`); a Docker lane passes a
 *   directory its container mounts
 * @param {string} [options.fileName="module.wasm"] - staged file name
 * @returns {Promise<{path: string, directory: string, artifactBytes: Uint8Array, wasmBytes: Uint8Array, verification: Object, dispose: () => Promise<void>}>}
 *   `artifactBytes` is the artifact as read (trailer included) and `wasmBytes`
 *   the checked payload, a view into it.
 */
export async function stageModuleArtifact(source, options = {}) {
  const artifactBytes =
    typeof source === "string"
      ? new Uint8Array(await readFile(source))
      : source;
  const { wasmBytes, verification } = await openModuleArtifact(
    artifactBytes,
    options,
  );
  const parent = options.directory ?? os.tmpdir();
  await mkdir(parent, { recursive: true });
  // mkdtemp creates the directory 0700: only this user can list or swap the
  // staged file, and its name is unpredictable.
  const directory = await mkdtemp(path.join(parent, "sdm-staged-"));
  const stagedPath = path.join(directory, options.fileName ?? "module.wasm");
  await writeFile(stagedPath, wasmBytes, { mode: 0o400, flag: "wx" });
  let disposed = false;
  const staged = {
    path: stagedPath,
    directory,
    artifactBytes,
    wasmBytes,
    verification,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await rm(directory, { recursive: true, force: true });
    },
  };
  stagedArtifacts.add(staged);
  return staged;
}

/**
 * True only for an object `stageModuleArtifact` returned. Loaders that accept
 * a pre-staged artifact check this, so a hand-built `{path}` cannot stand in
 * for one that went through the check.
 */
export function isStagedModuleArtifact(value) {
  return value !== null && typeof value === "object" && stagedArtifacts.has(value);
}
