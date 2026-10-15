// Regression tests for the 2026-10-15 security audit:
//   SEC-035 protectModuleArtifact never substitutes, returns or prints a
//           signing mnemonic; encryption needs a recipient; no mnemonic on argv
//   SEC-058 deployment authorizations verify against TRUSTED keys only, with
//           required expiry, bounded lifetime and nonce, and claims are only
//           checked on a verified envelope
// The only mnemonics here are the public BIP-39 test vector and a copy of it
// with a broken checksum.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createRecipientKeypairHex, protectModuleArtifact } from "../src/compiler/compileModule.js";
import {
  assertDeploymentAuthorization,
  createDeploymentAuthorization,
  createHdWalletSigner,
  createHdWalletVerifier,
  signAuthorization,
  verifyAuthorization,
} from "../src/auth/permissions.js";
import { secp256k1PublicKey, secp256k1SignDigest, secp256k1VerifyDigest } from "../src/utils/wasmCrypto.js";

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "bin", "space-data-module.js");
const VECTOR = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const BROKEN_CHECKSUM = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandom";
const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x00, 0x05, 0x01, 0x78, 0x01, 0x02, 0x03]);
const MANIFEST = {
  pluginId: "com.digitalarsenal.tests.protect-security",
  name: "Protect security",
  version: "1.0.0",
  pluginFamily: "analysis",
  capabilities: [],
  invokeSurfaces: ["direct"],
  runtimeTargets: ["browser"],
  methods: [{ methodId: "invoke", inputPorts: [], outputPorts: [], maxBatch: 1, drainPolicy: "single-shot" }],
};

async function cli(args, env = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("SEC-035: an invalid or missing mnemonic throws instead of signing with a random identity", async () => {
  await assert.rejects(
    protectModuleArtifact({ manifest: MANIFEST, wasmBytes: WASM, mnemonic: BROKEN_CHECKSUM }),
    (error) => /not a valid BIP-39 mnemonic/.test(error.message) && !error.message.includes("abandon"),
  );
  await assert.rejects(protectModuleArtifact({ manifest: MANIFEST, wasmBytes: WASM }), /requires the publisher signing mnemonic/);
  await assert.rejects(protectModuleArtifact({ manifest: MANIFEST, wasmBytes: WASM, mnemonic: 12345 }), /not a valid BIP-39/);

  const first = await protectModuleArtifact({ manifest: MANIFEST, wasmBytes: WASM, mnemonic: VECTOR });
  const second = await protectModuleArtifact({ manifest: MANIFEST, wasmBytes: WASM, mnemonic: VECTOR });
  assert.equal(first.signingPublicKeyHex, second.signingPublicKeyHex, "the supplied identity signs, every time");
  assert.equal("mnemonic" in first, false, "the result never carries the mnemonic");
  assert.doesNotMatch(JSON.stringify(first, (k, v) => (v instanceof Uint8Array ? undefined : v)), /abandon/);

  const ephemeral = await protectModuleArtifact({ manifest: MANIFEST, wasmBytes: WASM, ephemeralIdentity: true });
  assert.equal("mnemonic" in ephemeral, false);
  assert.notEqual(ephemeral.signingPublicKeyHex, first.signingPublicKeyHex);
});

test("SEC-035: an encrypted result carries no plaintext module, and encrypt: true requires a recipient", async () => {
  const recipient = await createRecipientKeypairHex();
  const encrypted = await protectModuleArtifact({
    manifest: MANIFEST,
    wasmBytes: WASM,
    mnemonic: VECTOR,
    recipientPublicKeyHex: recipient.publicKeyHex,
  });
  assert.equal(encrypted.encrypted, true);
  assert.equal("wasmBase64" in encrypted.payload, false);
  assert.doesNotMatch(JSON.stringify(encrypted.payload), new RegExp(Buffer.from(WASM).toString("base64").replace(/[+/=]/g, ".")));
  await assert.rejects(
    protectModuleArtifact({ manifest: MANIFEST, wasmBytes: WASM, mnemonic: VECTOR, encrypt: true }),
    /requires recipientPublicKeyHex/,
  );
});

test("SEC-035: the CLI takes no mnemonic on argv and never prints one", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "sdm-protect-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const manifestPath = path.join(dir, "manifest.json");
  const wasmPath = path.join(dir, "module.wasm");
  const mnemonicPath = path.join(dir, "publisher.mnemonic");
  await writeFile(manifestPath, JSON.stringify(MANIFEST));
  await writeFile(wasmPath, WASM);
  await writeFile(mnemonicPath, `${VECTOR}\n`, { mode: 0o600 });
  const base = ["protect", "--manifest", manifestPath, "--wasm", wasmPath, "--json"];

  const onArgv = await cli([...base, "--mnemonic", VECTOR]);
  assert.notEqual(onArgv.code, 0);
  assert.match(onArgv.stderr, /not accepted on the command line/);
  assert.doesNotMatch(onArgv.stdout, /abandon/);

  const typo = await cli(base, { SDN_MODULE_SIGNING_MNEMONIC: BROKEN_CHECKSUM });
  assert.notEqual(typo.code, 0, "a mistyped mnemonic fails the run");
  assert.doesNotMatch(`${typo.stdout}${typo.stderr}`, /abandon/);

  const fromFile = await cli([...base, "--mnemonic-file", mnemonicPath], { SDN_MODULE_SIGNING_MNEMONIC: "" });
  assert.equal(fromFile.code, 0, fromFile.stderr);
  const summary = JSON.parse(fromFile.stdout);
  assert.equal("mnemonic" in summary, false);
  assert.match(summary.signingPublicKeyHex, /^[0-9a-f]{66}$/);
  assert.doesNotMatch(fromFile.stdout, /abandon/);
});

