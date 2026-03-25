import { canonicalBytes } from "../auth/canonicalize.js";
import {
  base64ToBytes,
  bytesToBase64,
  hexToBytes,
  toUint8Array,
} from "../utils/encoding.js";
import {
  aesCtrDecrypt,
  aesCtrEncrypt,
  aesGcmDecrypt,
  aesGcmEncrypt,
  hkdfBytes,
  randomBytes,
  x25519PublicKey,
  x25519SharedSecret,
} from "../utils/wasmCrypto.js";
import {
  appendPublicationRecordCollection,
  createEncryptedEnvelopePayload,
  decodeEncRecord,
  encodePublicationRecordCollection,
  extractPublicationRecordCollection,
} from "./records.js";

function normalizePublicKey(value) {
  if (typeof value === "string") {
    return hexToBytes(value);
  }
  return toUint8Array(value);
}

function normalizePrivateKey(value) {
  if (typeof value === "string") {
    return hexToBytes(value);
  }
  return toUint8Array(value);
}

async function deriveSharedSecret(privateKey, publicKey) {
  return x25519SharedSecret(
    normalizePrivateKey(privateKey),
    normalizePublicKey(publicKey),
  );
}

async function deriveAesKey(sharedSecret, salt, context) {
  return hkdfBytes(
    sharedSecret,
    salt,
    new TextEncoder().encode(context),
    32,
  );
}

export async function generateX25519Keypair() {
  const privateKey = await randomBytes(32);
  const publicKey = await x25519PublicKey(privateKey);
  return {
    publicKey,
    privateKey,
  };
}

async function encryptBytesLegacy({
  plaintext,
  recipientPublicKey,
  context = "space-data-module-sdk/package",
  senderKeyPair = null,
} = {}) {
  const sender = senderKeyPair ?? (await generateX25519Keypair());
  const salt = await randomBytes(32);
  const iv = await randomBytes(12);
  const sharedSecret = await deriveSharedSecret(
    sender.privateKey,
    recipientPublicKey,
  );
  const aesKey = await deriveAesKey(sharedSecret, salt, context);
  const { ciphertext, tag } = await aesGcmEncrypt(
    aesKey,
    toUint8Array(plaintext),
    iv,
  );
  const packedCiphertext = new Uint8Array(ciphertext.length + tag.length);
  packedCiphertext.set(ciphertext, 0);
  packedCiphertext.set(tag, ciphertext.length);
  return {
    version: 1,
    scheme: "x25519-hkdf-aes-256-gcm",
    context,
    senderPublicKeyBase64: bytesToBase64(sender.publicKey),
    saltBase64: bytesToBase64(salt),
    ivBase64: bytesToBase64(iv),
    ciphertextBase64: bytesToBase64(packedCiphertext),
  };
}

export async function decryptProtectedBytes({
  protectedBytes,
  recipientPrivateKey,
} = {}) {
  const parsed = extractPublicationRecordCollection(protectedBytes);
  if (!parsed?.enc) {
    return toUint8Array(protectedBytes);
  }
  const sharedSecret = await deriveSharedSecret(
    recipientPrivateKey,
    parsed.enc.ephemeralPublicKey,
  );
  const aesKey = await deriveAesKey(
    sharedSecret,
    new Uint8Array(0),
    parsed.enc.context ?? "",
  );
  return aesCtrDecrypt(aesKey, parsed.payloadBytes, parsed.enc.nonceStart);
}

