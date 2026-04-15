import * as flatbuffers from "flatbuffers";

import {
  LCH,
  licensingChallengeMessageType,
  licensingChallengeRole,
} from "spacedatastandards.org/lib/js/LCH/main.js";
import { KMF, keyMaterialAlgorithm, keyMaterialEncoding, keyMaterialRole } from "spacedatastandards.org/lib/js/KMF/main.js";
import {
  ENC,
  KDF,
  KeyExchange,
  LGR,
  PLG,
  SymmetricAlgo,
  licensingGrantMessageType,
} from "spacedatastandards.org/lib/js/LGR/main.js";
import { LPF, licensingProofMessageType } from "spacedatastandards.org/lib/js/LPF/main.js";

export class LicensingProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LicensingProtocolError";
    this.code = code;
  }
}

export function encodeLicensingChallengeRequest(options) {
  const builder = new flatbuffers.Builder(512);
  const reqIdOffset = builder.createString(
    normalizeRequiredString(options.reqId, "reqId"),
  );
  const moduleIdOffset = builder.createString(
    normalizeRequiredString(options.moduleId, "moduleId"),
  );
  const moduleVersionOffset = createOptionalString(builder, options.moduleVersion);
  const requesterPeerIdOffset = builder.createString(
    normalizeRequiredString(options.requesterPeerId, "requesterPeerId"),
  );
  const requesterXpubOffset = createOptionalString(builder, options.requesterXpub);
  const requesterSigningPubkeyOffset = LCH.createRequesterSigningPubkeyVector(
    builder,
    cloneRequiredBytes(
      options.requesterSigningPublicKey,
      "requesterSigningPublicKey",
    ),
  );
  const requesterEphemeralPubkeyOffset = LCH.createRequesterEphemeralPubkeyVector(
    builder,
    cloneRequiredBytes(
      options.requesterEphemeralPublicKey,
      "requesterEphemeralPublicKey",
    ),
  );
  const requesterDomainOffset = builder.createString(
    normalizeRequiredString(options.requesterDomain, "requesterDomain"),
  );
  const providerPeerIdOffset = builder.createString(
    normalizeRequiredString(options.providerPeerId, "providerPeerId"),
  );
  const root = LCH.createLCH(
    builder,
    licensingChallengeMessageType.Request,
    licensingChallengeRole.Requester,
    reqIdOffset,
    moduleIdOffset,
    moduleVersionOffset,
    requesterPeerIdOffset,
    requesterXpubOffset,
    requesterSigningPubkeyOffset,
    requesterEphemeralPubkeyOffset,
    requesterDomainOffset,
    BigInt(normalizePositiveInteger(options.requestedTimeoutMs, "requestedTimeoutMs")),
    BigInt(normalizeInteger(options.requestedAtMs, "requestedAtMs")),
    0,
    0n,
    providerPeerIdOffset,
    0,
    0,
  );
  LCH.finishLCHBuffer(builder, root);
  return builder.asUint8Array();
}

