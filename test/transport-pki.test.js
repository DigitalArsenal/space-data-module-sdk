import test from "node:test";
import assert from "node:assert/strict";

import {
  decryptBytesFromEnvelope,
  decryptProtectedBytes,
  encryptBytesForRecipient,
  generateX25519Keypair,
} from "../src/transport/pki.js";
import {
  appendPublicationRecordCollection,
  encodePublicationRecordCollection,
  extractPublicationRecordCollection,
} from "../src/transport/records.js";
import { base64ToBytes } from "../src/utils/encoding.js";

const PLAINTEXT = new TextEncoder().encode(
  "authenticated module delivery payload",
);

async function createEncryptedFixture() {
  const recipient = await generateX25519Keypair();
  const envelope = await encryptBytesForRecipient({
    plaintext: PLAINTEXT,
    recipientPublicKey: recipient.publicKey,
    context: "space-data-module-sdk/package",
    schemaHash: new Uint8Array(32).fill(3),
    rootType: "WASM",
  });
  return { recipient, envelope };
}

test("ENC delivery emits AES-256-GCM records and round-trips", async () => {
  const { recipient, envelope } = await createEncryptedFixture();

  assert.equal(envelope.scheme, "x25519-hkdf-aes-256-gcm-rec");
  assert.ok(envelope.encRecordBase64);

  const protectedBytes = base64ToBytes(envelope.protectedBlobBase64);
  const parsed = extractPublicationRecordCollection(protectedBytes);
  assert.ok(parsed?.enc);
  assert.equal(parsed.enc.symmetric, "AES_256_GCM");
  assert.equal(parsed.enc.keyExchange, "X25519");
  assert.equal(parsed.enc.keyDerivation, "HKDF_SHA256");
  assert.equal(parsed.enc.nonceStart.length, 12);
  // ciphertext || 16-byte GCM tag
  assert.equal(parsed.payloadBytes.length, PLAINTEXT.length + 16);

  const viaBlob = await decryptProtectedBytes({
    protectedBytes,
    recipientPrivateKey: recipient.privateKey,
  });
  assert.deepEqual(Array.from(viaBlob), Array.from(PLAINTEXT));

  const viaEnvelope = await decryptBytesFromEnvelope({
    envelope: {
      ciphertextBase64: envelope.ciphertextBase64,
      encRecordBase64: envelope.encRecordBase64,
      context: envelope.context,
    },
    recipientPrivateKey: recipient.privateKey,
  });
  assert.deepEqual(Array.from(viaEnvelope), Array.from(PLAINTEXT));
});

test("tampered ENC ciphertext fails authentication", async () => {
  const { recipient, envelope } = await createEncryptedFixture();
  const protectedBytes = base64ToBytes(envelope.protectedBlobBase64);

  const tamperedCiphertext = new Uint8Array(protectedBytes);
  tamperedCiphertext[0] ^= 0x01;
  await assert.rejects(
    decryptProtectedBytes({
      protectedBytes: tamperedCiphertext,
      recipientPrivateKey: recipient.privateKey,
    }),
  );
});

test("tampered ENC auth tag fails authentication", async () => {
  const { recipient, envelope } = await createEncryptedFixture();
  const protectedBytes = base64ToBytes(envelope.protectedBlobBase64);
  const parsed = extractPublicationRecordCollection(protectedBytes);
  assert.ok(parsed);

  // Flip a bit in the trailing 16-byte GCM tag of the payload region.
  const tagByteOffset = parsed.payloadBytes.length - 1;
  const tampered = new Uint8Array(protectedBytes);
  tampered[tagByteOffset] ^= 0x80;
  await assert.rejects(
    decryptProtectedBytes({
      protectedBytes: tampered,
      recipientPrivateKey: recipient.privateKey,
    }),
  );
});

test("tampered ENC record metadata breaks the GCM AAD binding", async () => {
  const { recipient, envelope } = await createEncryptedFixture();
  const protectedBytes = base64ToBytes(envelope.protectedBlobBase64);
  const parsed = extractPublicationRecordCollection(protectedBytes);
  assert.ok(parsed?.enc);

  // Swap the schema hash (which does not participate in key derivation) and
  // rebuild the trailer around the untouched ciphertext. Decryption must fail
  // because the encoded ENC record is the GCM AAD.
  const forgedCollection = encodePublicationRecordCollection({
    enc: { ...parsed.enc, schemaHash: new Uint8Array(32).fill(0x42) },
  });
  const forged = appendPublicationRecordCollection(
    parsed.payloadBytes,
    forgedCollection,
  );
  await assert.rejects(
    decryptProtectedBytes({
      protectedBytes: forged,
      recipientPrivateKey: recipient.privateKey,
    }),
  );
});

test("ENC records claiming AES_256_CTR are rejected", async () => {
  const { recipient, envelope } = await createEncryptedFixture();
  const protectedBytes = base64ToBytes(envelope.protectedBlobBase64);
  const parsed = extractPublicationRecordCollection(protectedBytes);
  assert.ok(parsed?.enc);

  const ctrCollection = encodePublicationRecordCollection({
    enc: { ...parsed.enc, symmetric: "AES_256_CTR" },
  });
  const ctrBlob = appendPublicationRecordCollection(
    parsed.payloadBytes,
    ctrCollection,
  );
  await assert.rejects(
    decryptProtectedBytes({
      protectedBytes: ctrBlob,
      recipientPrivateKey: recipient.privateKey,
    }),
    /only AES_256_GCM/,
  );
});

test("truncated AES-256-GCM payloads are rejected", async () => {
  const { recipient, envelope } = await createEncryptedFixture();
  const protectedBytes = base64ToBytes(envelope.protectedBlobBase64);
  const parsed = extractPublicationRecordCollection(protectedBytes);
  assert.ok(parsed);

  const truncated = appendPublicationRecordCollection(
    parsed.payloadBytes.subarray(0, 8),
    parsed.recordCollectionBytes,
  );
  await assert.rejects(
    decryptProtectedBytes({
      protectedBytes: truncated,
      recipientPrivateKey: recipient.privateKey,
    }),
    /truncated/,
  );
});
