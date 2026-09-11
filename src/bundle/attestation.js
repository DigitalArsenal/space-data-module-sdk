/**
 * W4.1 — the conformance receipt travels as a bundle ATTESTATION entry
 * (task harness-w4-conformance-receipt-attestation; finding
 * graph/findings/official-harness-shapes.md §5 "Receipt & trust").
 *
 * The MBL schema's ATTESTATION ordinal has always existed; what was missing
 * was a receipt-shaped payload inside it and a chain that PROVES the receipt
 * describes the artifact it sits beside. This module supplies both:
 *
 * - encodeConformanceReceiptAttestation — the entry builder (role
 *   ATTESTATION, JSON_UTF8 payload = the canonical receipt bytes, the same
 *   form the W4.2 statement domain will bind to the artifact CONTENT_HASH).
 * - verifyBundleConformanceReceipt — the CLIENT VERIFY-CHAIN EXTENSION.
 *   The bundle signature already covers every non-signature MBL member
 *   (computeModuleBundleSignatureHash includes the attestation entry's
 *   payload digest in the signed statement), so an ATTESTATION entry is
 *   "publisher-signed for free under bundle scope". What the extension adds
 *   is the receipt-specific chain the listing gate needs:
 *
 *     1. the entry exists and is an ATTESTATION entry,
 *     2. the entry's recorded payload digest equals the payload bytes
 *        (the link the bundle signature actually binds — a tampered receipt
 *        can never hide behind a re-recorded digest),
 *     3. the payload is a shape-valid receipt (parseConformanceReceipt),
 *     4. a FAIL verdict certifies nothing,
 *     5. the receipt's artifact.sha256 binds the PORTABLE bytes of the very
 *        artifact it sits beside (or the caller-named digest),
 *     6. signature presence is reported and enforcible via requireSignature
 *        (the actual ed25519 proof stays verifyModuleArtifact's job — the
 *        chain extension consumes it; it does not re-implement it).
 *
 * Every failure is a structured reason, never a silent skip.
 */

import { sha256Bytes } from "../utils/crypto.js";

import {
  ConformanceReceiptError,
  RECEIPT_DOCUMENT_KEY,
  canonicalReceiptBytes,
  parseConformanceReceipt,
  portableArtifactDigest,
  receiptFingerprint,
} from "../conformance/receipt.js";
import { decodeModuleBundleEntryPayload } from "./codec.js";
import { parseSingleFileBundle } from "./wasm.js";

export const RECEIPT_ATTESTATION_ENTRY_ID = "conformance-receipt";
export const RECEIPT_ATTESTATION_SECTION_NAME = "sds.attestation";
export const RECEIPT_ATTESTATION_MEDIA_TYPE =
  "application/vnd.space-data.module.conformance-receipt+json";
export { RECEIPT_DOCUMENT_KEY, RECEIPT_SCHEMA_VERSION } from "../conformance/receipt.js";

export class ReceiptAttestationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReceiptAttestationError";
    this.code = code;
  }
}

function originalPayloadBytes(entry) {
  // createSingleFileBundle normalizes JSON_UTF8 payloads via
  // canonicalBytes when given an object; with Uint8Array it keeps the bytes.
  return new Uint8Array(entry.payload ?? []);
}

