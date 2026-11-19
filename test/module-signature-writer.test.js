// The two writer proofs of 0.11.0: what signModuleArtifact hashes, and that it
// never parses a payload that carries an encryption record.
//
// (a) A raw build still carries its `sds.*` custom sections (the manifest
//     among them). The writer moves them into the trailer, so the bytes the
//     OUTPUT holds before its trailer are the build with those sections
//     removed. The signature must be taken over THOSE bytes, in one pass.
// (b) A payload with an ENC record is ciphertext. It is signed over the bytes
//     as stored, without ever being read as wasm; the ENC record, the PNM
//     record and every other bundle entry are kept as they were.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SDK_TEST_SIGNER_PUBLIC_KEY_HEX,
  signModuleArtifact,
  verifyModuleArtifact,
} from "../src/bundle/signing.js";
import { DOMAIN_MODULE_PUBLICATION_V1 } from "../src/bundle/sigdomain.js";
import {
  appendWasmCustomSection,
  createSingleFileBundle,
  getWasmCustomSections,
  listWasmCustomSections,
  stripWasmCustomSections,
} from "../src/bundle/wasm.js";
import { SDS_MANIFEST_SECTION_NAME } from "../src/bundle/constants.js";
import { encodePluginManifest } from "../src/manifest/index.js";
import {
  appendPublicationRecordCollection,
  encodeEncRecord,
  encodePnmRecord,
  encodePublicationRecordCollection,
  extractPublicationRecordCollection,
} from "../src/transport/records.js";
import {
  decryptProtectedBytes,
  encryptBytesForRecipient,
  generateX25519Keypair,
} from "../src/transport/pki.js";
import { ed25519PublicKey, ed25519Sign, sha256Bytes } from "../src/utils/wasmCrypto.js";
import { statement as buildSignatureStatement } from "../src/bundle/sigdomain.js";
import { toLoadableWasmBytes } from "../src/bundle/artifactBytes.js";
import { readBoundManifestBytes, readSignedCodeManifest } from "../src/bundle/codeManifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_KEYPAIR_PATH = path.join(__dirname, "support", "dev-module-signing-keypair.json");

const bytesToHex = (bytes) => Buffer.from(bytes).toString("hex");

async function loadDevKeypair() {
  return JSON.parse(await readFile(DEV_KEYPAIR_PATH, "utf8"));
}

function manifestBytes() {
  return encodePluginManifest({
    pluginId: "com.digitalarsenal.test.writer-proof",
    name: "Writer proof fixture",
    version: "1.0.0",
    pluginFamily: "data_source",
    capabilities: [],
    invokeSurfaces: ["direct"],
    runtimeTargets: ["browser"],
    methods: [],
    schemasUsed: [],
    abiVersion: 1,
  });
}

// The smallest valid wasm (header only) with, in order: a non-sds custom
// section, the build's `sds.manifest` section, and a second `sds.*` section.
function rawBuildCarryingSdsSections(manifest) {
  let wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  wasm = appendWasmCustomSection(wasm, "producers.test", Uint8Array.of(1, 2, 3));
  wasm = appendWasmCustomSection(wasm, SDS_MANIFEST_SECTION_NAME, manifest);
  wasm = appendWasmCustomSection(wasm, "sds.extra", Uint8Array.of(9, 9));
  return wasm;
}

function trailerSignature(bytes) {
  const mbl = extractPublicationRecordCollection(bytes).mbl;
  const entry = mbl.entries.find((candidate) => candidate.entryId === "signature");
  return JSON.parse(new TextDecoder().decode(new Uint8Array(entry.payload)));
}