export function decodeLicensingChallengeMessage(bytes) {
  const payload = toUint8Array(bytes, "challenge bytes");
  const bb = new flatbuffers.ByteBuffer(payload);
  if (!LCH.bufferHasIdentifier(bb)) {
    throw new LicensingProtocolError(
      "invalid_response",
      "invalid licensing challenge identifier",
    );
  }

  const message = LCH.getRootAsLCH(bb);
  const reqId = message.REQUEST_ID();
  const moduleId = message.MODULE_ID();
  if (!reqId || !moduleId) {
    throw new LicensingProtocolError(
      "invalid_response",
      "challenge message is missing required identifiers",
    );
  }

  const messageType = challengeMessageTypeName(message.MESSAGE_TYPE());
  const role = challengeRoleName(message.ROLE());

  if (message.MESSAGE_TYPE() === licensingChallengeMessageType.Error) {
    return {
      messageType,
      role,
      reqId,
      moduleId,
      moduleVersion: trimOptional(message.MODULE_VERSION()),
      errorCode: normalizeProtocolCode(message.ERROR_CODE(), "challenge_rejected"),
      errorMessage: trimOptional(message.ERROR_MESSAGE()),
      rawBytes: cloneBytes(payload),
    };
  }

  const decoded = {
    messageType,
    role,
    reqId,
    moduleId,
    moduleVersion: trimOptional(message.MODULE_VERSION()),
    requesterPeerId: trimOptional(message.REQUESTER_PEER_ID()),
    requesterXpub: trimOptional(message.REQUESTER_XPUB()),
    requesterSigningPublicKey: cloneOptionalBytes(
      message.requesterSigningPubkeyArray(),
    ),
    requesterEphemeralPublicKey: cloneOptionalBytes(
      message.requesterEphemeralPubkeyArray(),
    ),
    requestedDomain: trimOptional(message.REQUESTED_DOMAIN()),
    requestedTimeoutMs: numberFromUint64(
      message.REQUESTED_TIMEOUT_MS(),
      "challenge.REQUESTED_TIMEOUT_MS",
    ),
    requestedAtMs: numberFromUint64(
      message.REQUESTED_AT(),
      "challenge.REQUESTED_AT",
    ),
    challengeNonce: cloneOptionalBytes(message.challengeNonceArray()),
    expiresAtMs: numberFromUint64(message.EXPIRES_AT(), "challenge.EXPIRES_AT"),
    providerPeerId: trimOptional(message.PROVIDER_PEER_ID()),
    errorCode: trimOptional(message.ERROR_CODE()),
    errorMessage: trimOptional(message.ERROR_MESSAGE()),
    rawBytes: cloneBytes(payload),
  };

  if (
    message.MESSAGE_TYPE() === licensingChallengeMessageType.Response &&
    decoded.challengeNonce.length === 0
  ) {
    throw new LicensingProtocolError(
      "invalid_response",
      "challenge response is missing the challenge nonce",
    );
  }

  return decoded;
}

export function encodeLicensingProof(options) {
  const builder = new flatbuffers.Builder(512);
  const reqIdOffset = builder.createString(
    normalizeRequiredString(options.reqId, "reqId"),
  );
  const moduleIdOffset = builder.createString(
    normalizeRequiredString(options.moduleId, "moduleId"),
  );
  const moduleVersionOffset = createOptionalString(builder, options.moduleVersion);
  const requesterPeerIdOffset = builder.createString(
    normalizeRequiredString(options.requesterPeerId, "requesterPeerId"),
  );
  const requesterXpubOffset = createOptionalString(builder, options.requesterXpub);
  const requesterDomainOffset = builder.createString(
    normalizeRequiredString(options.requesterDomain, "requesterDomain"),
  );
  const requesterEphemeralPubkeyOffset = LPF.createRequesterEphemeralPubkeyVector(
    builder,
    cloneRequiredBytes(
      options.requesterEphemeralPublicKey,
      "requesterEphemeralPublicKey",
    ),
  );
  const challengeNonceOffset = LPF.createChallengeNonceVector(
    builder,
    cloneRequiredBytes(options.challengeNonce, "challengeNonce"),
  );
  const providerPeerIdOffset = builder.createString(
    normalizeRequiredString(options.providerPeerId, "providerPeerId"),
  );
  const signatureOffset = LPF.createSignatureVector(
    builder,
    cloneRequiredBytes(options.signature, "signature"),
  );
  const signingPubkeyOffset = LPF.createSigningPubkeyVector(
    builder,
    cloneRequiredBytes(
      options.requesterSigningPublicKey,
      "requesterSigningPublicKey",
    ),
  );
  const root = LPF.createLPF(
    builder,
    licensingProofMessageType.ProofRequest,
    reqIdOffset,
    moduleIdOffset,
    moduleVersionOffset,
    requesterPeerIdOffset,
    requesterXpubOffset,
    requesterDomainOffset,
    BigInt(normalizePositiveInteger(options.requestedTimeoutMs, "requestedTimeoutMs")),
    requesterEphemeralPubkeyOffset,
    challengeNonceOffset,
    BigInt(normalizeInteger(options.challengeExpiresAtMs, "challengeExpiresAtMs")),
    providerPeerIdOffset,
    signatureOffset,
    signingPubkeyOffset,
    BigInt(normalizeInteger(options.timestampMs, "timestampMs")),
    0,
    0,
  );
  LPF.finishLPFBuffer(builder, root);
  return builder.asUint8Array();
}

