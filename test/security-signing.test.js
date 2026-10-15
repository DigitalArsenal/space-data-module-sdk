// Regression tests for the 2026-10-15 security audit, signing and trust:
//   SEC-008 fail-closed trust policy (strict keys, signature always required,
//           no silent "no policy"), malformed trailers are errors
//   SEC-005 the published development signer is denylisted (explicit
//           allowDevFixture opt-in for tests only)
//   SEC-021 the CLI signs with bundle scope by default; the unsigned MBL
//           manifest is not read as the artifact's manifest
// Signing keys are random per run, except where a test exercises the
// development fixture on purpose.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { signModuleArtifact, verifyModuleArtifact } from "../src/bundle/signing.js";
import {
  DENYLISTED_MODULE_SIGNER_PUBLIC_KEYS,
  parseTrustedModuleSigners,
  resolveTrustedModuleSignaturePolicy,
  verifyTrustedModuleArtifact,
} from "../src/bundle/trustPolicy.js";
import {
  appendWasmCustomSection,
  createSingleFileBundle,
  parseSingleFileBundle,
} from "../src/bundle/wasm.js";
import { SDS_MANIFEST_SECTION_NAME } from "../src/bundle/constants.js";
import { locateEmbeddedPlgManifest } from "../src/compliance/index.js";
import { encodePluginManifest } from "../src/manifest/index.js";
import { ed25519PublicKey } from "../src/utils/wasmCrypto.js";

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "bin", "space-data-module.js");
const DEV_KEYPAIR_PATH = path.join(__dirname, "support", "dev-module-signing-keypair.json");
const DEV_PUBLIC_KEY = "cf4625795484d8efe18860141cfdeaaaed7bbee9209488405b6ddeac7543fe78";

function buildTestWasm(marker = 1) {
  return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x00, 0x05, 0x01, 0x78, marker, 0x02, 0x03]);
}

async function randomSigner() {
  const seed = randomBytes(32);
  return {
    privateKeySeedHex: seed.toString("hex"),
    publicKeyHex: Buffer.from(await ed25519PublicKey(seed)).toString("hex"),
  };
}

async function cli(args, options = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { env: { ...process.env, ...options.env } });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("SEC-008: a configured trust set always requires a signature; unsigned and stripped artifacts are refused", async () => {
  const signer = await randomSigner();
  const signed = await signModuleArtifact(buildTestWasm(), { privateKeySeedHex: signer.privateKeySeedHex, signatureScope: "bundle" });
  const policy = resolveTrustedModuleSignaturePolicy({ verifySignature: { trustedPublicKeys: [signer.publicKeyHex] } });
  assert.equal(policy.requireSignature, true);

  const verified = await verifyTrustedModuleArtifact(signed.wasmBytes, policy);
  assert.equal(verified.verified, true);
  assert.equal(verified.signatureScope, "bundle");

  const parsed = await parseSingleFileBundle(signed.wasmBytes);
  for (const [label, bytes] of [["unsigned", buildTestWasm()], ["trailer stripped", parsed.wasmBytes]]) {
    await assert.rejects(verifyTrustedModuleArtifact(bytes, policy), (error) => error.code === "missing_signature", label);
  }

  const attacker = await randomSigner();
  const evil = await signModuleArtifact(buildTestWasm(9), { privateKeySeedHex: attacker.privateKeySeedHex, signatureScope: "bundle" });
  await assert.rejects(verifyTrustedModuleArtifact(evil.wasmBytes, policy), (error) => error.code === "untrusted_signer");

  // requireSignature: false is not a way around it
  assert.throws(
    () => resolveTrustedModuleSignaturePolicy({ verifySignature: { trustedPublicKeys: [signer.publicKeyHex], requireSignature: false } }),
    (error) => error.code === "invalid_trust_policy",
  );
  // nothing configured is an error, never "load unverified"
  const savedEnv = process.env.SDM_TRUSTED_MODULE_SIGNERS;
  delete process.env.SDM_TRUSTED_MODULE_SIGNERS;
  try {
    assert.throws(() => resolveTrustedModuleSignaturePolicy({}), (error) => error.code === "no_trust_policy");
  } finally {
    if (savedEnv !== undefined) process.env.SDM_TRUSTED_MODULE_SIGNERS = savedEnv;
  }
  // the only opt-out is explicit
  assert.equal(resolveTrustedModuleSignaturePolicy({ verifySignature: false }), null);
});