test("(a) a raw build carrying sds.manifest is signed in one pass over the bytes the output holds before its trailer", async () => {
  const keypair = await loadDevKeypair();
  const manifest = manifestBytes();
  const raw = rawBuildCarryingSdsSections(manifest);
  assert.equal(getWasmCustomSections(raw, SDS_MANIFEST_SECTION_NAME).length, 1);

  const signed = await signModuleArtifact(raw, {
    privateKeySeedHex: keypair.privateKeySeedHex,
    keyId: keypair.keyId,
  });
  const out = new Uint8Array(signed.wasmBytes);
  const portable = extractPublicationRecordCollection(out).payloadBytes;

  // What the output holds before its trailer: the build without its sds.*
  // sections; the other custom section stays.
  const stripped = stripWasmCustomSections(raw, (section) => section.name.startsWith("sds."));
  assert.deepEqual(new Uint8Array(portable), stripped);
  assert.deepEqual(
    listWasmCustomSections(portable).map((section) => section.name),
    ["producers.test"],
  );

  // The hash is of those bytes, not of the raw input.
  const strippedHashHex = bytesToHex(await sha256Bytes(stripped));
  const rawHashHex = bytesToHex(await sha256Bytes(raw));
  assert.notEqual(strippedHashHex, rawHashHex);
  assert.equal(signed.signedHashHex, strippedHashHex);
  assert.equal(trailerSignature(out).signedHashHex, strippedHashHex);

  // The manifest moved to the trailer, byte for byte.
  const manifestEntry = extractPublicationRecordCollection(out).mbl.entries.find(
    (entry) => entry.entryId === "manifest",
  );
  assert.deepEqual(new Uint8Array(manifestEntry.payload), manifest);

  const verified = await verifyModuleArtifact(out, {
    trustedPublicKeys: [keypair.publicKeyHex],
    requireSignature: true,
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.statementDomain, DOMAIN_MODULE_PUBLICATION_V1);
  assert.equal(verified.contentHashHex, strippedHashHex);

  // Signing the output again changes nothing before the trailer and writes the
  // same signature (Ed25519 is deterministic).
  const again = await signModuleArtifact(out, {
    privateKeySeedHex: keypair.privateKeySeedHex,
    keyId: keypair.keyId,
  });
  assert.deepEqual(new Uint8Array(again.wasmBytes), out);
});

// A node-style file: the node's signer (modulesign.Artifact) appends a trailer
// that holds only a signature entry, in its own field order with keyId "", to
// a module that keeps its sds.manifest section in the signed bytes.
async function nodeStyleSignedFile(raw, seedHex) {
  const seed = Uint8Array.from(Buffer.from(seedHex, "hex"));
  const contentHash = await sha256Bytes(raw);
  const signatureHex = bytesToHex(
    await ed25519Sign(buildSignatureStatement(DOMAIN_MODULE_PUBLICATION_V1, contentHash), seed),
  );
  const entryText = JSON.stringify({
    algorithm: "ed25519",
    keyId: "",
    publicKeyHex: bytesToHex(await ed25519PublicKey(seed)),
    signatureHex,
    signedHashHex: bytesToHex(contentHash),
    signedHashAlgorithm: "sha256-canonical-module-hash",
    statementDomain: DOMAIN_MODULE_PUBLICATION_V1,
  });
  // The trailer's shape, taken from the bundle writer over an empty module,
  // then put after the raw module as it stands.
  const header = Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);
  const shaped = extractPublicationRecordCollection(
    (await createSingleFileBundle({ wasmBytes: header, signature: entryText })).wasmBytes,
  );
  return appendPublicationRecordCollection(
    raw,
    encodePublicationRecordCollection({ version: shaped.version, mbl: shaped.mbl }),
  );
}

test("signing a node-style file again keeps the bytes before its trailer, and its manifest stays bound", async () => {
  const keypair = await loadDevKeypair();
  const manifest = manifestBytes();
  const raw = rawBuildCarryingSdsSections(manifest);
  const nodeFile = await nodeStyleSignedFile(raw, keypair.privateKeySeedHex);
  const policy = { trustedPublicKeys: [keypair.publicKeyHex], requireSignature: true };
  // The fixture is what it claims: the signed bytes are the raw module, its
  // trailer holds only the signature entry, and it verifies.
  assert.deepEqual(new Uint8Array(extractPublicationRecordCollection(nodeFile).payloadBytes), raw);
  assert.deepEqual(
    extractPublicationRecordCollection(nodeFile).mbl.entries.map((entry) => entry.entryId),
    ["signature"],
  );
  assert.equal((await verifyModuleArtifact(nodeFile, policy)).verified, true);

  const again = new Uint8Array(
    (await signModuleArtifact(nodeFile, { privateKeySeedHex: keypair.privateKeySeedHex })).wasmBytes,
  );
  // The bytes before the trailer, and so the loadable wasm, are identical.
  assert.deepEqual(new Uint8Array(extractPublicationRecordCollection(again).payloadBytes), raw);
  assert.deepEqual(toLoadableWasmBytes(again), toLoadableWasmBytes(nodeFile));
  assert.equal((await verifyModuleArtifact(again, policy)).verified, true);
  // The manifest stays in the signed bytes and bound.
  assert.equal((await readSignedCodeManifest(again)).source, "custom-section");
  assert.deepEqual(new Uint8Array(await readBoundManifestBytes(again)), manifest);
});

async function encryptedEnvelope(plaintext, { withBundle = false } = {}) {
  const recipient = await generateX25519Keypair();
  const envelope = await encryptBytesForRecipient({
    plaintext,
    recipientPublicKey: recipient.publicKey,
    context: "space-data-module-sdk/test-writer-proof",
  });
  let bytes = new Uint8Array(Buffer.from(envelope.protectedBlobBase64, "base64"));
  if (withBundle) {
    // As protectModuleArtifact writes it for a recipient: the plaintext's
    // bundle (its manifest entry), the ENC record and a PNM notice in one
    // trailer behind the ciphertext.
    const parsed = extractPublicationRecordCollection(bytes);
    const plainBundle = await createSingleFileBundle({
      wasmBytes: plaintext,
      manifestBytes: manifestBytes(),
    });
    bytes = appendPublicationRecordCollection(
      parsed.payloadBytes,
      encodePublicationRecordCollection({
        mbl: plainBundle.bundle,
        enc: parsed.enc,
        pnm: {
          multiformatAddress: "/ipfs/bafytest",
          publishTimestamp: "2026-11-19T00:00:00.000Z",
          cid: "bafytest",
          fileName: "module.wasm",
          fileId: "module",
        },
      }),
    );
  }
  return { bytes, recipient };
}