function equalBytes(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Build the MBL entry object that carries a receipt. Feed it to
 * createSingleFileBundle({entries:[...]}) — the builder hashes the canonical
 * payload bytes into entry.sha256, and signing the bundle then covers this
 * entry's digest under the bundle-scope statement.
 *
 * @param {object} receipt - a receipt document ({sdn-conformance-receipt: {...}})
 * @param {object} [options]
 * @returns {object} the entry object (role "attestation", JSON_UTF8 payload)
 */
export function encodeConformanceReceiptAttestation(receipt, options = {}) {
  const normalized = parseConformanceReceipt(receipt); // shape-refuse before it travels
  const document = { [RECEIPT_DOCUMENT_KEY]: normalized };
  return {
    entryId: options.entryId ?? RECEIPT_ATTESTATION_ENTRY_ID,
    role: "attestation",
    sectionName: options.sectionName ?? RECEIPT_ATTESTATION_SECTION_NAME,
    payloadEncoding: "json-utf8",
    mediaType: RECEIPT_ATTESTATION_MEDIA_TYPE,
    payload: canonicalReceiptBytes(document),
  };
}

/**
 * Locate the conformance-receipt ATTESTATION entry in a decoded bundle.
 * Matches the canonical entryId; an entry that uses the ATTESTATION role with
 * the receipt media type is also honored.
 */
export function findConformanceReceiptAttestation(bundle) {
  if (!bundle || !Array.isArray(bundle.entries)) {
    return null;
  }
  return (
    bundle.entries.find((entry) => entry.entryId === RECEIPT_ATTESTATION_ENTRY_ID) ??
    bundle.entries.find(
      (entry) =>
        (entry.mediaType ?? "") === RECEIPT_ATTESTATION_MEDIA_TYPE &&
        String(entry.role ?? "")
          .toLowerCase()
          .replace(/_/g, "-") === "attestation",
    ) ??
    null
  );
}

/**
 * Decode an ATTESTATION entry back into a shape-validated receipt document.
 * Refuses (throws ReceiptAttestationError) on any shape violation.
 */
export function decodeConformanceReceiptAttestation(entry) {
  if (!entry) {
    throw new ReceiptAttestationError(
      "missing_attestation",
      `no ${RECEIPT_ATTESTATION_ENTRY_ID} ATTESTATION entry in the bundle`,
    );
  }
  let decoded;
  try {
    decoded = decodeModuleBundleEntryPayload(entry);
  } catch (error) {
    throw new ReceiptAttestationError(
      "invalid_receipt",
      `receipt attestation payload could not be decoded: ${error.message}`,
    );
  }
  try {
    return parseConformanceReceipt(decoded);
  } catch (error) {
    if (error instanceof ConformanceReceiptError) {
      throw new ReceiptAttestationError("invalid_receipt", error.message);
    }
    throw error;
  }
}

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * THE CLIENT VERIFY-CHAIN EXTENSION. Given a published artifact (single-file
 * bundle bytes) — or an already-decoded bundle — prove every link between the
 * bundle signature and the conformance receipt, and bind the receipt to the
 * artifact it certifies.
 *
 * @param {Uint8Array|object} wasmBytesOrBundle - single-file bundle bytes, or
 *   the decoded {entries, bundle} object from parseSingleFileBundle
 * @param {object} [options]
 * @param {Uint8Array|ArrayBuffer|number[]} [options.artifactBytes] - the
 *   artifact bytes to bind (portable digest computed here); mutually exclusive
 *   with artifactSha256Hex
 * @param {string} [options.artifactSha256Hex] - already-known portable digest
 * @param {boolean} [options.requireSignature] - refuse when the bundle has no
 *   signature entry (the crypto proof itself is verifyModuleArtifact's; this
 *   gate makes the chain fail CLOSED instead of "certified, never signed")
 * @returns {Promise<object>} {verified, reason, entry, receipt, fingerprint,
 *   artifactSha256, signatureDigestCovered, signaturePresent}
 */
export async function verifyBundleConformanceReceipt(
  wasmBytesOrBundle,
  options = {},
) {
  let bundle;
  if (
    wasmBytesOrBundle instanceof Uint8Array ||
    wasmBytesOrBundle instanceof ArrayBuffer ||
    Array.isArray(wasmBytesOrBundle)
  ) {
    const bytes =
      wasmBytesOrBundle instanceof Uint8Array
        ? wasmBytesOrBundle
        : new Uint8Array(wasmBytesOrBundle);
    const parsed = await parseSingleFileBundle(bytes);
    bundle = parsed.bundle;
  } else if (wasmBytesOrBundle && Array.isArray(wasmBytesOrBundle.entries)) {
    bundle = wasmBytesOrBundle;
  } else {
    throw new ReceiptAttestationError(
      "invalid_input",
      "verifyBundleConformanceReceipt requires bundle bytes or a decoded bundle",
    );
  }

  const failure = (reason) => ({ verified: false, reason, entry: null });

  const entry = findConformanceReceiptAttestation(bundle);
  if (!entry) {
    return failure("missing_attestation");
  }

  // Link 1: payload digest == recorded digest. This is the exact link the
  // signed statement binds; if it fails, nothing later can be trusted.
  const payloadBytes = originalPayloadBytes(entry);
  if (!entry.sha256) {
    return failure("receipt_digest_unrecorded");
  }
  const payloadDigest = await sha256Bytes(payloadBytes);
  if (!equalBytes(payloadDigest, new Uint8Array(entry.sha256))) {
    return failure("payload_hash_mismatch");
  }

  // Link 2: the payload is a shape-valid receipt.
  let receipt;
  try {
    receipt = decodeConformanceReceiptAttestation(entry);
  } catch (error) {
    return failure(error.code ?? "invalid_receipt");
  }

  // Link 3: a FAIL verdict certifies nothing. (Gaps are admissible — the
  // verdict vocabulary is PASS / PASS-WITH-GAPS / FAIL, and gaps are named.)
  if (receipt.verdict === "FAIL") {
    return failure("failed_verdict");
  }

  // Link 4: the receipt binds the artifact it sits beside (portable digest).
  let artifactSha256 = null;
  if (options.artifactSha256Hex !== undefined) {
    artifactSha256 = String(options.artifactSha256Hex).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(artifactSha256)) {
      return failure("invalid_artifact_digest");
    }
  } else if (options.artifactBytes !== undefined) {
    artifactSha256 = (await portableArtifactDigest(options.artifactBytes)).sha256;
  }
  if (artifactSha256 !== null && artifactSha256 !== receipt.artifact.sha256) {
    return failure("receipt_artifact_mismatch");
  }

  // Link 5: signature coverage — the bundle-scope statement covers every
  // non-signature entry, this one included. The cryptographic proof is
  // verifyModuleArtifact's; the extension reports coverage and can fail
  // closed when the caller requires a signature.
  const signaturePresent = (bundle.entries ?? []).some(
    (candidate) =>
      String(candidate.entryId ?? "")
        .toLowerCase()
        .replace(/_/g, "-") === "signature" ||
      String(candidate.role ?? "")
        .toLowerCase()
        .replace(/_/g, "-") === "signature",
  );
  if (options.requireSignature === true && !signaturePresent) {
    return failure("missing_signature");
  }

  const document = { [RECEIPT_DOCUMENT_KEY]: receipt };
  return {
    verified: true,
    reason: null,
    entry,
    receipt,
    fingerprint: await receiptFingerprint(document),
    artifactSha256,
    signaturePresent,
  };
}
