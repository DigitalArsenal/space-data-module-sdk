// The signature entry is found and read as the node finds and reads it
// (sdn-server/internal/modulert/publication_signature.go): every known key is
// a string (keyId may be null), fields are trimmed as Go's strings.TrimSpace
// trims, and the entry is matched by entryId or sectionName after a Go trim
// and lowercase.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ModuleSignatureError,
  signModuleArtifact,
  verifyModuleArtifact,
} from "../src/bundle/signing.js";
import { createSingleFileBundle } from "../src/bundle/wasm.js";
import { extractPublicationRecordCollection } from "../src/transport/records.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_KEYPAIR_PATH = path.join(__dirname, "support", "dev-module-signing-keypair.json");

const KNOWN_KEYS = [
  "algorithm",
  "keyId",
  "publicKeyHex",
  "signatureHex",
  "signedHashHex",
  "signedHashAlgorithm",
  "statementDomain",
];

async function signedFixture() {
  const keypair = JSON.parse(await readFile(DEV_KEYPAIR_PATH, "utf8"));
  const wasm = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const signed = await signModuleArtifact(wasm, {
    privateKeySeedHex: keypair.privateKeySeedHex,
    keyId: "parsing-fixture",
  });
  const portable = new Uint8Array(extractPublicationRecordCollection(signed.wasmBytes).payloadBytes);
  const policy = { trustedPublicKeys: [keypair.publicKeyHex], requireSignature: true };
  return { signature: signed.signature, portable, policy };
}

// The file with the given signature entry payload (a JSON string, written as
// it is) under the default entry identity.
async function withEntryText(portable, text) {
  return (await createSingleFileBundle({ wasmBytes: portable, signature: text })).wasmBytes;
}

// The file with the payload in an entry whose identity is given explicitly
// (role AUXILIARY, so only entryId or sectionName can match it).
async function withEntryIdentity(portable, signature, { entryId, sectionName }) {
  return (
    await createSingleFileBundle({
      wasmBytes: portable,
      entries: [
        {
          entryId,
          role: "auxiliary",
          sectionName,
          payloadEncoding: "json-utf8",
          mediaType: "application/json",
          payload: new TextEncoder().encode(JSON.stringify(signature)),
        },
      ],
    })
  ).wasmBytes;
}

const isPayloadRefusal = (error) =>
  error instanceof ModuleSignatureError && error.code === "invalid_signature_payload";

test("the fixture verifies as written (control)", async () => {
  const { signature, portable, policy } = await signedFixture();
  const result = await verifyModuleArtifact(await withEntryText(portable, JSON.stringify(signature)), policy);
  assert.equal(result.verified, true);
});

for (const key of KNOWN_KEYS) {
  for (const [label, wrap] of [
    ["a one-element array", (value) => [value]],
    ["a number", () => 1],
    ["an object", (value) => ({ value })],
    ["a boolean", () => true],
  ]) {
    test(`a ${key} that is ${label} is refused (Go's json.Unmarshal refuses it)`, async () => {
      const { signature, portable, policy } = await signedFixture();
      const entry = { ...signature, [key]: wrap(signature[key]) };
      await assert.rejects(
        verifyModuleArtifact(await withEntryText(portable, JSON.stringify(entry)), policy),
        isPayloadRefusal,
      );
    });
  }
}

test("keyId null verifies; null for any other known key is refused", async () => {
  const { signature, portable, policy } = await signedFixture();
  const keyIdNull = await withEntryText(portable, JSON.stringify({ ...signature, keyId: null }));
  assert.equal((await verifyModuleArtifact(keyIdNull, policy)).verified, true);
  for (const key of KNOWN_KEYS.filter((name) => name !== "keyId")) {
    await assert.rejects(
      verifyModuleArtifact(await withEntryText(portable, JSON.stringify({ ...signature, [key]: null })), policy),
      isPayloadRefusal,
      key,
    );
  }
});

test("signatureHex and publicKeyHex are trimmed as Go trims: U+0085 is trimmed, U+FEFF is not", async () => {
  const { signature, portable, policy } = await signedFixture();
  for (const key of ["signatureHex", "publicKeyHex"]) {
    // NEXT LINE (U+0085): Go's strings.TrimSpace trims it; JavaScript's
    // String.prototype.trim does not.
    const nel = await withEntryText(portable, JSON.stringify({ ...signature, [key]: `\u0085${signature[key]}\u0085` }));
    assert.equal((await verifyModuleArtifact(nel, policy)).verified, true, `${key} padded with U+0085`);
    // ZERO WIDTH NO-BREAK SPACE (U+FEFF): JavaScript's trim trims it; Go's
    // does not, so the node cannot decode the hex and refuses.
    const bom = await withEntryText(portable, JSON.stringify({ ...signature, [key]: `﻿${signature[key]}` }));
    await assert.rejects(
      verifyModuleArtifact(bom, policy),
      (error) => error instanceof ModuleSignatureError,
      `${key} padded with U+FEFF`,
    );
  }
});

test("the entry is matched by entryId or sectionName after a Go trim and lowercase, as the node matches it", async () => {
  const { signature, portable, policy } = await signedFixture();
  for (const identity of [
    { entryId: "Signature", sectionName: "sds.other" },
    { entryId: " SIGNATURE\u0085", sectionName: "sds.other" },
    { entryId: "other", sectionName: "SDS.Signature" },
    { entryId: "other", sectionName: "\tsds.signature " },
  ]) {
    const bytes = await withEntryIdentity(portable, signature, identity);
    const result = await verifyModuleArtifact(bytes, policy);
    assert.equal(result.verified, true, JSON.stringify(identity));
  }
  // An entry that names neither is not a signature entry: unsigned.
  const neither = await withEntryIdentity(portable, signature, { entryId: "other", sectionName: "sds.other" });
  await assert.rejects(
    verifyModuleArtifact(neither, policy),
    (error) => error instanceof ModuleSignatureError && error.code === "missing_signature",
  );
});