function plaintextModule() {
  return appendWasmCustomSection(
    new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
    SDS_MANIFEST_SECTION_NAME,
    manifestBytes(),
  );
}

for (const withBundle of [false, true]) {
  const label = withBundle ? "with a bundle and a PNM notice" : "with only an ENC record";
  test(`(b) an encrypted payload ${label} is signed over its ciphertext without being parsed, and verifies`, async () => {
    const keypair = await loadDevKeypair();
    const plaintext = plaintextModule();
    const { bytes, recipient } = await encryptedEnvelope(plaintext, { withBundle });
    const before = extractPublicationRecordCollection(bytes);
    assert.ok(before.enc);
    // The ciphertext is not wasm: any parse of it would throw.
    assert.notDeepEqual(new Uint8Array(before.payloadBytes.subarray(0, 4)), Uint8Array.of(0, 0x61, 0x73, 0x6d));
    assert.throws(() => listWasmCustomSections(before.payloadBytes));

    const signed = await signModuleArtifact(bytes, {
      privateKeySeedHex: keypair.privateKeySeedHex,
      keyId: keypair.keyId,
    });
    const out = new Uint8Array(signed.wasmBytes);
    const after = extractPublicationRecordCollection(out);

    // The ciphertext is untouched, and it is what was signed.
    assert.deepEqual(new Uint8Array(after.payloadBytes), new Uint8Array(before.payloadBytes));
    const contentHashHex = bytesToHex(await sha256Bytes(before.payloadBytes));
    assert.equal(signed.signedHashHex, contentHashHex);
    const entry = trailerSignature(out);
    assert.equal(entry.signedHashHex, contentHashHex);
    assert.equal(entry.statementDomain, DOMAIN_MODULE_PUBLICATION_V1);
    assert.equal(entry.keyId, keypair.keyId);

    // ENC and PNM kept byte for byte; every other bundle entry kept.
    assert.deepEqual(encodeEncRecord(after.enc), encodeEncRecord(before.enc));
    if (withBundle) {
      assert.deepEqual(encodePnmRecord(after.pnm), encodePnmRecord(before.pnm));
      assert.deepEqual(
        after.mbl.entries.map((e) => e.entryId).sort(),
        ["manifest", "signature"],
      );
      const manifestBefore = before.mbl.entries.find((e) => e.entryId === "manifest");
      const manifestAfter = after.mbl.entries.find((e) => e.entryId === "manifest");
      assert.deepEqual(new Uint8Array(manifestAfter.payload), new Uint8Array(manifestBefore.payload));
      assert.deepEqual(
        new Uint8Array(after.mbl.canonicalModuleHash),
        new Uint8Array(before.mbl.canonicalModuleHash),
      );
    } else {
      assert.equal(after.pnm ?? null, null);
      assert.deepEqual(after.mbl.entries.map((e) => e.entryId), ["signature"]);
      // As the engine's envelope signer records it: the content hash.
      assert.equal(bytesToHex(after.mbl.canonicalModuleHash), contentHashHex);
    }

    const verified = await verifyModuleArtifact(out, {
      trustedPublicKeys: [SDK_TEST_SIGNER_PUBLIC_KEY_HEX],
      requireSignature: true,
    });
    assert.equal(verified.verified, true);
    assert.equal(verified.testSigner, true);
    assert.equal(verified.contentHashHex, contentHashHex);

    // The signed envelope still opens to the same plaintext.
    const opened = await decryptProtectedBytes({
      protectedBytes: out,
      recipientPrivateKey: recipient.privateKey,
    });
    assert.deepEqual(new Uint8Array(opened), plaintext);

    // Signing it again replaces the signature entry and changes nothing else.
    const again = await signModuleArtifact(out, {
      privateKeySeedHex: keypair.privateKeySeedHex,
      keyId: keypair.keyId,
    });
    assert.deepEqual(new Uint8Array(again.wasmBytes), out);
  });
}

test("(b) a changed ciphertext byte is refused after signing", async () => {
  const keypair = await loadDevKeypair();
  const { bytes } = await encryptedEnvelope(plaintextModule());
  const signed = new Uint8Array(
    (await signModuleArtifact(bytes, { privateKeySeedHex: keypair.privateKeySeedHex })).wasmBytes,
  );
  signed[3] ^= 0x01;
  await assert.rejects(
    verifyModuleArtifact(signed, {
      trustedPublicKeys: [SDK_TEST_SIGNER_PUBLIC_KEY_HEX],
      requireSignature: true,
    }),
    (error) => error.code === "hash_mismatch",
  );
});
