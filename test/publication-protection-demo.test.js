import test from "node:test";
import assert from "node:assert/strict";

import {
  createPublicationProtectionDemoManifest,
  createPublicationProtectionDemoSummary,
} from "../src/testing/publicationProtectionDemo.js";

test("publication protection demo manifest advertises aligned-binary with flatbuffer fallback", () => {
  const manifest = createPublicationProtectionDemoManifest();
  const outputTypes =
    manifest.methods[0].outputPorts[0].acceptedTypeSets[0].allowedTypes;

  assert.equal(outputTypes.length, 2);
  assert.equal(outputTypes[0].wireFormat ?? "flatbuffer", "flatbuffer");
  assert.equal(outputTypes[1].wireFormat, "aligned-binary");
  assert.equal(outputTypes[1].schemaName, outputTypes[0].schemaName);
  assert.equal(outputTypes[1].fileIdentifier, outputTypes[0].fileIdentifier);
  assert.equal(outputTypes[1].rootTypeName, "StateVector");
  assert.equal(outputTypes[1].requiredAlignment, 8);
  assert.equal(outputTypes[1].byteLength, 72);
});

test("publication protection demo summary uses standards-backed REC, PNM, and ENC records", async () => {
  const summary = await createPublicationProtectionDemoSummary();

  assert.equal(summary.recTrailer.fileIdentifier, "$REC");
  assert.ok(summary.recTrailer.usesStandardsFlatbuffers);
  assert.equal(summary.alignedBinaryContract.length, 1);
  assert.equal(summary.alignedBinaryContract[0].hasFlatbufferFallback, true);

  assert.equal(summary.signedOnly.encrypted, false);
  assert.deepEqual(summary.signedOnly.recordStandards, ["PNM"]);
  assert.equal(summary.signedOnly.pnm.fileId, summary.manifest.pluginId);
  assert.equal(summary.signedOnly.pnm.fileName, `${summary.signedOnly.artifactId}.wasm`);
  assert.ok(summary.signedOnly.pnm.cid.length > 0);
  assert.ok(summary.signedOnly.pnm.hasSignature);

  assert.equal(summary.encryptedDelivery.encrypted, true);
  assert.deepEqual(summary.encryptedDelivery.recordStandards, ["ENC", "PNM"]);
  assert.equal(summary.encryptedDelivery.enc.context, "space-data-module-sdk/package");
  assert.equal(summary.encryptedDelivery.enc.rootType, "WASM");
  assert.equal(summary.encryptedDelivery.enc.keyExchange, "X25519");
  assert.equal(summary.encryptedDelivery.enc.symmetric, "AES_256_CTR");
  assert.equal(summary.encryptedDelivery.enc.keyDerivation, "HKDF_SHA256");
  assert.equal(summary.encryptedDelivery.enc.nonceLength, 12);
  assert.ok(summary.encryptedDelivery.enc.ephemeralPublicKeyLength >= 32);
  assert.ok(summary.encryptedDelivery.envelope.hasEncRecord);
  assert.ok(summary.encryptedDelivery.envelope.hasPnmRecord);
});
