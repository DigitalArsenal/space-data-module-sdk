/**
 * Artifact byte reduction — runtime surface, not test-harness surface.
 *
 * A published module artifact is `module.wasm` plus an appended publication
 * record collection (MBL bundle: the sds.signature entry, PNM/REC trailers).
 * EVERY runtime that loads a module — browser, native WasmEdge, Docker
 * WasmEdge — must reduce the artifact to the same canonical payload before it
 * reaches a wasm engine, because every engine rejects the trailing bytes
 * ("unknown section code" / "malformed section id"). Same input bytes in,
 * byte-identical payload out, in all three runtimes.
 *
 * That makes this an ARTIFACT concern and it belongs beside signing and
 * verification, on `space-data-module-sdk/bundle`. It previously lived in
 * `src/testing/browserModuleHarness.js`, which forced production delivery code
 * (OrbPro's SDN module decryptor) to import a TEST-harness subpath to get it —
 * the import that dragged the Node harnesses into a browser bundle and blanked
 * all 275 gallery demos (`orbpro-engine-bundle-ships-node-builtins`).
 *
 * THE ONE LOAD PATH. `openModuleArtifact` is the only function that turns an
 * artifact into bytes an engine may RUN: it checks the signature and strips
 * the trailer in one step, so there is no way to get runnable bytes from a
 * signed artifact without the check having happened. Every SDK loader (browser
 * harness, worker harness, isomorphic loader, module harness, parity harness
 * and gate) goes through it, and `./bundle/stage` writes its output to a
 * private file for engines that only read paths (the WasmEdge CLI and
 * runners, wasmedgec, Docker). The trailer an engine refuses is the tripwire
 * that keeps it that way: a raw consumer that skips this path fails loudly
 * ("malformed section id") instead of running an unchecked signed artifact.
 */

import { extractPublicationRecordCollection } from "../transport/records.js";
import {
  ModuleSignatureError,
  resolveModuleSignaturePolicy,
  verifyModuleArtifact,
  verifyModuleArtifactIntegrity,
} from "./signing.js";

function toArtifactBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  throw new TypeError("module artifact must be a Uint8Array, ArrayBufferView, or ArrayBuffer");
}

function refuseEncrypted(publication) {
  if (publication?.enc) {
    throw new ModuleSignatureError(
      "encrypted_artifact",
      "Module artifact payload is ENC-protected; decrypt it before loading.",
    );
  }
}

/**
 * Reduce a module artifact to the bytes a wasm engine can COMPILE, without
 * checking its signature.
 *
 * For INSPECTION only (listing imports/exports, reading custom sections,
 * hashing the portable payload). Bytes that will be instantiated or run must
 * come from {@link openModuleArtifact}, which checks the signature first.
 *
 * ENC-protected payloads cannot be reduced here — decryption is a host
 * concern, and the caller must decrypt before loading.
 *
 * @param {Uint8Array} bytes - raw artifact bytes
 * @returns {Uint8Array} compilable wasm bytes
 */
export function toLoadableWasmBytes(bytes) {
  const publication = extractPublicationRecordCollection(bytes);
  if (!publication) {
    return bytes;
  }
  refuseEncrypted(publication);
  return publication.payloadBytes;
}

/**
 * Check a module artifact's signature and reduce it to the bytes an engine
 * runs — the ONE path from an artifact to runnable bytes.
 *
 * Policy (the same sources every loader reads, see
 * `resolveModuleSignaturePolicy`: `options.verifySignature`, then
 * `SDM_TRUSTED_MODULE_SIGNERS` / `SDM_REQUIRE_MODULE_SIGNATURE`, then their
 * `globalThis.__SDM_*__` twins):
 *
 *  - A trust policy is configured: the artifact must verify against it
 *    (`verifyModuleArtifact`): a signed artifact must chain to a trusted key,
 *    and with `requireSignature` an unsigned one is refused.
 *  - No trust policy (including `verifySignature: false`): a SIGNED artifact
 *    must still be intact — its signature must verify against the key it
 *    names — so a tampered or re-trailered artifact is refused, never silently
 *    stripped and run. That is integrity, not trust: the result says
 *    `trusted: false`. An unsigned artifact passes through.
 *
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} bytes - the artifact as delivered
 * @param {Object} [options] - loader options carrying `verifySignature`
 * @returns {Promise<{wasmBytes: Uint8Array, verification: Object}>} the
 *   portable payload (a view into `bytes`) and the verification outcome
 */
export async function openModuleArtifact(bytes, options = {}) {
  const artifactBytes = toArtifactBytes(bytes);
  const publication = extractPublicationRecordCollection(artifactBytes);
  refuseEncrypted(publication);
  const policy = resolveModuleSignaturePolicy(options);
  const verification = policy
    ? { trusted: true, ...(await verifyModuleArtifact(artifactBytes, policy)) }
    : await verifyModuleArtifactIntegrity(artifactBytes);
  if (policy && !verification.verified) {
    verification.trusted = false;
  }
  return {
    wasmBytes: publication ? publication.payloadBytes : artifactBytes,
    verification,
  };
}
