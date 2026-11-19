import {
  computeCanonicalModuleHash,
  createSingleFileBundle,
  getWasmCustomSections,
  parseSingleFileBundle,
  rewriteProtectedEnvelopeTrailer,
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
// The SDK's public TEST signer (keyId sdm-dev-test-2026), whose private half is
// committed in test/support/dev-module-signing-keypair.json and therefore
// public. A signature by this key shows only that the file was not damaged by
// accident: anyone can sign anything with it. verifyModuleArtifact reports it
// as testSigner by the verified KEY (the keyId in the entry is not signed and
// says nothing).
export const SDK_TEST_SIGNER_PUBLIC_KEY_HEX =
  "cf4625795484d8efe18860141cfdeaaaed7bbee9209488405b6ddeac7543fe78";

export function isSdkTestSigner(publicKeyHex) {
  return (
    String(publicKeyHex ?? "").trim().toLowerCase() ===
    SDK_TEST_SIGNER_PUBLIC_KEY_HEX
  );
}

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
  // Trimmed as Go's strings.TrimSpace trims, as the node trims these fields.
  const normalized = trimGoWhitespace(hex).toLowerCase();
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

// A trusted key is exactly 64 hex characters (a 32-byte Ed25519 public key)
// after trim and lowercase. Anything else that is not empty is REFUSED by
// name: a key the operator named and the SDK silently dropped would leave a
// policy that trusts nothing it was told to, or none at all (fail open).
function normalizeTrustedPublicKeys(trustedPublicKeys) {
  const list = Array.isArray(trustedPublicKeys)
    ? trustedPublicKeys
    : typeof trustedPublicKeys === "string"
      ? trustedPublicKeys.split(",")
      : [];
  const keys = [];
  for (const entry of list) {
    const key = String(entry ?? "").trim().toLowerCase();
    if (key === "") continue;
    if (!/^[0-9a-f]{64}$/.test(key)) {
      throw new ModuleSignatureError(
        "invalid_trusted_key",
        `a trusted signer key must be exactly 64 hex characters (a 32-byte Ed25519 public key, no 0x prefix); got ${key.length} characters`,
      );
    }
    keys.push(key);
  }
  return keys;
}

// The entry judged is the one the node judges (publication_signature.go,
// findModuleSignatureEntry): the first whose role is SIGNATURE, or whose
// entryId or sectionName, Go-trimmed and lowercased, is "signature" or
// "sds.signature".
function findSignatureEntry(bundle) {
  const folded = (value) =>
    typeof value === "string" ? trimGoWhitespace(value).toLowerCase() : value;
  for (const entry of bundle?.entries ?? []) {
    const role =
      typeof entry.role === "string" ? entry.role.toLowerCase() : entry.role;
    if (
      role === MODULE_SIGNATURE_ENTRY_ROLE ||
      role === ModuleBundleEntryRole.SIGNATURE ||
      folded(entry.entryId) === "signature" ||
      folded(entry.sectionName) === "sds.signature"
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
  // Every known key is a string, as the node's struct reads it (Go's
  // json.Unmarshal refuses an array, a number, an object or a boolean for a
  // string field). keyId may also be null: OrbPro's envelope signer and this
  // SDK write keyId null when there is none. Without this check, String()
  // turned a one-element array into its string and admitted what the node
  // refuses.
  for (const key of SIGNATURE_PAYLOAD_KEYS) {
    if (!Object.hasOwn(parsed, key)) continue;
    const value = parsed[key];
    if (typeof value === "string" || (key === "keyId" && value === null)) continue;
    throw new ModuleSignatureError(
      "invalid_signature_payload",
      `module signature entry payload's "${key}" is ${value === null ? "null" : Array.isArray(value) ? "an array" : typeof value}; it must be a string${key === "keyId" ? " or null" : ""}`,
    );
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
 * The publication signature entry over `portable` (the bytes before the
 * trailer), in the node's SignatureEntry JSON key order
 * (sdn-server/internal/modulesign/modulesign.go, Sign): the same key over the
 * same portable bytes gives the same entry bytes as the node's.
 */
async function publicationSignatureEntry(seed, portable, keyId) {
  const publicKey = await ed25519PublicKey(seed);
  const contentHashBytes = await sha256Bytes(new Uint8Array(portable));
  const signedHashHex = bytesToHex(contentHashBytes);
  const signatureBytes = await ed25519Sign(
    buildSignatureStatement(DOMAIN_MODULE_PUBLICATION_V1, contentHashBytes),
    seed,
  );
  return {
    contentHashBytes,
    signedHashHex,
    signature: {
      algorithm: MODULE_SIGNATURE_ALGORITHM,
      keyId: keyId ?? null,
      publicKeyHex: bytesToHex(new Uint8Array(publicKey)),
      signatureHex: bytesToHex(new Uint8Array(signatureBytes)),
      signedHashAlgorithm: PUBLICATION_SIGNED_HASH_ALGORITHM,
      signedHashHex,
      statementDomain: DOMAIN_MODULE_PUBLICATION_V1,
    },
  };
}

/**
 * An artifact whose trailer carries an ENC record: the payload is ciphertext
 * and is NEVER parsed. The signature is taken over the bytes as stored (the
 * ciphertext), the same statement as for a plaintext module; the trailer is
 * written again with the new signature entry, every other bundle entry, and
 * the ENC and PNM records as they were. The engine's envelope signer
 * (OrbPro `scripts/signProtectedEnvelope.mjs`) writes the same entry.
 *
 * What this signature binds is the ciphertext only: not the ENC record (its
 * cipher suite, key context or recipient), not the plaintext. A host that
 * decrypts checks the plaintext's own signature after decrypting.
 */
async function signEncryptedArtifact(protectedArtifact, seed, options, signatureScope) {
  const portable = new Uint8Array(protectedArtifact.payloadBytes);
  const keptEntries = (protectedArtifact.mbl?.entries ?? [])
    .filter((entry) => !findSignatureEntry({ entries: [entry] }))
    .map((entry) => ({ ...entry, payload: new Uint8Array(entry.payload ?? []) }));
  const { signature, signedHashHex, contentHashBytes } =
    await publicationSignatureEntry(seed, portable, options.keyId);
  const wasmBytes = await rewriteProtectedEnvelopeTrailer({
    publicationRecords: protectedArtifact,
    entries: keptEntries,
    signature,
    contentHash: contentHashBytes,
  });
  const written = extractPublicationRecordCollection(wasmBytes);
  if (!written?.enc || !equalBytes(written.payloadBytes, portable)) {
    throw new ModuleSignatureError(
      "hash_mismatch",
      "writing the signature changed the encrypted payload; nothing signed",
    );
  }
  return {
    wasmBytes,
    signature,
    // The bundle's recorded value, as it stands in the trailer: the
    // plaintext's canonical hash when the old trailer carried one, else the
    // ciphertext's content hash. The ciphertext itself is never parsed.
    canonicalModuleHashHex: bytesToHex(
      new Uint8Array(written.mbl?.canonicalModuleHash ?? []),
    ),
    signedHashHex,
    signatureScope,
  };
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
 * What is hashed is what the OUTPUT holds before its trailer. For a raw
 * module (no trailer yet) that is the module with its `sds.*` custom sections
 * removed (they move into the trailer), so a raw build that still carries
 * `sds.manifest` is signed correctly in one pass. For a file that already has
 * a trailer, the bytes before it are signed as they stand and kept unchanged
 * (a node-signed file keeps its `sds.manifest` section there): signing again
 * never changes the loadable wasm. For an artifact whose trailer carries an
 * ENC record, the payload is ciphertext: it is hashed as stored and never
 * parsed.
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
  if (protectedArtifact?.enc) {
    return signEncryptedArtifact(protectedArtifact, seed, options, signatureScope);
  }
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

  // A file that already has a trailer (signed before, by this SDK or by the
  // node) is signed over the bytes before that trailer AS THEY STAND, and they
  // are kept unchanged: signing again never changes the loadable wasm. A
  // node-signed file keeps its sds.manifest section in those bytes; the bundle
  // writer would strip it (only the trailer it writes is used, below).
  const keptPortable = protectedArtifact
    ? new Uint8Array(protectedArtifact.payloadBytes)
    : null;

  const { signature, signedHashHex } = await publicationSignatureEntry(
    seed,
    keptPortable ?? unsignedPortable,
    options.keyId,
  );

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
  let wasmBytes = new Uint8Array(rebuilt.wasmBytes);
  if (keptPortable) {
    // The trailer is self-contained (its footer records only its own length):
    // the one just written goes after the bytes as they stood.
    const trailer = wasmBytes.subarray(signedPortable.length);
    wasmBytes = new Uint8Array(keptPortable.length + trailer.length);
    wasmBytes.set(keptPortable, 0);
    wasmBytes.set(trailer, keptPortable.length);
    const written = extractPublicationRecordCollection(wasmBytes);
    if (!written?.mbl || written.enc || !equalBytes(written.payloadBytes, keptPortable)) {
      throw new ModuleSignatureError(
        "hash_mismatch",
        "writing the signature changed the bytes before the trailer; nothing signed",
      );
    }
  }
  return {
    wasmBytes,
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
  // First, before the artifact is looked at: a malformed trusted key is the
  // caller's error (invalid_trusted_key) whatever the file holds.
  const trusted = normalizeTrustedPublicKeys(options.trustedPublicKeys);
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
  const publicKeyHex = trimGoWhitespace(payload.publicKeyHex).toLowerCase();
  const publicKeyBytes = hexToBytes(publicKeyHex);
  if (publicKeyBytes.length !== 32) {
    throw new ModuleSignatureError(
      "invalid_public_key",
      "module signer public key must be 32 bytes",
    );
  }

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

    // The entry names what it covers. signedHashHex is REQUIRED and equal to
    // sha256(portable) (a different one is hash_mismatch, above); the node's
    // signer always writes it, and sdn-js already requires it. The hash
    // algorithm label is REQUIRED and is the node's fixed string.
    if (declaredHashHex === "") {
      const error = new ModuleSignatureError(
        "missing_signed_hash",
        `module signature declares no signedHashHex; the publication form records sha256 of the bytes before the trailer (${contentHashHex}), sign the module again`,
      );
      error.statementDomain = DOMAIN_MODULE_PUBLICATION_V1;
      throw error;
    }
    if (
      trimGoWhitespace(payload.signedHashAlgorithm) !==
      PUBLICATION_SIGNED_HASH_ALGORITHM
    ) {
      const error = new ModuleSignatureError(
        "unsupported_hash_algorithm",
        `module signature declares signedHashAlgorithm ${JSON.stringify(payload.signedHashAlgorithm ?? "")}; the publication form records ${JSON.stringify(PUBLICATION_SIGNED_HASH_ALGORITHM)}`,
      );
      error.statementDomain = DOMAIN_MODULE_PUBLICATION_V1;
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
      testSigner: isSdkTestSigner(publicKeyHex),
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
 *
 * NAMING A TRUSTED KEY REQUIRES A SIGNATURE. The publication form does not
 * cover its own trailer, so stripping the trailer (or only its signature
 * entry) leaves a file that would otherwise load as "unsigned" under a policy
 * that trusts key X. A policy, environment or global that names any trusted
 * key therefore always sets requireSignature, whatever it says about it.
 *
 * A MALFORMED KEY IS REFUSED, never dropped: any non-empty entry that is not
 * exactly 64 hex characters after trim and lowercase (a `0x` prefix, a
 * 63-character typo, a non-hex character) throws
 * `ModuleSignatureError("invalid_trusted_key")`, so a typo can never turn the
 * check off. An environment variable that is set but empty does not hide the
 * global list.
 *
 * `verifySignature: true` uses the environment's or the global's trust. The
 * caller asked for verification, so it always requires a signature: with no
 * trust configured there, nothing is trusted and every load is refused by
 * name (`missing_signature` or `untrusted_signer`), never let through.
 */
export function resolveModuleSignaturePolicy(options = {}) {
  if (options.verifySignature === false) {
    return null;
  }
  if (options.verifySignature && typeof options.verifySignature === "object") {
    const trustedPublicKeys = normalizeTrustedPublicKeys(
      options.verifySignature.trustedPublicKeys,
    );
    return {
      trustedPublicKeys,
      requireSignature:
        options.verifySignature.requireSignature === true ||
        trustedPublicKeys.length > 0,
    };
  }
  const envTrusted = readEnv("SDM_TRUSTED_MODULE_SIGNERS");
  const envRequire = readEnv("SDM_REQUIRE_MODULE_SIGNATURE");
  const globalTrusted = globalThis.__SDM_TRUSTED_MODULE_SIGNERS__;
  const globalRequire = globalThis.__SDM_REQUIRE_MODULE_SIGNATURE__;
  const envTrustedText =
    typeof envTrusted === "string" ? envTrusted.trim() : envTrusted;
  const trustedPublicKeys = normalizeTrustedPublicKeys(
    envTrustedText || globalTrusted,
  );
  const requireSignature =
    options.verifySignature === true ||
    trustedPublicKeys.length > 0 ||
    envRequire === "1" ||
    envRequire === "true" ||
    globalRequire === true ||
    globalRequire === "1";
  if (trustedPublicKeys.length === 0 && !requireSignature) {
    return null;
  }
  return { trustedPublicKeys, requireSignature };
}
