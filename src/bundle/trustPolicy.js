/**
 * Fail-closed module trust policy (security audit 2026-10-15: SEC-008, SEC-005).
 *
 * `verifyModuleArtifact` answers "is this signature valid, and is its signer in
 * this list?". It does not decide whether an UNSIGNED artifact may run, and its
 * legacy policy resolver turns a configured trust set into
 * `requireSignature: false` and silently drops malformed keys. This module is
 * the policy layer that load paths put in front of it:
 *
 *  - A configured trust set ALWAYS requires a signature. The only way to load
 *    an unsigned module is the explicit `verifySignature: false` opt-out.
 *  - Trusted keys are parsed strictly. An entry that is not 64 hex characters
 *    (after an optional `0x`) is an error, never dropped; a source that is
 *    configured but yields no key is an error, never "no policy".
 *  - Nothing configured anywhere is an error (`no_trust_policy`), not "load
 *    unverified".
 *  - The result must say `verified === true` and `signed === true`.
 *  - Signer keys on the hard denylist are refused. Today that is the
 *    development signer whose private seed is committed to this public
 *    repository (`test/support/dev-module-signing-keypair.json`). Tests that
 *    sign with that fixture on purpose pass `allowDevFixture: true`; nothing
 *    sets it by default.
 */

import { ModuleSignatureError, verifyModuleArtifact } from "./signing.js";

/**
 * Ed25519 public keys that never sign a module this SDK will trust.
 *
 * cf462579…fe78 is the development signer whose private seed is committed in
 * this public repository. Anyone can sign with it, so a signature from it
 * proves nothing.
 */
export const DENYLISTED_MODULE_SIGNER_PUBLIC_KEYS = Object.freeze([
  "cf4625795484d8efe18860141cfdeaaaed7bbee9209488405b6ddeac7543fe78",
]);

const DENYLIST = new Set(DENYLISTED_MODULE_SIGNER_PUBLIC_KEYS);