export function decodeLicensingProofMessage(bytes) {
  const payload = toUint8Array(bytes, "proof bytes");
  const bb = new flatbuffers.ByteBuffer(payload);
  if (!LPF.bufferHasIdentifier(bb)) {
    throw new LicensingProtocolError(
      "invalid_response",
      "invalid licensing proof identifier",
    );
  }

  const message = LPF.getRootAsLPF(bb);
  const reqId = message.REQUEST_ID();
  const moduleId = message.MODULE_ID();
  if (!reqId || !moduleId) {
    throw new LicensingProtocolError(
      "invalid_response",
      "proof message is missing required identifiers",
    );
  }

  return {
    messageType: proofMessageTypeName(message.MESSAGE_TYPE()),
    reqId,
    moduleId,
    moduleVersion: trimOptional(message.MODULE_VERSION()),
    requesterPeerId: trimOptional(message.REQUESTER_PEER_ID()),
    requesterXpub: trimOptional(message.REQUESTER_XPUB()),
    requestedDomain: trimOptional(message.REQUESTED_DOMAIN()),
    requestedTimeoutMs: numberFromUint64(
      message.REQUESTED_TIMEOUT_MS(),
      "proof.REQUESTED_TIMEOUT_MS",
    ),
    requesterEphemeralPublicKey: cloneOptionalBytes(
      message.requesterEphemeralPubkeyArray(),
    ),
    challengeNonce: cloneOptionalBytes(message.challengeNonceArray()),
    challengeExpiresAtMs: numberFromUint64(
      message.CHALLENGE_EXPIRES_AT(),
      "proof.CHALLENGE_EXPIRES_AT",
    ),
    providerPeerId: trimOptional(message.PROVIDER_PEER_ID()),
    signature: cloneOptionalBytes(message.signatureArray()),
    requesterSigningPublicKey: cloneOptionalBytes(message.signingPubkeyArray()),
    timestampMs: numberFromUint64(message.TIMESTAMP_MS(), "proof.TIMESTAMP_MS"),
    rejectionCode: trimOptional(message.REJECTION_CODE()),
    rejectionMessage: trimOptional(message.REJECTION_MESSAGE()),
    rawBytes: cloneBytes(payload),
  };
}

export function decodeLicensingGrant(bytes) {
  const payload = toUint8Array(bytes, "grant bytes");
  const bb = new flatbuffers.ByteBuffer(payload);
  if (!LGR.bufferHasIdentifier(bb)) {
    throw new LicensingProtocolError(
      "invalid_response",
      "invalid licensing grant identifier",
    );
  }

  const grant = LGR.getRootAsLGR(bb);
  const reqId = grant.REQUEST_ID();
  const moduleId = grant.MODULE_ID();
  if (!reqId || !moduleId) {
    throw new LicensingProtocolError(
      "invalid_response",
      "grant response is missing required identifiers",
    );
  }

  const messageType = grantMessageTypeName(grant.MESSAGE_TYPE());
  const decoded = {
    messageType,
    reqId,
    moduleId,
    moduleVersion: trimOptional(grant.MODULE_VERSION()),
    requesterPeerId: trimOptional(grant.REQUESTER_PEER_ID()),
    requesterXpub: trimOptional(grant.REQUESTER_XPUB()),
    requestedDomain: trimOptional(grant.REQUESTED_DOMAIN()),
    requestedTimeoutMs: numberFromUint64(
      grant.REQUESTED_TIMEOUT_MS(),
      "grant.REQUESTED_TIMEOUT_MS",
    ),
    grantedDomain: trimOptional(grant.GRANTED_DOMAIN()),
    grantedTimeoutMs: numberFromUint64(
      grant.GRANTED_TIMEOUT_MS(),
      "grant.GRANTED_TIMEOUT_MS",
    ),
    expiresAtMs: numberFromUint64(grant.EXPIRES_AT(), "grant.EXPIRES_AT"),
    requiredScope: trimOptional(grant.REQUIRED_SCOPE()),
    grantStatus: trimOptional(grant.GRANT_STATUS()),
    denialReason: trimOptional(grant.DENIAL_REASON()),
    capabilityToken: cloneOptionalBytes(grant.capabilityTokenArray()),
    grantVerifierPublicKey: cloneOptionalBytes(
      grant.grantVerifierPubkeyArray(),
    ),
    providerSignature: cloneOptionalBytes(grant.providerSignatureArray()),
    moduleDescriptor: null,
    wrappedContentKey: null,
    rawBytes: cloneBytes(payload),
  };

  if (grant.MESSAGE_TYPE() === licensingGrantMessageType.Granted) {
    decoded.moduleDescriptor = decodeGrantModuleDescriptor(grant.MODULE_DESCRIPTOR());
    decoded.wrappedContentKey = decodeWrappedContentKey(
      grant.WRAPPED_CONTENT_KEY_HEADER(),
      grant.wrappedContentKeyPayloadArray(),
      decoded.expiresAtMs,
    );
  }

  return decoded;
}

