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
  decodeLicensingGrant,
  encodeLicensingChallengeRequest,
  encodeLicensingProof,
  extractGrantModuleDescriptor,
  extractWrappedContentKey,
} from "../src/index.js";

test("SDK challenge request bytes match the canonical sdn-js LCH builder layout", () => {
  const options = {
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
  };

  assert.deepEqual(
    encodeLicensingChallengeRequest(options),
    encodeCanonicalChallengeRequest(options),
  );
});

test("SDK proof bytes match the canonical sdn-js LPF builder layout", () => {
  const options = {
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
  };

  assert.deepEqual(encodeLicensingProof(options), encodeCanonicalProof(options));
});

test("SDK grant decoding reads the same SDS payload shape sdn-js currently consumes", () => {
  const bytes = encodeCanonicalGrantResponse({
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
  const descriptor = extractGrantModuleDescriptor(decoded);
  const wrappedContentKey = extractWrappedContentKey(decoded);
  const kmf = KMF.getRootAsKMF(
    new flatbuffers.ByteBuffer(wrappedContentKey.encryptedPayload),
  );

  assert.equal(decoded.messageType, "granted");
  assert.equal(descriptor.cid, "bafyencryptedmodule");
  assert.equal(descriptor.moduleId, "com.space-data-network.fastest-path");
  assert.equal(descriptor.moduleVersion, "0.5.22");
  assert.deepEqual(descriptor.allowedDomains, ["app.example.com"]);
  assert.equal(wrappedContentKey.header.rootType, "$KMF");
  assert.equal(wrappedContentKey.header.context, "license-grant:com.space-data-network.fastest-path:0.5.22");
  assert.equal(kmf.KEY_ID(), "com.space-data-network.fastest-path:0.5.22");
  assert.deepEqual(kmf.keyBytesArray(), new Uint8Array([4, 5, 6]));
});

function encodeCanonicalChallengeRequest(options) {
  const builder = new flatbuffers.Builder(512);
  const reqIdOffset = builder.createString(options.reqId);
  const moduleIdOffset = builder.createString(options.moduleId);
  const moduleVersionOffset = options.moduleVersion ? builder.createString(options.moduleVersion) : 0;
  const requesterPeerIdOffset = builder.createString(options.requesterPeerId);
  const requesterXpubOffset = options.requesterXpub ? builder.createString(options.requesterXpub) : 0;
  const requesterSigningPubkeyOffset = LCH.createRequesterSigningPubkeyVector(
    builder,
    options.requesterSigningPublicKey,
  );
  const requesterEphemeralPubkeyOffset = LCH.createRequesterEphemeralPubkeyVector(
    builder,
    options.requesterEphemeralPublicKey,
  );
  const requesterDomainOffset = builder.createString(options.requesterDomain);
  const providerPeerIdOffset = builder.createString(options.providerPeerId);
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
    BigInt(options.requestedTimeoutMs),
    BigInt(options.requestedAtMs),
    0,
    0n,
    providerPeerIdOffset,
    0,
    0,
  );
  LCH.finishLCHBuffer(builder, root);
  return builder.asUint8Array();
}

function encodeCanonicalProof(options) {
  const builder = new flatbuffers.Builder(512);
  const reqIdOffset = builder.createString(options.reqId);
  const moduleIdOffset = builder.createString(options.moduleId);
  const moduleVersionOffset = options.moduleVersion ? builder.createString(options.moduleVersion) : 0;
  const requesterPeerIdOffset = builder.createString(options.requesterPeerId);
  const requesterXpubOffset = options.requesterXpub ? builder.createString(options.requesterXpub) : 0;
  const requesterDomainOffset = builder.createString(options.requesterDomain);
  const requesterEphemeralPubkeyOffset = LPF.createRequesterEphemeralPubkeyVector(
    builder,
    options.requesterEphemeralPublicKey,
  );
  const challengeNonceOffset = LPF.createChallengeNonceVector(
    builder,
    options.challengeNonce,
  );
  const providerPeerIdOffset = builder.createString(options.providerPeerId);
  const signatureOffset = LPF.createSignatureVector(builder, options.signature);
  const signingPubkeyOffset = LPF.createSigningPubkeyVector(
    builder,
    options.requesterSigningPublicKey,
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
    BigInt(options.requestedTimeoutMs),
    requesterEphemeralPubkeyOffset,
    challengeNonceOffset,
    BigInt(options.challengeExpiresAtMs),
    providerPeerIdOffset,
    signatureOffset,
    signingPubkeyOffset,
    BigInt(options.timestampMs),
    0,
    0,
  );
  LPF.finishLPFBuffer(builder, root);
  return builder.asUint8Array();
}

function encodeCanonicalGrantResponse(options) {
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
  const verifierPubkeyOffset = LGR.createGrantVerifierPubkeyVector(builder, new Uint8Array(32).fill(5));
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
