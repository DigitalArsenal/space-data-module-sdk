/**
 * The W4.1 conformance RECEIPT — the settled document format that a
 * publisher attaches to a module so an ANONYMOUS client with no human in the
 * loop can see, in one signed place, what the module was actually certified
 * against (finding graph/findings/official-harness-shapes.md §5 "Receipt &
 * trust"; task harness-w4-conformance-receipt-attestation).
 *
 * Why a separate document and not just the report:
 *
 * 1. The receipt binds the PORTABLE payload — sha256 over the bytes a client
 *    actually compiles, i.e. the REC publication trailer STRIPPED (the same
 *    "strip-then-hash" semantic the node's pmm.HashArtifact uses). The raw
 *    runConformance report hashes the file as read; certifying trailered
 *    bytes would make the receipt disagree with every manifest CONTENT_HASH
 *    in the fleet.
 * 2. The receipt is SHAPED: parseConformanceReceipt refuses a document that
 *    lacks the envelope key, carries an unsupported version, or whose
 *    checks[] and summary[] disagree. Garbage on the wire is a refusal, not
 *    an impression — the "silent fallback must be structurally unreachable"
 *    rule applies to trust metadata too.
 * 3. The receipt is CANONICAL: canonicalReceiptBytes is the deterministic
 *    byte form (sorted keys, compact separators) that travels inside the
 *    bundle ATTESTATION entry and that receiptFingerprint digests. W4.2
 *    (harness-w4-receipt-statement-domain) binds third-party attestors to the
 *    artifact CONTENT_HASH through a statement domain; this canonical form is
 *    what that binding will cover, so it is pinned by tests on both the SDK
 *    and the sdn side (internal/pmmreceipt parses the SAME fixture).
 *
 * The format is settled HERE (W4.1), ratified as a statement domain in W4.2.
 * The envelope key is deliberately the future domain name spelled out
 * ("sdn-conformance-receipt"), so the receipt document and the statement that
 * will later authenticate it never disagree about what they name.
 */

import { sha256Bytes } from "../utils/wasmCrypto.js";
import { bytesToHex } from "../utils/encoding.js";

import { stripPublicationRecordCollection } from "../transport/records.js";

/** The single envelope key of a receipt document (future domain name). */
export const RECEIPT_DOCUMENT_KEY = "sdn-conformance-receipt";

/** Version of the settled receipt schema. parse refuses any other version. */
export const RECEIPT_SCHEMA_VERSION = 1;

/** Verdicts a receipt may record. FAIL can be RECORDED but never certifies. */
export const RECEIPT_VERDICTS = Object.freeze([
  "PASS",
  "PASS-WITH-GAPS",
  "FAIL",
]);

export const RECEIPT_CHECK_STATUSES = Object.freeze(["pass", "gap", "fail"]);

export const RECEIPT_DEFAULT_TOOL_NAME = "space-data-module-sdk";

export class ConformanceReceiptError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConformanceReceiptError";
    this.code = code;
  }
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return new Uint8Array(value);
  }
  if (value && typeof value === "object" && Number.isInteger(value.byteLength)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new ConformanceReceiptError(
    "invalid_input",
    "expected artifact bytes (Uint8Array, ArrayBuffer, or byte array)",
  );
}

/**
 * sha256 hex of the PORTABLE (REC-trailer-stripped) payload bytes.
 * WASM crypto (same helper the rest of the bundle surface uses — this module
 * must build for browsers, so no node:crypto here).
 */
export async function portableArtifactDigest(artifactBytes) {
  const bytes = toUint8Array(artifactBytes);
  const portable = stripPublicationRecordCollection(bytes);
  const sha256 = bytesToHex(await sha256Bytes(portable));
  return { sha256, sizeBytes: portable.length };
}

/** Deterministic form: keys sorted recursively, compact separators, then UTF-8. */
export function canonicalReceiptBytes(receipt) {
  function sortKeys(value) {
    if (Array.isArray(value)) {
      return value.map(sortKeys);
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, sortKeys(value[key])]),
      );
    }
    return value;
  }
  return new TextEncoder().encode(JSON.stringify(sortKeys(receipt)));
}

/** sha256 of the canonical byte form — the receipt's own digest. */
export async function receiptFingerprint(receipt) {
  return bytesToHex(await sha256Bytes(canonicalReceiptBytes(receipt)));
}