export function validateLicensingGrant(grant, options = {}) {
  if (!grant || typeof grant !== "object") {
    throw new TypeError("grant is required");
  }

  if (grant.messageType === "denied") {
    throw new LicensingProtocolError(
      normalizeProtocolCode(grant.grantStatus, "grant_denied"),
      grant.denialReason || "grant request denied",
    );
  }

  if (grant.messageType !== "granted") {
    throw new LicensingProtocolError(
      "unexpected_response",
      "expected licensing grant response",
    );
  }

  if (!grant.moduleDescriptor || !grant.wrappedContentKey) {
    throw new LicensingProtocolError(
      "invalid_grant",
      "grant response is missing the module descriptor or wrapped content key",
    );
  }

  const grantedDomain = trimOptional(grant.grantedDomain);
  if (!grantedDomain) {
    throw new LicensingProtocolError(
      "invalid_grant",
      "grant response is missing the granted domain",
    );
  }
  if (grant.grantedTimeoutMs <= 0) {
    throw new LicensingProtocolError(
      "grant_policy_mismatch",
      "grant timeout must be a positive duration",
    );
  }

  if (options.reqId && grant.reqId !== options.reqId) {
    throw new LicensingProtocolError(
      "request_mismatch",
      "grant response request id mismatch",
    );
  }
  if (options.moduleId && grant.moduleId !== options.moduleId) {
    throw new LicensingProtocolError(
      "request_mismatch",
      "grant response module id mismatch",
    );
  }
  if (
    options.moduleVersion &&
    grant.moduleVersion &&
    grant.moduleVersion !== options.moduleVersion
  ) {
    throw new LicensingProtocolError(
      "request_mismatch",
      "grant response module version mismatch",
    );
  }
  if (
    (options.expectedDomain ?? grant.requestedDomain) &&
    grantedDomain !== (options.expectedDomain ?? grant.requestedDomain)
  ) {
    throw new LicensingProtocolError(
      "grant_policy_mismatch",
      "grant domain does not match the requested domain",
    );
  }
  if (
    Number.isFinite(options.requestedTimeoutMs) &&
    (grant.grantedTimeoutMs <= 0 ||
      grant.grantedTimeoutMs > options.requestedTimeoutMs)
  ) {
    throw new LicensingProtocolError(
      "grant_policy_mismatch",
      "grant timeout exceeds the requested timeout",
    );
  }
  const expectedVerifierKeyLength = Number.isFinite(
    options.grantVerifierPublicKeyLength,
  )
    ? options.grantVerifierPublicKeyLength
    : 32;
  if (grant.grantVerifierPublicKey.length !== expectedVerifierKeyLength) {
    throw new LicensingProtocolError(
      "invalid_grant",
      `grant verifier public key must be ${expectedVerifierKeyLength} bytes`,
    );
  }

  return grant;
}

