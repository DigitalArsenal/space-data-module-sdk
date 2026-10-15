import { canonicalBytes } from "./canonicalize.js";
import { bytesToHex, hexToBytes, toUint8Array } from "../utils/encoding.js";
import { randomBytes, sha256Bytes } from "../utils/crypto.js";

function normalizeCapabilityList(capabilities) {
  if (!Array.isArray(capabilities)) {
    return [];
  }
  return capabilities
    .map((capability) => String(capability ?? "").trim())
    .filter(Boolean);
}

function normalizeTarget(target = null) {
  if (typeof target === "string") {
    return {
      kind: "remote",
      id: null,
      audience: null,
      url: target,
    };
  }
  return {
    kind: target?.kind ?? "remote",
    id: target?.id ?? target?.targetId ?? null,
    audience: target?.audience ?? null,
    url: target?.url ?? null,
  };
}

export async function createDeploymentAuthorization(options = {}) {
  const issuedAt = Number(options.issuedAt ?? Date.now());
  const ttlMs = Number(options.ttlMs ?? 5 * 60 * 1000);
  const artifact = options.artifact ?? {};
  const target = normalizeTarget(options.target);

  return {
    version: 1,
    action: "deploy-flow",
    artifactId: String(artifact.artifactId ?? options.artifactId ?? "").trim(),
    programId: String(artifact.programId ?? options.programId ?? "").trim(),
    graphHash: artifact.graphHash ?? options.graphHash ?? null,
    manifestHash: artifact.manifestHash ?? options.manifestHash ?? null,
    target,
    capabilities: normalizeCapabilityList(
      options.capabilities ?? artifact.requiredCapabilities ?? [],
    ),
    issuedAt,
    expiresAt: issuedAt + ttlMs,
    nonce: options.nonce ?? bytesToHex(await randomBytes(16)),
    constraints: options.constraints ?? null,
  };
}

// Authorization signatures ("secp256k1-sha256"): ECDSA over sha256(canonical bytes), hashed exactly once; the
// signature is 64 raw bytes (r || s). node:crypto verifies it with crypto.verify("sha256", bytes, ...).

/**
 * A signer for authorizations: `signDigest(digest)` signs the 32-byte sha256 of the canonical bytes AS GIVEN, with no
 * further hashing - e.g. hd-wallet-wasm's secp256k1.signRecoverable(digest, key).signature, or the SDK's
 * secp256k1SignDigest. Never hd-wallet-wasm's secp256k1.sign(digest): it hashes its input again.
 */
export function createHdWalletSigner(options = {}) {
  if (typeof options.signDigest !== "function") {
    throw new Error("createHdWalletSigner requires signDigest.");
  }
  const publicKeyHex = String(options.publicKeyHex ?? "").trim();
  if (!publicKeyHex) {
    throw new Error("createHdWalletSigner requires publicKeyHex.");
  }
  return {
    algorithm: options.algorithm ?? "secp256k1-sha256",
    curve: options.curve ?? "secp256k1",
    publicKeyHex,
    derivationPath: options.derivationPath ?? null,
    keyId: options.keyId ?? null,
    async sign(bytes) {
      const digest = await sha256Bytes(bytes);
      return toUint8Array(await options.signDigest(digest));
    },
  };
}

/**
 * A verifier for authorizations: `verifyDigest(digest, signature, header, payload)` checks a signature over the
 * 32-byte sha256 of the canonical bytes AS GIVEN, with no further hashing (e.g. the SDK's secp256k1VerifyDigest).
 */
export function createHdWalletVerifier(options = {}) {
  if (typeof options.verifyDigest !== "function") {
    throw new Error("createHdWalletVerifier requires verifyDigest.");
  }
  return {
    async verify(bytes, signature, header, payload) {
      const digest = await sha256Bytes(bytes);
      return Boolean(await options.verifyDigest(digest, signature, header, payload));
    },
  };
}

export async function signAuthorization({ authorization, signer }) {
  if (!signer || typeof signer.sign !== "function") {
    throw new Error("signAuthorization requires a signer.");
  }
  const payload = authorization ?? {};
  const payloadBytes = canonicalBytes(payload);
  const signature = await signer.sign(payloadBytes);
  return {
    protected: {
      algorithm: signer.algorithm ?? "unknown",
      curve: signer.curve ?? null,
      publicKeyHex: signer.publicKeyHex ?? null,
      derivationPath: signer.derivationPath ?? null,
      keyId: signer.keyId ?? null,
    },
    payload,
    signatureHex: bytesToHex(signature),
  };
}

/** Longest lifetime verifyAuthorization accepts by default (issuedAt to expiresAt). */
export const DEFAULT_MAX_AUTHORIZATION_TTL_MS = 60 * 60 * 1000;
/** Clock skew tolerated on issuedAt. */
export const AUTHORIZATION_CLOCK_SKEW_MS = 60 * 1000;

function normalizeTrustedAuthorizationKeys(trustedPublicKeys) {
  const list = Array.isArray(trustedPublicKeys)
    ? trustedPublicKeys
    : typeof trustedPublicKeys === "string"
      ? trustedPublicKeys.split(/[\s,;]+/).filter(Boolean)
      : null;
  if (!list || list.length === 0) {
    throw new Error(
      "verifyAuthorization requires trustedPublicKeys: the authorization signer keys this verifier accepts.",
    );
  }
  return list.map((key, index) => {
    const normalized = String(key ?? "").trim().toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]+$/.test(normalized) || normalized.length < 64) {
      throw new Error(`trustedPublicKeys[${index}] is not a hex public key.`);
    }
    return normalized;
  });
}