function normalizeStringField(value, field, { allowEmpty = true, maxLength = 4096 } = {}) {
  if (typeof value !== "string") {
    throw new ConformanceReceiptError(
      "invalid_field",
      `receipt ${field} must be a string`,
    );
  }
  if (!allowEmpty && value.trim() === "") {
    throw new ConformanceReceiptError(
      "invalid_field",
      `receipt ${field} must not be empty`,
    );
  }
  if (value.length > maxLength) {
    throw new ConformanceReceiptError(
      "invalid_field",
      `receipt ${field} exceeds ${maxLength} characters`,
    );
  }
  return value;
}

function normalizeHexSha256(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new ConformanceReceiptError(
      "invalid_field",
      "receipt artifact.sha256 must be 64 lowercase hex characters",
    );
  }
  return normalized;
}

function normalizeIntegerField(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new ConformanceReceiptError(
      "invalid_field",
      `receipt ${field} must be a non-negative integer`,
    );
  }
  return normalized;
}

function normalizeChecks(checks) {
  if (!Array.isArray(checks)) {
    throw new ConformanceReceiptError(
      "invalid_field",
      "receipt checks must be an array",
    );
  }
  return checks.map((check, index) => {
    if (check === null || typeof check !== "object") {
      throw new ConformanceReceiptError(
        "invalid_field",
        `receipt checks[${index}] must be an object`,
      );
    }
    const status = String(check.status ?? "").trim().toLowerCase();
    if (!RECEIPT_CHECK_STATUSES.includes(status)) {
      throw new ConformanceReceiptError(
        "invalid_field",
        `receipt checks[${index}] has invalid status ${JSON.stringify(check.status)}`,
      );
    }
    return {
      id: normalizeStringField(check.id, `checks[${index}].id`),
      tier: normalizeIntegerField(check.tier ?? 0, `checks[${index}].tier`),
      required: check.required === true,
      status,
      detail: normalizeStringField(check.detail ?? "", `checks[${index}].detail`),
    };
  });
}

/**
 * Parse and shape-validate a receipt document. Accepts the canonical JSON
 * bytes, a JSON string, a plain string of JSON, or the parsed object.
 * Returns a normalized document (the envelope object's inner value).
 *
 * A document that fails ANY shape rule is refused — an invalid or inscrutable
 * receipt must never travel as if it certified anything.
 */
