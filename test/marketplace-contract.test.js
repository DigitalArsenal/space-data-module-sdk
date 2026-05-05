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
import { KMF, keyMaterialAlgorithm, keyMaterialEncoding, keyMaterialRole } from "spacedatastandards.org/lib/js/KMF/main.js";
import { pluginCategory } from "spacedatastandards.org/lib/js/PLG/main.js";

import {
  appendPublicationRecordCollection,
  createEncryptedEnvelopePayload,
  createPublicationNotice,
  decryptMarketplaceContentKeyWrap,
  decodeLicensingGrant,
  encodeUnsignedLicensingGrantForProviderSignature,
  encodePublicationRecordCollection,
  extractGrantModuleDescriptor,
  extractPublicationRecordCollection,
  extractWrappedContentKey,
  generateX25519Keypair,
  protectMarketplaceContent,
  validateLicensingGrant,
  verifyLicensingGrantProviderSignature,
} from "../src/index.js";

const textEncoder = new TextEncoder();

test("marketplace group grants expose distinct member envelopes for one protected artifact", () => {
  const members = ["member-alpha-key", "member-beta-key", "member-gamma-key"];
  const grants = members.map((recipientKeyId, index) =>
    decodeLicensingGrant(
      encodeGrantResponse({
        reqId: `req-${index}`,
        moduleId: "com.space-data-network.protected-catalog",
        moduleVersion: "1.2.3",
        requesterPeerId: `peer-${index}`,
        requestedDomain: "app.example.com",
        requestedTimeoutMs: 300_000n,
        grantedDomain: "app.example.com",
        grantedTimeoutMs: 300_000n,
        expiresAtMs: 1_800_000_000_000n,
        encryptedCid: "bafy-single-copy-protected-bundle",
        encryptedHash: new Uint8Array(32).fill(0x42),
        contentKeyId: "dataset:celestrak:full-catalog:2026-05-05",
        recipientKeyId,
      }),
    ),
  );

  const descriptors = grants.map((grant) => extractGrantModuleDescriptor(grant));
  const envelopes = grants.map((grant) => extractWrappedContentKey(grant));

  assert.deepEqual(
    new Set(descriptors.map((descriptor) => descriptor.cid)),
    new Set(["bafy-single-copy-protected-bundle"]),
  );
  assert.deepEqual(
    new Set(descriptors.map((descriptor) => Buffer.from(descriptor.contentHash).toString("hex"))),
    new Set([Buffer.from(new Uint8Array(32).fill(0x42)).toString("hex")]),
  );
  assert.equal(new Set(envelopes.map((envelope) => envelope.recipientKeyId)).size, members.length);
  assert.deepEqual(
    envelopes.map((envelope) => envelope.contentKeyId),
    members.map(() => "dataset:celestrak:full-catalog:2026-05-05"),
  );
});

test("marketplace grants require a provider signature over the unsigned LGR bytes", async () => {
  const unsignedGrant = decodeLicensingGrant(encodeGrantResponse({
    reqId: "req-signed",
    moduleId: "com.space-data-network.protected-catalog",
    moduleVersion: "1.2.3",
    requesterPeerId: "peer-alpha",
    requestedDomain: "app.example.com",
    requestedTimeoutMs: 300_000n,
    grantedDomain: "app.example.com",
    grantedTimeoutMs: 300_000n,
    expiresAtMs: 1_800_000_000_000n,
    encryptedCid: "bafy-single-copy-protected-bundle",
    encryptedHash: new Uint8Array(32).fill(0x42),
    contentKeyId: "dataset:celestrak:full-catalog:2026-05-05",
    recipientKeyId: "member-alpha-key",
    providerSignature: null,
  }));
  const unsignedGrantBytes = encodeUnsignedLicensingGrantForProviderSignature(unsignedGrant);
  const signedGrant = validateLicensingGrant(
    decodeLicensingGrant(
      encodeGrantResponse({
        reqId: "req-signed",
        moduleId: "com.space-data-network.protected-catalog",
        moduleVersion: "1.2.3",
        requesterPeerId: "peer-alpha",
        requestedDomain: "app.example.com",
        requestedTimeoutMs: 300_000n,
        grantedDomain: "app.example.com",
        grantedTimeoutMs: 300_000n,
        expiresAtMs: 1_800_000_000_000n,
        encryptedCid: "bafy-single-copy-protected-bundle",
        encryptedHash: new Uint8Array(32).fill(0x42),
        contentKeyId: "dataset:celestrak:full-catalog:2026-05-05",
        recipientKeyId: "member-alpha-key",
        providerSignature: mockProviderSignature(unsignedGrantBytes),
      }),
    ),
  );

  const verified = await verifyLicensingGrantProviderSignature(signedGrant, {
    verify: async (publicKey, payload, signature) =>
      Buffer.from(publicKey).equals(Buffer.from(new Uint8Array(32).fill(5))) &&
      Buffer.from(payload).equals(Buffer.from(unsignedGrantBytes)) &&
      Buffer.from(signature).equals(Buffer.from(mockProviderSignature(unsignedGrantBytes))),
  });
  assert.equal(verified, signedGrant);

  await assert.rejects(
    () =>
      verifyLicensingGrantProviderSignature(
        { ...signedGrant, providerSignature: new Uint8Array(64).fill(8) },
        { verify: async () => false },
      ),
    /provider signature verification failed/i,
  );
});

