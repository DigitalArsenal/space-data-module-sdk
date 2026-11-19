import {
  computeCanonicalModuleHash,
  createSingleFileBundle,
  getWasmCustomSections,
  parseSingleFileBundle,
} from "./wasm.js";
import { SDS_MANIFEST_SECTION_NAME } from "./constants.js";
import {
  extractPublicationRecordCollection,
} from "../transport/records.js";
import {
  ed25519PublicKey,
  ed25519Sign,
  ed25519Verify,
} from "../utils/wasmCrypto.js";
import { sha256Bytes } from "../utils/crypto.js";
import {
  DOMAIN_MODULE_PUBLICATION_V1,
  statement as buildSignatureStatement,
  trimGoWhitespace,
} from "./sigdomain.js";
import { ModuleBundleEntryRole } from "spacedatastandards.org/lib/js/MBL/main.js";

export const MODULE_SIGNATURE_ALGORITHM = "ed25519";
export const MODULE_SIGNATURE_ENTRY_ROLE = "signature";
// The `signedHashAlgorithm` of the publication form: REQUIRED and fixed, the
// exact string the node's publication signer writes next to its
// statementDomain (sdn-server/internal/modulesign). The wire string is the
// node's and does not change; the statementDomain, not this label, says what
// the signature covers.
//
// A signature entry with NO statementDomain is one of the two forms removed in
// 0.11.0 and is refused by name: `legacy_module_signature` (the bare module
// digest, labelled with this string or with none) or `legacy_bundle_signature`
// (the whole-bundle digest, BUNDLE_SIGNATURE_HASH_ALGORITHM).
export const PUBLICATION_SIGNED_HASH_ALGORITHM =
  "sha256-canonical-module-hash";
export const BUNDLE_SIGNATURE_HASH_ALGORITHM =
  "sha256-sdn-module-bundle-v1";

/**
 * The one signature form, `signatureScope: "publication"`: Ed25519 over
 * `"SDN-MODULE-PUBLICATION-V1" || 0x00 || sha256(portable)`, the entry the
 * node's signing endpoint writes, field for field. "module" (the bare canonical
 * module digest) and "bundle" (the whole-bundle digest) were removed in 0.11.0
 * and are refused by name.
 */
export const MODULE_SIGNATURE_SCOPES = Object.freeze(["publication"]);
export const DEFAULT_MODULE_SIGNATURE_SCOPE = "publication";
const REMOVED_SIGNATURE_SCOPES = Object.freeze({
  module: "a signature over the bare canonical module digest, no statement domain",
  bundle: "a signature over the whole-bundle digest, no statement domain",
});

