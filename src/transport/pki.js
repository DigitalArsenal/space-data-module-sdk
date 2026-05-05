import { canonicalBytes } from "../auth/canonicalize.js";
import * as flatbuffers from "flatbuffers";
import { KMF, keyMaterialAlgorithm, keyMaterialEncoding, keyMaterialRole } from "spacedatastandards.org/lib/js/KMF/main.js";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
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

function normalizeOptionalBytes(value) {
  if (value === null || value === undefined) {
    return new Uint8Array(0);
  }
  if (typeof value === "string") {
    return hexToBytes(value);
  }
  return toUint8Array(value);
}

function normalizeRequiredString(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${name} is required.`);
  }
  return normalized;
}

function normalizeArtifactBinding(artifact = {}) {
  const listingId = normalizeRequiredString(artifact.listingId, "artifact.listingId");
  const moduleId = normalizeRequiredString(artifact.moduleId, "artifact.moduleId");
  const version = normalizeRequiredString(artifact.version, "artifact.version");
  const encryptedCid = normalizeRequiredString(
    artifact.encryptedCid,
    "artifact.encryptedCid",
  );
  const providerId = normalizeRequiredString(artifact.providerId, "artifact.providerId");
  const policyId = normalizeRequiredString(artifact.policyId, "artifact.policyId");
  const keyEpoch = normalizeRequiredString(artifact.keyEpoch, "artifact.keyEpoch");
  const contentKeyId =
    String(artifact.contentKeyId ?? "").trim() ||
    `${listingId}:${moduleId}:${version}:${keyEpoch}`;
  const encryptedHash = normalizeOptionalBytes(artifact.encryptedHash);
  if (encryptedHash.length !== 32) {
    throw new Error("artifact.encryptedHash must be 32 bytes.");
  }
  const manifestHash = normalizeOptionalBytes(artifact.manifestHash);
  if (manifestHash.length !== 32) {
    throw new Error("artifact.manifestHash must be 32 bytes.");
  }
  return {
    listingId,
    moduleId,
    version,
    encryptedCid,
    encryptedHash: bytesToHex(encryptedHash),
    providerId,
    policyId,
    keyEpoch,
    manifestHash: bytesToHex(manifestHash),
    contentKeyId,
  };
}

export function createMarketplaceContentAad(artifact = {}) {
  const binding = normalizeArtifactBinding(artifact);
  return canonicalBytes({
    encryptedCid: binding.encryptedCid,
    encryptedHash: binding.encryptedHash,
    keyEpoch: binding.keyEpoch,
    listingId: binding.listingId,
    manifestHash: binding.manifestHash,
    moduleId: binding.moduleId,
    policyId: binding.policyId,
    providerId: binding.providerId,
    version: binding.version,
  });
}

function createWrapAad({ artifact, recipient, algorithm }) {
  return canonicalBytes({
    algorithm,
    contentKeyId: artifact.contentKeyId,
    encryptedCid: artifact.encryptedCid,
    expiresAtMs: Number(recipient.expiresAtMs ?? 0),
    grantId: normalizeRequiredString(recipient.grantId, "recipient.grantId"),
    keyEpoch: artifact.keyEpoch,
    providerId: artifact.providerId,
    recipientKeyId: normalizeRequiredString(
      recipient.recipientKeyId,
      "recipient.recipientKeyId",
    ),
    scope: normalizeRequiredString(recipient.scope, "recipient.scope"),
  });
}

function encodeContentKeyMaterial({ keyId, keyBytes, expiresAtMs }) {
  const builder = new flatbuffers.Builder(256);
  const keyIdOffset = builder.createString(keyId);
  const keyBytesOffset = KMF.createKeyBytesVector(builder, keyBytes);
  const root = KMF.createKMF(
    builder,
    keyIdOffset,
    keyMaterialRole.PublicationContent,
    keyMaterialAlgorithm.Aes256Gcm,
    keyMaterialEncoding.RawBytes,
    keyBytesOffset,
    1,
    BigInt(Number(expiresAtMs ?? 0)),
  );
  KMF.finishKMFBuffer(builder, root);
  return builder.asUint8Array();
}

function decodeContentKeyMaterial(bytes) {
  const payload = toUint8Array(bytes);
  const bb = new flatbuffers.ByteBuffer(payload);
  if (!KMF.bufferHasIdentifier(bb)) {
    throw new Error("Wrapped marketplace content key payload is not a KMF record.");
  }
  const kmf = KMF.getRootAsKMF(bb);
  if (kmf.ROLE() !== keyMaterialRole.PublicationContent) {
    throw new Error("Wrapped marketplace key material is not a publication content key.");
  }
  if (kmf.ALGORITHM() !== keyMaterialAlgorithm.Aes256Gcm) {
    throw new Error("Wrapped marketplace key material is not an AES-256-GCM key.");
  }
  const keyBytes = kmf.keyBytesArray();
  if (!keyBytes || keyBytes.length !== 32) {
    throw new Error("Wrapped marketplace content key must be 32 bytes.");
  }
  return new Uint8Array(keyBytes);
}

export async function generateX25519Keypair() {
  const privateKey = await randomBytes(32);
  const publicKey = await x25519PublicKey(privateKey);
  return {
    publicKey,
    privateKey,
  };
}

export async function protectMarketplaceContent({
  plaintext,
  artifact,
  recipients = [],
  contentKey = null,
  contentNonce = null,
  providerWrapKeyPair = null,
  wrapNonce = null,
} = {}) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error("protectMarketplaceContent requires at least one recipient.");
  }
  const binding = normalizeArtifactBinding(artifact);
  const keyBytes = contentKey ? toUint8Array(contentKey) : await randomBytes(32);
  if (keyBytes.length !== 32) {
    throw new Error("Marketplace content keys must be 32 bytes.");
  }
  const nonce = contentNonce ? toUint8Array(contentNonce) : await randomBytes(12);
  if (nonce.length !== 12) {
    throw new Error("AES-256-GCM content encryption requires a 12-byte nonce.");
  }
  const aad = createMarketplaceContentAad(binding);
  const encrypted = await aesGcmEncrypt(
    keyBytes,
    toUint8Array(plaintext),
    nonce,
    aad,
  );
  const wrappedKeys = [];
  for (const recipient of recipients) {
    const sender = providerWrapKeyPair ?? (await generateX25519Keypair());
    const recipientPublicKey = normalizePublicKey(recipient.publicKey);
    const wrapIv = wrapNonce ? toUint8Array(wrapNonce) : await randomBytes(12);
    if (wrapIv.length !== 12) {
      throw new Error("AES-256-GCM key wrapping requires a 12-byte nonce.");
    }
    const wrapAad = createWrapAad({
      artifact: binding,
      recipient,
      algorithm: "X25519-HKDF-SHA256-AES-256-GCM-KMF",
    });
    const sharedSecret = await deriveSharedSecret(
      sender.privateKey,
      recipientPublicKey,
    );
    const wrapContext = `marketplace-content-key:${binding.providerId}:${binding.contentKeyId}:${recipient.recipientKeyId}`;
    const wrapKey = await deriveAesKey(sharedSecret, new Uint8Array(0), wrapContext);
    const keyMaterial = encodeContentKeyMaterial({
      keyId: binding.contentKeyId,
      keyBytes,
      expiresAtMs: recipient.expiresAtMs,
    });
    const wrapped = await aesGcmEncrypt(wrapKey, keyMaterial, wrapIv, wrapAad);
    wrappedKeys.push({
      algorithm: "X25519-HKDF-SHA256-AES-256-GCM-KMF",
      contentKeyId: binding.contentKeyId,
      recipientPeerId: normalizeRequiredString(
        recipient.recipientPeerId,
        "recipient.recipientPeerId",
      ),
      recipientKeyId: normalizeRequiredString(
        recipient.recipientKeyId,
        "recipient.recipientKeyId",
      ),
      providerId: binding.providerId,
      encryptedCid: binding.encryptedCid,
      grantId: normalizeRequiredString(recipient.grantId, "recipient.grantId"),
      scope: normalizeRequiredString(recipient.scope, "recipient.scope"),
      expiresAtMs: Number(recipient.expiresAtMs ?? 0),
      providerEphemeralPublicKey: sender.publicKey,
      nonce: wrapIv,
      aad: wrapAad,
      ciphertext: wrapped.ciphertext,
      tag: wrapped.tag,
    });
  }
  return {
    algorithm: "AES-256-GCM",
    contentKeyId: binding.contentKeyId,
    artifact: binding,
    aad,
    encryptedPayload: {
      algorithm: "AES-256-GCM",
      nonce,
      aad,
      ciphertext: encrypted.ciphertext,
      tag: encrypted.tag,
    },
    wrappedKeys,
  };
}

export async function decryptMarketplaceContentKeyWrap({
  wrap,
  recipientPrivateKey,
} = {}) {
  if (!wrap) {
    throw new Error("decryptMarketplaceContentKeyWrap requires wrap.");
  }
  const sharedSecret = await deriveSharedSecret(
    recipientPrivateKey,
    wrap.providerEphemeralPublicKey,
  );
  const wrapContext = `marketplace-content-key:${wrap.providerId}:${wrap.contentKeyId}:${wrap.recipientKeyId}`;
  const wrapKey = await deriveAesKey(sharedSecret, new Uint8Array(0), wrapContext);
  const keyMaterial = await aesGcmDecrypt(
    wrapKey,
    wrap.ciphertext,
    wrap.tag,
    wrap.nonce,
    wrap.aad,
  );
  return decodeContentKeyMaterial(keyMaterial);
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
