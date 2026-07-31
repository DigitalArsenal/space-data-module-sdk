// CROSS-RUNTIME PARITY for the domain-separated module publication signature
// (graph task sdn-sdk-statement-domain-parity, Janus 2026-07-30).
//
// The statement `"SDN-MODULE-PUBLICATION-V1" || 0x00 || sha256(portable)` is
// implemented in Go three times (sdn-server/internal/sigdomain, the kubo twin,
// and the verifier that reads it) and in JS once — here, for BOTH the browser
// loader and the Node/WasmEdge loader. An artifact that verifies on the node
// and is refused in the browser is a P1 cross-runtime defect, so this suite
// does not write its own fixtures: it reads the SHARED vector file the node's
// Go suite reads, byte-for-byte.
//
//   test/support/statement-domain-vectors.json
//     == space-data-network/sdn-server/internal/modulert/testdata/statement-domain-vectors.json
//
// Both suites pin the file's sha256 (VECTORS_SHA256 here,
// vectorsSHA256 in publication_signature_vectors_test.go), so editing one copy
// turns the OTHER suite red. Every signature in it was produced by Go's
// crypto/ed25519 over a preimage built by Go's sigdomain.Statement; the
// artifact envelopes were produced by this SDK's own writer. Neither side gets
// to grade its own homework.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ModuleSignatureError,
  verifyModuleArtifact,
} from "../src/bundle/signing.js";
import {
  CONTENT_HASH_SIZE,
  DOMAIN_MODULE_PUBLICATION_V1,
  DOMAIN_UPDATE_MANIFEST_V1,
  SignatureDomainError,
  describe as describeDomain,
  domains as registeredDomains,
  registered,
  statement,
} from "../src/bundle/sigdomain.js";
import { ed25519PublicKey, ed25519Sign, sha256Bytes } from "../src/utils/wasmCrypto.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = path.join(
  __dirname,
  "support",
  "statement-domain-vectors.json",
);

// Pinned in the node's Go suite too. See this file's header.
const VECTORS_SHA256 =
  "72124d7710658858ca747c90593e7d0c23fb63560cb7b2cd3fe607d542d83c58";

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

const vectorsRaw = await readFile(VECTORS_PATH);
const vectors = JSON.parse(vectorsRaw.toString("utf8"));

test("the shared vector file is the same bytes the node's Go suite reads", () => {
  const sum = createHash("sha256").update(vectorsRaw).digest("hex");
  assert.equal(
    sum,
    VECTORS_SHA256,
    "shared vector file drifted — regenerate BOTH copies (SDK test/support + sdn-server internal/modulert/testdata) and update the pinned sha256 in BOTH suites",
  );
});

test("the statement-domain registry is closed and matches the node's", () => {
  assert.deepEqual(
    registeredDomains(),
    vectors.registry.map((entry) => entry.domain),
    "the JS registry has drifted from the node's sigdomain registry",
  );
  for (const entry of vectors.registry) {
    assert.equal(describeDomain(entry.domain), entry.description);
    assert.equal(registered(entry.domain), true);
  }
  assert.equal(registered("SDN-MADE-UP-DOMAIN"), false);
  assert.equal(CONTENT_HASH_SIZE, 32);
  // The two domains the node registers, named explicitly so adding a third
  // cannot slip in as "the vectors said so".
  assert.deepEqual(registeredDomains(), [
    DOMAIN_MODULE_PUBLICATION_V1,
    DOMAIN_UPDATE_MANIFEST_V1,
  ]);
});

test("statement() reproduces the node's preimage bytes exactly", () => {
  for (const vector of vectors.statements) {
    if (!vector.registered) {
      assert.throws(
        () => statement(vector.domain, hexToBytes(vector.contentHashHex)),
        (error) =>
          error instanceof SignatureDomainError &&
          error.code === "unregistered_statement_domain",
        `${vector.name}: an unregistered domain must have no statement at all`,
      );
      continue;
    }
    assert.equal(
      bytesToHex(statement(vector.domain, hexToBytes(vector.contentHashHex))),
      vector.statementHex,
      `${vector.name}: preimage bytes differ from the node's`,
    );
  }
});

