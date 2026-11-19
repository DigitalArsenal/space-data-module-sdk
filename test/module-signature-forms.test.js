// The signature forms of 0.11.0: what signModuleArtifact writes, what every
// verifier admits, and the bare module digest form refused by name everywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PUBLICATION_SIGNED_HASH_ALGORITHM,
  MODULE_SIGNATURE_SCOPES,
  DEFAULT_MODULE_SIGNATURE_SCOPE,
  ModuleSignatureError,
  resolveModuleSignaturePolicy,
  signModuleArtifact,
  verifyModuleArtifact,
} from "../src/bundle/signing.js";
import { DOMAIN_MODULE_PUBLICATION_V1 } from "../src/bundle/sigdomain.js";
import {
  computeCanonicalModuleHash,
  createSingleFileBundle,
} from "../src/bundle/wasm.js";
import { toLoadableWasmBytes } from "../src/bundle/artifactBytes.js";
import { extractPublicationRecordCollection } from "../src/transport/records.js";
import { ed25519PublicKey, ed25519Sign, sha256Bytes } from "../src/utils/wasmCrypto.js";
import { loadModule } from "../src/host/isomorphicLoader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_KEYPAIR_PATH = path.join(__dirname, "support", "dev-module-signing-keypair.json");
const VECTORS_PATH = path.join(__dirname, "support", "statement-domain-vectors.json");
const CLI_PATH = path.join(__dirname, "..", "bin", "space-data-module.js");

const hexToBytes = (hex) => Uint8Array.from(Buffer.from(hex, "hex"));
const bytesToHex = (bytes) => Buffer.from(bytes).toString("hex");

function buildTestWasm() {
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x05, 0x01, 0x78, 0x01, 0x02, 0x03,
  ]);
}

async function loadDevKeypair() {
  return JSON.parse(await readFile(DEV_KEYPAIR_PATH, "utf8"));
}

// A bare module digest artifact, as SDK 0.10.x wrote it by default: Ed25519
// over the raw canonical module hash, no statement domain. Built by hand,
// because no writer in this SDK produces it any more.
async function buildBareDigestArtifact(seedHex, keyId = null) {
  const wasm = buildTestWasm();
  const seed = hexToBytes(seedHex);
  const canonical = await computeCanonicalModuleHash(wasm);
  const signatureBytes = await ed25519Sign(canonical.hashBytes, seed);
  const built = await createSingleFileBundle({
    wasmBytes: wasm,
    signature: {
      algorithm: "ed25519",
      keyId,
      publicKeyHex: bytesToHex(await ed25519PublicKey(seed)),
      signatureHex: bytesToHex(signatureBytes),
      signedHashHex: canonical.hashHex,
      signedHashAlgorithm: PUBLICATION_SIGNED_HASH_ALGORITHM,
    },
  });
  return new Uint8Array(built.wasmBytes);
}

test("the writer has one form, the publication form, and it is the default", () => {
  assert.deepEqual([...MODULE_SIGNATURE_SCOPES], ["publication"]);
  assert.equal(DEFAULT_MODULE_SIGNATURE_SCOPE, "publication");
});

test('signatureScope "module" and "bundle" are refused by name', async () => {
  const keypair = await loadDevKeypair();
  for (const signatureScope of ["module", "bundle"]) {
    await assert.rejects(
      signModuleArtifact(buildTestWasm(), {
        privateKeySeedHex: keypair.privateKeySeedHex,
        signatureScope,
      }),
      (error) =>
        error instanceof ModuleSignatureError &&
        error.code === "legacy_signature_scope" &&
        error.message.includes(`signatureScope "${signatureScope}"`) &&
        /removed in space-data-module-sdk 0\.11\.0/.test(error.message),
    );
  }
  await assert.rejects(
    signModuleArtifact(buildTestWasm(), {
      privateKeySeedHex: keypair.privateKeySeedHex,
      signatureScope: "everything",
    }),
    (error) => error.code === "invalid_signature_scope",
  );
});