/**
 * Verify a signed deployment authorization (security audit 2026-10-15,
 * SEC-058).
 *
 * The envelope names its own signer key in `protected.publicKeyHex`; that is a
 * claim, not trust. The key must be one of `trustedPublicKeys`, and the
 * verifier is handed the TRUSTED key, so a self-signed envelope never
 * verifies. The payload must carry a nonce, an issuedAt not in the future, an
 * expiresAt not in the past, and a lifetime no longer than `maxTtlMs`. When a
 * `nonceStore` ({has(nonce), add(nonce, expiresAt)}) is given, a nonce is
 * accepted once.
 *
 * @returns {Promise<boolean>}
 */
export async function verifyAuthorization({
  envelope,
  verifier,
  trustedPublicKeys,
  now = Date.now(),
  maxTtlMs = DEFAULT_MAX_AUTHORIZATION_TTL_MS,
  nonceStore = null,
}) {
  if (!verifier || typeof verifier.verify !== "function") {
    throw new Error("verifyAuthorization requires a verifier.");
  }
  const trusted = normalizeTrustedAuthorizationKeys(trustedPublicKeys);
  if (!envelope?.payload || !envelope?.signatureHex) {
    return false;
  }
  const payload = envelope.payload;
  const header = envelope.protected ?? {};
  const signerKey = String(header.publicKeyHex ?? "").trim().toLowerCase().replace(/^0x/, "");
  if (!signerKey || !trusted.includes(signerKey)) {
    return false;
  }
  if (
    typeof payload.issuedAt !== "number" ||
    typeof payload.expiresAt !== "number" ||
    !Number.isFinite(payload.issuedAt) ||
    !Number.isFinite(payload.expiresAt)
  ) {
    return false;
  }
  if (payload.expiresAt < now || payload.issuedAt > now + AUTHORIZATION_CLOCK_SKEW_MS) {
    return false;
  }
  if (payload.expiresAt <= payload.issuedAt || payload.expiresAt - payload.issuedAt > maxTtlMs) {
    return false;
  }
  if (typeof payload.nonce !== "string" || payload.nonce.trim().length < 16) {
    return false;
  }
  if (nonceStore && (await nonceStore.has(payload.nonce))) {
    return false;
  }
  const payloadBytes = canonicalBytes(payload);
  const valid = Boolean(
    await verifier.verify(
      payloadBytes,
      hexToBytes(envelope.signatureHex),
      { ...header, publicKeyHex: signerKey },
      payload,
    ),
  );
  if (valid && nonceStore) {
    await nonceStore.add(payload.nonce, payload.expiresAt);
  }
  return valid;
}

/**
 * Check a deployment authorization's claims against what is being deployed.
 * `verified` must be the result of verifyAuthorization for this envelope
 * (SEC-058): this function checks claims, never signatures, so it refuses to
 * run on an envelope nobody verified. A target id or audience the caller
 * expects must be present in the payload, not merely "not different".
 */
export function assertDeploymentAuthorization({
  envelope,
  verified,
  artifact,
  target,
  requiredCapabilities = [],
  now = Date.now(),
}) {
  if (verified !== true) {
    throw new Error(
      "Deployment authorization has not been verified (pass verified: true from verifyAuthorization).",
    );
  }
  const payload = envelope?.payload;
  if (!payload) {
    throw new Error("Deployment authorization envelope is missing payload.");
  }
  if (payload.action !== "deploy-flow") {
    throw new Error(`Unexpected authorization action "${payload.action}".`);
  }
  if (typeof payload.expiresAt !== "number" || payload.expiresAt < now) {
    throw new Error("Deployment authorization has expired or has no expiry.");
  }
  if (artifact?.artifactId && payload.artifactId !== artifact.artifactId) {
    throw new Error("Deployment authorization artifactId mismatch.");
  }
  if (artifact?.programId && payload.programId !== artifact.programId) {
    throw new Error("Deployment authorization programId mismatch.");
  }
  if (artifact?.graphHash && payload.graphHash !== artifact.graphHash) {
    throw new Error("Deployment authorization graphHash mismatch.");
  }
  if (artifact?.manifestHash && payload.manifestHash !== artifact.manifestHash) {
    throw new Error("Deployment authorization manifestHash mismatch.");
  }

  const normalizedTarget = normalizeTarget(target);
  if (normalizedTarget.id && payload.target?.id !== normalizedTarget.id) {
    throw new Error("Deployment authorization target id mismatch.");
  }
  if (
    normalizedTarget.audience &&
    payload.target?.audience !== normalizedTarget.audience
  ) {
    throw new Error("Deployment authorization target audience mismatch.");
  }

  const granted = new Set(normalizeCapabilityList(payload.capabilities));
  for (const capability of normalizeCapabilityList(requiredCapabilities)) {
    if (!granted.has(capability)) {
      throw new Error(
        `Deployment authorization missing capability "${capability}".`,
      );
    }
  }
  return true;
}

/**
 * verifyAuthorization then assertDeploymentAuthorization, in one call. Throws
 * unless the envelope is signed by a trusted key, fresh, and matches.
 */
export async function verifyDeploymentAuthorization(options = {}) {
  const verified = await verifyAuthorization(options);
  if (!verified) {
    throw new Error("Deployment authorization signature, signer, nonce or lifetime is not valid.");
  }
  return assertDeploymentAuthorization({ ...options, verified });
}
