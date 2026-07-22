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
import { canonicalBytes } from "../auth/canonicalize.js";
import { sha256Bytes } from "../utils/crypto.js";
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
      .sort((left, right) => left.entryId.localeCompare(right.entryId)),
  };
  const hashBytes = await sha256Bytes(canonicalBytes(statement));
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
 * Verification recomputes the canonical wasm hash, requires it to match both
 * the bundle's recorded canonicalModuleHash and the signed digest, requires
 * the signing key to be in `trustedPublicKeys`, and checks the Ed25519
 * signature. A present-but-invalid signature always throws. A missing
 * signature throws only when `requireSignature` is true.
 *
 * @param {Uint8Array|ArrayBuffer} bytes - module artifact bytes
 * @param {Object} options
 * @param {string[]|string} [options.trustedPublicKeys] - allowed signer public keys (hex)
 * @param {boolean} [options.requireSignature=false]
 * @returns {Promise<{verified: boolean, signed: boolean, keyId?: string|null, publicKeyHex?: string, canonicalModuleHashHex?: string, reason?: string}>}
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
  if (payload.algorithm !== MODULE_SIGNATURE_ALGORITHM) {
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
  if (!trusted.includes(publicKeyHex)) {
    throw new ModuleSignatureError(
      "untrusted_signer",
      "module signer public key is not in the trusted signer set",
    );
  }

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
