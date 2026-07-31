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
export const LEGACY_MODULE_SIGNATURE_HASH_ALGORITHM =
  "sha256-canonical-module-hash";
export const BUNDLE_SIGNATURE_HASH_ALGORITHM =
  "sha256-sdn-module-bundle-v1";

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

function decodeSignaturePayload(entry) {
  try {
    const payload = entry.payload ?? [];
    const text = new TextDecoder().decode(new Uint8Array(payload));
    return JSON.parse(text);
  } catch {
    throw new ModuleSignatureError(
      "invalid_signature_payload",
      "module signature entry payload is not valid JSON",
    );
  }
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

const bundleStatementTextEncoder = new TextEncoder();

function compareUtf8Keys(left, right) {
  const leftBytes = bundleStatementTextEncoder.encode(left);
  const rightBytes = bundleStatementTextEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return leftBytes[index] - rightBytes[index];
    }
  }
  return leftBytes.length - rightBytes.length;
}

function normalizeBundleStatementValue(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      const normalized = normalizeBundleStatementValue(item);
      return normalized === undefined ? null : normalized;
    });
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nestedValue]) => nestedValue !== undefined)
      .sort(([left], [right]) => compareUtf8Keys(left, right))
      .map(([key, nestedValue]) => [
        key,
        normalizeBundleStatementValue(nestedValue),
      ]),
  );
}

