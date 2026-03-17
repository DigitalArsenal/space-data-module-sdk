import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  decodeModuleBundle,
  getWasmCustomSections,
} from "../src/index.js";
import { sha256Bytes } from "../src/utils/crypto.js";
import { bytesToHex } from "../src/utils/encoding.js";

const execFileAsync = promisify(execFile);

const vectorsDir = path.resolve(
  "examples",
  "single-file-bundle",
  "vectors",
);
const runnerDir = path.resolve(
  "examples",
  "single-file-bundle",
  "go",
  "generated",
);

function normalizeSummary(summary) {
  return {
    bundleSectionName: summary.bundleSectionName,
    baseModuleSha256Hex: summary.baseModuleSha256Hex,
    canonicalModuleHashHex: summary.canonicalModuleHashHex,
    manifestHashHex: summary.manifestHashHex,
    manifestPluginId: summary.manifestPluginId,
    entryIds: summary.entryIds,
    entries: summary.entries,
  };
}

test("Go reference runner parses the checked-in bundled module", async () => {
  const expected = JSON.parse(
    await readFile(path.join(vectorsDir, "expected.json"), "utf8"),
  );
  const { stdout } = await execFileAsync(
    "go",
    ["run", "./cmd/reference_bundle", "parse", "../../vectors/single-file-module.wasm"],
    { cwd: runnerDir },
  );
  assert.deepEqual(JSON.parse(stdout), expected);
});

test("Go reference runner recreates semantically equivalent bundle artifacts", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "space-data-module-sdk-go-"),
  );
  const expected = JSON.parse(
    await readFile(path.join(vectorsDir, "expected.json"), "utf8"),
  );
  const expectedBundle = new Uint8Array(
    await readFile(path.join(vectorsDir, "bundle.fb")),
  );
  const expectedDecodedBundle = decodeModuleBundle(expectedBundle);
  const { stdout } = await execFileAsync(
    "go",
    ["run", "./cmd/reference_bundle", "create", tempDir],
    { cwd: runnerDir },
  );

  const createdBundle = new Uint8Array(
    await readFile(path.join(tempDir, "bundle.fb")),
  );
  const createdBundledModule = new Uint8Array(
    await readFile(path.join(tempDir, "single-file-module.wasm")),
  );
  const createdSummary = JSON.parse(stdout);

  assert.deepEqual(decodeModuleBundle(createdBundle), expectedDecodedBundle);
  assert.equal(WebAssembly.validate(createdBundledModule), true);
  assert.equal(
    getWasmCustomSections(createdBundledModule, "sds.bundle").length,
    1,
  );
  assert.equal(
    createdSummary.bundleSha256Hex,
    bytesToHex(await sha256Bytes(createdBundle)),
  );
  assert.equal(
    createdSummary.bundledModuleSha256Hex,
    bytesToHex(await sha256Bytes(createdBundledModule)),
  );
  assert.deepEqual(normalizeSummary(createdSummary), normalizeSummary(expected));
});
