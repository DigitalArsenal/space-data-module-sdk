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
import {
  createCidV1Raw,
  createRecipientKeypairHex,
  decryptProtectedBytes,
} from "../src/index.js";
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

test("CLI protect can emit an encrypted binary with an appended REC trailer", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "space-data-module-sdk-cli-encrypted-"),
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
  const encryptedPath = path.join(tempDir, "module.wasm.enc");
  const recipient = await createRecipientKeypairHex();

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
    "--recipient-public-key",
    recipient.publicKeyHex,
    "--out",
    encryptedPath,
  ]);

  const [wasmBytes, encryptedBytes] = await Promise.all([
    readFile(wasmPath),
    readFile(encryptedPath),
  ]);
  const publication = extractPublicationRecordCollection(
    new Uint8Array(encryptedBytes),
  );
  assert.ok(publication);
  assert.ok(publication.enc);
  assert.ok(publication.pnm);
  assert.equal(WebAssembly.validate(publication.payloadBytes), false);
  assert.equal(
    publication.pnm.cid,
    await createCidV1Raw(publication.payloadBytes),
  );

  const decryptedBytes = await decryptProtectedBytes({
    protectedBytes: new Uint8Array(encryptedBytes),
    recipientPrivateKey: recipient.privateKeyHex,
  });
  assert.deepEqual(Array.from(decryptedBytes), Array.from(wasmBytes));
  assert.equal(WebAssembly.validate(decryptedBytes), true);
});
