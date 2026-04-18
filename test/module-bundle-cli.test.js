import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  getWasmCustomSections,
  parseSingleFileBundle,
} from "../src/bundle/wasm.js";
import { extractPublicationRecordCollection } from "../src/transport/records.js";

const execFileAsync = promisify(execFile);

test("CLI protect can emit a single-file bundle wasm", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "space-data-module-sdk-cli-"),
  );
  const manifestPath = path.resolve(
    "examples",
    "single-file-bundle",
    "vectors",
    "manifest.json",
  );
  const sourcePath = path.resolve(
    "examples",
    "single-file-bundle",
    "vectors",
    "module.c",
  );
  const wasmPath = path.join(tempDir, "module.wasm");
  const bundledPath = path.join(tempDir, "module.bundle.wasm");

  await execFileAsync(process.execPath, [
    path.resolve("bin", "space-data-module.js"),
    "compile",
    "--manifest",
    manifestPath,
    "--source",
    sourcePath,
    "--out",
    wasmPath,
  ]);

  await execFileAsync(process.execPath, [
    path.resolve("bin", "space-data-module.js"),
    "protect",
    "--manifest",
    manifestPath,
    "--wasm",
    wasmPath,
    "--single-file-bundle",
    "--out",
    bundledPath,
  ]);

  const bundledBytes = new Uint8Array(await readFile(bundledPath));
  const protectedBundle = extractPublicationRecordCollection(bundledBytes);
  assert.ok(protectedBundle);
  assert.equal(WebAssembly.validate(protectedBundle.payloadBytes), true);
  assert.equal(getWasmCustomSections(protectedBundle.payloadBytes, "sds.bundle").length, 0);

  const parsed = await parseSingleFileBundle(bundledBytes);
  assert.equal(
    parsed.manifest?.pluginId,
    "com.digitalarsenal.examples.single-file-vector",
  );
});