test("marketplace protected bundles carry one encrypted payload with REC ENC and PNM metadata", async () => {
  const encryptedPayload = Uint8Array.from([0, 97, 115, 109, 9, 9, 9, 9]);
  const pnm = await createPublicationNotice({
    payloadBytes: encryptedPayload,
    cid: "bafy-single-copy-protected-bundle",
    fileName: "protected-catalog.wasm",
    fileId: "com.space-data-network.protected-catalog",
    signature: "provider-signature",
    signatureType: "Ed25519",
  });
  const enc = {
    version: 1,
    keyExchange: "X25519",
    symmetric: "AES_256_CTR",
    keyDerivation: "HKDF_SHA256",
    ephemeralPublicKey: new Uint8Array(32).fill(7),
    nonceStart: new Uint8Array(12).fill(8),
    recipientKeyId: textEncoder.encode("member-alpha-key"),
    context: "listing=com.space-data-network.protected-catalog;version=1.2.3;cid=bafy-single-copy-protected-bundle;provider=provider-peer;policy=paid-group;epoch=2026-05-05",
    schemaHash: new Uint8Array(32).fill(9),
    rootType: "$KMF",
    timestamp: 1_800_000_000_000,
  };

  const recordCollection = encodePublicationRecordCollection({ enc, pnm });
  const protectedBundle = appendPublicationRecordCollection(encryptedPayload, recordCollection);
  const parsed = extractPublicationRecordCollection(protectedBundle);
  const envelope = createEncryptedEnvelopePayload({ protectedBlobBytes: protectedBundle });

  assert.deepEqual(parsed.records.map((record) => record.standard), ["ENC", "PNM"]);
  assert.deepEqual(parsed.payloadBytes, encryptedPayload);
  assert.equal(parsed.pnm.cid, "bafy-single-copy-protected-bundle");
  assert.equal(parsed.enc.context, enc.context);
  assert.equal(envelope.protectedBlobBase64.length > envelope.ciphertextBase64.length, true);
  assert.equal(envelope.pnmRecordBase64.length > 0, true);
});