export async function encryptBytesForRecipient({
  plaintext,
  recipientPublicKey,
  context = "space-data-module-sdk/package",
  senderKeyPair = null,
  recipientKeyId = null,
  schemaHash = null,
  rootType = null,
} = {}) {
  if (!recipientPublicKey) {
    throw new Error("encryptBytesForRecipient requires recipientPublicKey.");
  }
  const sender = senderKeyPair ?? (await generateX25519Keypair());
  const nonceStart = await randomBytes(12);
  const sharedSecret = await deriveSharedSecret(
    sender.privateKey,
    recipientPublicKey,
  );
  const aesKey = await deriveAesKey(sharedSecret, new Uint8Array(0), context);
  const ciphertext = await aesCtrEncrypt(aesKey, toUint8Array(plaintext), nonceStart);
  const enc = {
    version: 1,
    keyExchange: "X25519",
    symmetric: "AES_256_CTR",
    keyDerivation: "HKDF_SHA256",
    ephemeralPublicKey: sender.publicKey,
    nonceStart,
    recipientKeyId,
    context,
    schemaHash,
    rootType,
    timestamp: Date.now(),
  };
  const recordCollectionBytes = encodePublicationRecordCollection({ enc });
  const protectedBlobBytes = appendPublicationRecordCollection(
    ciphertext,
    recordCollectionBytes,
  );
  return createEncryptedEnvelopePayload({
    protectedBlobBytes,
    parsedProtectedBlob: {
      payloadBytes: ciphertext,
      recordCollectionBytes,
      enc,
      pnm: null,
    },
    enc,
    context,
  });
}

export async function decryptBytesFromEnvelope({
  envelope,
  recipientPrivateKey,
} = {}) {
  if (!envelope || !recipientPrivateKey) {
    throw new Error(
      "decryptBytesFromEnvelope requires envelope and recipientPrivateKey.",
    );
  }
  if (envelope.protectedBlobBase64) {
    return decryptProtectedBytes({
      protectedBytes: base64ToBytes(envelope.protectedBlobBase64),
      recipientPrivateKey,
    });
  }
  if (envelope.ciphertextBase64 && envelope.encRecordBase64) {
    const enc = decodeEncRecord(base64ToBytes(envelope.encRecordBase64));
    const sharedSecret = await deriveSharedSecret(
      recipientPrivateKey,
      enc.ephemeralPublicKey,
    );
    const aesKey = await deriveAesKey(
      sharedSecret,
      new Uint8Array(0),
      enc.context ?? envelope.context ?? "",
    );
    return aesCtrDecrypt(
      aesKey,
      base64ToBytes(envelope.ciphertextBase64),
      enc.nonceStart,
    );
  }
  const sharedSecret = await deriveSharedSecret(
    recipientPrivateKey,
    base64ToBytes(envelope.senderPublicKeyBase64),
  );
  const aesKey = await deriveAesKey(
    sharedSecret,
    base64ToBytes(envelope.saltBase64),
    envelope.context,
  );
  const packedCiphertext = base64ToBytes(envelope.ciphertextBase64);
  if (packedCiphertext.length < 16) {
    throw new Error("Encrypted envelope payload is truncated.");
  }
  const ciphertext = packedCiphertext.slice(0, packedCiphertext.length - 16);
  const tag = packedCiphertext.slice(packedCiphertext.length - 16);
  return aesGcmDecrypt(
    aesKey,
    ciphertext,
    tag,
    base64ToBytes(envelope.ivBase64),
  );
}

export async function encryptJsonForRecipient(options = {}) {
  return encryptBytesForRecipient({
    ...options,
    plaintext: canonicalBytes(options.payload ?? {}),
  });
}

export async function decryptJsonFromEnvelope(options = {}) {
  const bytes = await decryptBytesFromEnvelope(options);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function decryptPublicationRecordCollection({
  protectedBytes,
  recipientPrivateKey,
} = {}) {
  const parsed = extractPublicationRecordCollection(protectedBytes);
  if (!parsed) {
    return {
      payloadBytes: toUint8Array(protectedBytes),
      decryptedBytes: toUint8Array(protectedBytes),
      publication: null,
    };
  }
  const decryptedBytes = parsed.enc
    ? await decryptProtectedBytes({ protectedBytes, recipientPrivateKey })
    : parsed.payloadBytes;
  return {
    payloadBytes: parsed.payloadBytes,
    decryptedBytes,
    publication: parsed,
  };
}