export function extractGrantModuleDescriptor(grant) {
  if (!grant?.moduleDescriptor) {
    throw new LicensingProtocolError(
      "invalid_grant",
      "grant response is missing the module descriptor",
    );
  }
  return grant.moduleDescriptor;
}

export function extractWrappedContentKey(grant) {
  if (!grant?.wrappedContentKey) {
    throw new LicensingProtocolError(
      "invalid_grant",
      "grant response is missing the wrapped content key",
    );
  }
  return grant.wrappedContentKey;
}

function decodeGrantModuleDescriptor(moduleDescriptor) {
  if (!moduleDescriptor) {
    throw new LicensingProtocolError(
      "invalid_grant",
      "grant response is missing the module descriptor",
    );
  }

  const cid = moduleDescriptor.WASM_CID();
  if (!cid) {
    throw new LicensingProtocolError(
      "invalid_grant",
      "grant response is missing the published CID",
    );
  }

  const encrypted = Boolean(moduleDescriptor.ENCRYPTED());
  const contentHash = encrypted
    ? cloneOptionalBytes(
        moduleDescriptor.encryptedWasmHashArray() ??
          moduleDescriptor.wasmHashArray(),
      )
    : cloneOptionalBytes(moduleDescriptor.wasmHashArray());
  const sizeBytes =
    encrypted && moduleDescriptor.ENCRYPTED_WASM_SIZE() > 0n
      ? numberFromUint64(
          moduleDescriptor.ENCRYPTED_WASM_SIZE(),
          "moduleDescriptor.ENCRYPTED_WASM_SIZE",
        )
      : numberFromUint64(
          moduleDescriptor.WASM_SIZE(),
          "moduleDescriptor.WASM_SIZE",
        );

  return {
    cid,
    contentHash,
    sizeBytes,
    moduleId: normalizeRequiredString(
      moduleDescriptor.PLUGIN_ID() || "",
      "moduleDescriptor.PLUGIN_ID",
    ),
    moduleVersion: trimOptional(moduleDescriptor.VERSION()),
    requiredScope: trimOptional(moduleDescriptor.REQUIRED_SCOPE()),
    keyId: trimOptional(moduleDescriptor.KEY_ID()),
    allowedDomains: readAllowedDomains(moduleDescriptor),
    maxGrantTimeoutMs: numberFromUint64(
      moduleDescriptor.MAX_GRANT_TIMEOUT_MS(),
      "moduleDescriptor.MAX_GRANT_TIMEOUT_MS",
    ),
    encrypted,
  };
}

function decodeWrappedContentKey(header, payload, expiresAtMs) {
  const encryptedPayload = cloneOptionalBytes(payload);
  if (!header || encryptedPayload.length === 0) {
    throw new LicensingProtocolError(
      "invalid_grant",
      "grant response is missing the wrapped content key payload",
    );
  }

  const providerEphemeralPublicKey = cloneOptionalBytes(
    header.ephemeralPublicKeyArray(),
  );
  const nonceStart = cloneOptionalBytes(header.nonceStartArray());
  const recipientKeyIdBytes = cloneOptionalBytes(header.recipientKeyIdArray());
  const schemaHash = cloneOptionalBytes(header.schemaHashArray());
  if (providerEphemeralPublicKey.length === 0 || nonceStart.length === 0) {
    throw new LicensingProtocolError(
      "invalid_grant",
      "wrapped content key header is incomplete",
    );
  }

  const keyMaterial = decodeWrappedKeyMaterialFrame(encryptedPayload);
  return {
    wrappingAlgorithm: wrappedContentKeySchemeName(header),
    contentKeyId: keyMaterial?.keyId,
    contentKeyRole: keyMaterial?.roleName,
    contentKeyAlgorithm: keyMaterial?.algorithmName,
    contentKeyEncoding: keyMaterial?.encodingName,
    keyBytes: keyMaterial?.keyBytes ?? new Uint8Array(0),
    contentKeyVersion: keyMaterial?.version,
    recipientKeyId:
      recipientKeyIdBytes.length > 0 ? bytesToHex(recipientKeyIdBytes) : undefined,
    requesterEphemeralPublicKey: new Uint8Array(0),
    providerEphemeralPublicKey,
    hkdfSalt: new Uint8Array(0),
    iv: nonceStart,
    ciphertext: encryptedPayload,
    tag: new Uint8Array(0),
    expiresAtMs,
    recipientPublicKey: new Uint8Array(0),
    ephemeralPublicKey: providerEphemeralPublicKey,
    nonce: nonceStart,
    header: {
      version: header.VERSION(),
      keyExchange: keyExchangeName(header.KEY_EXCHANGE()),
      symmetric: symmetricAlgorithmName(header.SYMMETRIC()),
      keyDerivation: keyDerivationName(header.KEY_DERIVATION()),
      ephemeralPublicKey: providerEphemeralPublicKey,
      nonceStart,
      recipientKeyId: recipientKeyIdBytes,
      context: trimOptional(header.CONTEXT()),
      schemaHash,
      rootType: trimOptional(header.ROOT_TYPE()),
      timestamp:
        header.TIMESTAMP() > 0n
          ? numberFromUint64(
              header.TIMESTAMP(),
              "wrappedContentKeyHeader.TIMESTAMP",
            )
          : undefined,
    },
    encryptedPayload,
    recipientKeyIdBytes,
    schemaHash,
    keyMaterialRootType: trimOptional(header.ROOT_TYPE()),
  };
}