test("marketplace DPM query metadata binds replay query, result hash, CIDs, encryption, and provider signature", async () => {
  const { DPM, DPMT, DPMAssetT, DPMEncryptionBindingT, DPMQueryBindingT, publicationAssetKind } =
    await import("../../../main-packages/spacedatastandards.org/lib/js/DPM/main.js");

  const manifest = new DPMT(
    "1.0.0",
    "celestrak-full-catalog",
    "update-2026-05-05T13:47:02Z",
    "celestrak.eth",
    "bafy-provider-epm",
    "2026-05-05T13:47:02Z",
    [
      new DPMAssetT(publicationAssetKind.DATA_SHARD, "bafy-data-shard", "/ipfs/bafy-data-shard", "OMM.fbs.bin", 128n, "a".repeat(64), "OMM.fbs", "b".repeat(64), "dataset-key-epoch-2026-05-05"),
      new DPMAssetT(publicationAssetKind.QUERY_INDEX, "bafy-query-index", "/ipfs/bafy-query-index", "index.json", 64n, "c".repeat(64), "DPM.index.json", "d".repeat(64), "dataset-key-epoch-2026-05-05"),
    ],
    [],
    new DPMQueryBindingT(
      '{"schema":"OMM.fbs","source":"celestrak","where":{"active":true}}',
      "e".repeat(64),
      "f".repeat(64),
      "flatsql",
      "0.4.2",
      ["OMM.fbs"],
      ["celestrak.eth"],
      ["celestrak-gp-full-catalog"],
      ["source-sha256"],
      "2026-05-05T00:00:00Z",
      "2026-05-05T13:47:02Z",
    ),
    new DPMEncryptionBindingT(true, "AES-256-GCM", "dataset-key-epoch-2026-05-05", "2026-05-05", "paid-group", "1".repeat(64)),
    Array.from(new Uint8Array(64).fill(0x99)),
    "Ed25519",
  );
  const builder = new flatbuffers.Builder(1024);
  const root = manifest.pack(builder);
  DPM.finishDPMBuffer(builder, root);
  const bytes = builder.asUint8Array();
  const decoded = DPM.getRootAsDPM(new flatbuffers.ByteBuffer(bytes));

  assert.equal(DPM.bufferHasIdentifier(new flatbuffers.ByteBuffer(bytes)), true);
  assert.equal(decoded.assetsLength(), 2);
  assert.equal(decoded.QUERY().CANONICAL_QUERY(), '{"schema":"OMM.fbs","source":"celestrak","where":{"active":true}}');
  assert.equal(decoded.QUERY().QUERY_SHA256(), "e".repeat(64));
  assert.equal(decoded.QUERY().RESULT_SHA256(), "f".repeat(64));
  assert.equal(decoded.ENCRYPTION().ENCRYPTED(), true);
  assert.equal(decoded.ENCRYPTION().POLICY_ID(), "paid-group");
  assert.equal(decoded.providerSignatureLength(), 64);
  assert.equal(decoded.SIGNATURE_TYPE(), "Ed25519");
});

test("marketplace content protection encrypts once and wraps one generated content key per recipient", async () => {
  const alphaKeyPair = await generateX25519Keypair();
  const betaKeyPair = await generateX25519Keypair();
  const providerKeyPair = await generateX25519Keypair();
  const recipients = [
    {
      recipientPeerId: "peer-alpha",
      recipientKeyId: "alpha-key-2026-05-05",
      publicKey: alphaKeyPair.publicKey,
      grantId: "grant-alpha",
      scope: "dataset.read",
      expiresAtMs: 1_800_000_000_000,
    },
    {
      recipientPeerId: "peer-beta",
      recipientKeyId: "beta-key-2026-05-05",
      publicKey: betaKeyPair.publicKey,
      grantId: "grant-beta",
      scope: "dataset.read",
      expiresAtMs: 1_800_000_000_000,
    },
  ];
  const result = await protectMarketplaceContent({
    plaintext: textEncoder.encode("single immutable artifact bytes"),
    contentNonce: new Uint8Array(12).fill(32),
    wrapNonce: new Uint8Array(12).fill(33),
    providerWrapKeyPair: providerKeyPair,
    artifact: {
      listingId: "celestrak-full-catalog",
      moduleId: "com.space-data-network.protected-catalog",
      version: "2026-05-05T13:47:02Z",
      encryptedCid: "bafy-single-copy-protected-bundle",
      encryptedHash: new Uint8Array(32).fill(0x42),
      providerId: "celestrak.eth",
      policyId: "paid-group",
      keyEpoch: "2026-05-05",
      manifestHash: new Uint8Array(32).fill(0x77),
      contentKeyId: "dataset:celestrak:full-catalog:2026-05-05",
    },
    recipients,
  });

  assert.equal(result.algorithm, "AES-256-GCM");
  assert.equal(result.contentKeyId, "dataset:celestrak:full-catalog:2026-05-05");
  assert.equal(result.encryptedPayload.ciphertext.length, "single immutable artifact bytes".length);
  assert.equal(result.encryptedPayload.tag.length, 16);
  assert.equal(result.wrappedKeys.length, recipients.length);
  assert.equal(
    new Set(result.wrappedKeys.map((wrap) => wrap.contentKeyId)).size,
    1,
  );
  assert.equal(
    new Set(result.wrappedKeys.map((wrap) => wrap.recipientKeyId)).size,
    recipients.length,
  );
  assert.match(new TextDecoder().decode(result.aad), /bafy-single-copy-protected-bundle/);
  assert.match(new TextDecoder().decode(result.aad), /celestrak.eth/);
  assert.match(new TextDecoder().decode(result.aad), /paid-group/);

  const unwrappedKeys = await Promise.all(
    result.wrappedKeys.map((wrap, index) =>
      decryptMarketplaceContentKeyWrap({
        wrap,
        recipientPrivateKey: index === 0 ? alphaKeyPair.privateKey : betaKeyPair.privateKey,
      }),
    ),
  );
  assert.equal(unwrappedKeys[0].length, 32);
  assert.deepEqual(unwrappedKeys[1], unwrappedKeys[0]);
});