export function parseConformanceReceipt(data) {
  let parsed = data;
  if (typeof data === "string" || data instanceof Uint8Array || Array.isArray(data)) {
    try {
      const text =
        typeof data === "string"
          ? data
          : new TextDecoder().decode(toUint8Array(data));
      parsed = JSON.parse(text);
    } catch {
      throw new ConformanceReceiptError(
        "invalid_json",
        "receipt payload is not valid JSON",
      );
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConformanceReceiptError(
      "invalid_json",
      "receipt payload must be a JSON object",
    );
  }
  if (!Object.hasOwn(parsed, RECEIPT_DOCUMENT_KEY)) {
    throw new ConformanceReceiptError(
      "wrong_document",
      `receipt payload must carry the "${RECEIPT_DOCUMENT_KEY}" envelope key`,
    );
  }
  const doc = parsed[RECEIPT_DOCUMENT_KEY];
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new ConformanceReceiptError(
      "invalid_field",
      `"${RECEIPT_DOCUMENT_KEY}" must be a JSON object`,
    );
  }
  const version = Number(doc.version);
  if (!Number.isSafeInteger(version) || version !== RECEIPT_SCHEMA_VERSION) {
    throw new ConformanceReceiptError(
      "unsupported_version",
      `unsupported receipt version ${JSON.stringify(doc.version)} (need ${RECEIPT_SCHEMA_VERSION})`,
    );
  }
  const family = normalizeStringField(doc.family, "family", { allowEmpty: false });
  const artifact = doc.artifact;
  if (artifact === null || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new ConformanceReceiptError(
      "invalid_field",
      "receipt artifact must be an object",
    );
  }
  const sha256 = normalizeHexSha256(artifact.sha256);
  const sizeBytes = normalizeIntegerField(artifact.size_bytes, "artifact.size_bytes");
  const kit = doc.kit;
  if (kit === null || typeof kit !== "object" || Array.isArray(kit)) {
    throw new ConformanceReceiptError(
      "invalid_field",
      "receipt kit must be an object (a receipt exists only for a family with a kit)",
    );
  }
  const kitId = normalizeStringField(kit.id, "kit.id", { allowEmpty: false });
  const kitVersion = normalizeStringField(kit.version ?? "", "kit.version");
  const tool = doc.tool;
  if (tool === null || typeof tool !== "object" || Array.isArray(tool)) {
    throw new ConformanceReceiptError(
      "invalid_field",
      "receipt tool must be an object",
    );
  }
  const toolName = normalizeStringField(tool.name, "tool.name", { allowEmpty: false });
  const toolVersion = normalizeStringField(tool.version ?? "", "tool.version");
  const verdict = String(doc.verdict ?? "").trim();
  if (!RECEIPT_VERDICTS.includes(verdict)) {
    throw new ConformanceReceiptError(
      "invalid_field",
      `receipt verdict ${JSON.stringify(doc.verdict)} is not one of ${RECEIPT_VERDICTS.join(", ")}`,
    );
  }
  const checks = normalizeChecks(doc.checks);
  const summary = doc.summary;
  if (summary === null || typeof summary !== "object" || Array.isArray(summary)) {
    throw new ConformanceReceiptError(
      "invalid_field",
      "receipt summary must be an object",
    );
  }
  const expected = { passed: 0, gaps: 0, failed: 0 };
  const expectedKey = { pass: "passed", gap: "gaps", fail: "failed" };
  for (const check of checks) {
    expected[expectedKey[check.status]] += 1;
  }
  const passed = normalizeIntegerField(summary.passed ?? 0, "summary.passed");
  const gaps = normalizeIntegerField(summary.gaps ?? 0, "summary.gaps");
  const failed = normalizeIntegerField(summary.failed ?? 0, "summary.failed");
  if (passed !== expected.passed || gaps !== expected.gaps || failed !== expected.failed) {
    throw new ConformanceReceiptError(
      "summary_mismatch",
      `receipt summary (${passed}/${gaps}/${failed}) disagrees with checks[] ` +
        `(${expected.passed}/${expected.gaps}/${expected.failed})`,
    );
  }
  let corpus = null;
  if (doc.corpus !== undefined && doc.corpus !== null) {
    if (typeof doc.corpus !== "object" || Array.isArray(doc.corpus)) {
      throw new ConformanceReceiptError(
        "invalid_field",
        "receipt corpus must be an object or null",
      );
    }
    corpus = {
      path: normalizeStringField(doc.corpus.path ?? "", "corpus.path"),
      schema_version: normalizeStringField(
        doc.corpus.schema_version ?? "",
        "corpus.schema_version",
      ),
      cases: normalizeIntegerField(doc.corpus.cases ?? 0, "corpus.cases"),
      model: normalizeStringField(doc.corpus.model ?? "", "corpus.model"),
    };
    if (doc.corpus.cases === undefined && corpus.cases === 0 && corpus.path === "") {
      corpus = null;
    }
  }
  return {
    version,
    family,
    artifact: { sha256, size_bytes: sizeBytes },
    corpus,
    kit: { id: kitId, version: kitVersion },
    tool: { name: toolName, version: toolVersion },
    generated_at: normalizeStringField(doc.generated_at ?? "", "generated_at"),
    verdict,
    checks,
    summary: { passed, gaps, failed },
  };
}

function summarizeChecks(checks) {
  const summary = { passed: 0, gaps: 0, failed: 0 };
  for (const check of checks) {
    if (check.status === "pass") summary.passed += 1;
    else if (check.status === "gap") summary.gaps += 1;
    else summary.failed += 1;
  }
  return summary;
}

/**
 * Build the settled receipt document from a runConformance report.
 *
 * @param {object} report - the report returned by runConformance
 * @param {object} options
 * @param {Uint8Array|ArrayBuffer|number[]} options.artifactBytes - the tested
 *   artifact FILE bytes; the receipt digests the PORTABLE payload (REC trailer
 *   stripped), never the trailered file, so the receipt and the node's
 *   manifest CONTENT_HASH always describe the same bytes.
 * @param {object} options.kit - {id, version} of the conformance kit used;
 *   id defaults to the family, version required-in-practice
 * @param {object} [options.tool] - {name, version} of the runner; defaults to
 *   name=space-data-module-sdk
 * @param {string} [options.generatedAt] - ISO timestamp; defaults to now
 */