export function isDenylistedModuleSigner(publicKeyHex) {
  return DENYLIST.has(String(publicKeyHex ?? "").trim().toLowerCase());
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
 * Parse a trusted-signer list strictly.
 *
 * Accepts an array of keys or one string of keys separated by commas,
 * semicolons or whitespace. Each key is 64 hex characters, optionally with a
 * `0x` prefix. Anything else throws `invalid_trusted_key`. An empty result
 * throws too, because a trust source that was configured but holds no key is
 * a misconfiguration, never "no policy".
 *
 * @param {string|string[]} value
 * @param {{source?: string, allowDevFixture?: boolean}} [options]
 * @returns {string[]} lowercase 64-hex keys, de-duplicated
 */
export function parseTrustedModuleSigners(value, options = {}) {
  const source = options.source ?? "trustedPublicKeys";
  let entries;
  if (Array.isArray(value)) {
    entries = value;
  } else if (typeof value === "string") {
    entries = value.split(/[\s,;]+/);
  } else {
    throw new ModuleSignatureError(
      "invalid_trusted_key",
      `${source} must be a string or an array of 64-hex Ed25519 public keys`,
    );
  }
  const keys = [];
  entries.forEach((entry, index) => {
    if (typeof entry !== "string") {
      throw new ModuleSignatureError(
        "invalid_trusted_key",
        `${source}[${index}] is not a string`,
      );
    }
    let key = entry.trim().toLowerCase();
    if (key === "" && !Array.isArray(value)) return; // separator run in a string list
    if (key.startsWith("0x")) key = key.slice(2);
    if (!/^[0-9a-f]{64}$/.test(key)) {
      throw new ModuleSignatureError(
        "invalid_trusted_key",
        `${source}[${index}] is not a 64-hex Ed25519 public key (length ${key.length})`,
      );
    }
    if (DENYLIST.has(key) && options.allowDevFixture !== true) {
      throw new ModuleSignatureError(
        "denylisted_signer",
        `${source}[${index}] is the public development signer, whose private key is published; it cannot be trusted`,
      );
    }
    if (!keys.includes(key)) keys.push(key);
  });
  if (keys.length === 0) {
    throw new ModuleSignatureError(
      "invalid_trusted_key",
      `${source} is configured but contains no trusted key`,
    );
  }
  return keys;
}

/**
 * Resolve the trust policy a load path enforces.
 *
 * Sources, first match wins: `options.verifySignature` (object), then the
 * `SDM_TRUSTED_MODULE_SIGNERS` environment variable, then
 * `globalThis.__SDM_TRUSTED_MODULE_SIGNERS__`.
 *
 * @returns {{trustedPublicKeys: string[], requireSignature: true, allowDevFixture: boolean} | null}
 *   null ONLY for an explicit `verifySignature: false` (local debugging). With
 *   nothing configured it throws `no_trust_policy`.
 */
export function resolveTrustedModuleSignaturePolicy(options = {}) {
  if (options.verifySignature === false) {
    return null;
  }
  const allowDevFixture =
    options.allowDevFixture === true ||
    (options.verifySignature &&
      typeof options.verifySignature === "object" &&
      options.verifySignature.allowDevFixture === true);
  if (options.verifySignature && typeof options.verifySignature === "object") {
    if (options.verifySignature.requireSignature === false) {
      throw new ModuleSignatureError(
        "invalid_trust_policy",
        "a trust policy always requires a signature; use verifySignature: false to load unverified bytes for local debugging",
      );
    }
    return {
      trustedPublicKeys: parseTrustedModuleSigners(
        options.verifySignature.trustedPublicKeys ?? [],
        { source: "verifySignature.trustedPublicKeys", allowDevFixture },
      ),
      requireSignature: true,
      allowDevFixture,
    };
  }
  if (options.verifySignature !== undefined && options.verifySignature !== null && options.verifySignature !== true) {
    throw new ModuleSignatureError(
      "invalid_trust_policy",
      "verifySignature must be an object {trustedPublicKeys} or false",
    );
  }
  const envTrusted = readEnv("SDM_TRUSTED_MODULE_SIGNERS");
  if (envTrusted !== undefined) {
    return {
      trustedPublicKeys: parseTrustedModuleSigners(envTrusted, {
        source: "SDM_TRUSTED_MODULE_SIGNERS",
        allowDevFixture,
      }),
      requireSignature: true,
      allowDevFixture,
    };
  }
  const globalTrusted = globalThis.__SDM_TRUSTED_MODULE_SIGNERS__;
  if (globalTrusted !== undefined && globalTrusted !== null) {
    return {
      trustedPublicKeys: parseTrustedModuleSigners(globalTrusted, {
        source: "__SDM_TRUSTED_MODULE_SIGNERS__",
        allowDevFixture,
      }),
      requireSignature: true,
      allowDevFixture,
    };
  }
  throw new ModuleSignatureError(
    "no_trust_policy",
    "no trusted module signers are configured (verifySignature.trustedPublicKeys, SDM_TRUSTED_MODULE_SIGNERS or __SDM_TRUSTED_MODULE_SIGNERS__); refusing to load an unverified module",
  );
}

/**
 * Verify an artifact under a resolved policy and return the verification only
 * when it proves a trusted signature: `verified === true`, `signed === true`,
 * and a signer that is not denylisted. Everything else throws.
 *
 * @param {Uint8Array|ArrayBuffer} bytes
 * @param {{trustedPublicKeys: string[], allowDevFixture?: boolean}} policy
 */
export async function verifyTrustedModuleArtifact(bytes, policy) {
  if (!policy || !Array.isArray(policy.trustedPublicKeys) || policy.trustedPublicKeys.length === 0) {
    throw new ModuleSignatureError(
      "no_trust_policy",
      "verifyTrustedModuleArtifact requires a policy with at least one trusted key",
    );
  }
  const trustedPublicKeys = parseTrustedModuleSigners(policy.trustedPublicKeys, {
    source: "policy.trustedPublicKeys",
    allowDevFixture: policy.allowDevFixture === true,
  });
  const result = await verifyModuleArtifact(bytes, {
    trustedPublicKeys,
    requireSignature: true,
  });
  if (result?.verified !== true || result?.signed !== true) {
    throw new ModuleSignatureError(
      "unverified",
      `module artifact did not verify (${result?.reason ?? "no verified signature"})`,
    );
  }
  if (isDenylistedModuleSigner(result.publicKeyHex) && policy.allowDevFixture !== true) {
    throw new ModuleSignatureError(
      "denylisted_signer",
      "module artifact is signed by the public development signer, whose private key is published",
    );
  }
  return result;
}