function encodeGrantResponse(options) {
  const builder = new flatbuffers.Builder(1024);
  const reqIdOffset = builder.createString(options.reqId);
  const moduleIdOffset = builder.createString(options.moduleId);
  const moduleVersionOffset = options.moduleVersion ? builder.createString(options.moduleVersion) : 0;
  const requesterPeerIdOffset = options.requesterPeerId ? builder.createString(options.requesterPeerId) : 0;
  const requestedDomainOffset = builder.createString(options.requestedDomain);
  const grantedDomainOffset = builder.createString(options.grantedDomain);
  const requiredScopeOffset = builder.createString("orbpro.default");
  const grantStatusOffset = builder.createString("active");
  const capabilityTokenOffset = LGR.createCapabilityTokenVector(builder, new Uint8Array([1, 2, 3]));
  const moduleDescriptorOffset = createModuleDescriptorOffset(builder, options);
  const wrappedContentKeyHeaderOffset = createWrappedContentKeyHeaderOffset(builder, options);
  const wrappedContentKeyPayloadOffset = createWrappedContentKeyPayloadOffset(builder, options);
  const verifierPubkeyOffset = LGR.createGrantVerifierPubkeyVector(builder, new Uint8Array(32).fill(5));
  const providerSignatureOffset =
    options.providerSignature === null
      ? 0
      : LGR.createProviderSignatureVector(builder, options.providerSignature ?? new Uint8Array(64).fill(9));

  LGR.startLGR(builder);
  LGR.addMessageType(builder, licensingGrantMessageType.Granted);
  LGR.addRequestId(builder, reqIdOffset);
  LGR.addModuleId(builder, moduleIdOffset);
  if (moduleVersionOffset !== 0) LGR.addModuleVersion(builder, moduleVersionOffset);
  if (requesterPeerIdOffset !== 0) LGR.addRequesterPeerId(builder, requesterPeerIdOffset);
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
  if (providerSignatureOffset !== 0) LGR.addProviderSignature(builder, providerSignatureOffset);
  const root = LGR.endLGR(builder);
  LGR.finishLGRBuffer(builder, root);
  return builder.asUint8Array();
}

function createModuleDescriptorOffset(builder, options) {
  const pluginIdOffset = builder.createString(options.moduleId);
  const nameOffset = builder.createString(options.moduleId);
  const versionOffset = builder.createString(options.moduleVersion);
  const descriptionOffset = builder.createString("Protected marketplace fixture");
  const wasmHashOffset = PLG.createWasmHashVector(builder, options.encryptedHash);
  const wasmCidOffset = builder.createString(options.encryptedCid);
  const requiredScopeOffset = builder.createString("orbpro.default");
  const keyIdOffset = builder.createString(options.contentKeyId);
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
  PLG.addWasmSize(builder, 8n);
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
  const recipientKeyIdOffset = ENC.createRecipientKeyIdVector(builder, textEncoder.encode(options.recipientKeyId));
  const contextOffset = builder.createString(`license-grant:${options.moduleId}:${options.moduleVersion}`);
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
  const keyIdOffset = kmfBuilder.createString(options.contentKeyId);
  const keyBytesOffset = KMF.createKeyBytesVector(kmfBuilder, new Uint8Array([4, 5, 6]));
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

function mockProviderSignature(unsignedGrantBytes) {
  const signature = new Uint8Array(64);
  signature.set(unsignedGrantBytes.subarray(0, Math.min(unsignedGrantBytes.length, signature.length)));
  return signature;
}
