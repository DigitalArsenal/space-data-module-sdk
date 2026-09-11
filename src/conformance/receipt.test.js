/**
 * W4.1 — conformance receipt format + bundle ATTESTATION + client
 * verify-chain (task harness-w4-conformance-receipt-attestation, finding
 * graph/findings/official-harness-shapes.md §5).
 *
 * Outcome tests ONLY (owner 2026-08-13): every assertion below is a
 * computable contract — the settled canonical format, the strip-then-hash
 * binding, the bundle-chain links, and each refusal class. The RECEIPT_FIXTURE
 * is the settle point: the byte-exact canonical document, pinned identically
 * on the sdn side (sdn-server/internal/pmmreceipt/receipt_test.go parses the
 * same string). A drift on either side is a red lane.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  ConformanceReceiptError,
  RECEIPT_DOCUMENT_KEY,
  RECEIPT_SCHEMA_VERSION,
  buildConformanceReceipt,
  canonicalReceiptBytes,
  formatConformanceReceipt,
  parseConformanceReceipt,
  portableArtifactDigest,
  receiptFingerprint,
} from "./receipt.js";
import {
  RECEIPT_ATTESTATION_ENTRY_ID,
  RECEIPT_ATTESTATION_MEDIA_TYPE,
  ReceiptAttestationError,
  decodeConformanceReceiptAttestation,
  encodeConformanceReceiptAttestation,
  findConformanceReceiptAttestation,
  verifyBundleConformanceReceipt,
} from "../bundle/attestation.js";
import { createSingleFileBundle, parseSingleFileBundle } from "../bundle/wasm.js";
import { signModuleArtifact, verifyModuleArtifact } from "../bundle/signing.js";
import {
  BUNDLE_SIGNATURE_HASH_ALGORITHM,
  moduleBundleRoleToName,
} from "../bundle/index.js";

const privateKeySeedHex = "31".repeat(32);

const SIGNED = "PASS";

// The settled W4.1 receipt — canonical byte form (sorted keys, compact).
// Pinned byte-exactly; sdn-server/internal/pmmreceipt parses this same string.
const RECEIPT_FIXTURE =
  '{"sdn-conformance-receipt":{"artifact":{"sha256":"b5c9a1b2db97ddd709a490be797722c07df0302194bdc79589f3503424668afa","size_bytes":14},"checks":[{"detail":"12/12 vector cases pass (authority: keplerian textbook anchors)","id":"vectors-tierB-keplerian-reference","required":true,"status":"pass","tier":2},{"detail":"energy closure within 1e-9 relative","id":"vis-viva-closure","required":true,"status":"pass","tier":3}],"corpus":{"cases":12,"model":"keplerian","path":"/modules/propagator/keplerian-reference/vectors/vectors.json","schema_version":"1"},"family":"propagator","generated_at":"2026-08-21T00:00:00.000Z","kit":{"id":"propagator","version":"1.0.0"},"summary":{"failed":0,"gaps":0,"passed":2},"tool":{"name":"space-data-module-sdk","version":"0.8.15"},"verdict":"PASS","version":1}}';

const FIXTURE_ARTIFACT_SHA256 = "b5c9a1b2db97ddd709a490be797722c07df0302194bdc79589f3503424668afa";

function testWasm() {
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x04, 0x01, 0x78, 0xaa, 0xbb,
  ]);
}

function deterministicReport() {
  return {
    family: "propagator",
    verdict: SIGNED,
    corpus: {
      path: "/modules/propagator/keplerian-reference/vectors/vectors.json",
      schemaVersion: "1",
      cases: 12,
      model: "keplerian",
    },
    checks: [
      {
        id: "vectors-tierB-keplerian-reference",
        tier: 2,
        required: true,
        status: "pass",
        detail: "12/12 vector cases pass (authority: keplerian textbook anchors)",
      },
      {
        id: "vis-viva-closure",
        tier: 3,
        required: true,
        status: "pass",
        detail: "energy closure within 1e-9 relative",
      },
    ],
  };
}

async function traileredArtifactBytes() {
  const bundle = await createSingleFileBundle({
    wasmBytes: testWasm(),
    manifestBytes: new Uint8Array([9, 10, 11]),
  });
  return { wasmBytes: bundle.wasmBytes, bundle };
}

function receiptFor(report = deterministicReport(), artifactBytes, extra = {}) {
  return buildConformanceReceipt(report, {
    artifactBytes,
    kit: { id: "propagator", version: "1.0.0" },
    tool: { name: "space-data-module-sdk", version: "0.8.15" },
    generatedAt: "2026-08-21T00:00:00.000Z",
    ...extra,
  });
}

test("W4.1 receipt settles the canonical format (fixture pinned byte-exact)", async () => {
  const { wasmBytes } = await traileredArtifactBytes();
  const receipt = await receiptFor(deterministicReport(), wasmBytes);
  const canonical = new TextDecoder().decode(canonicalReceiptBytes(receipt));
  assert.equal(canonical, RECEIPT_FIXTURE);
  // And the settled digest IS what the manifest CONTENT_HASH will carry:
  assert.equal(receipt[RECEIPT_DOCUMENT_KEY].artifact.sha256, FIXTURE_ARTIFACT_SHA256);
});

test("portable digest strips the REC trailer before hashing", async () => {
  const { wasmBytes } = await traileredArtifactBytes();
  const portable = await portableArtifactDigest(wasmBytes);
  // The raw (trailered) file hashes DIFFERENTLY — certifying trailered bytes
  // would disagree with every manifest CONTENT_HASH in the fleet.
  const rawSha256 = crypto.createHash("sha256").update(wasmBytes).digest("hex");
  assert.notEqual(portable.sha256, rawSha256);
  // The portable digest is exactly the digest of the untrailered module.
  const baseSha256 = crypto
    .createHash("sha256")
    .update(testWasm())
    .digest("hex");
  assert.equal(portable.sha256, baseSha256);
  assert.equal(portable.sizeBytes, testWasm().length);
});

test("parse round-trips the canonical bytes and refuses shape violations", async () => {
  const { wasmBytes } = await traileredArtifactBytes();
  const receipt = await receiptFor(deterministicReport(), wasmBytes);
  const canonical = canonicalReceiptBytes(receipt);

  const fromBytes = parseConformanceReceipt(canonical);
  const fromText = parseConformanceReceipt(new TextDecoder().decode(canonical));
  assert.deepEqual(fromBytes, fromText);
  assert.equal(fromBytes.version, RECEIPT_SCHEMA_VERSION);
  assert.equal(fromBytes.family, "propagator");
  assert.equal(parseConformanceReceipt(receipt).artifact.sha256, FIXTURE_ARTIFACT_SHA256);

  const refuse = (mutator, code) => {
    const doc = JSON.parse(RECEIPT_FIXTURE);
    mutator(doc);
    assert.throws(
      () => parseConformanceReceipt(JSON.stringify(doc)),
      (error) => error instanceof ConformanceReceiptError && error.code === code,
      `${code} must refuse`,
    );
  };
  refuse((doc) => delete doc[RECEIPT_DOCUMENT_KEY], "wrong_document");
  refuse((doc) => doc[RECEIPT_DOCUMENT_KEY].version++, "unsupported_version");
  refuse((doc) => {
    doc[RECEIPT_DOCUMENT_KEY].artifact.sha256 = "ab";
  }, "invalid_field");
  refuse((doc) => {
    doc[RECEIPT_DOCUMENT_KEY].verdict = "MAYBE";
  }, "invalid_field");
  refuse((doc) => {
    doc[RECEIPT_DOCUMENT_KEY].summary.passed = 17;
  }, "summary_mismatch");
  assert.throws(
    () => parseConformanceReceipt(new Uint8Array([1, 2, 3])),
    (error) => error instanceof ConformanceReceiptError && error.code === "invalid_json",
  );
});

test("fingerprint is stable and receipt-sensitive", async () => {
  const { wasmBytes } = await traileredArtifactBytes();
  const receipt = await receiptFor(deterministicReport(), wasmBytes);
  const reParsed = { [RECEIPT_DOCUMENT_KEY]: parseConformanceReceipt(receipt) };
  assert.equal(await receiptFingerprint(receipt), await receiptFingerprint(reParsed));
  const later = await receiptFor(deterministicReport(), wasmBytes, {
    generatedAt: "2026-08-22T00:00:00.000Z",
  });
  assert.notEqual(await receiptFingerprint(receipt), await receiptFingerprint(later));
});

test("receipt attaches as a bundle ATTESTATION entry (ordinal, media type, JSON_UTF8)", async () => {
  const { wasmBytes } = await traileredArtifactBytes();
  const receipt = await receiptFor(deterministicReport(), wasmBytes);
  const entry = encodeConformanceReceiptAttestation(receipt);
  assert.equal(entry.entryId, RECEIPT_ATTESTATION_ENTRY_ID);
  assert.equal(entry.role, "attestation");
  assert.equal(entry.mediaType, RECEIPT_ATTESTATION_MEDIA_TYPE);
  assert.equal(entry.payloadEncoding, "json-utf8");

  const bundled = await createSingleFileBundle({
    wasmBytes: testWasm(),
    manifestBytes: new Uint8Array([9, 10, 11]),
    entries: [entry],
  });
  const parsed = await parseSingleFileBundle(bundled.wasmBytes);
  const found = findConformanceReceiptAttestation(parsed.bundle);
  assert.ok(found, "receipt attestation entry is findable after bundling");
  assert.equal(moduleBundleRoleToName(found.role), "attestation");
  const decoded = decodeConformanceReceiptAttestation(found);
  assert.equal(decoded.family, "propagator");
  assert.equal(decoded.artifact.sha256, FIXTURE_ARTIFACT_SHA256);
  assert.equal(decoded.verdict, SIGNED);
});

test("client verify chain: signed bundle fully verifies the receipt (bundle scope)", async () => {
  const { wasmBytes } = await traileredArtifactBytes();
  const receipt = await receiptFor(deterministicReport(), wasmBytes);
  const entry = encodeConformanceReceiptAttestation(receipt);
  const bundled = await createSingleFileBundle({
    wasmBytes: testWasm(),
    manifestBytes: new Uint8Array([9, 10, 11]),
    entries: [entry],
  });
  const signed = await signModuleArtifact(bundled.wasmBytes, {
    privateKeySeedHex,
    keyId: "w4-receipt",
    signatureScope: "bundle",
  });
  assert.equal(signed.signature.signedHashAlgorithm, BUNDLE_SIGNATURE_HASH_ALGORITHM);

  // The crypto proof itself (statement over every non-signature entry):
  const verified = await verifyModuleArtifact(signed.wasmBytes, {
    trustedPublicKeys: [signed.signature.publicKeyHex],
    requireSignature: true,
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.signatureScope, "bundle");

  // The receipt-specific chain on top — the client-side extension:
  const chain = await verifyBundleConformanceReceipt(signed.wasmBytes, {
    artifactBytes: testWasm(),
  });
  assert.equal(chain.verified, true, "receipt chain verifies");
  assert.equal(chain.receipt.artifact.sha256, FIXTURE_ARTIFACT_SHA256);
  assert.equal(chain.signaturePresent, true);
  // The receipt binds the very artifact the bundle carries:
  assert.equal(
    chain.receipt.artifact.sha256,
    signed.canonicalModuleHashHex,
    "receipt artifact sha256 binds the bundle's canonical module hash",
  );
});

test("client verify chain: every refusal class is named and loud", async () => {
  const { wasmBytes } = await traileredArtifactBytes();
  const receipt = await receiptFor(deterministicReport(), wasmBytes);

  const buildBundled = async (entries, { sign = false } = {}) => {
    const bundled = await createSingleFileBundle({
      wasmBytes: testWasm(),
      manifestBytes: new Uint8Array([9, 10, 11]),
      entries,
    });
    if (!sign) {
      return bundled.wasmBytes;
    }
    const signed = await signModuleArtifact(bundled.wasmBytes, {
      privateKeySeedHex,
      signatureScope: "bundle",
    });
    return signed.wasmBytes;
  };

  // 1. no receipt present
  let bytes = await buildBundled([]);
  let outcome = await verifyBundleConformanceReceipt(bytes);
  assert.equal(outcome.reason, "missing_attestation");

  // 2. unsigned bundle fails CLOSED under requireSignature, reports otherwise
  bytes = await buildBundled([encodeConformanceReceiptAttestation(receipt)]);
  outcome = await verifyBundleConformanceReceipt(bytes, { requireSignature: true });
  assert.equal(outcome.reason, "missing_signature");
  outcome = await verifyBundleConformanceReceipt(bytes, {
    artifactBytes: testWasm(),
  });
  assert.equal(outcome.verified, true);
  assert.equal(outcome.signaturePresent, false);

  // 3. chain link 1: recorded digest that does not cover the payload
  bytes = await buildBundled([encodeConformanceReceiptAttestation(receipt)]);
  const parsed = await parseSingleFileBundle(bytes);
  const tamperedBundle = {
    ...parsed.bundle,
    entries: parsed.bundle.entries.map((candidate) =>
      candidate.entryId === RECEIPT_ATTESTATION_ENTRY_ID
        ? { ...candidate, sha256: new Uint8Array(32) }
        : candidate,
    ),
  };
  outcome = await verifyBundleConformanceReceipt(tamperedBundle);
  assert.equal(outcome.reason, "payload_hash_mismatch");

  // 4. chain link 4: receipt artifact binding refusal
  const signedBytes = await buildBundled([encodeConformanceReceiptAttestation(receipt)], {
    sign: true,
  });
  outcome = await verifyBundleConformanceReceipt(signedBytes, {
    artifactSha256Hex: "11".repeat(32),
  });
  assert.equal(outcome.reason, "receipt_artifact_mismatch");

  // 5. chain link 3: a FAIL verdict certifies nothing
  const failReport = { ...deterministicReport(), verdict: "FAIL" };
  const failReceipt = await receiptFor(failReport, wasmBytes);
  outcome = await verifyBundleConformanceReceipt(
    await buildBundled([encodeConformanceReceiptAttestation(failReceipt)], {
      sign: true,
    }),
    { artifactBytes: testWasm() },
  );
  assert.equal(outcome.reason, "failed_verdict");

  // 6. a garbled payload is a refusal, never an impression
  const garbled = await createSingleFileBundle({
    wasmBytes: testWasm(),
    manifestBytes: new Uint8Array([9, 10, 11]),
    entries: [
      {
        entryId: RECEIPT_ATTESTATION_ENTRY_ID,
        role: "attestation",
        sectionName: "sds.attestation",
        payloadEncoding: "json-utf8",
        mediaType: RECEIPT_ATTESTATION_MEDIA_TYPE,
        payload: new TextEncoder().encode("not a receipt"),
      },
    ],
  });
  outcome = await verifyBundleConformanceReceipt(garbled.wasmBytes);
  assert.equal(outcome.reason, "invalid_receipt");

  assert.throws(
    () => encodeConformanceReceiptAttestation({ not: "a receipt" }),
    (error) => error instanceof ConformanceReceiptError,
  );
});

test("parse refuses PASS-WITH-GAPS mismatch and format renders", async () => {
  const { wasmBytes } = await traileredArtifactBytes();
  const report = deterministicReport();
  report.verdict = "PASS-WITH-GAPS";
  report.checks[1] = {
    id: "leak-envelope",
    tier: 4,
    required: false,
    status: "gap",
    detail: "leak lane belongs to another command here",
  };
  const receipt = await receiptFor(report, wasmBytes);
  const doc = parseConformanceReceipt(receipt);
  assert.equal(doc.verdict, "PASS-WITH-GAPS");
  assert.equal(doc.summary.gaps, 1);
  const text = formatConformanceReceipt(receipt);
  assert.match(text, /conformance receipt v1 — PASS-WITH-GAPS/);
  assert.match(text, new RegExp(FIXTURE_ARTIFACT_SHA256.slice(0, 16)));
  assert.throws(
    () => formatConformanceReceipt({ junk: true }),
    (error) => error instanceof ConformanceReceiptError,
  );
});

test("a receipt can never be produced without a kit (family-without-kit guard)", async () => {
  const { wasmBytes } = await traileredArtifactBytes();
  const report = deterministicReport();
  await assert.rejects(
    () =>
      buildConformanceReceipt(report, {
        artifactBytes: wasmBytes,
        kit: { id: "", version: "" },
        generatedAt: "2026-08-21T00:00:00.000Z",
      }),
    (error) => error instanceof ConformanceReceiptError,
  );
  // ReceiptAttestationError refuses malformed input, disjoint from ConformanceReceiptError
  assert.throws(
    () => decodeConformanceReceiptAttestation(null),
    (error) => error instanceof ReceiptAttestationError && error.code === "missing_attestation",
  );
});