async function authorityKeys() {
  const privateKey = randomBytes(32);
  const publicKeyHex = Buffer.from(await secp256k1PublicKey(privateKey)).toString("hex");
  return {
    publicKeyHex,
    signer: createHdWalletSigner({ publicKeyHex, signDigest: (digest) => secp256k1SignDigest(digest, privateKey) }),
  };
}

// The natural verifier: it checks the signature against the key in the header.
const verifier = createHdWalletVerifier({
  verifyDigest: (digest, signature, header) => secp256k1VerifyDigest(digest, signature, Buffer.from(String(header.publicKeyHex), "hex")),
});

test("SEC-058: a deployment authorization verifies only against a trusted key, fresh, bounded and once", async () => {
  const authority = await authorityKeys();
  const attacker = await authorityKeys();
  const authorization = await createDeploymentAuthorization({ artifactId: "a", programId: "p", target: { id: "node-1" }, capabilities: ["clock"] });
  const envelope = await signAuthorization({ authorization, signer: authority.signer });

  await assert.rejects(verifyAuthorization({ envelope, verifier }), /requires trustedPublicKeys/);
  assert.equal(await verifyAuthorization({ envelope, verifier, trustedPublicKeys: [authority.publicKeyHex] }), true);

  // self-signed by an attacker whose key is in its own header
  const forged = await signAuthorization({ authorization: { ...authorization, capabilities: ["clock", "wallet_sign"] }, signer: attacker.signer });
  assert.equal(await verifyAuthorization({ envelope: forged, verifier, trustedPublicKeys: [authority.publicKeyHex] }), false);
  // ...or claiming the trusted key in its header while signing with its own
  const lying = { ...forged, protected: { ...forged.protected, publicKeyHex: authority.publicKeyHex } };
  assert.equal(await verifyAuthorization({ envelope: lying, verifier, trustedPublicKeys: [authority.publicKeyHex] }), false);

  const now = Date.now();
  const variants = {
    expired: { issuedAt: now - 120_000, expiresAt: now - 60_000 },
    "no expiry": { expiresAt: undefined },
    "lifetime too long": { issuedAt: now, expiresAt: now + 2 * 60 * 60 * 1000 },
    "issued in the future": { issuedAt: now + 10 * 60 * 1000, expiresAt: now + 11 * 60 * 1000 },
    "no nonce": { nonce: undefined },
  };
  for (const [label, change] of Object.entries(variants)) {
    const payload = { ...authorization, ...change };
    for (const key of Object.keys(change)) if (change[key] === undefined) delete payload[key];
    const signed = await signAuthorization({ authorization: payload, signer: authority.signer });
    assert.equal(await verifyAuthorization({ envelope: signed, verifier, trustedPublicKeys: [authority.publicKeyHex] }), false, label);
  }

  const seen = new Map();
  const nonceStore = { has: (nonce) => seen.has(nonce), add: (nonce, expiresAt) => seen.set(nonce, expiresAt) };
  assert.equal(await verifyAuthorization({ envelope, verifier, trustedPublicKeys: [authority.publicKeyHex], nonceStore }), true);
  assert.equal(await verifyAuthorization({ envelope, verifier, trustedPublicKeys: [authority.publicKeyHex], nonceStore }), false, "replay refused");
});

test("SEC-058: assertDeploymentAuthorization checks claims only on a verified envelope, and an expected target must be present", async () => {
  const authority = await authorityKeys();
  const authorization = await createDeploymentAuthorization({ artifactId: "a", programId: "p", capabilities: ["clock"] });
  const envelope = await signAuthorization({ authorization, signer: authority.signer });

  assert.throws(() => assertDeploymentAuthorization({ envelope, artifact: { artifactId: "a" } }), /has not been verified/);
  assert.equal(assertDeploymentAuthorization({ envelope, verified: true, artifact: { artifactId: "a" }, requiredCapabilities: ["clock"] }), true);
  // the payload names no target; a caller expecting one is refused, not waved through
  assert.throws(() => assertDeploymentAuthorization({ envelope, verified: true, target: { id: "node-1" } }), /target id mismatch/);
  assert.throws(() => assertDeploymentAuthorization({ envelope, verified: true, target: { audience: "aud" } }), /audience mismatch/);
  const noExpiry = { ...envelope, payload: { ...envelope.payload } };
  delete noExpiry.payload.expiresAt;
  assert.throws(() => assertDeploymentAuthorization({ envelope: noExpiry, verified: true }), /no expiry|expired/);
});