test("SEC-008: trusted-key lists are parsed strictly; a malformed or empty list never becomes 'no policy'", async () => {
  const a = (await randomSigner()).publicKeyHex;
  const b = (await randomSigner()).publicKeyHex;
  assert.deepEqual(parseTrustedModuleSigners(`0x${a}`), [a]);
  assert.deepEqual(parseTrustedModuleSigners(`${a};${b}`), [a, b]);
  assert.deepEqual(parseTrustedModuleSigners(` ${a.toUpperCase()} , ${b}\n`), [a, b]);
  for (const bad of [`${a}x`, a.slice(2), "not-a-key", [a, 42], [""]]) {
    assert.throws(() => parseTrustedModuleSigners(bad), (error) => error.code === "invalid_trusted_key", String(bad));
  }
  for (const empty of ["", " ; ", []]) {
    assert.throws(() => parseTrustedModuleSigners(empty), (error) => error.code === "invalid_trusted_key");
  }

  const savedEnv = process.env.SDM_TRUSTED_MODULE_SIGNERS;
  try {
    process.env.SDM_TRUSTED_MODULE_SIGNERS = `0x${a}`;
    assert.deepEqual(resolveTrustedModuleSignaturePolicy({}).trustedPublicKeys, [a]);
    process.env.SDM_TRUSTED_MODULE_SIGNERS = `${a};${b}`;
    assert.deepEqual(resolveTrustedModuleSignaturePolicy({}).trustedPublicKeys, [a, b]);
    process.env.SDM_TRUSTED_MODULE_SIGNERS = "0xdeadbeef";
    assert.throws(() => resolveTrustedModuleSignaturePolicy({}), (error) => error.code === "invalid_trusted_key");
    process.env.SDM_TRUSTED_MODULE_SIGNERS = "";
    assert.throws(() => resolveTrustedModuleSignaturePolicy({}), (error) => error.code === "invalid_trusted_key");
  } finally {
    if (savedEnv === undefined) delete process.env.SDM_TRUSTED_MODULE_SIGNERS;
    else process.env.SDM_TRUSTED_MODULE_SIGNERS = savedEnv;
  }
});

test("SEC-008: a signed artifact whose record trailer is corrupted is an error, not an 'unsigned' artifact", async () => {
  const signer = await randomSigner();
  const signed = await signModuleArtifact(buildTestWasm(), { privateKeySeedHex: signer.privateKeySeedHex, signatureScope: "bundle" });
  const footer = signed.wasmBytes.length - 8;
  const recordLength = new DataView(signed.wasmBytes.buffer, signed.wasmBytes.byteOffset).getUint32(footer, true);
  const trailerStart = footer - recordLength;
  for (const offset of [0, 1, 4]) {
    const corrupted = new Uint8Array(signed.wasmBytes);
    corrupted[trailerStart + offset] ^= 0xff;
    await assert.rejects(
      verifyModuleArtifact(corrupted, { trustedPublicKeys: [signer.publicKeyHex] }),
      (error) => error.code === "malformed_trailer",
      `trailer byte ${offset}`,
    );
  }
});

test("SEC-005: the published development signer is denylisted unless a test opts in explicitly", async () => {
  assert.deepEqual([...DENYLISTED_MODULE_SIGNER_PUBLIC_KEYS], [DEV_PUBLIC_KEY]);
  assert.throws(() => parseTrustedModuleSigners([DEV_PUBLIC_KEY]), (error) => error.code === "denylisted_signer");
  assert.throws(
    () => resolveTrustedModuleSignaturePolicy({ verifySignature: { trustedPublicKeys: [DEV_PUBLIC_KEY] } }),
    (error) => error.code === "denylisted_signer",
  );

  const keypair = JSON.parse(await readFile(DEV_KEYPAIR_PATH, "utf8"));
  assert.equal(keypair.publicKeyHex, DEV_PUBLIC_KEY, "the denylist names the committed fixture");
  const signed = await signModuleArtifact(buildTestWasm(), { privateKeySeedHex: keypair.privateKeySeedHex, signatureScope: "bundle" });
  await assert.rejects(
    verifyTrustedModuleArtifact(signed.wasmBytes, { trustedPublicKeys: [DEV_PUBLIC_KEY] }),
    (error) => error.code === "denylisted_signer",
  );
  const allowed = await verifyTrustedModuleArtifact(signed.wasmBytes, { trustedPublicKeys: [DEV_PUBLIC_KEY], allowDevFixture: true });
  assert.equal(allowed.verified, true);
});