for (const signatureScope of MODULE_SIGNATURE_SCOPES) {
  test(`${signatureScope}: sign, verify, and what the result reports`, async () => {
    const keypair = await loadDevKeypair();
    const signed = await signModuleArtifact(buildTestWasm(), {
      privateKeySeedHex: keypair.privateKeySeedHex,
      keyId: keypair.keyId,
      signatureScope,
    });
    assert.equal(signed.signatureScope, signatureScope);
    const result = await verifyModuleArtifact(signed.wasmBytes, {
      trustedPublicKeys: [keypair.publicKeyHex],
      requireSignature: true,
    });
    assert.equal(result.verified, true);
    assert.equal(result.keyId, keypair.keyId);
    assert.equal(result.signedHashHex, signed.signedHashHex);
    const portable = extractPublicationRecordCollection(signed.wasmBytes).payloadBytes;
    assert.equal(result.statementDomain, DOMAIN_MODULE_PUBLICATION_V1);
    assert.equal(result.signatureScope, "module");
    assert.equal(signed.signedHashHex, bytesToHex(await sha256Bytes(new Uint8Array(portable))));
    // The loadable wasm is the input, whatever the form.
    assert.deepEqual(
      Buffer.from(toLoadableWasmBytes(signed.wasmBytes)),
      Buffer.from(buildTestWasm()),
    );
  });

  test(`${signatureScope}: a changed payload byte is refused`, async () => {
    const keypair = await loadDevKeypair();
    const signed = await signModuleArtifact(buildTestWasm(), {
      privateKeySeedHex: keypair.privateKeySeedHex,
      signatureScope,
    });
    const tampered = new Uint8Array(signed.wasmBytes);
    tampered[12] ^= 0xff;
    await assert.rejects(
      verifyModuleArtifact(tampered, {
        trustedPublicKeys: [keypair.publicKeyHex],
        requireSignature: true,
      }),
      (error) => error instanceof ModuleSignatureError && error.code === "hash_mismatch",
    );
  });

  test(`${signatureScope}: re-signing a bare digest artifact replaces its signature`, async () => {
    const keypair = await loadDevKeypair();
    const old = await buildBareDigestArtifact("22".repeat(32));
    const signed = await signModuleArtifact(old, {
      privateKeySeedHex: keypair.privateKeySeedHex,
      keyId: keypair.keyId,
      signatureScope,
    });
    const result = await verifyModuleArtifact(signed.wasmBytes, {
      trustedPublicKeys: [keypair.publicKeyHex],
      requireSignature: true,
    });
    assert.equal(result.verified, true);
    assert.deepEqual(
      Buffer.from(toLoadableWasmBytes(signed.wasmBytes)),
      Buffer.from(toLoadableWasmBytes(old)),
    );
  });
}

test("publication: the SDK's entry is the node's, byte for byte (shared vector domain-signed-ok)", async () => {
  const vectors = JSON.parse(await readFile(VECTORS_PATH, "utf8"));
  const vector = vectors.artifacts.find((entry) => entry.name === "domain-signed-ok");
  const signed = await signModuleArtifact(hexToBytes(vector.portableHex), {
    privateKeySeedHex: vectors.signerSeedHex,
    keyId: vector.signatureEntry.keyId,
    signatureScope: "publication",
  });
  // Every field the node wrote, with the node's values, in the node's order.
  assert.deepEqual(Object.keys(signed.signature), Object.keys(vector.signatureEntry));
  assert.deepEqual(signed.signature, vector.signatureEntry);
  // The signature entry's payload bytes and the portable bytes equal the
  // vector's. (The REC envelope around them does not: the vector file was
  // wrapped by an earlier SDK writer, and 0.10.4's writer already emits a
  // 12-byte longer REC table for the same entry. The Go verifier reads the
  // entry and the portable bytes, not the envelope layout.)
  const ours = extractPublicationRecordCollection(signed.wasmBytes);
  const theirs = extractPublicationRecordCollection(hexToBytes(vector.sdkArtifactHex));
  assert.equal(bytesToHex(ours.payloadBytes), bytesToHex(theirs.payloadBytes));
  const entryOf = (rec) => rec.mbl.entries.find((entry) => entry.entryId === "signature");
  assert.equal(
    bytesToHex(new Uint8Array(entryOf(ours).payload)),
    bytesToHex(new Uint8Array(entryOf(theirs).payload)),
  );
  const result = await verifyModuleArtifact(signed.wasmBytes, {
    trustedPublicKeys: vector.trustedPublicKeysHex,
    requireSignature: true,
  });
  assert.equal(result.statementDomain, vector.expect.statementDomain);
  assert.equal(result.contentHashHex, vector.expect.contentHashHex);
  assert.equal(result.signatureScope, vector.expect.signatureScope);
});