export async function buildConformanceReceipt(report, options) {
  if (report === null || typeof report !== "object") {
    throw new ConformanceReceiptError(
      "invalid_input",
      "buildConformanceReceipt requires a runConformance report",
    );
  }
  const family = String(report.family ?? "").trim().toLowerCase();
  if (family === "") {
    throw new ConformanceReceiptError(
      "invalid_input",
      "buildConformanceReceipt requires report.family",
    );
  }
  if (!RECEIPT_VERDICTS.includes(report.verdict)) {
    throw new ConformanceReceiptError(
      "invalid_input",
      `report verdict ${JSON.stringify(report.verdict)} is not one of ${RECEIPT_VERDICTS.join(", ")}`,
    );
  }
  if (!Array.isArray(report.checks)) {
    throw new ConformanceReceiptError(
      "invalid_input",
      "buildConformanceReceipt requires report.checks",
    );
  }
  if (options?.artifactBytes === undefined) {
    throw new ConformanceReceiptError(
      "invalid_input",
      "buildConformanceReceipt requires options.artifactBytes " +
        "(the digest must bind the PORTABLE payload, which the report alone cannot know)",
    );
  }
  const digest = await portableArtifactDigest(options.artifactBytes);
  const kitId = String(options?.kit?.id ?? family).trim();
  if (kitId === "") {
    throw new ConformanceReceiptError(
      "invalid_input",
      "buildConformanceReceipt requires options.kit.id (a receipt exists only for a family with a kit)",
    );
  }
  const toolName = String(options?.tool?.name ?? RECEIPT_DEFAULT_TOOL_NAME).trim();
  const toolVersion = String(options?.tool?.version ?? "unknown").trim();
  const generatedAt =
    options?.generatedAt && String(options.generatedAt).trim() !== ""
      ? String(options.generatedAt).trim()
      : new Date().toISOString();

  const checks = report.checks.map((check) => ({
    id: String(check.id ?? ""),
    tier: Number.isSafeInteger(check.tier) ? check.tier : 0,
    required: check.required === true,
    status: String(check.status ?? "").toLowerCase(),
    detail: String(check.detail ?? ""),
  }));

  const doc = {
    version: RECEIPT_SCHEMA_VERSION,
    family,
    artifact: { sha256: digest.sha256, size_bytes: digest.sizeBytes },
    corpus:
      report.corpus === null || report.corpus === undefined
        ? null
        : {
            path: String(report.corpus.path ?? ""),
            schema_version:
              report.corpus.schemaVersion === null ||
              report.corpus.schemaVersion === undefined
                ? ""
                : String(report.corpus.schemaVersion),
            cases: Number(report.corpus.cases ?? 0),
            model: report.corpus.model === null || report.corpus.model === undefined
              ? ""
              : String(report.corpus.model),
          },
    kit: { id: kitId, version: String(options?.kit?.version ?? "").trim() },
    tool: { name: toolName, version: toolVersion },
    generated_at: generatedAt,
    verdict: report.verdict,
    checks,
    summary: summarizeChecks(checks),
  };
  return { [RECEIPT_DOCUMENT_KEY]: doc };
}

/** Human-readable rendering for CLIs and logs. */
export function formatConformanceReceipt(receipt) {
  const doc = parseConformanceReceipt(receipt);
  const lines = [];
  lines.push(
    `conformance receipt v${doc.version} — ${doc.verdict} (family ${doc.family})`,
  );
  lines.push(`  artifact sha256 ${doc.artifact.sha256} (${doc.artifact.size_bytes} B)`);
  lines.push(
    `  kit         ${doc.kit.id}@${doc.kit.version || "?"} via ${doc.tool.name}@${doc.tool.version}`,
  );
  if (doc.corpus) {
    lines.push(
      `  corpus      ${doc.corpus.path || "(unnamed)"} (${doc.corpus.cases} cases` +
        `${doc.corpus.model ? `, model: ${doc.corpus.model}` : ""})`,
    );
  } else {
    lines.push("  corpus      none supplied");
  }
  lines.push(
    `  checks      ${doc.summary.passed} pass / ${doc.summary.gaps} gap / ${doc.summary.failed} fail`,
  );
  return lines.join("\n");
}
