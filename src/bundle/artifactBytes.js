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
 */

import { extractPublicationRecordCollection } from "../transport/records.js";
import { ModuleSignatureError } from "./signing.js";

/**
 * Reduce a module artifact to the bytes a wasm engine can compile.
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
  if (publication.enc) {
    throw new ModuleSignatureError(
      "encrypted_artifact",
      "Module artifact payload is ENC-protected; decrypt it before loading.",
    );
  }
  return publication.payloadBytes;
}