function decodeWrappedKeyMaterialFrame(bytes) {
  const bb = new flatbuffers.ByteBuffer(bytes);
  if (!KMF.bufferHasIdentifier(bb)) {
    return null;
  }

  const kmf = KMF.getRootAsKMF(bb);
  return {
    keyId: trimOptional(kmf.KEY_ID()),
    role: kmf.ROLE(),
    roleName: keyMaterialRoleName(kmf.ROLE()),
    algorithm: kmf.ALGORITHM(),
    algorithmName: keyMaterialAlgorithmName(kmf.ALGORITHM()),
    encoding: kmf.ENCODING(),
    encodingName: keyMaterialEncodingName(kmf.ENCODING()),
    keyBytes: cloneOptionalBytes(kmf.keyBytesArray()),
    version: kmf.VERSION(),
    expiresAtMs: numberFromUint64(kmf.EXPIRES_AT(), "kmf.EXPIRES_AT"),
  };
}

function createOptionalString(builder, value) {
  const normalized = trimOptional(value);
  return normalized ? builder.createString(normalized) : 0;
}

function toUint8Array(value, label) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`${label} must be a Uint8Array, ArrayBuffer, or view.`);
}

function normalizeRequiredString(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function trimOptional(value) {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function normalizeInteger(value, name) {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return Math.trunc(value);
}

function normalizePositiveInteger(value, name) {
  const normalized = normalizeInteger(value, name);
  if (normalized <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return normalized;
}

function cloneRequiredBytes(value, name) {
  const bytes = cloneOptionalBytes(value);
  if (bytes.length === 0) {
    throw new Error(`${name} is required`);
  }
  return bytes;
}

function cloneOptionalBytes(value) {
  if (!value) {
    return new Uint8Array(0);
  }
  return value instanceof Uint8Array ? value.slice() : Uint8Array.from(value);
}

function cloneBytes(value) {
  return value.slice();
}

function numberFromUint64(value, name) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new LicensingProtocolError(
      "invalid_response",
      `${name} exceeds JavaScript safe integer range`,
    );
  }
  return Number(value);
}

function normalizeProtocolCode(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function challengeMessageTypeName(value) {
  switch (value) {
    case licensingChallengeMessageType.Request:
      return "request";
    case licensingChallengeMessageType.Response:
      return "response";
    case licensingChallengeMessageType.Error:
      return "error";
    default:
      return `unknown_${value}`;
  }
}

function challengeRoleName(value) {
  switch (value) {
    case licensingChallengeRole.Requester:
      return "requester";
    case licensingChallengeRole.Provider:
      return "provider";
    default:
      return `unknown_${value}`;
  }
}

function proofMessageTypeName(value) {
  switch (value) {
    case licensingProofMessageType.ProofRequest:
      return "proof-request";
    case licensingProofMessageType.ProofAccepted:
      return "proof-accepted";
    case licensingProofMessageType.ProofRejected:
      return "proof-rejected";
    default:
      return `unknown_${value}`;
  }
}

function grantMessageTypeName(value) {
  switch (value) {
    case licensingGrantMessageType.Request:
      return "request";
    case licensingGrantMessageType.Granted:
      return "granted";
    case licensingGrantMessageType.Denied:
      return "denied";
    default:
      return `unknown_${value}`;
  }
}

function wrappedContentKeySchemeName(value) {
  if (
    value.KEY_EXCHANGE() === KeyExchange.X25519 &&
    value.KEY_DERIVATION() === KDF.HKDF_SHA256 &&
    value.SYMMETRIC() === SymmetricAlgo.AES_256_CTR
  ) {
    return "x25519-hkdf-sha256-aes-256-ctr-rec";
  }
  return [
    keyExchangeName(value.KEY_EXCHANGE()),
    keyDerivationName(value.KEY_DERIVATION()),
    symmetricAlgorithmName(value.SYMMETRIC()),
    "rec",
  ]
    .join("-")
    .toLowerCase();
}

function keyExchangeName(value) {
  switch (value) {
    case KeyExchange.X25519:
      return "X25519";
    case KeyExchange.Secp256k1:
      return "Secp256k1";
    case KeyExchange.P256:
      return "P256";
    default:
      return `UNKNOWN_${value}`;
  }
}

function symmetricAlgorithmName(value) {
  switch (value) {
    case SymmetricAlgo.AES_256_CTR:
      return "AES_256_CTR";
    default:
      return `UNKNOWN_${value}`;
  }
}

function keyDerivationName(value) {
  switch (value) {
    case KDF.HKDF_SHA256:
      return "HKDF_SHA256";
    default:
      return `UNKNOWN_${value}`;
  }
}

function keyMaterialRoleName(value) {
  switch (value) {
    case keyMaterialRole.PublicationContent:
      return "PublicationContent";
    case keyMaterialRole.RequesterSigning:
      return "RequesterSigning";
    case keyMaterialRole.VerificationKey:
      return "VerificationKey";
    case keyMaterialRole.DecryptKey:
      return "DecryptKey";
    case keyMaterialRole.Unknown:
      return "Unknown";
    default:
      return `UNKNOWN_${value}`;
  }
}

function keyMaterialAlgorithmName(value) {
  switch (value) {
    case keyMaterialAlgorithm.Ed25519Seed:
      return "Ed25519Seed";
    case keyMaterialAlgorithm.Ed25519Public:
      return "Ed25519Public";
    case keyMaterialAlgorithm.X25519Private:
      return "X25519Private";
    case keyMaterialAlgorithm.X25519Public:
      return "X25519Public";
    case keyMaterialAlgorithm.Aes256Gcm:
      return "Aes256Gcm";
    case keyMaterialAlgorithm.Opaque:
      return "Opaque";
    case keyMaterialAlgorithm.Unknown:
      return "Unknown";
    default:
      return `UNKNOWN_${value}`;
  }
}

function keyMaterialEncodingName(value) {
  switch (value) {
    case keyMaterialEncoding.RawBytes:
      return "RawBytes";
    case keyMaterialEncoding.Seed32:
      return "Seed32";
    case keyMaterialEncoding.PublicKey32:
      return "PublicKey32";
    case keyMaterialEncoding.Unknown:
      return "Unknown";
    default:
      return `UNKNOWN_${value}`;
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function readAllowedDomains(descriptor) {
  const allowedDomains = [];
  for (let index = 0; index < descriptor.allowedDomainsLength(); index += 1) {
    const domain = descriptor.ALLOWED_DOMAINS(index);
    if (domain) {
      allowedDomains.push(domain);
    }
  }
  return allowedDomains;
}

export {
  bytesToHex,
  keyDerivationName,
  keyExchangeName,
  symmetricAlgorithmName,
};
