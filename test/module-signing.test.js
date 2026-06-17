import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ModuleSignatureError,
  signModuleArtifact,
  verifyModuleArtifact,
  resolveModuleSignaturePolicy,
} from "../src/bundle/signing.js";
import {
  createSingleFileBundle,
  parseSingleFileBundle,
} from "../src/bundle/wasm.js";
import { loadModule } from "../src/host/isomorphicLoader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_KEYPAIR_PATH = path.join(
  __dirname,
  "support",
  "dev-module-signing-keypair.json",
);

async function loadDevKeypair() {
  return JSON.parse(await readFile(DEV_KEYPAIR_PATH, "utf8"));
}

// Minimal valid wasm: header + one custom section "x" with payload [1,2,3].
// The custom section does not match the sds.* strip prefix, so it is part of
// the canonical module hash — flipping a payload byte simulates tampering.
function buildTestWasm() {
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x05, 0x01, 0x78, 0x01, 0x02, 0x03,
  ]);
}

test("dev keypair fixture exists and is well-formed", async () => {
  const keypair = await loadDevKeypair();
  assert.equal(keypair.algorithm, "ed25519");
  assert.match(keypair.privateKeySeedHex, /^[0-9a-f]{64}$/);
  assert.match(keypair.publicKeyHex, /^[0-9a-f]{64}$/);
  assert.ok(
    /development|test/i.test(keypair.comment ?? ""),
    "fixture must be clearly marked as development/test only",
  );
});

test("sign + verify round-trip with the dev keypair", async () => {
  const keypair = await loadDevKeypair();
  const signed = await signModuleArtifact(buildTestWasm(), {
    privateKeySeedHex: keypair.privateKeySeedHex,
    keyId: keypair.keyId,
  });
  assert.equal(signed.signature.publicKeyHex, keypair.publicKeyHex);

  const result = await verifyModuleArtifact(signed.wasmBytes, {
    trustedPublicKeys: [keypair.publicKeyHex],
    requireSignature: true,
  });
  assert.equal(result.verified, true);
  assert.equal(result.signed, true);
  assert.equal(result.keyId, keypair.keyId);
  assert.equal(result.canonicalModuleHashHex, signed.canonicalModuleHashHex);
});

test("verification rejects an untrusted signer", async () => {
  const keypair = await loadDevKeypair();
  const signed = await signModuleArtifact(buildTestWasm(), {
    privateKeySeedHex: keypair.privateKeySeedHex,
  });
  await assert.rejects(
    verifyModuleArtifact(signed.wasmBytes, {
      trustedPublicKeys: ["ab".repeat(32)],
      requireSignature: true,
    }),
    (error) =>
      error instanceof ModuleSignatureError &&
      error.code === "untrusted_signer",
  );
});

test("verification rejects tampered module bytes", async () => {
  const keypair = await loadDevKeypair();
  const signed = await signModuleArtifact(buildTestWasm(), {
    privateKeySeedHex: keypair.privateKeySeedHex,
  });
  const tampered = new Uint8Array(signed.wasmBytes);
  // Flip a byte inside the "x" custom section payload (offset 12 in the
  // original wasm, which is preserved at the head of the bundled artifact).
  tampered[12] ^= 0xff;
  await assert.rejects(
    verifyModuleArtifact(tampered, {
      trustedPublicKeys: [keypair.publicKeyHex],
      requireSignature: true,
    }),
    (error) =>
      error instanceof ModuleSignatureError && error.code === "hash_mismatch",
  );
});

test("verification rejects a signature from the wrong key over the same hash", async () => {
  const keypair = await loadDevKeypair();
  const otherSeed = "11".repeat(32);
  const signed = await signModuleArtifact(buildTestWasm(), {
    privateKeySeedHex: otherSeed,
  });
  // Trust the OTHER key's public key but swap in the dev signature payload:
  // simulate by signing with other key and trusting dev key.
  await assert.rejects(
    verifyModuleArtifact(signed.wasmBytes, {
      trustedPublicKeys: [keypair.publicKeyHex],
      requireSignature: true,
    }),
    (error) =>
      error instanceof ModuleSignatureError &&
      error.code === "untrusted_signer",
  );
});

test("unsigned artifact: requireSignature throws, otherwise reports unsigned", async () => {
  const wasm = buildTestWasm();
  await assert.rejects(
    verifyModuleArtifact(wasm, {
      trustedPublicKeys: ["ab".repeat(32)],
      requireSignature: true,
    }),
    (error) =>
      error instanceof ModuleSignatureError &&
      error.code === "missing_signature",
  );
  const lenient = await verifyModuleArtifact(wasm, {
    trustedPublicKeys: ["ab".repeat(32)],
  });
  assert.deepEqual(lenient, {
    verified: false,
    signed: false,
    reason: "unsigned",
  });
});

