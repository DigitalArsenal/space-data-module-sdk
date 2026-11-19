// A trusted key the caller named is never dropped without a word: a malformed
// key is refused by name (invalid_trusted_key), so a typo can never turn the
// signature check off. An empty environment variable does not hide the global
// list, and `verifySignature: true` always requires a signature.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ModuleSignatureError,
  resolveModuleSignaturePolicy,
  signModuleArtifact,
  verifyModuleArtifact,
} from "../src/bundle/signing.js";
import { createSingleFileBundle } from "../src/bundle/wasm.js";
import { extractPublicationRecordCollection } from "../src/transport/records.js";
import { loadModule } from "../src/host/isomorphicLoader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_KEYPAIR_PATH = path.join(__dirname, "support", "dev-module-signing-keypair.json");

function buildTestWasm() {
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x05, 0x01, 0x78, 0x01, 0x02, 0x03,
  ]);
}

const GOOD = "ab".repeat(32);
const MALFORMED = Object.freeze({
  "0x prefix": `0x${GOOD}`,
  "63 characters": GOOD.slice(0, 63),
  "65 characters": `${GOOD}a`,
  "a non-hex character": `${GOOD.slice(0, 63)}g`,
});

const isInvalidKey = (error) =>
  error instanceof ModuleSignatureError && error.code === "invalid_trusted_key";

async function withSignerEnv({ env, global }, fn) {
  const previousEnv = process.env.SDM_TRUSTED_MODULE_SIGNERS;
  const previousRequire = process.env.SDM_REQUIRE_MODULE_SIGNATURE;
  const previousGlobal = globalThis.__SDM_TRUSTED_MODULE_SIGNERS__;
  delete process.env.SDM_REQUIRE_MODULE_SIGNATURE;
  if (env === undefined) delete process.env.SDM_TRUSTED_MODULE_SIGNERS;
  else process.env.SDM_TRUSTED_MODULE_SIGNERS = env;
  if (global === undefined) delete globalThis.__SDM_TRUSTED_MODULE_SIGNERS__;
  else globalThis.__SDM_TRUSTED_MODULE_SIGNERS__ = global;
  try {
    return await fn();
  } finally {
    if (previousEnv === undefined) delete process.env.SDM_TRUSTED_MODULE_SIGNERS;
    else process.env.SDM_TRUSTED_MODULE_SIGNERS = previousEnv;
    if (previousRequire === undefined) delete process.env.SDM_REQUIRE_MODULE_SIGNATURE;
    else process.env.SDM_REQUIRE_MODULE_SIGNATURE = previousRequire;
    if (previousGlobal === undefined) delete globalThis.__SDM_TRUSTED_MODULE_SIGNERS__;
    else globalThis.__SDM_TRUSTED_MODULE_SIGNERS__ = previousGlobal;
  }
}

for (const [label, key] of Object.entries(MALFORMED)) {
  test(`a malformed trusted key (${label}) is refused by name, in the policy, the environment and the global`, async () => {
    assert.throws(
      () => resolveModuleSignaturePolicy({ verifySignature: { trustedPublicKeys: [key] } }),
      isInvalidKey,
    );
    // Next to a good key too: the bad one is never dropped silently.
    assert.throws(
      () => resolveModuleSignaturePolicy({ verifySignature: { trustedPublicKeys: [GOOD, key] } }),
      isInvalidKey,
    );
    await withSignerEnv({ env: key }, async () => {
      assert.throws(() => resolveModuleSignaturePolicy({}), isInvalidKey);
    });
    await withSignerEnv({ env: `${GOOD},${key}` }, async () => {
      assert.throws(() => resolveModuleSignaturePolicy({}), isInvalidKey);
    });
    await withSignerEnv({ global: [key] }, async () => {
      assert.throws(() => resolveModuleSignaturePolicy({}), isInvalidKey);
    });
    await assert.rejects(
      verifyModuleArtifact(buildTestWasm(), { trustedPublicKeys: [key] }),
      isInvalidKey,
    );
  });
}

