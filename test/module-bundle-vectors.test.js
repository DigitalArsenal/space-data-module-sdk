import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  compileModuleFromSource,
} from "../src/compiler/compileModule.js";
import {
  createSingleFileBundle,
  getWasmCustomSections,
  parseSingleFileBundle,
} from "../src/bundle/wasm.js";
import { extractPublicationRecordCollection } from "../src/transport/records.js";
import { sha256Bytes } from "../src/utils/crypto.js";
import { bytesToHex } from "../src/utils/encoding.js";

const vectorsDir = path.resolve(
  "examples",
  "single-file-bundle",
  "vectors",
);

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

function normalizeWireFormat(value) {
  if (value === 1) {
    return "aligned-binary";
  }
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  return normalized === "aligned-binary" ? "aligned-binary" : "flatbuffer";
}

function toTypeRefSummary(typeRef) {
  if (!typeRef) {
    return null;
  }
  const summary = {};
  if (typeRef.schemaName !== undefined && typeRef.schemaName !== null) {
    summary.schemaName = typeRef.schemaName;
  }
  if (typeRef.fileIdentifier !== undefined && typeRef.fileIdentifier !== null) {
    summary.fileIdentifier = typeRef.fileIdentifier;
  }
  if (Array.isArray(typeRef.schemaHash) && typeRef.schemaHash.length > 0) {
    summary.schemaHashHex = bytesToHex(new Uint8Array(typeRef.schemaHash));
  }
  if (typeRef.acceptsAnyFlatbuffer === true) {
    summary.acceptsAnyFlatbuffer = true;
  }
  const wireFormat = normalizeWireFormat(typeRef.wireFormat);
  if (wireFormat !== "flatbuffer") {
    summary.wireFormat = wireFormat;
  }
  if (typeRef.rootTypeName) {
    summary.rootTypeName = typeRef.rootTypeName;
  }
  if (typeRef.fixedStringLength) {
    summary.fixedStringLength = typeRef.fixedStringLength;
  }
  if (typeRef.byteLength) {
    summary.byteLength = typeRef.byteLength;
  }
  if (typeRef.requiredAlignment) {
    summary.requiredAlignment = typeRef.requiredAlignment;
  }
  return summary;
}

function buildParsedSummary(bundleResult, parsedBundle) {
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
      typeRef: toTypeRefSummary(entry.typeRef),
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

test("checked-in single-file bundle vectors recreate exactly", async () => {
  const inputs = await loadVectorInputs();
  const expected = await readJson("expected.json");
  const expectedBaseModule = new Uint8Array(
    await readFile(path.join(vectorsDir, "base-module.wasm")),
  );
  const expectedBundle = new Uint8Array(
    await readFile(path.join(vectorsDir, "bundle.fb")),
  );
  const expectedBundledModule = new Uint8Array(
    await readFile(path.join(vectorsDir, "single-file-module.wasm")),
  );

  const compilation = await compileModuleFromSource({
    manifest: inputs.manifest,
    sourceCode: inputs.sourceCode,
    language: "c",
  });
  assert.deepEqual(Array.from(compilation.wasmBytes), Array.from(expectedBaseModule));

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

  assert.deepEqual(Array.from(bundleResult.bundleBytes), Array.from(expectedBundle));
  assert.deepEqual(
    Array.from(bundleResult.wasmBytes),
    Array.from(expectedBundledModule),
  );
  const protectedBundle = extractPublicationRecordCollection(bundleResult.wasmBytes);
  assert.ok(protectedBundle);
  assert.equal(WebAssembly.validate(protectedBundle.payloadBytes), true);
  assert.equal(
    getWasmCustomSections(protectedBundle.payloadBytes, "sds.bundle").length,
    0,
  );

  const parsedBundle = await parseSingleFileBundle(bundleResult.wasmBytes);
  const summary = buildParsedSummary(
    {
      ...bundleResult,
      baseModuleHash: await sha256Bytes(compilation.wasmBytes),
      bundleHash: await sha256Bytes(bundleResult.bundleBytes),
      bundledModuleHash: await sha256Bytes(bundleResult.wasmBytes),
    },
    parsedBundle,
  );
  assert.deepEqual(summary, expected);
});