test("publication: signedHashHex and the hash label are required; an entry without them is refused by name", async () => {
  const keypair = await loadDevKeypair();
  const signed = await signModuleArtifact(buildTestWasm(), {
    privateKeySeedHex: keypair.privateKeySeedHex,
    keyId: keypair.keyId,
  });
  const portable = new Uint8Array(extractPublicationRecordCollection(signed.wasmBytes).payloadBytes);
  const policy = { trustedPublicKeys: [keypair.publicKeyHex], requireSignature: true };
  const withEntry = async (signature) =>
    new Uint8Array((await createSingleFileBundle({ wasmBytes: portable, signature })).wasmBytes);
  // The Ed25519 signature is valid in every case below: only the entry's
  // declarations change, and they are refused before the signature is checked.
  for (const signedHashHex of ["", "   ", undefined]) {
    const entry = { ...signed.signature, signedHashHex };
    if (signedHashHex === undefined) delete entry.signedHashHex;
    await assert.rejects(
      verifyModuleArtifact(await withEntry(entry), policy),
      (error) =>
        error instanceof ModuleSignatureError &&
        error.code === "missing_signed_hash" &&
        error.statementDomain === DOMAIN_MODULE_PUBLICATION_V1,
      JSON.stringify(signedHashHex),
    );
  }
  for (const signedHashAlgorithm of ["", "sha256", undefined]) {
    const entry = { ...signed.signature, signedHashAlgorithm };
    if (signedHashAlgorithm === undefined) delete entry.signedHashAlgorithm;
    await assert.rejects(
      verifyModuleArtifact(await withEntry(entry), policy),
      (error) => error instanceof ModuleSignatureError && error.code === "unsupported_hash_algorithm",
      JSON.stringify(signedHashAlgorithm),
    );
  }
  // A recorded hash other than sha256(portable) stays hash_mismatch.
  await assert.rejects(
    verifyModuleArtifact(await withEntry({ ...signed.signature, signedHashHex: "00".repeat(32) }), policy),
    (error) => error.code === "hash_mismatch",
  );
  // The entry as written verifies, and its label is the node's wire string.
  assert.equal(signed.signature.signedHashAlgorithm, "sha256-canonical-module-hash");
  assert.equal((await verifyModuleArtifact(await withEntry(signed.signature), policy)).verified, true);
});

test("a policy that names a trusted key requires a signature: a stripped trailer is refused", async () => {
  const keypair = await loadDevKeypair();
  const signed = await signModuleArtifact(buildTestWasm(), {
    privateKeySeedHex: keypair.privateKeySeedHex,
    keyId: keypair.keyId,
  });
  const keyOnly = { verifySignature: { trustedPublicKeys: [keypair.publicKeyHex] } };
  assert.deepEqual(resolveModuleSignaturePolicy(keyOnly), {
    trustedPublicKeys: [keypair.publicKeyHex],
    requireSignature: true,
  });
  assert.equal(
    resolveModuleSignaturePolicy({
      verifySignature: { trustedPublicKeys: [keypair.publicKeyHex], requireSignature: false },
    }).requireSignature,
    true,
  );
  const previous = process.env.SDM_TRUSTED_MODULE_SIGNERS;
  process.env.SDM_TRUSTED_MODULE_SIGNERS = keypair.publicKeyHex;
  try {
    assert.equal(resolveModuleSignaturePolicy({}).requireSignature, true);
  } finally {
    if (previous === undefined) delete process.env.SDM_TRUSTED_MODULE_SIGNERS;
    else process.env.SDM_TRUSTED_MODULE_SIGNERS = previous;
  }
  // No key named and no requirement: no policy, as before.
  assert.equal(resolveModuleSignaturePolicy({ verifySignature: {} }).requireSignature, false);

  // The attack: the trailer removed (the signature does not cover it), or
  // only its signature entry removed.
  const stripped = new Uint8Array(extractPublicationRecordCollection(signed.wasmBytes).payloadBytes);
  const signatureless = new Uint8Array(
    (await createSingleFileBundle({ wasmBytes: stripped, entries: [] })).wasmBytes,
  );
  const dir = await mkdtemp(path.join(tmpdir(), "sdm-forms-strip-"));
  for (const [label, bytes] of [["stripped", stripped], ["signatureless", signatureless]]) {
    await assert.rejects(
      verifyModuleArtifact(bytes, resolveModuleSignaturePolicy(keyOnly)),
      (error) => error.code === "missing_signature",
      label,
    );
    const wasmPath = path.join(dir, `${label}.wasm`);
    await writeFile(wasmPath, bytes);
    await assert.rejects(
      loadModule({ wasmSource: wasmPath, ...keyOnly }),
      (error) => error instanceof ModuleSignatureError && error.code === "missing_signature",
      label,
    );
  }
});

test("no shared vector verifies with an empty signedHashHex", async () => {
  const vectors = JSON.parse(await readFile(VECTORS_PATH, "utf8"));
  const empty = vectors.artifacts.filter(
    (vector) => String(vector.signatureEntry.signedHashHex ?? "").trim() === "",
  );
  assert.deepEqual(empty.map((vector) => vector.name), []);
});