test("statement() refuses a content hash that is not 32 raw bytes", () => {
  // The trap this closes: passing the hex TEXT of a hash instead of its bytes
  // would otherwise yield a perfectly valid signature over the wrong preimage.
  const hex = vectors.statements[0].contentHashHex;
  assert.throws(
    () => statement(DOMAIN_MODULE_PUBLICATION_V1, new TextEncoder().encode(hex)),
    (error) =>
      error instanceof SignatureDomainError &&
      error.code === "invalid_content_hash",
  );
  assert.throws(
    () => statement(DOMAIN_MODULE_PUBLICATION_V1, new Uint8Array(31)),
    (error) => error.code === "invalid_content_hash",
  );
});

test("signing the statement here reproduces the node's signature bytes", async () => {
  // Ed25519 is deterministic, so same seed + same preimage => same 64 bytes.
  // If this passes, the JS statement builder and Go's agree at the byte level
  // for the signing direction too, not only the verifying one.
  const seed = hexToBytes(vectors.signerSeedHex);
  const publicKey = await ed25519PublicKey(seed);
  assert.equal(bytesToHex(publicKey), vectors.signerPublicKeyHex);

  const portable = hexToBytes(vectors.portableHex);
  const contentHash = await sha256Bytes(portable);
  const signature = await ed25519Sign(
    statement(DOMAIN_MODULE_PUBLICATION_V1, contentHash),
    seed,
  );

  const nodeSigned = vectors.artifacts.find(
    (vector) => vector.name === "domain-signed-ok",
  );
  assert.ok(nodeSigned, "vector file is missing the domain-signed-ok artifact");
  assert.equal(
    bytesToHex(signature),
    nodeSigned.signatureEntry.signatureHex,
    "JS-produced signature differs from the node's over the same statement",
  );
});

for (const vector of vectors.artifacts) {
  test(`artifact vector: ${vector.name}`, async () => {
    const artifact = hexToBytes(vector.sdkArtifactHex);
    const options = { trustedPublicKeys: vector.trustedPublicKeysHex };

    if (vector.expect.verified) {
      const result = await verifyModuleArtifact(artifact, options);
      assert.equal(result.verified, true, vector.why);
      assert.equal(result.signed, true);
      assert.equal(
        result.statementDomain ?? "",
        vector.expect.statementDomain,
        `${vector.name}: statementDomain differs from the node's`,
      );
      assert.equal(
        result.contentHashHex,
        vector.expect.contentHashHex,
        `${vector.name}: portable content hash differs from the node's`,
      );
      // WHAT the signature covered, not merely that it passed. Agreeing on the
      // verdict while disagreeing on the basis is precisely how sdn-server
      // reported hash_mismatch for a bundle-scope artifact this verifier and
      // the kubo twin both accepted.
      assert.equal(
        result.signatureScope ?? "",
        vector.expect.signatureScope,
        `${vector.name}: signature scope differs from the node's`,
      );
      assert.equal(
        result.signedHashHex ?? "",
        vector.expect.signedHashHex,
        `${vector.name}: signed digest differs from the node's`,
      );
      return;
    }

    await assert.rejects(
      verifyModuleArtifact(artifact, options),
      (error) => {
        assert.ok(
          error instanceof ModuleSignatureError,
          `${vector.name}: expected a ModuleSignatureError, got ${error}`,
        );
        assert.equal(
          error.code,
          vector.expect.reason,
          `${vector.name}: refusal reason differs from the node's — ${vector.why}`,
        );
        if (vector.expect.statementDomain !== "") {
          assert.equal(
            error.statementDomain ?? "",
            vector.expect.statementDomain,
            `${vector.name}: reported statement domain differs from the node's`,
          );
        }
        return true;
      },
      vector.why,
    );
  });
}