function canonicalBundleStatementBytes(statement) {
  // Go's encoding/json orders map keys by their UTF-8 bytes and escapes these
  // five code points by default. Match that host-side representation exactly
  // so a bundle digest is independent of JavaScript's locale configuration.
  const json = JSON.stringify(normalizeBundleStatementValue(statement)).replace(
    /[<>&\u2028\u2029]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return bundleStatementTextEncoder.encode(json);
}

function normalizedBundleEntryForSignature(entry) {
  const payload = new Uint8Array(entry.payload ?? []);
  return {
    entryId: entry.entryId ?? null,
    role: Number(entry.role ?? ModuleBundleEntryRole.AUXILIARY),
    sectionName: entry.sectionName ?? null,
    typeRef: entry.typeRef ?? null,
    payloadEncoding: Number(entry.payloadEncoding ?? 0),
    mediaType: entry.mediaType ?? null,
    flags: Number(entry.flags ?? 0),
    sha256Hex: bytesToHex(new Uint8Array(entry.sha256 ?? [])),
    payloadLength: payload.length,
    description: entry.description ?? null,
  };
}

/**
 * Compute the v1 whole-bundle signing digest. Every non-signature entry's
 * payload hash is recomputed before the canonical statement is hashed; an
 * attacker cannot make a modified payload self-consistent merely by changing
 * its MBL sha256 field. Bundle metadata and the portable module hash are bound
 * by the same statement.
 */
export async function computeModuleBundleSignatureHash(bundle, options = {}) {
  if (!bundle || typeof bundle !== "object") {
    throw new ModuleSignatureError(
      "invalid_bundle",
      "module bundle is missing or malformed",
    );
  }
  const entries = (bundle.entries ?? []).filter(
    (entry) => !findSignatureEntry({ entries: [entry] }),
  );
  const seen = new Set();
  for (const entry of entries) {
    const entryId = String(entry.entryId ?? "");
    if (!entryId) {
      throw new ModuleSignatureError(
        "invalid_bundle",
        "module bundle contains an entry without an entryId",
      );
    }
    if (seen.has(entryId)) {
      throw new ModuleSignatureError(
        "invalid_bundle",
        `module bundle contains duplicate entryId ${JSON.stringify(entryId)}`,
      );
    }
    seen.add(entryId);
    const payloadHash = await sha256Bytes(new Uint8Array(entry.payload ?? []));
    if (!equalBytes(payloadHash, entry.sha256)) {
      throw new ModuleSignatureError(
        "hash_mismatch",
        `module bundle entry ${JSON.stringify(entryId)} payload hash does not match its recorded sha256`,
      );
    }
  }

  const recordedModuleHash = new Uint8Array(bundle.canonicalModuleHash ?? []);
  if (recordedModuleHash.length !== 32) {
    throw new ModuleSignatureError(
      "invalid_bundle",
      "module bundle canonicalModuleHash must be 32 bytes",
    );
  }
  if (options.wasmBytes) {
    const canonical = await computeCanonicalModuleHash(options.wasmBytes, {
      customSectionPrefix:
        bundle.canonicalization?.strippedCustomSectionPrefix,
    });
    if (!equalBytes(canonical.hashBytes, recordedModuleHash)) {
      throw new ModuleSignatureError(
        "hash_mismatch",
        "module canonical hash does not match the bundle's recorded hash",
      );
    }
  }

  const manifestEntry = entries.find(
    (entry) =>
      entry.entryId === "manifest" ||
      entry.role === ModuleBundleEntryRole.MANIFEST,
  );
  const recordedManifestHash = new Uint8Array(bundle.manifestHash ?? []);
  if (manifestEntry) {
    const manifestHash = await sha256Bytes(
      new Uint8Array(manifestEntry.payload ?? []),
    );
    if (!equalBytes(manifestHash, recordedManifestHash)) {
      throw new ModuleSignatureError(
        "hash_mismatch",
        "module manifest payload hash does not match the bundle's manifestHash",
      );
    }
  } else if (recordedManifestHash.length !== 0) {
    throw new ModuleSignatureError(
      "hash_mismatch",
      "module bundle records a manifestHash but contains no manifest entry",
    );
  }

  const statement = {
    version: 1,
    bundleVersion: Number(bundle.bundleVersion ?? 1),
    moduleFormat: bundle.moduleFormat ?? null,
    canonicalization: {
      version: Number(bundle.canonicalization?.version ?? 1),
      strippedCustomSectionPrefix:
        bundle.canonicalization?.strippedCustomSectionPrefix ?? null,
      bundleSectionName:
        bundle.canonicalization?.bundleSectionName ?? null,
      hashAlgorithm: bundle.canonicalization?.hashAlgorithm ?? null,
    },
    canonicalModuleHashHex: bytesToHex(recordedModuleHash),
    manifestHashHex: bytesToHex(recordedManifestHash),
    manifestExportSymbol: bundle.manifestExportSymbol ?? null,
    manifestSizeSymbol: bundle.manifestSizeSymbol ?? null,
    entries: entries
      .map(normalizedBundleEntryForSignature)
      .sort((left, right) => compareUtf8Keys(left.entryId, right.entryId)),
  };
  const hashBytes = await sha256Bytes(canonicalBundleStatementBytes(statement));
  return {
    statement,
    hashBytes,
    hashHex: bytesToHex(hashBytes),
  };
}

/**
 * Sign a module artifact's canonical wasm hash with an Ed25519 key and embed
 * the detached signature in the artifact's MBL bundle (sds.signature entry).
 *
 * Existing bundle entries, the manifest, and any ENC/PNM publication records
 * in the REC trailer are preserved. Any previous signature entry is replaced.
 *
 * @param {Uint8Array|ArrayBuffer} bytes - module artifact (raw wasm or single-file bundle)
 * @param {Object} options
 * @param {string} options.privateKeySeedHex - 32-byte Ed25519 seed, hex
 * @param {string} [options.keyId] - identifier recorded alongside the signature
 * @returns {Promise<{wasmBytes: Uint8Array, signature: Object, canonicalModuleHashHex: string}>}
 */
export async function signModuleArtifact(bytes, options = {}) {
  const seed = hexToBytes(options.privateKeySeedHex);
  if (seed.length !== 32) {
    throw new ModuleSignatureError(
      "invalid_seed",
      "privateKeySeedHex must be a 32-byte hex Ed25519 seed",
    );
  }
  const protectedArtifact = extractPublicationRecordCollection(bytes);
  const payloadBytes = protectedArtifact?.payloadBytes ?? bytes;
  const canonical = await computeCanonicalModuleHash(payloadBytes);

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

  let signedHashBytes = canonical.hashBytes;
  let signedHashHex = canonical.hashHex;
  let signedHashAlgorithm = LEGACY_MODULE_SIGNATURE_HASH_ALGORITHM;
  if (options.signatureScope === "bundle") {
    const unsigned = await createSingleFileBundle({
      wasmBytes: bytes,
      ...(manifestBytes ? { manifestBytes } : {}),
      entries: preservedEntries,
    });
    const parsedUnsigned = await parseSingleFileBundle(unsigned.wasmBytes);
    const bundleHash = await computeModuleBundleSignatureHash(
      parsedUnsigned.bundle,
      { wasmBytes: parsedUnsigned.wasmBytes },
    );
    signedHashBytes = bundleHash.hashBytes;
    signedHashHex = bundleHash.hashHex;
    signedHashAlgorithm = BUNDLE_SIGNATURE_HASH_ALGORITHM;
  } else if (
    options.signatureScope !== undefined &&
    options.signatureScope !== "module"
  ) {
    throw new ModuleSignatureError(
      "invalid_signature_scope",
      'signatureScope must be either "module" or "bundle"',
    );
  }

  const publicKey = await ed25519PublicKey(seed);
  const signatureBytes = await ed25519Sign(signedHashBytes, seed);
  const signature = {
    algorithm: MODULE_SIGNATURE_ALGORITHM,
    keyId: options.keyId ?? null,
    publicKeyHex: bytesToHex(new Uint8Array(publicKey)),
    signatureHex: bytesToHex(new Uint8Array(signatureBytes)),
    signedHashHex,
    signedHashAlgorithm,
  };

  const rebuilt = await createSingleFileBundle({
    wasmBytes: bytes,
    ...(manifestBytes ? { manifestBytes } : {}),
    signature,
    entries: preservedEntries,
  });
  return {
    wasmBytes: rebuilt.wasmBytes,
    signature,
    canonicalModuleHashHex: rebuilt.canonicalModuleHashHex,
    signedHashHex,
  };
}

/**
 * Verify a module artifact's embedded Ed25519 signature before loading.
 *
 * TWO SIGNED FORMS, and the artifact chooses — not the caller, not a policy:
 *
 *  - `statementDomain` PRESENT — the NODE-SIGNED form issued by the node's
 *    content-bound signing endpoint. The signature covers the domain-separated
 *    statement `domain || 0x00 || sha256(portable)` (see ./sigdomain.js), where
 *    `portable` is the trailer-stripped payload — the exact bytes the runtime
 *    instantiates and the node's capability policy identifies by content hash.
 *    The domain must be EXACTLY {@link DOMAIN_MODULE_PUBLICATION_V1}: not
 *    merely "registered". A registered-but-different domain (the reserved
 *    update-manifest domain, say) is REFUSED, which is what stops a signature
 *    minted for a signed update from being stapled into a module trailer.
 *
 *  - `statementDomain` ABSENT — the legacy SDK-signed form: a signature over
 *    the bare canonical module (or bundle) digest. Verification is byte-identical
 *    to what it has always been, so every artifact already published keeps
 *    verifying.
 *
 * THIS MIRRORS THE NODE EXACTLY, deliberately and to the reason code, because
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

  // ---- legacy form: bare canonical module (or bundle) digest ---------------
  const canonical = await computeCanonicalModuleHash(protectedArtifact.payloadBytes);
  const recordedHash = new Uint8Array(
    protectedArtifact.mbl.canonicalModuleHash ?? [],
  );
  if (
    recordedHash.length !== canonical.hashBytes.length ||
    !recordedHash.every((byte, i) => byte === canonical.hashBytes[i])
  ) {
    throw new ModuleSignatureError(
      "hash_mismatch",
      "module canonical hash does not match the bundle's recorded hash",
    );
  }

  let signedHashBytes = canonical.hashBytes;
  let signedHashHex = canonical.hashHex;
  let signatureScope = "module";
  const signedHashAlgorithm = String(payload.signedHashAlgorithm ?? "");
  if (signedHashAlgorithm === BUNDLE_SIGNATURE_HASH_ALGORITHM) {
    const parsed = await parseSingleFileBundle(bytes);
    const bundleHash = await computeModuleBundleSignatureHash(parsed.bundle, {
      wasmBytes: parsed.wasmBytes,
    });
    signedHashBytes = bundleHash.hashBytes;
    signedHashHex = bundleHash.hashHex;
    signatureScope = "bundle";
  } else if (
    signedHashAlgorithm !== LEGACY_MODULE_SIGNATURE_HASH_ALGORITHM
  ) {
    throw new ModuleSignatureError(
      "unsupported_hash_algorithm",
      `unsupported module signature hash algorithm: ${signedHashAlgorithm}`,
    );
  }
  if (
    String(payload.signedHashHex ?? "").toLowerCase() !== signedHashHex
  ) {
    throw new ModuleSignatureError(
      "hash_mismatch",
      "module or bundle hash does not match the signed digest",
    );
  }

  // Trust is asked LAST here too, for the same reason as above and so the two
  // forms cannot report different reasons for the same defect.
  requireTrustedSigner();

  const valid = await ed25519Verify(
    signedHashBytes,
    signatureBytes,
    publicKeyBytes,
  );
  if (!valid) {
    throw new ModuleSignatureError(
      "invalid_signature",
      "module signature verification failed",
    );
  }
  return {
    verified: true,
    signed: true,
    keyId: payload.keyId ?? null,
    publicKeyHex,
    // Null, not absent: the legacy form is a POSITIVE statement that this
    // artifact predates domain separation, which a caller may want to log.
    statementDomain: null,
    contentHashHex: bytesToHex(
      await sha256Bytes(new Uint8Array(protectedArtifact.payloadBytes)),
    ),
    canonicalModuleHashHex: canonical.hashHex,
    signatureScope,
    signedHashHex,
  };
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
