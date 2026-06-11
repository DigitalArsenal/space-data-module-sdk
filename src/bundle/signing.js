import {
  computeCanonicalModuleHash,
  createSingleFileBundle,
  parseSingleFileBundle,
} from "./wasm.js";
import {
  extractPublicationRecordCollection,
} from "../transport/records.js";
import {
  ed25519PublicKey,
  ed25519Sign,
  ed25519Verify,
} from "../utils/wasmCrypto.js";
import { ModuleBundleEntryRole } from "spacedatastandards.org/lib/js/MBL/main.js";

export const MODULE_SIGNATURE_ALGORITHM = "ed25519";
export const MODULE_SIGNATURE_ENTRY_ROLE = "signature";

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
  const publicKey = await ed25519PublicKey(seed);
  const signatureBytes = await ed25519Sign(canonical.hashBytes, seed);
  const signature = {
    algorithm: MODULE_SIGNATURE_ALGORITHM,
    keyId: options.keyId ?? null,
    publicKeyHex: bytesToHex(new Uint8Array(publicKey)),
    signatureHex: bytesToHex(new Uint8Array(signatureBytes)),
    signedHashHex: canonical.hashHex,
    signedHashAlgorithm: "sha256-canonical-module-hash",
  };

  let manifestBytes;
  let preservedEntries = [];
  if (protectedArtifact?.mbl) {
    const parsed = await parseSingleFileBundle(bytes);
    preservedEntries = (parsed.bundle.entries ?? []).filter((entry) => {
      if (findSignatureEntry({ entries: [entry] })) {
        return false;
      }
      if (entry.entryId === "manifest" || entry.role === "manifest") {
        manifestBytes = new Uint8Array(entry.payload ?? []);
        return false;
      }
      return true;
    });
  }

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

  const canonical = await computeCanonicalModuleHash(
    protectedArtifact.payloadBytes,
  );
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
  if (
    String(payload.signedHashHex ?? "").toLowerCase() !== canonical.hashHex
  ) {
    throw new ModuleSignatureError(
      "hash_mismatch",
      "module canonical hash does not match the signed digest",
    );
  }

  const valid = await ed25519Verify(
    canonical.hashBytes,
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