test("the bare module digest form is refused by name, before the signer is asked about", async () => {
  const keypair = await loadDevKeypair();
  const old = await buildBareDigestArtifact(keypair.privateKeySeedHex, keypair.keyId);
  for (const trustedPublicKeys of [[keypair.publicKeyHex], []]) {
    await assert.rejects(
      verifyModuleArtifact(old, { trustedPublicKeys, requireSignature: true }),
      (error) =>
        error instanceof ModuleSignatureError &&
        error.code === "legacy_module_signature" &&
        /sign the module again/.test(error.message),
    );
  }
  // Without a requirement too: a present signature in a removed form is never
  // "unsigned".
  await assert.rejects(
    verifyModuleArtifact(old, {}),
    (error) => error.code === "legacy_module_signature",
  );
  // A signature entry with no hash algorithm and no domain is the same form.
  const vectors = JSON.parse(await readFile(VECTORS_PATH, "utf8"));
  const legacy = vectors.artifacts.find((entry) => entry.name === "legacy-bare-digest-no-domain");
  await assert.rejects(
    verifyModuleArtifact(hexToBytes(legacy.sdkArtifactHex), {
      trustedPublicKeys: legacy.trustedPublicKeysHex,
    }),
    (error) => error.code === "legacy_module_signature",
  );
});

test("the whole-bundle form is refused by name, before the signer is asked about", async () => {
  const vectors = JSON.parse(await readFile(VECTORS_PATH, "utf8"));
  for (const name of ["bundle-scope-signed-ok", "bundle-scope-untrusted-signer", "bundle-scope-recorded-digest-tampered"]) {
    const vector = vectors.artifacts.find((entry) => entry.name === name);
    await assert.rejects(
      verifyModuleArtifact(hexToBytes(vector.sdkArtifactHex), {
        trustedPublicKeys: vector.trustedPublicKeysHex,
      }),
      (error) =>
        error instanceof ModuleSignatureError &&
        error.code === "legacy_bundle_signature" &&
        /sign the module again/.test(error.message),
      name,
    );
  }
});

test("loadModule refuses a bare module digest artifact by name", async () => {
  const keypair = await loadDevKeypair();
  const dir = await mkdtemp(path.join(tmpdir(), "sdm-forms-"));
  const wasmPath = path.join(dir, "bare-digest.wasm");
  await writeFile(wasmPath, await buildBareDigestArtifact(keypair.privateKeySeedHex));
  await assert.rejects(
    loadModule({
      wasmSource: wasmPath,
      verifySignature: { trustedPublicKeys: [keypair.publicKeyHex], requireSignature: true },
    }),
    (error) => error instanceof ModuleSignatureError && error.code === "legacy_module_signature",
  );
});

test("the CLI signs either form, refuses scope module, and refuses a bare digest artifact", async () => {
  const keypair = await loadDevKeypair();
  const dir = await mkdtemp(path.join(tmpdir(), "sdm-forms-cli-"));
  const rawPath = path.join(dir, "raw.wasm");
  await writeFile(rawPath, buildTestWasm());
  for (const scope of MODULE_SIGNATURE_SCOPES) {
    const outPath = path.join(dir, `${scope}.wasm`);
    const sign = spawnSync(process.execPath, [CLI_PATH, "sign", "--wasm", rawPath, "--key", DEV_KEYPAIR_PATH, "--scope", scope, "--out", outPath, "--json"], { encoding: "utf8" });
    assert.equal(sign.status, 0, sign.stderr);
    assert.equal(JSON.parse(sign.stdout).signatureScope, scope);
    const verify = spawnSync(process.execPath, [CLI_PATH, "verify", "--wasm", outPath, "--key", DEV_KEYPAIR_PATH], { encoding: "utf8" });
    assert.equal(verify.status, 0, verify.stderr);
    assert.match(verify.stdout, /verified=true/);
    // The role comes from the key; the keyId is printed as an unsigned label.
    assert.match(verify.stdout, /^signer=test$/m);
    assert.match(verify.stdout, /^unsignedKeyId=/m);
    assert.doesNotMatch(verify.stdout, /^keyId=/m);
  }
  for (const scope of ["module", "bundle"]) {
    const refusedScope = spawnSync(process.execPath, [CLI_PATH, "sign", "--wasm", rawPath, "--key", DEV_KEYPAIR_PATH, "--scope", scope, "--out", path.join(dir, "m.wasm")], { encoding: "utf8" });
    assert.notEqual(refusedScope.status, 0);
    assert.match(refusedScope.stderr, new RegExp(`signatureScope "${scope}"`));
  }
  const barePath = path.join(dir, "bare.wasm");
  await writeFile(barePath, await buildBareDigestArtifact(keypair.privateKeySeedHex));
  const refused = spawnSync(process.execPath, [CLI_PATH, "verify", "--wasm", barePath, "--key", DEV_KEYPAIR_PATH], { encoding: "utf8" });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /no statementDomain and covers the bare canonical module digest/);
});
