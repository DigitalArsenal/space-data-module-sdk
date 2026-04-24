import test from "node:test";
import assert from "node:assert/strict";

import * as flatbuffers from "flatbuffers";

import {
  ENC,
  KDF,
  KeyExchange,
  LGR,
  PLG,
  SymmetricAlgo,
  licensingGrantMessageType,
} from "spacedatastandards.org/lib/js/LGR/main.js";
import {
  LCH,
  licensingChallengeMessageType,
  licensingChallengeRole,
} from "spacedatastandards.org/lib/js/LCH/main.js";
import { KMF, keyMaterialAlgorithm, keyMaterialEncoding, keyMaterialRole } from "spacedatastandards.org/lib/js/KMF/main.js";
import { LPF, licensingProofMessageType } from "spacedatastandards.org/lib/js/LPF/main.js";
import { pluginCategory } from "spacedatastandards.org/lib/js/PLG/main.js";

import {
  LicensingProtocolError,
  decodeLicensingChallengeMessage,
  decodeLicensingGrant,
  decodeLicensingProofMessage,
  encodeLicensingChallengeRequest,
  encodeLicensingProof,
  extractGrantModuleDescriptor,
  extractWrappedContentKey,
  validateLicensingGrant,
} from "../src/index.js";

test("licensing challenge requests encode and decode through SDS LCH", () => {
  const bytes = encodeLicensingChallengeRequest({
    reqId: "req-123",
    moduleId: "com.space-data-network.fastest-path",
    moduleVersion: "0.5.22",
    requesterPeerId: "requester-peer-id",
    requesterXpub: "xpub-requester",
    requesterSigningPublicKey: new Uint8Array(32).fill(6),
    requesterEphemeralPublicKey: new Uint8Array(32).fill(8),
    requesterDomain: "app.example.com",
    requestedTimeoutMs: 300_000,
    requestedAtMs: 1_700_000_000_000,
    providerPeerId: "provider-peer-id",
  });

  const decoded = decodeLicensingChallengeMessage(bytes);
  const message = LCH.getRootAsLCH(new flatbuffers.ByteBuffer(bytes));

  assert.equal(message.MESSAGE_TYPE(), licensingChallengeMessageType.Request);
  assert.equal(message.ROLE(), licensingChallengeRole.Requester);
  assert.equal(message.REQUEST_ID(), "req-123");
  assert.equal(decoded.messageType, "request");
  assert.equal(decoded.role, "requester");
  assert.equal(decoded.reqId, "req-123");
  assert.equal(decoded.moduleId, "com.space-data-network.fastest-path");
  assert.equal(decoded.moduleVersion, "0.5.22");
  assert.equal(decoded.requesterPeerId, "requester-peer-id");
  assert.equal(decoded.requesterXpub, "xpub-requester");
  assert.equal(decoded.requestedDomain, "app.example.com");
  assert.equal(decoded.requestedTimeoutMs, 300_000);
  assert.equal(decoded.requestedAtMs, 1_700_000_000_000);
  assert.equal(decoded.providerPeerId, "provider-peer-id");
  assert.deepEqual(decoded.requesterSigningPublicKey, new Uint8Array(32).fill(6));
  assert.deepEqual(decoded.requesterEphemeralPublicKey, new Uint8Array(32).fill(8));
});

test("licensing challenge responses decode challenge nonce and provider details", () => {
  const bytes = encodeChallengeResponseFixture({
    reqId: "req-123",
    moduleId: "com.space-data-network.fastest-path",
    moduleVersion: "0.5.22",
    providerPeerId: "provider-peer-id",
    challengeNonce: new Uint8Array([1, 2, 3, 4]),
    expiresAtMs: 1_700_000_900_000n,
  });

  const decoded = decodeLicensingChallengeMessage(bytes);

  assert.equal(decoded.messageType, "response");
  assert.equal(decoded.role, "provider");
  assert.equal(decoded.reqId, "req-123");
  assert.equal(decoded.moduleId, "com.space-data-network.fastest-path");
  assert.equal(decoded.moduleVersion, "0.5.22");
  assert.equal(decoded.providerPeerId, "provider-peer-id");
  assert.equal(decoded.expiresAtMs, 1_700_000_900_000);
  assert.deepEqual(decoded.challengeNonce, new Uint8Array([1, 2, 3, 4]));
});