test("a well-formed key is accepted after trim and lowercase; empty entries are not keys", async () => {
  assert.deepEqual(
    resolveModuleSignaturePolicy({
      verifySignature: { trustedPublicKeys: [`  ${GOOD.toUpperCase()}  `, ""] },
    }),
    { trustedPublicKeys: [GOOD], requireSignature: true },
  );
  await withSignerEnv({ env: ` ${GOOD} , ` }, async () => {
    assert.deepEqual(resolveModuleSignaturePolicy({}), {
      trustedPublicKeys: [GOOD],
      requireSignature: true,
    });
  });
});

test("an environment variable set but empty does not hide the global list", async () => {
  for (const env of ["", "   "]) {
    await withSignerEnv({ env, global: [GOOD] }, async () => {
      assert.deepEqual(resolveModuleSignaturePolicy({}), {
        trustedPublicKeys: [GOOD],
        requireSignature: true,
      });
    });
  }
});

test("verifySignature: true uses the environment's or the global's trust and always requires a signature", async () => {
  await withSignerEnv({}, async () => {
    assert.equal(resolveModuleSignaturePolicy({}), null);
    assert.deepEqual(resolveModuleSignaturePolicy({ verifySignature: true }), {
      trustedPublicKeys: [],
      requireSignature: true,
    });
  });
  await withSignerEnv({ env: GOOD }, async () => {
    assert.deepEqual(resolveModuleSignaturePolicy({ verifySignature: true }), {
      trustedPublicKeys: [GOOD],
      requireSignature: true,
    });
  });
  await withSignerEnv({ global: [GOOD] }, async () => {
    assert.deepEqual(resolveModuleSignaturePolicy({ verifySignature: true }), {
      trustedPublicKeys: [GOOD],
      requireSignature: true,
    });
  });
});

test("a stripped file under a policy with a mistyped key is refused, never loaded", async () => {
  const keypair = JSON.parse(await readFile(DEV_KEYPAIR_PATH, "utf8"));
  const signed = await signModuleArtifact(buildTestWasm(), {
    privateKeySeedHex: keypair.privateKeySeedHex,
  });
  const stripped = new Uint8Array(extractPublicationRecordCollection(signed.wasmBytes).payloadBytes);
  const signatureless = new Uint8Array(
    (await createSingleFileBundle({ wasmBytes: stripped, entries: [] })).wasmBytes,
  );
  const typo = keypair.publicKeyHex.slice(0, 63);
  const prefixed = `0x${keypair.publicKeyHex}`;
  const dir = await mkdtemp(path.join(tmpdir(), "sdm-policy-keys-"));
  try {
    for (const [label, bytes] of [["stripped", stripped], ["signatureless", signatureless], ["signed", signed.wasmBytes]]) {
      const wasmPath = path.join(dir, `${label}.wasm`);
      await writeFile(wasmPath, bytes);
      for (const key of [typo, prefixed]) {
        await assert.rejects(
          loadModule({ wasmSource: wasmPath, verifySignature: { trustedPublicKeys: [key] } }),
          isInvalidKey,
          `${label} under an explicit policy`,
        );
        await withSignerEnv({ env: key }, async () => {
          await assert.rejects(loadModule({ wasmSource: wasmPath }), isInvalidKey, `${label} under the environment`);
        });
        await withSignerEnv({ global: [key] }, async () => {
          await assert.rejects(loadModule({ wasmSource: wasmPath }), isInvalidKey, `${label} under the global`);
        });
      }
      // verifySignature: true with no trust configured refuses too, by name.
      await withSignerEnv({}, async () => {
        await assert.rejects(
          loadModule({ wasmSource: wasmPath, verifySignature: true }),
          (error) =>
            error instanceof ModuleSignatureError &&
            (error.code === "missing_signature" || error.code === "untrusted_signer"),
          `${label} under verifySignature: true with nothing trusted`,
        );
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