export class ModuleSignatureError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ModuleSignatureError";
    this.code = code;
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const normalized = String(hex ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new ModuleSignatureError(
      "invalid_hex",
      "signature material must be even-length hex",
    );
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function normalizeTrustedPublicKeys(trustedPublicKeys) {
  const list = Array.isArray(trustedPublicKeys)
    ? trustedPublicKeys
    : typeof trustedPublicKeys === "string"
      ? trustedPublicKeys.split(",")
      : [];
  return list
    .map((key) => String(key ?? "").trim().toLowerCase())
    .filter((key) => key.length === 64);
}

function findSignatureEntry(bundle) {
  for (const entry of bundle?.entries ?? []) {
    const role =
      typeof entry.role === "string" ? entry.role.toLowerCase() : entry.role;
    if (
      role === MODULE_SIGNATURE_ENTRY_ROLE ||
      role === ModuleBundleEntryRole.SIGNATURE ||
      entry.entryId === "signature" ||
      entry.sectionName === "sds.signature"
    ) {
      return entry;
    }
  }
  return null;
}

// The exact key spellings the SDK writer emits. Go's encoding/json matches
// field names CASE-INSENSITIVELY and JavaScript's property access does not, so
// a trailer spelling "StatementDomain" populates the node's struct and is
// invisible here — the node would take the domain path and verify while this
// verifier fell to the legacy path and refused. Same artifact, opposite
// verdicts. Both sides therefore refuse a case variant of a known key outright.
// Keys that are not a variant of anything known stay tolerated on both sides:
// this closes a divergence, it is not a new schema.
const SIGNATURE_PAYLOAD_KEYS = Object.freeze([
  "algorithm",
  "keyId",
  "publicKeyHex",
  "signatureHex",
  "signedHashHex",
  "signedHashAlgorithm",
  "statementDomain",
]);

function decodeSignaturePayload(entry) {
  let parsed;
  try {
    const payload = entry.payload ?? [];
    const text = new TextDecoder().decode(new Uint8Array(payload));
    parsed = JSON.parse(text);
  } catch {
    throw new ModuleSignatureError(
      "invalid_signature_payload",
      "module signature entry payload is not valid JSON",
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ModuleSignatureError(
      "invalid_signature_payload",
      "module signature entry payload is not a JSON object",
    );
  }
  for (const key of Object.keys(parsed)) {
    if (SIGNATURE_PAYLOAD_KEYS.includes(key)) continue;
    const variant = SIGNATURE_PAYLOAD_KEYS.find(
      (known) => known.toLowerCase() === key.toLowerCase(),
    );
    if (variant) {
      throw new ModuleSignatureError(
        "invalid_signature_payload",
        `module signature entry payload spells "${key}"; the wire form is the module SDK's camelCase JSON and the correct spelling is "${variant}"`,
      );
    }
  }
  return parsed;
}

function equalBytes(left, right) {
  const a = new Uint8Array(left ?? []);
  const b = new Uint8Array(right ?? []);
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/**
 * The canonical module hash, or null if this artifact's wasm cannot be walked.
 * Used ONLY to populate a reporting field on the node-signed path, where the
 * node itself never parses the wasm: a module whose sections this SDK cannot
 * walk must not become an artifact the node admits and the SDK refuses.
 */
async function bestEffortCanonicalModuleHashHex(payloadBytes) {
  try {
    return (await computeCanonicalModuleHash(payloadBytes)).hashHex;
  } catch {
    return null;
  }
}

function resolveSignatureScope(signatureScope) {
  if (signatureScope === undefined) {
    return DEFAULT_MODULE_SIGNATURE_SCOPE;
  }
  if (Object.hasOwn(REMOVED_SIGNATURE_SCOPES, signatureScope)) {
    throw new ModuleSignatureError(
      "legacy_signature_scope",
      `signatureScope ${JSON.stringify(signatureScope)} (${REMOVED_SIGNATURE_SCOPES[signatureScope]}) was removed in space-data-module-sdk 0.11.0; the one form is signatureScope "publication"`,
    );
  }
  if (!MODULE_SIGNATURE_SCOPES.includes(signatureScope)) {
    throw new ModuleSignatureError(
      "invalid_signature_scope",
      `signatureScope must be one of ${MODULE_SIGNATURE_SCOPES.map((scope) => JSON.stringify(scope)).join(", ")}`,
    );
  }
  return signatureScope;
}

/**
 * Sign a module artifact with an Ed25519 key and embed the detached signature
 * in the artifact's MBL bundle (sds.signature entry).
 *
 * One form, `signatureScope: "publication"` (the default and the only value):
 * the entry the node's signing endpoint writes
 * (`sdn-server/internal/modulesign`), field for field and in its key order, so
 * the same key over the same portable bytes yields the same entry bytes. The
 * signature covers the bytes before the trailer; the trailer's entries (the
 * manifest copy included) are not covered.
 *
 * Existing bundle entries, the manifest, and any ENC/PNM publication records
 * in the REC trailer are preserved. Any previous signature entry is replaced,
 * whatever its form: a previous signature is never verified or kept here.
 *
 * @param {Uint8Array|ArrayBuffer} bytes - module artifact (raw wasm or single-file bundle)
 * @param {Object} options
 * @param {string} options.privateKeySeedHex - 32-byte Ed25519 seed, hex
 * @param {string} [options.keyId] - identifier recorded alongside the signature
 * @param {"publication"} [options.signatureScope]
 * @returns {Promise<{wasmBytes: Uint8Array, signature: Object, canonicalModuleHashHex: string, signedHashHex: string, signatureScope: string}>}
 */
export async function signModuleArtifact(bytes, options = {}) {
  const signatureScope = resolveSignatureScope(options.signatureScope);
  const seed = hexToBytes(options.privateKeySeedHex);
  if (seed.length !== 32) {
    throw new ModuleSignatureError(
      "invalid_seed",
      "privateKeySeedHex must be a 32-byte hex Ed25519 seed",
    );
  }
  const protectedArtifact = extractPublicationRecordCollection(bytes);
  const payloadBytes = protectedArtifact?.payloadBytes ?? bytes;

  let manifestBytes;
  let preservedEntries = [];
  if (protectedArtifact?.mbl) {
    const parsed = await parseSingleFileBundle(bytes);
    preservedEntries = (parsed.bundle.entries ?? [])
      .filter((entry) => {
        if (findSignatureEntry({ entries: [entry] })) {
          return false;
        }
        if (
          entry.entryId === "manifest" ||
          entry.role === ModuleBundleEntryRole.MANIFEST
        ) {
          manifestBytes = new Uint8Array(entry.payload ?? []);
          return false;
        }
        return true;
      })
      .map((entry) => ({
        ...entry,
        payload: new Uint8Array(entry.payload ?? []),
      }));
  }
  if (!manifestBytes) {
    manifestBytes = getWasmCustomSections(
      payloadBytes,
      SDS_MANIFEST_SECTION_NAME,
    )[0];
  }

  // The bundle as it will be written, without its signature: the preimage is
  // the bytes before the trailer, which the signature entry does not change.
  const unsigned = await createSingleFileBundle({
    wasmBytes: bytes,
    ...(manifestBytes ? { manifestBytes } : {}),
    entries: preservedEntries,
  });
  const unsignedPortable = extractPublicationRecordCollection(
    unsigned.wasmBytes,
  )?.payloadBytes;
  if (!unsignedPortable) {
    throw new ModuleSignatureError(
      "invalid_bundle",
      "the unsigned bundle has no publication trailer",
    );
  }

  const publicKey = await ed25519PublicKey(seed);
  const publicKeyHex = bytesToHex(new Uint8Array(publicKey));
  const contentHashBytes = await sha256Bytes(new Uint8Array(unsignedPortable));
  const signedHashHex = bytesToHex(contentHashBytes);
  const signatureBytes = await ed25519Sign(
    buildSignatureStatement(DOMAIN_MODULE_PUBLICATION_V1, contentHashBytes),
    seed,
  );
  // The node's SignatureEntry, in its JSON key order
  // (sdn-server/internal/modulesign/modulesign.go, Sign): the same key over
  // the same portable bytes gives the same entry bytes as the node's.
  const signature = {
    algorithm: MODULE_SIGNATURE_ALGORITHM,
    keyId: options.keyId ?? null,
    publicKeyHex,
    signatureHex: bytesToHex(new Uint8Array(signatureBytes)),
    signedHashAlgorithm: PUBLICATION_SIGNED_HASH_ALGORITHM,
    signedHashHex,
    statementDomain: DOMAIN_MODULE_PUBLICATION_V1,
  };

  const rebuilt = await createSingleFileBundle({
    wasmBytes: bytes,
    ...(manifestBytes ? { manifestBytes } : {}),
    signature,
    entries: preservedEntries,
  });
  const signedPortable = extractPublicationRecordCollection(
    rebuilt.wasmBytes,
  )?.payloadBytes;
  if (!equalBytes(signedPortable, unsignedPortable)) {
    throw new ModuleSignatureError(
      "hash_mismatch",
      "writing the signature changed the bytes before the trailer; nothing signed",
    );
  }
  return {
    wasmBytes: rebuilt.wasmBytes,
    signature,
    canonicalModuleHashHex: rebuilt.canonicalModuleHashHex,
    signedHashHex,
    signatureScope,
  };
}

/**
 * Verify a module artifact's embedded Ed25519 signature before loading.
 *
 * ONE SIGNED FORM, the publication form:
 *
 *  - `statementDomain` PRESENT — written by the node's content-bound signing
 *    endpoint and by `signModuleArtifact`. The signature covers the domain-separated
 *    statement `domain || 0x00 || sha256(portable)` (see ./sigdomain.js), where
 *    `portable` is the trailer-stripped payload — the exact bytes the runtime
 *    instantiates and the node's capability policy identifies by content hash.
 *    The domain must be EXACTLY {@link DOMAIN_MODULE_PUBLICATION_V1}: not
 *    merely "registered". A registered-but-different domain (the reserved
 *    update-manifest domain, say) is REFUSED, which is what stops a signature
 *    minted for a signed update from being stapled into a module trailer.
 *
 * A signature WITHOUT a statement domain is one of the two forms removed in
 * 0.11.0 and is REFUSED by name before the signer is asked about (it is a
 * property of the artifact): `legacy_bundle_signature` when it declares the
 * whole-bundle hash algorithm, `legacy_module_signature` for the bare module
 * digest. Such an artifact must be signed again. Here, and only here, this
 * verifier is deliberately STRICTER than the node's, which still admits both;
 * the parity test names the vectors where the verdicts differ.
 *
 * Elsewhere this mirrors the node exactly, to the reason code, because
 * the same artifact is verified by the Go loaders
 * (`sdn-server/internal/modulert/publication_signature.go` and its kubo twin)
 * and by this function in the browser and under Node/WasmEdge. An artifact that
 * verifies on the node and is refused here is a cross-runtime defect, not a
 * platform difference — so the checks below run in the node's ORDER (what the
 * signature covers is resolved before who signed it) and the shared vector file
 * `test/support/statement-domain-vectors.json` pins both sides against the same
 * bytes and the same refusal reasons.
 *
 * Note the deliberate omissions on the node-signed path: `signedHashAlgorithm`
 * is not consulted and the bundle's recorded `canonicalModuleHash` is not
 * gated on, because the node consults neither. The domain itself defines the
 * hash basis (portable-payload SHA-256), and that basis binds the entire
 * instantiated payload — a strictly stronger commitment than the canonical
 * hash, which strips `sds.*` custom sections before hashing.
 *
 * A present-but-invalid signature always throws. A missing signature throws
 * only when `requireSignature` is true.
 *
 * @param {Uint8Array|ArrayBuffer} bytes - module artifact bytes
 * @param {Object} options
 * @param {string[]|string} [options.trustedPublicKeys] - allowed signer public keys (hex)
 * @param {boolean} [options.requireSignature=false]
 * @returns {Promise<{verified: boolean, signed: boolean, keyId?: string|null, publicKeyHex?: string, canonicalModuleHashHex?: string, contentHashHex?: string, statementDomain?: string, reason?: string}>}
 */
export async function verifyModuleArtifact(bytes, options = {}) {
  const requireSignature = options.requireSignature === true;
  const protectedArtifact = extractPublicationRecordCollection(bytes);
  const signatureEntry = protectedArtifact?.mbl
    ? findSignatureEntry(protectedArtifact.mbl)
    : null;

  if (!signatureEntry) {
    if (requireSignature) {
      throw new ModuleSignatureError(
        "missing_signature",
        "module artifact has no signature entry but signature is required",
      );
    }
    return { verified: false, signed: false, reason: "unsigned" };
  }

  const payload = decodeSignaturePayload(signatureEntry);
  // Trimmed and case-folded, because the node is: `strings.EqualFold(
  // strings.TrimSpace(payload.Algorithm), "ed25519")`. An exact match here
  // would refuse an "ED25519" the node admits.
  if (trimGoWhitespace(payload.algorithm).toLowerCase() !== MODULE_SIGNATURE_ALGORITHM) {
    throw new ModuleSignatureError(
      "unsupported_algorithm",
      `unsupported module signature algorithm: ${payload.algorithm}`,
    );
  }
  const signatureBytes = hexToBytes(payload.signatureHex);
  if (signatureBytes.length !== 64) {
    throw new ModuleSignatureError(
      "invalid_signature",
      "module signature must be 64 bytes",
    );
  }
  if (signatureBytes.every((byte) => byte === 0)) {
    throw new ModuleSignatureError(
      "invalid_signature",
      "module signature must not be all zeroes",
    );
  }
  const publicKeyHex = String(payload.publicKeyHex ?? "").trim().toLowerCase();
  const publicKeyBytes = hexToBytes(publicKeyHex);
  if (publicKeyBytes.length !== 32) {
    throw new ModuleSignatureError(
      "invalid_public_key",
      "module signer public key must be 32 bytes",
    );
  }

  const trusted = normalizeTrustedPublicKeys(options.trustedPublicKeys);
  // resolvedStatementDomain is carried onto the thrown error so a refusal
  // reports the same (reason, domain) pair the node's ModuleSignatureStatus
  // does — including for untrusted_signer, where the domain was already
  // resolved before trust was asked.
  const requireTrustedSigner = (resolvedStatementDomain) => {
    if (!trusted.includes(publicKeyHex)) {
      const error = new ModuleSignatureError(
        "untrusted_signer",
        "module signer public key is not in the trusted signer set",
      );
      if (resolvedStatementDomain) {
        error.statementDomain = resolvedStatementDomain;
      }
      throw error;
    }
  };

  // ---- node-signed form: domain-separated statement over the portable hash --
  //
  // Resolved BEFORE the trusted-signer check, mirroring the node: a wrong
  // statement domain is a property of the ARTIFACT and must be reported as
  // such whether or not the signer happens to be trusted. (The shared vector
  // `foreign-registered-domain-untrusted-signer` pins exactly this ordering.)
  const declaredStatementDomain = trimGoWhitespace(payload.statementDomain);
  // AN ARTIFACT DECLARES EXACTLY ONE BASIS. A statement domain says the
  // signature covers domain||0x00||sha256(portable); the bundle hash algorithm
  // says it covers the canonical whole-bundle statement. Different preimages,
  // so an artifact claiming both has not said what its signature covers.
  // Resolving it either way silently discards the other claim — the node twins
  // resolved it bundle-first, which would have dropped the domain check and
  // with it the cross-domain replay guard. All three verifiers refuse instead
  // (sdn-server + kubo: reason "ambiguous_signature_scope").
  if (
    declaredStatementDomain !== "" &&
    trimGoWhitespace(payload.signedHashAlgorithm) ===
      BUNDLE_SIGNATURE_HASH_ALGORITHM
  ) {
    const error = new ModuleSignatureError(
      "ambiguous_signature_scope",
      `module signature declares statement domain ${JSON.stringify(declaredStatementDomain)} AND hash algorithm ${JSON.stringify(BUNDLE_SIGNATURE_HASH_ALGORITHM)}; these are different preimages and an artifact must declare exactly one`,
    );
    error.statementDomain = declaredStatementDomain;
    throw error;
  }
  if (declaredStatementDomain !== "") {
    const portableBytes = new Uint8Array(protectedArtifact.payloadBytes);
    const contentHashBytes = await sha256Bytes(portableBytes);
    const contentHashHex = bytesToHex(contentHashBytes);

    const declaredHashHex = trimGoWhitespace(payload.signedHashHex).toLowerCase();
    if (declaredHashHex !== "" && declaredHashHex !== contentHashHex) {
      throw new ModuleSignatureError(
        "hash_mismatch",
        `module signature covers content hash ${declaredHashHex}, portable artifact hashes to ${contentHashHex}`,
      );
    }

    if (declaredStatementDomain !== DOMAIN_MODULE_PUBLICATION_V1) {
      const error = new ModuleSignatureError(
        "unsupported_statement_domain",
        `module signature declares statement domain ${JSON.stringify(declaredStatementDomain)}; a module artifact must be signed under ${JSON.stringify(DOMAIN_MODULE_PUBLICATION_V1)}`,
      );
      error.statementDomain = declaredStatementDomain;
      throw error;
    }

    const statementBytes = buildSignatureStatement(
      DOMAIN_MODULE_PUBLICATION_V1,
      contentHashBytes,
    );

    requireTrustedSigner(DOMAIN_MODULE_PUBLICATION_V1);

    const validStatement = await ed25519Verify(
      statementBytes,
      signatureBytes,
      publicKeyBytes,
    );
    if (!validStatement) {
      const error = new ModuleSignatureError(
        "invalid_signature",
        "module publication signature verification failed",
      );
      error.statementDomain = DOMAIN_MODULE_PUBLICATION_V1;
      throw error;
    }

    return {
      verified: true,
      signed: true,
      keyId: payload.keyId ?? null,
      publicKeyHex,
      statementDomain: DOMAIN_MODULE_PUBLICATION_V1,
      contentHashHex,
      // Reported for continuity with the legacy result shape (the CLI prints
      // it); NOT gated on, because the node does not gate on it either.
      canonicalModuleHashHex: await bestEffortCanonicalModuleHashHex(
        protectedArtifact.payloadBytes,
      ),
      signatureScope: "module",
      signedHashHex: contentHashHex,
    };
  }

  // ---- no statement domain: a removed form, refused by name -----------------
  // Before the signer is asked about: the form is a property of the artifact.
  if (
    trimGoWhitespace(payload.signedHashAlgorithm) ===
    BUNDLE_SIGNATURE_HASH_ALGORITHM
  ) {
    throw new ModuleSignatureError(
      "legacy_bundle_signature",
      `module signature has no statementDomain and covers the whole-bundle digest (signedHashAlgorithm ${JSON.stringify(BUNDLE_SIGNATURE_HASH_ALGORITHM)}); space-data-module-sdk 0.11.0 refuses this form, sign the module again`,
    );
  }
  const declaredAlgorithm = trimGoWhitespace(payload.signedHashAlgorithm);
  if (
    declaredAlgorithm !== "" &&
    declaredAlgorithm !== PUBLICATION_SIGNED_HASH_ALGORITHM
  ) {
    throw new ModuleSignatureError(
      "unsupported_hash_algorithm",
      `unsupported module signature hash algorithm: ${payload.signedHashAlgorithm}`,
    );
  }
  throw new ModuleSignatureError(
    "legacy_module_signature",
    `module signature has no statementDomain and covers the bare canonical module digest (signedHashAlgorithm ${JSON.stringify(payload.signedHashAlgorithm ?? "")}); space-data-module-sdk 0.11.0 refuses this form, sign the module again`,
  );
}

function readEnv(name) {
  try {
    if (typeof process !== "undefined" && process?.env?.[name] !== undefined) {
      return process.env[name];
    }
  } catch {
    // no process in this runtime
  }
  return undefined;
}

/**
 * Resolve the effective signature-verification policy for a load operation.
 * Sources, in priority order: explicit `options.verifySignature`, then the
 * `SDM_TRUSTED_MODULE_SIGNERS` / `SDM_REQUIRE_MODULE_SIGNATURE` environment
 * variables, then `globalThis.__SDM_TRUSTED_MODULE_SIGNERS__` /
 * `globalThis.__SDM_REQUIRE_MODULE_SIGNATURE__` (for browser hosts).
 *
 * Returns null when no policy is configured (loading proceeds unverified,
 * preserving existing behavior).
 */
export function resolveModuleSignaturePolicy(options = {}) {
  if (options.verifySignature === false) {
    return null;
  }
  if (options.verifySignature && typeof options.verifySignature === "object") {
    return {
      trustedPublicKeys: normalizeTrustedPublicKeys(
        options.verifySignature.trustedPublicKeys,
      ),
      requireSignature: options.verifySignature.requireSignature === true,
    };
  }
  const envTrusted = readEnv("SDM_TRUSTED_MODULE_SIGNERS");
  const envRequire = readEnv("SDM_REQUIRE_MODULE_SIGNATURE");
  const globalTrusted = globalThis.__SDM_TRUSTED_MODULE_SIGNERS__;
  const globalRequire = globalThis.__SDM_REQUIRE_MODULE_SIGNATURE__;
  const trustedPublicKeys = normalizeTrustedPublicKeys(
    envTrusted ?? globalTrusted,
  );
  const requireSignature =
    envRequire === "1" ||
    envRequire === "true" ||
    globalRequire === true ||
    globalRequire === "1";
  if (trustedPublicKeys.length === 0 && !requireSignature) {
    return null;
  }
  return { trustedPublicKeys, requireSignature };
}