test("the verifier and its crypto cannot fork per runtime", async () => {
  // TRI-RUNTIME, structurally rather than by testing twice: `./bundle` and
  // `./utils/wasm-crypto` must resolve to ONE file under every export
  // condition. The moment either grows a {browser, default} fork, "the browser
  // verifier" becomes a different program from "the Node/WasmEdge verifier"
  // and this whole vector file stops proving anything about the browser.
  const packageJson = JSON.parse(
    await readFile(path.join(__dirname, "..", "package.json"), "utf8"),
  );
  for (const subpath of ["./bundle", "./utils/wasm-crypto"]) {
    assert.equal(
      typeof packageJson.exports[subpath],
      "string",
      `${subpath} must resolve to a single file for every runtime; a conditional export here forks the signature verifier`,
    );
  }
  // And the verifier itself must not sniff the runtime.
  const verifierSource = await readFile(
    path.join(__dirname, "..", "src", "bundle", "sigdomain.js"),
    "utf8",
  );
  for (const sniff of ["typeof window", "typeof document", "navigator", "process.versions"]) {
    assert.ok(
      !verifierSource.includes(sniff),
      `sigdomain.js must contain no runtime detection (found ${sniff})`,
    );
  }
});

test("the browser export condition resolves the same verifier and agrees on every vector", async () => {
  // Resolution under `--conditions=browser` is what a bundler does; running the
  // vectors through THAT resolution is the browser lane's evidence. It is a
  // child process because export conditions are fixed at process start.
  const script = `
    import { verifyModuleArtifact } from "space-data-module-sdk/bundle";
    import { readFile } from "node:fs/promises";
    const vectors = JSON.parse(await readFile(${JSON.stringify(VECTORS_PATH)}, "utf8"));
    const hexToBytes = (hex) => {
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return out;
    };
    const results = [];
    for (const vector of vectors.artifacts) {
      const options = { trustedPublicKeys: vector.trustedPublicKeysHex };
      try {
        const result = await verifyModuleArtifact(hexToBytes(vector.sdkArtifactHex), options);
        results.push({ name: vector.name, verified: result.verified, reason: "ok", statementDomain: result.statementDomain ?? "" });
      } catch (error) {
        results.push({ name: vector.name, verified: false, reason: error.code, statementDomain: error.statementDomain ?? "" });
      }
    }
    process.stdout.write(JSON.stringify(results));
  `;
  const child = spawnSync(
    process.execPath,
    ["--conditions=browser", "--input-type=module", "-e", script],
    { cwd: path.join(__dirname, ".."), encoding: "utf8" },
  );
  assert.equal(
    child.status,
    0,
    `browser-condition child failed: ${child.stderr || child.stdout}`,
  );
  const results = JSON.parse(child.stdout);
  assert.equal(results.length, vectors.artifacts.length);
  for (const [index, vector] of vectors.artifacts.entries()) {
    const got = results[index];
    assert.equal(got.name, vector.name);
    assert.equal(
      got.verified,
      vector.expect.verified,
      `${vector.name}: browser condition disagrees with Node on the verdict`,
    );
    assert.equal(
      got.reason,
      vector.expect.reason,
      `${vector.name}: browser condition disagrees with Node on the reason`,
    );
    assert.equal(
      got.statementDomain,
      vector.expect.statementDomain,
      `${vector.name}: browser condition disagrees with Node on the statement domain`,
    );
  }
});

test("a node-signed artifact is refused when its payload is swapped for another module", async () => {
  // Not in the shared file because it is built from two vectors at once: take
  // the accepted artifact's trailer and put a DIFFERENT module in front of it.
  // The signature still checks out against its own statement — but not against
  // the statement over these bytes, which is the whole point of binding the
  // content hash into the preimage.
  const ok = vectors.artifacts.find((v) => v.name === "domain-signed-ok");
  const tamperedVector = vectors.artifacts.find(
    (v) => v.name === "domain-signed-tampered-payload",
  );
  const okArtifact = hexToBytes(ok.sdkArtifactHex);
  const otherPortable = hexToBytes(tamperedVector.portableHex);
  const okPortableLength = hexToBytes(ok.portableHex).length;

  const swapped = new Uint8Array(
    otherPortable.length + (okArtifact.length - okPortableLength),
  );
  swapped.set(otherPortable, 0);
  swapped.set(okArtifact.subarray(okPortableLength), otherPortable.length);

  await assert.rejects(
    verifyModuleArtifact(swapped, {
      trustedPublicKeys: ok.trustedPublicKeysHex,
    }),
    (error) => error instanceof ModuleSignatureError,
  );
});
