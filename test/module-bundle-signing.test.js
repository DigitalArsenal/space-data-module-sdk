import assert from "node:assert/strict";
import test from "node:test";

import {
  BUNDLE_SIGNATURE_HASH_ALGORITHM,
  ModuleSignatureError,
  computeModuleBundleSignatureHash,
  signModuleArtifact,
  verifyModuleArtifact,
} from "../src/bundle/signing.js";
import {
  createSingleFileBundle,
  parseSingleFileBundle,
} from "../src/bundle/wasm.js";

const privateKeySeedHex = "31".repeat(32);

function testWasm() {
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x04, 0x01, 0x78, 0xaa, 0xbb,
  ]);
}

function requiredEntries() {
  return [
    {
      entryId: "flow.plg",
      role: "manifest",
      sectionName: "sdn.flow.plg",
      payloadEncoding: "flatbuffer",
      typeRef: { schemaName: "PLG.fbs", fileIdentifier: "$PLG" },
      payload: new Uint8Array([1, 2, 3, 4]),
    },
    {
      entryId: "artifact.json",
      role: "auxiliary",
      sectionName: "sdn.flow.artifact",
      payloadEncoding: "json-utf8",
      mediaType: "application/json",
      payload: { version: 1, programId: "org.example.weather-flow" },
    },
    {
      entryId: "app.app",
      role: "auxiliary",
      sectionName: "sdn.app.record",
      payloadEncoding: "flatbuffer",
      typeRef: { schemaName: "APP.fbs", fileIdentifier: "$APP" },
      payload: new Uint8Array([5, 6, 7, 8]),
    },
  ];
}

async function unsignedBundle() {
  return createSingleFileBundle({
    wasmBytes: testWasm(),
    manifestBytes: new Uint8Array([9, 10, 11]),
    entries: requiredEntries(),
  });
}

test("bundle digest uses bytewise JSON key ordering shared by Go hosts", async () => {
  const unsigned = await unsignedBundle();
  const parsed = await parseSingleFileBundle(unsigned.wasmBytes);
  const digest = await computeModuleBundleSignatureHash(parsed.bundle, {
    wasmBytes: parsed.wasmBytes,
  });

  assert.equal(
    digest.hashHex,
    "c0d49118c6e404f48f5886498278624e27eeedfd17434bc1b119b9e0071e2200",
  );
});

test("bundle digest orders entry identifiers by UTF-8 bytes", async () => {
  const unsigned = await createSingleFileBundle({
    wasmBytes: testWasm(),
    manifestBytes: new Uint8Array([9, 10, 11]),
    entries: [
      { entryId: "a", payload: new Uint8Array([1]) },
      { entryId: "B", payload: new Uint8Array([2]) },
    ],
  });
  const parsed = await parseSingleFileBundle(unsigned.wasmBytes);
  const digest = await computeModuleBundleSignatureHash(parsed.bundle, {
    wasmBytes: parsed.wasmBytes,
  });

  assert.deepEqual(
    digest.statement.entries.map((entry) => entry.entryId),
    ["B", "a", "manifest"],
  );
});

test("bundle-scoped signatures bind the module and every non-signature MBL member", async () => {
  const unsigned = await unsignedBundle();
  const signed = await signModuleArtifact(unsigned.wasmBytes, {
    privateKeySeedHex,
    keyId: "bundle-test",
    signatureScope: "bundle",
  });
  assert.equal(
    signed.signature.signedHashAlgorithm,
    BUNDLE_SIGNATURE_HASH_ALGORITHM,
  );
  assert.match(signed.signature.signedHashHex, /^[a-f0-9]{64}$/);

  const verified = await verifyModuleArtifact(signed.wasmBytes, {
    trustedPublicKeys: [signed.signature.publicKeyHex],
    requireSignature: true,
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.signatureScope, "bundle");
  assert.equal(verified.signedHashHex, signed.signature.signedHashHex);
});

test("bundle verification rejects payload tampering even when the attacker recomputes the entry hash", async () => {
  const unsigned = await unsignedBundle();
  const signed = await signModuleArtifact(unsigned.wasmBytes, {
    privateKeySeedHex,
    signatureScope: "bundle",
  });
  const parsed = await parseSingleFileBundle(signed.wasmBytes);
  const signature = parsed.entries.find((entry) => entry.entryId === "signature");
  const manifest = parsed.entries.find((entry) => entry.entryId === "manifest");
  const entries = parsed.entries
    .filter((entry) => !["manifest", "signature"].includes(entry.entryId))
    .map((entry) => ({
      ...entry,
      payload:
        entry.entryId === "app.app"
          ? new Uint8Array([5, 6, 7, 9])
          : entry.payloadBytes,
    }));
  const tampered = await createSingleFileBundle({
    wasmBytes: parsed.wasmBytes,
    manifestBytes: manifest.payloadBytes,
    signature: signature.decodedPayload,
    entries,
  });

  await assert.rejects(
    verifyModuleArtifact(tampered.wasmBytes, {
      trustedPublicKeys: [signed.signature.publicKeyHex],
      requireSignature: true,
    }),
    (error) =>
      error instanceof ModuleSignatureError && error.code === "hash_mismatch",
  );
});

test("bundle verification rejects removal of a signed member", async () => {
  const unsigned = await unsignedBundle();
  const signed = await signModuleArtifact(unsigned.wasmBytes, {
    privateKeySeedHex,
    signatureScope: "bundle",
  });
  const parsed = await parseSingleFileBundle(signed.wasmBytes);
  const signature = parsed.entries.find((entry) => entry.entryId === "signature");
  const manifest = parsed.entries.find((entry) => entry.entryId === "manifest");
  const withoutApp = parsed.entries
    .filter((entry) => !["manifest", "signature", "app.app"].includes(entry.entryId))
    .map((entry) => ({ ...entry, payload: entry.payloadBytes }));
  const tampered = await createSingleFileBundle({
    wasmBytes: parsed.wasmBytes,
    manifestBytes: manifest.payloadBytes,
    signature: signature.decodedPayload,
    entries: withoutApp,
  });

  await assert.rejects(
    verifyModuleArtifact(tampered.wasmBytes, {
      trustedPublicKeys: [signed.signature.publicKeyHex],
      requireSignature: true,
    }),
    (error) =>
      error instanceof ModuleSignatureError && error.code === "hash_mismatch",
  );
});