test("signing preserves existing bundle manifest and entries", async () => {
  const keypair = await loadDevKeypair();
  const manifestBytes = new TextEncoder().encode('{"pluginId":"test"}');
  const bundled = await createSingleFileBundle({
    wasmBytes: buildTestWasm(),
    manifestBytes,
    entries: [
      {
        entryId: "extra",
        role: "auxiliary",
        sectionName: "sds.extra",
        payloadEncoding: "json-utf8",
        payload: { keep: true },
      },
    ],
  });
  const signed = await signModuleArtifact(bundled.wasmBytes, {
    privateKeySeedHex: keypair.privateKeySeedHex,
    keyId: keypair.keyId,
  });
  const parsed = await parseSingleFileBundle(signed.wasmBytes);
  const entryIds = parsed.bundle.entries.map((entry) => entry.entryId);
  assert.ok(entryIds.includes("manifest"), "manifest entry preserved");
  assert.ok(entryIds.includes("extra"), "additional entry preserved");
  assert.ok(entryIds.includes("signature"), "signature entry added");
  const result = await verifyModuleArtifact(signed.wasmBytes, {
    trustedPublicKeys: [keypair.publicKeyHex],
    requireSignature: true,
  });
  assert.equal(result.verified, true);
});

test("re-signing replaces the previous signature entry", async () => {
  const keypair = await loadDevKeypair();
  const first = await signModuleArtifact(buildTestWasm(), {
    privateKeySeedHex: "22".repeat(32),
  });
  const second = await signModuleArtifact(first.wasmBytes, {
    privateKeySeedHex: keypair.privateKeySeedHex,
    keyId: keypair.keyId,
  });
  const parsed = await parseSingleFileBundle(second.wasmBytes);
  const signatureEntries = parsed.bundle.entries.filter(
    (entry) => entry.entryId === "signature",
  );
  assert.equal(signatureEntries.length, 1);
  const result = await verifyModuleArtifact(second.wasmBytes, {
    trustedPublicKeys: [keypair.publicKeyHex],
    requireSignature: true,
  });
  assert.equal(result.publicKeyHex, keypair.publicKeyHex);
});

test("loadModule rejects unsigned artifacts before instantiation when policy requires signatures", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sdm-signing-"));
  const wasmPath = path.join(dir, "unsigned.wasm");
  await writeFile(wasmPath, buildTestWasm());
  await assert.rejects(
    loadModule({
      wasmSource: wasmPath,
      verifySignature: {
        trustedPublicKeys: ["ab".repeat(32)],
        requireSignature: true,
      },
    }),
    (error) =>
      error instanceof ModuleSignatureError &&
      error.code === "missing_signature",
  );
});

test("loadModule accepts a signed artifact under the same policy (verification passes before runtime selection)", async () => {
  const keypair = await loadDevKeypair();
  const signed = await signModuleArtifact(buildTestWasm(), {
    privateKeySeedHex: keypair.privateKeySeedHex,
  });
  const dir = await mkdtemp(path.join(tmpdir(), "sdm-signing-"));
  const wasmPath = path.join(dir, "signed.wasm");
  await writeFile(wasmPath, signed.wasmBytes);
  // Loading must proceed past signature verification: the loader strips the
  // appended publication record collection (signature trailer) before
  // compiling/launching, so a trusted signed artifact reaches runtime
  // selection. If the minimal test wasm still fails in the runtime layer,
  // that failure must NOT be a signature error.
  let harness = null;
  try {
    harness = await loadModule({
      wasmSource: wasmPath,
      verifySignature: {
        trustedPublicKeys: [keypair.publicKeyHex],
        requireSignature: true,
      },
    });
  } catch (error) {
    assert.ok(
      !(error instanceof ModuleSignatureError),
      `signature verification must pass for a trusted signed artifact: ${error}`,
    );
  } finally {
    await harness?.destroy?.();
  }
});

test("resolveModuleSignaturePolicy resolves explicit, env, and global sources", async () => {
  assert.equal(resolveModuleSignaturePolicy({}), null);
  assert.equal(resolveModuleSignaturePolicy({ verifySignature: false }), null);
  const explicit = resolveModuleSignaturePolicy({
    verifySignature: { trustedPublicKeys: ["AB".repeat(32)], requireSignature: true },
  });
  assert.deepEqual(explicit.trustedPublicKeys, ["ab".repeat(32)]);
  assert.equal(explicit.requireSignature, true);

  process.env.SDM_TRUSTED_MODULE_SIGNERS = "cd".repeat(32);
  process.env.SDM_REQUIRE_MODULE_SIGNATURE = "1";
  try {
    const fromEnv = resolveModuleSignaturePolicy({});
    assert.deepEqual(fromEnv.trustedPublicKeys, ["cd".repeat(32)]);
    assert.equal(fromEnv.requireSignature, true);
  } finally {
    delete process.env.SDM_TRUSTED_MODULE_SIGNERS;
    delete process.env.SDM_REQUIRE_MODULE_SIGNATURE;
  }

  globalThis.__SDM_TRUSTED_MODULE_SIGNERS__ = ["ef".repeat(32)];
  globalThis.__SDM_REQUIRE_MODULE_SIGNATURE__ = true;
  try {
    const fromGlobal = resolveModuleSignaturePolicy({});
    assert.deepEqual(fromGlobal.trustedPublicKeys, ["ef".repeat(32)]);
    assert.equal(fromGlobal.requireSignature, true);
  } finally {
    delete globalThis.__SDM_TRUSTED_MODULE_SIGNERS__;
    delete globalThis.__SDM_REQUIRE_MODULE_SIGNATURE__;
  }
});