test("licensing proofs encode and decode through SDS LPF", () => {
  const bytes = encodeLicensingProof({
    reqId: "req-123",
    moduleId: "com.space-data-network.fastest-path",
    moduleVersion: "0.5.22",
    requesterPeerId: "requester-peer-id",
    requesterXpub: "xpub-requester",
    requesterDomain: "app.example.com",
    requestedTimeoutMs: 300_000,
    requesterEphemeralPublicKey: new Uint8Array(32).fill(8),
    challengeNonce: new Uint8Array([1, 2, 3, 4]),
    challengeExpiresAtMs: 1_700_000_900_000,
    providerPeerId: "provider-peer-id",
    signature: new Uint8Array([0xaa, 0xbb, 0xcc]),
    requesterSigningPublicKey: new Uint8Array(32).fill(6),
    timestampMs: 1_700_000_123_456,
  });

  const decoded = decodeLicensingProofMessage(bytes);
  const message = LPF.getRootAsLPF(new flatbuffers.ByteBuffer(bytes));

  assert.equal(message.MESSAGE_TYPE(), licensingProofMessageType.ProofRequest);
  assert.equal(decoded.messageType, "proof-request");
  assert.equal(decoded.reqId, "req-123");
  assert.equal(decoded.moduleId, "com.space-data-network.fastest-path");
  assert.equal(decoded.moduleVersion, "0.5.22");
  assert.equal(decoded.requesterPeerId, "requester-peer-id");
  assert.equal(decoded.requesterXpub, "xpub-requester");
  assert.equal(decoded.requestedDomain, "app.example.com");
  assert.equal(decoded.requestedTimeoutMs, 300_000);
  assert.equal(decoded.challengeExpiresAtMs, 1_700_000_900_000);
  assert.equal(decoded.providerPeerId, "provider-peer-id");
  assert.equal(decoded.timestampMs, 1_700_000_123_456);
  assert.deepEqual(decoded.requesterEphemeralPublicKey, new Uint8Array(32).fill(8));
  assert.deepEqual(decoded.challengeNonce, new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual(decoded.signature, new Uint8Array([0xaa, 0xbb, 0xcc]));
  assert.deepEqual(decoded.requesterSigningPublicKey, new Uint8Array(32).fill(6));
});

test("granted licensing grants decode, validate, and expose PLG plus wrapped key payloads", () => {
  const bytes = encodeGrantedGrantFixture({
    reqId: "req-123",
    moduleId: "com.space-data-network.fastest-path",
    moduleVersion: "0.5.22",
    requesterPeerId: "requester-peer-id",
    requesterXpub: "xpub-requester",
    requestedDomain: "app.example.com",
    requestedTimeoutMs: 300_000n,
    grantedDomain: "app.example.com",
    grantedTimeoutMs: 300_000n,
    expiresAtMs: 1_700_003_600_000n,
    contentHash: new Uint8Array(32).fill(7),
  });

  const decoded = decodeLicensingGrant(bytes);
  const validated = validateLicensingGrant(decoded, {
    reqId: "req-123",
    moduleId: "com.space-data-network.fastest-path",
    moduleVersion: "0.5.22",
    expectedDomain: "app.example.com",
    requestedTimeoutMs: 300_000,
    grantVerifierPublicKeyLength: 32,
  });
  const descriptor = extractGrantModuleDescriptor(validated);
  const wrappedContentKey = extractWrappedContentKey(validated);
  const kmf = KMF.getRootAsKMF(
    new flatbuffers.ByteBuffer(wrappedContentKey.encryptedPayload),
  );

  assert.equal(decoded.messageType, "granted");
  assert.equal(validated.grantedDomain, "app.example.com");
  assert.equal(validated.grantedTimeoutMs, 300_000);
  assert.equal(validated.expiresAtMs, 1_700_003_600_000);
  assert.equal(validated.requiredScope, "orbpro.default");
  assert.equal(validated.grantStatus, "active");
  assert.equal(descriptor.cid, "bafyencryptedmodule");
  assert.equal(descriptor.moduleId, "com.space-data-network.fastest-path");
  assert.equal(descriptor.moduleVersion, "0.5.22");
  assert.equal(descriptor.keyId, "com.space-data-network.fastest-path:0.5.22");
  assert.deepEqual(descriptor.contentHash, new Uint8Array(32).fill(7));
  assert.deepEqual(descriptor.allowedDomains, ["app.example.com"]);
  assert.equal(descriptor.encrypted, true);
  assert.equal(wrappedContentKey.wrappingAlgorithm, "x25519-hkdf-sha256-aes-256-ctr-rec");
  assert.equal(wrappedContentKey.contentKeyId, "com.space-data-network.fastest-path:0.5.22");
  assert.equal(wrappedContentKey.recipientKeyId, "7265717565737465722d656e6372797074696f6e2d6b6579");
  assert.equal(wrappedContentKey.keyMaterialRootType, "$KMF");
  assert.deepEqual(wrappedContentKey.providerEphemeralPublicKey, new Uint8Array(32).fill(9));
  assert.deepEqual(wrappedContentKey.nonce, new Uint8Array(12).fill(4));
  assert.equal(kmf.KEY_ID(), "com.space-data-network.fastest-path:0.5.22");
  assert.deepEqual(kmf.keyBytesArray(), new Uint8Array([4, 5, 6]));
});

test("grant validation defaults enforce domain and verifier-key invariants", () => {
  const mismatchedDomain = decodeLicensingGrant(
    encodeGrantedGrantFixture({
      reqId: "req-mismatch",
      moduleId: "com.space-data-network.fastest-path",
      moduleVersion: "0.5.22",
      requesterPeerId: "requester-peer-id",
      requesterXpub: "xpub-requester",
      requestedDomain: "app.example.com",
      grantedDomain: "other.example.com",
      requestedTimeoutMs: 300_000n,
      grantedTimeoutMs: 300_000n,
      expiresAtMs: 1_700_003_600_000n,
      contentHash: new Uint8Array(32).fill(7),
    }),
  );
  assert.throws(
    () => validateLicensingGrant(mismatchedDomain),
    (error) =>
      error instanceof LicensingProtocolError &&
      error.code === "grant_policy_mismatch" &&
      /grant domain does not match/i.test(error.message),
  );

  const shortVerifierKey = decodeLicensingGrant(
    encodeGrantedGrantFixture({
      reqId: "req-short-key",
      moduleId: "com.space-data-network.fastest-path",
      moduleVersion: "0.5.22",
      requesterPeerId: "requester-peer-id",
      requesterXpub: "xpub-requester",
      requestedDomain: "app.example.com",
      grantedDomain: "app.example.com",
      requestedTimeoutMs: 300_000n,
      grantedTimeoutMs: 300_000n,
      expiresAtMs: 1_700_003_600_000n,
      contentHash: new Uint8Array(32).fill(7),
      grantVerifierPublicKey: new Uint8Array(31).fill(5),
    }),
  );
  assert.throws(
    () => validateLicensingGrant(shortVerifierKey),
    (error) =>
      error instanceof LicensingProtocolError &&
      error.code === "invalid_grant" &&
      /grant verifier public key must be 32 bytes/i.test(error.message),
  );
});

test("denied licensing grants decode and validate as protocol errors", () => {
  const bytes = encodeDeniedGrantFixture({
    reqId: "req-denied",
    moduleId: "com.space-data-network.fastest-path",
    grantStatus: "policy_denied",
    denialReason: "domain rejected",
  });

  const decoded = decodeLicensingGrant(bytes);

  assert.equal(decoded.messageType, "denied");
  assert.equal(decoded.reqId, "req-denied");
  assert.equal(decoded.moduleId, "com.space-data-network.fastest-path");
  assert.equal(decoded.grantStatus, "policy_denied");
  assert.equal(decoded.denialReason, "domain rejected");
  assert.throws(
    () => validateLicensingGrant(decoded),
    (error) =>
      error instanceof LicensingProtocolError &&
      error.code === "policy_denied" &&
      /domain rejected/i.test(error.message),
  );
});

function encodeChallengeResponseFixture(options) {
  const builder = new flatbuffers.Builder(256);
  const reqIdOffset = builder.createString(options.reqId);
  const moduleIdOffset = builder.createString(options.moduleId);
  const moduleVersionOffset = options.moduleVersion ? builder.createString(options.moduleVersion) : 0;
  const providerPeerIdOffset = builder.createString(options.providerPeerId);
  const challengeNonceOffset = LCH.createChallengeNonceVector(builder, options.challengeNonce);
  const root = LCH.createLCH(
    builder,
    licensingChallengeMessageType.Response,
    licensingChallengeRole.Provider,
    reqIdOffset,
    moduleIdOffset,
    moduleVersionOffset,
    0,
    0,
    0,
    0,
    0,
    0n,
    0n,
    challengeNonceOffset,
    options.expiresAtMs,
    providerPeerIdOffset,
    0,
    0,
  );
  LCH.finishLCHBuffer(builder, root);
  return builder.asUint8Array();
}

function encodeGrantedGrantFixture(options) {
  const builder = new flatbuffers.Builder(1024);
  const reqIdOffset = builder.createString(options.reqId);
  const moduleIdOffset = builder.createString(options.moduleId);
  const moduleVersionOffset = options.moduleVersion ? builder.createString(options.moduleVersion) : 0;
  const requesterPeerIdOffset = options.requesterPeerId ? builder.createString(options.requesterPeerId) : 0;
  const requesterXpubOffset = options.requesterXpub ? builder.createString(options.requesterXpub) : 0;
  const requestedDomainOffset = builder.createString(options.requestedDomain);
  const grantedDomainOffset = builder.createString(options.grantedDomain);
  const requiredScopeOffset = builder.createString("orbpro.default");
  const grantStatusOffset = builder.createString("active");
  const capabilityTokenOffset = LGR.createCapabilityTokenVector(builder, new Uint8Array([1, 2, 3]));
  const moduleDescriptorOffset = createModuleDescriptorOffset(builder, options.contentHash);
  const wrappedContentKeyHeaderOffset = createWrappedContentKeyHeaderOffset(builder, options);
  const wrappedContentKeyPayloadOffset = createWrappedContentKeyPayloadOffset(builder, options);
  const verifierPubkeyOffset = LGR.createGrantVerifierPubkeyVector(
    builder,
    options.grantVerifierPublicKey ?? new Uint8Array(32).fill(5),
  );
  const providerSignatureOffset = LGR.createProviderSignatureVector(builder, new Uint8Array([9, 9, 9]));

  LGR.startLGR(builder);
  LGR.addMessageType(builder, licensingGrantMessageType.Granted);
  LGR.addRequestId(builder, reqIdOffset);
  LGR.addModuleId(builder, moduleIdOffset);
  if (moduleVersionOffset !== 0) {
    LGR.addModuleVersion(builder, moduleVersionOffset);
  }
  if (requesterPeerIdOffset !== 0) {
    LGR.addRequesterPeerId(builder, requesterPeerIdOffset);
  }
  if (requesterXpubOffset !== 0) {
    LGR.addRequesterXpub(builder, requesterXpubOffset);
  }
  LGR.addRequestedDomain(builder, requestedDomainOffset);
  LGR.addRequestedTimeoutMs(builder, options.requestedTimeoutMs);
  LGR.addGrantedDomain(builder, grantedDomainOffset);
  LGR.addGrantedTimeoutMs(builder, options.grantedTimeoutMs);
  LGR.addExpiresAt(builder, options.expiresAtMs);
  LGR.addRequiredScope(builder, requiredScopeOffset);
  LGR.addGrantStatus(builder, grantStatusOffset);
  LGR.addCapabilityToken(builder, capabilityTokenOffset);
  LGR.addModuleDescriptor(builder, moduleDescriptorOffset);
  LGR.addWrappedContentKeyHeader(builder, wrappedContentKeyHeaderOffset);
  LGR.addWrappedContentKeyPayload(builder, wrappedContentKeyPayloadOffset);
  LGR.addGrantVerifierPubkey(builder, verifierPubkeyOffset);
  LGR.addProviderSignature(builder, providerSignatureOffset);
  const root = LGR.endLGR(builder);
  LGR.finishLGRBuffer(builder, root);
  return builder.asUint8Array();
}

function encodeDeniedGrantFixture(options) {
  const builder = new flatbuffers.Builder(256);
  const reqIdOffset = builder.createString(options.reqId);
  const moduleIdOffset = builder.createString(options.moduleId);
  const grantStatusOffset = builder.createString(options.grantStatus);
  const denialReasonOffset = builder.createString(options.denialReason);

  LGR.startLGR(builder);
  LGR.addMessageType(builder, licensingGrantMessageType.Denied);
  LGR.addRequestId(builder, reqIdOffset);
  LGR.addModuleId(builder, moduleIdOffset);
  LGR.addGrantStatus(builder, grantStatusOffset);
  LGR.addDenialReason(builder, denialReasonOffset);
  const root = LGR.endLGR(builder);
  LGR.finishLGRBuffer(builder, root);
  return builder.asUint8Array();
}

function createModuleDescriptorOffset(builder, contentHash) {
  const moduleId = "com.space-data-network.fastest-path";
  const moduleVersion = "0.5.22";
  const pluginIdOffset = builder.createString(moduleId);
  const nameOffset = builder.createString(moduleId);
  const versionOffset = builder.createString(moduleVersion);
  const descriptionOffset = builder.createString("Protected module fixture");
  const wasmHashOffset = PLG.createWasmHashVector(builder, contentHash);
  const wasmCidOffset = builder.createString("bafyencryptedmodule");
  const requiredScopeOffset = builder.createString("orbpro.default");
  const keyIdOffset = builder.createString(`${moduleId}:${moduleVersion}`);
  const allowedDomainsOffset = PLG.createAllowedDomainsVector(
    builder,
    [builder.createString("app.example.com")],
  );

  PLG.startPLG(builder);
  PLG.addPluginId(builder, pluginIdOffset);
  PLG.addName(builder, nameOffset);
  PLG.addVersion(builder, versionOffset);
  PLG.addDescription(builder, descriptionOffset);
  PLG.addPluginType(builder, pluginCategory.Analysis);
  PLG.addAbiVersion(builder, 1);
  PLG.addWasmHash(builder, wasmHashOffset);
  PLG.addWasmSize(builder, 4n);
  PLG.addWasmCid(builder, wasmCidOffset);
  PLG.addEncrypted(builder, true);
  PLG.addRequiredScope(builder, requiredScopeOffset);
  PLG.addKeyId(builder, keyIdOffset);
  PLG.addAllowedDomains(builder, allowedDomainsOffset);
  PLG.addMaxGrantTimeoutMs(builder, 300_000n);
  return PLG.endPLG(builder);
}

function createWrappedContentKeyHeaderOffset(builder, options) {
  const ephemeralPublicKeyOffset = ENC.createEphemeralPublicKeyVector(builder, new Uint8Array(32).fill(9));
  const nonceStartOffset = ENC.createNonceStartVector(builder, new Uint8Array(12).fill(4));
  const recipientKeyIdOffset = ENC.createRecipientKeyIdVector(
    builder,
    new TextEncoder().encode("requester-encryption-key"),
  );
  const contextOffset = builder.createString(
    `license-grant:${options.moduleId}:${options.moduleVersion ?? "latest"}`,
  );
  const rootTypeOffset = builder.createString("$KMF");

  return ENC.createENC(
    builder,
    1,
    KeyExchange.X25519,
    SymmetricAlgo.AES_256_CTR,
    KDF.HKDF_SHA256,
    ephemeralPublicKeyOffset,
    nonceStartOffset,
    recipientKeyIdOffset,
    contextOffset,
    0,
    rootTypeOffset,
    options.expiresAtMs,
  );
}

function createWrappedContentKeyPayloadOffset(builder, options) {
  const kmfBuilder = new flatbuffers.Builder(256);
  const keyIdOffset = kmfBuilder.createString(
    `${options.moduleId}:${options.moduleVersion ?? "latest"}`,
  );
  const keyBytesOffset = KMF.createKeyBytesVector(
    kmfBuilder,
    new Uint8Array([4, 5, 6]),
  );
  const kmfOffset = KMF.createKMF(
    kmfBuilder,
    keyIdOffset,
    keyMaterialRole.PublicationContent,
    keyMaterialAlgorithm.Aes256Gcm,
    keyMaterialEncoding.RawBytes,
    keyBytesOffset,
    1,
    options.expiresAtMs,
  );
  KMF.finishKMFBuffer(kmfBuilder, kmfOffset);
  return LGR.createWrappedContentKeyPayloadVector(builder, kmfBuilder.asUint8Array());
}
