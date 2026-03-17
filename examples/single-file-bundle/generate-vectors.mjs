import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileModuleFromSource,
  createSingleFileBundle,
  parseSingleFileBundle,
} from "../../src/index.js";
import { canonicalBytes } from "../../src/auth/index.js";
import { bytesToHex } from "../../src/utils/encoding.js";
import { sha256Bytes } from "../../src/utils/crypto.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.join(__dirname, "vectors");

async function readJson(filename) {
  return JSON.parse(await readFile(path.join(vectorsDir, filename), "utf8"));
}

async function loadVectorInputs() {
  return {
    manifest: await readJson("manifest.json"),
    authorization: await readJson("authorization.json"),
    signature: await readJson("signature.json"),
    transport: await readJson("transport.json"),
    sourceCode: await readFile(path.join(vectorsDir, "module.c"), "utf8"),
    auxiliaryBytes: new Uint8Array(
      await readFile(path.join(vectorsDir, "auxiliary.bin")),
    ),
  };
}

function buildExpectedSummary(bundleResult, parsedBundle) {
  return {
    bundleSectionName:
      bundleResult.bundle.canonicalization.bundleSectionName,
    baseModuleSha256Hex: bytesToHex(bundleResult.baseModuleHash),
    bundleSha256Hex: bytesToHex(bundleResult.bundleHash),
    bundledModuleSha256Hex: bytesToHex(bundleResult.bundledModuleHash),
    canonicalModuleHashHex: bundleResult.canonicalModuleHashHex,
    manifestHashHex: bundleResult.manifestHashHex,
    manifestPluginId: parsedBundle.manifest?.pluginId ?? null,
    entryIds: parsedBundle.entries.map((entry) => entry.entryId),
    entries: parsedBundle.entries.map((entry) => ({
      entryId: entry.entryId,
      role: entry.roleName,
      payloadEncoding: entry.payloadEncodingName,
      sectionName: entry.sectionName ?? null,
      payloadLength: entry.payloadBytes.length,
      payloadSha256Hex: bytesToHex(entry.sha256Bytes),
      typeRef: entry.typeRef
        ? {
            schemaName: entry.typeRef.schemaName ?? null,
            fileIdentifier: entry.typeRef.fileIdentifier ?? null,
          }
        : null,
      decodedPayload:
        entry.payloadEncodingName === "flatbuffer"
          ? null
          : entry.payloadEncodingName === "raw-bytes"
            ? Array.from(entry.decodedPayload)
          : entry.decodedPayload,
      decodedManifestPluginId: entry.decodedManifest?.pluginId ?? null,
    })),
  };
}

async function main() {
  const inputs = await loadVectorInputs();
  const compilation = await compileModuleFromSource({
    manifest: inputs.manifest,
    sourceCode: inputs.sourceCode,
    language: "c",
  });

  const bundleResult = await createSingleFileBundle({
    manifest: inputs.manifest,
    wasmBytes: compilation.wasmBytes,
    authorization: inputs.authorization,
    signature: inputs.signature,
    transportEnvelope: inputs.transport,
    entries: [
      {
        entryId: "auxiliary-note",
        role: "auxiliary",
        sectionName: "sds.auxiliary",
        payloadEncoding: "raw-bytes",
        mediaType: "application/octet-stream",
        payload: inputs.auxiliaryBytes,
        description: "Opaque auxiliary bytes for cross-language round-trip tests.",
      },
    ],
  });

  const parsedBundle = await parseSingleFileBundle(bundleResult.wasmBytes);
  const baseModuleHash = await sha256Bytes(compilation.wasmBytes);
  const bundleHash = await sha256Bytes(bundleResult.bundleBytes);
  const bundledModuleHash = await sha256Bytes(bundleResult.wasmBytes);
  const expectedSummary = buildExpectedSummary(
    {
      ...bundleResult,
      baseModuleHash,
      bundleHash,
      bundledModuleHash,
    },
    parsedBundle,
  );

  await mkdir(vectorsDir, { recursive: true });
  await writeFile(
    path.join(vectorsDir, "manifest.fb"),
    bundleResult.bundle.entries.find((entry) => entry.entryId === "manifest").payload,
  );
  await writeFile(path.join(vectorsDir, "base-module.wasm"), compilation.wasmBytes);
  await writeFile(path.join(vectorsDir, "bundle.fb"), bundleResult.bundleBytes);
  await writeFile(
    path.join(vectorsDir, "single-file-module.wasm"),
    bundleResult.wasmBytes,
  );
  await writeFile(
    path.join(vectorsDir, "expected.json"),
    `${JSON.stringify(expectedSummary, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(vectorsDir, "authorization.canonical.json"),
    `${new TextDecoder().decode(canonicalBytes(inputs.authorization))}\n`,
    "utf8",
  );
  await writeFile(
    path.join(vectorsDir, "signature.canonical.json"),
    `${new TextDecoder().decode(canonicalBytes(inputs.signature))}\n`,
    "utf8",
  );
  await writeFile(
    path.join(vectorsDir, "transport.canonical.json"),
    `${new TextDecoder().decode(canonicalBytes(inputs.transport))}\n`,
    "utf8",
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        vectorsDir,
        bundledModuleBytes: bundleResult.wasmBytes.length,
        bundleBytes: bundleResult.bundleBytes.length,
        canonicalModuleHashHex: bundleResult.canonicalModuleHashHex,
      },
      null,
      2,
    )}\n`,
  );
}

await main();