test("SEC-005/SEC-008/SEC-021: the CLI signs with bundle scope, verifies strictly, refuses the dev signer, and no longer advertises it", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "sdm-cli-sign-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const signer = await randomSigner();
  const keyPath = path.join(dir, "publisher.json");
  await writeFile(keyPath, JSON.stringify({ privateKeySeedHex: signer.privateKeySeedHex, keyId: "cli-test" }));
  const wasmPath = path.join(dir, "module.wasm");
  await writeFile(wasmPath, buildTestWasm());

  const help = await cli(["--help"]);
  assert.doesNotMatch(`${help.stdout}${help.stderr}`, /dev-module-signing-keypair/);

  const signed = await cli(["sign", "--wasm", wasmPath, "--key", keyPath, "--out", path.join(dir, "signed.wasm")]);
  assert.equal(signed.code, 0, signed.stderr);
  assert.match(signed.stdout, /signatureScope=bundle/);
  const result = await verifyModuleArtifact(await readFile(path.join(dir, "signed.wasm")), {
    trustedPublicKeys: [signer.publicKeyHex],
    requireSignature: true,
  });
  assert.equal(result.signatureScope, "bundle");

  const verified = await cli(["verify", "--wasm", path.join(dir, "signed.wasm"), "--trusted", `0x${signer.publicKeyHex}`]);
  assert.equal(verified.code, 0, verified.stderr);
  assert.match(verified.stdout, /verified=true/);
  const unsignedVerify = await cli(["verify", "--wasm", wasmPath, "--trusted", signer.publicKeyHex]);
  assert.notEqual(unsignedVerify.code, 0);
  const malformed = await cli(["verify", "--wasm", path.join(dir, "signed.wasm"), "--trusted", "0xdeadbeef"]);
  assert.notEqual(malformed.code, 0);
  assert.match(malformed.stderr, /not a 64-hex/);

  const devSign = await cli(["sign", "--wasm", wasmPath, "--key", DEV_KEYPAIR_PATH, "--out", path.join(dir, "dev.wasm")]);
  assert.notEqual(devSign.code, 0);
  assert.match(devSign.stderr, /development key/);
  const devSignAllowed = await cli(["sign", "--wasm", wasmPath, "--key", DEV_KEYPAIR_PATH, "--out", path.join(dir, "dev.wasm"), "--allow-dev-fixture"]);
  assert.equal(devSignAllowed.code, 0, devSignAllowed.stderr);
  const devVerify = await cli(["verify", "--wasm", path.join(dir, "dev.wasm"), "--key", DEV_KEYPAIR_PATH]);
  assert.notEqual(devVerify.code, 0);
  assert.match(devVerify.stderr, /development signer/);
});

test("SEC-021: the unsigned MBL manifest of a module-scope artifact is not read as its manifest", async () => {
  const signer = await randomSigner();
  const manifest = {
    pluginId: "com.digitalarsenal.tests.trailer-manifest",
    name: "Trailer manifest",
    version: "1.0.0",
    pluginFamily: "analysis",
    capabilities: ["clock"],
    invokeSurfaces: ["direct"],
    runtimeTargets: ["browser"],
    methods: [{ methodId: "invoke", inputPorts: [], outputPorts: [], maxBatch: 1, drainPolicy: "single-shot" }],
  };
  const wasm = appendWasmCustomSection(buildTestWasm(), SDS_MANIFEST_SECTION_NAME, encodePluginManifest(manifest));
  const moduleScope = await signModuleArtifact(wasm, { privateKeySeedHex: signer.privateKeySeedHex });

  // ATTACKER (no key): swap the trailer manifest, keep the signature entry verbatim
  const parsed = await parseSingleFileBundle(moduleScope.wasmBytes);
  const signature = JSON.parse(new TextDecoder().decode(new Uint8Array(parsed.bundle.entries.find((e) => e.entryId === "signature").payload)));
  const evilManifest = { ...manifest, capabilities: ["clock", "network", "wallet_sign", "secrets"], runtimeTargets: ["browser", "wasmedge"] };
  const tampered = (await createSingleFileBundle({ wasmBytes: moduleScope.wasmBytes, manifestBytes: encodePluginManifest(evilManifest), signature })).wasmBytes;
  const verification = await verifyModuleArtifact(tampered, { trustedPublicKeys: [signer.publicKeyHex], requireSignature: true });
  assert.equal(verification.verified, true, "module scope does not cover the trailer (the reason for this fix)");
  assert.equal(verification.signatureScope, "module");

  for (const options of [{}, { verification }]) {
    const located = locateEmbeddedPlgManifest(tampered, options);
    assert.notEqual(located?.source, "bundle-manifest");
    const names = (located?.decoded?.capabilities ?? []).map((c) => c?.name ?? c);
    assert.ok(!names.includes("wallet_sign"), "the swapped capabilities are never read");
  }

  // bundle scope: the trailer IS signed, and a verified result unlocks it
  const bundleScope = await signModuleArtifact(wasm, { privateKeySeedHex: signer.privateKeySeedHex, signatureScope: "bundle" });
  const bundleVerification = await verifyModuleArtifact(bundleScope.wasmBytes, { trustedPublicKeys: [signer.publicKeyHex], requireSignature: true });
  const located = locateEmbeddedPlgManifest(bundleScope.wasmBytes, { verification: bundleVerification });
  assert.equal(located?.source, "bundle-manifest");
  assert.deepEqual(located.decoded.capabilities.map((c) => c?.name ?? c), ["clock"]);
});
