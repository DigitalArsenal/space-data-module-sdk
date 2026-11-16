import path from "node:path";
import { readFile } from "node:fs/promises";
import { bytesToHex } from "../utils/encoding.js";
import { sha256Bytes } from "../utils/crypto.js";
import { parseWasmModuleSections } from "../bundle/wasm.js";

const NAME = /^[A-Za-z][A-Za-z0-9._-]*$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const NAMESPACE = /^sdm_lib_[A-Za-z0-9_]+_$/;

/** The same byte, hash and metadata contract applies to MODULE and FLOW inputs. */
export async function verifyGuestLinkLibrary(library, { requireKind = false } = {}) {
  const label = `Guest-link library "${library?.name ?? "unnamed"}"`;
  if (!NAME.test(library?.name ?? "") || !VERSION.test(library?.version ?? "") ||
      !NAMESPACE.test(library?.namespace ?? "") ||
      !["c", "c++", "fortran"].includes(library?.language)) {
    throw new Error(`${label} has invalid name, version, namespace or language.`);
  }
  if (!(library.objectBytes instanceof Uint8Array) || !library.objectBytes.length) {
    throw new Error(`${label} needs nonempty objectBytes.`);
  }
  const objectBytes = new Uint8Array(library.objectBytes);
  const sha256 = bytesToHex(await sha256Bytes(objectBytes));
  if (sha256 !== library.sha256) {
    throw new Error(`${label} SHA-256 mismatch: expected ${library.sha256}, received ${sha256}.`);
  }
  const archive = new TextDecoder().decode(objectBytes.subarray(0, 8)) === "!<arch>\n";
  const kind = library.kind ?? (requireKind ? null : archive ? "archive" : "wasm-object");
  if (!["wasm-object", "archive"].includes(kind) || archive !== (kind === "archive")) {
    throw new Error(`${label} kind must match its bytes (wasm-object or archive).`);
  }
  if (kind === "wasm-object") {
    try {
      const parsed = parseWasmModuleSections(objectBytes);
      if (!parsed.sections.some(section => section.id === 0 && section.name === "linking")) {
        throw new Error("missing relocatable linking section");
      }
    } catch (error) {
      throw new Error(`${label} is not a relocatable wasm object: ${error.message}`, { cause: error });
    }
  }
  return { ...library, kind, sha256, objectBytes };
}

// Same names identify the same bytes. Namespaces also cannot alias different bytes.
// First-use order preserves archive dependency ordering.
export function collectGuestLinkLibraries(libraries) {
  const byName = new Map();
  const byNamespace = new Map();
  const unique = [];
  for (const library of libraries) {
    for (const prior of [byName.get(library.name), byNamespace.get(library.namespace)]) {
      if (prior && prior.sha256 !== library.sha256) {
        throw new Error(`Conflicting guest-link library "${library.name}": ${prior.sha256} and ${library.sha256} (namespace ${library.namespace}).`);
      }
    }
    if (!byName.has(library.name) && !byNamespace.has(library.namespace)) {
      unique.push(library);
    }
    byName.set(library.name, library);
    byNamespace.set(library.namespace, library);
  }
  return unique;
}

export async function normalizePrebuiltLibraries(libraries) {
  if (libraries == null) return [];
  if (!Array.isArray(libraries)) throw new Error("prebuiltLibraries must be an array.");
  const verified = [];
  for (const library of libraries) verified.push(await verifyGuestLinkLibrary(library, { requireKind: true }));
  return collectGuestLinkLibraries(verified);
}

export async function readGuestLinkLibraries(guestLink, pluginId) {
  const listed = guestLink.metadata?.libraries;
  if (listed == null) return [];
  if (!Array.isArray(listed)) {
    throw new Error(`Plugin "${pluginId}": guest-link metadata.libraries must be an array.`);
  }
  const libraries = [];
  for (const library of listed) {
    const file = String(library?.file ?? "");
    const resolved = path.resolve(guestLink.guestLinkDir, file);
    if (!file || !resolved.startsWith(guestLink.guestLinkDir + path.sep)) {
      throw new Error(`Plugin "${pluginId}": guest-link library ${JSON.stringify(library?.name)} has no file inside its guest-link dir.`);
    }
    try {
      libraries.push(await verifyGuestLinkLibrary({ ...library, objectBytes: new Uint8Array(await readFile(resolved)) }));
    } catch (error) {
      throw new Error(`Plugin "${pluginId}" library "${library?.name}": ${error.message}`, { cause: error });
    }
  }
  return collectGuestLinkLibraries(libraries);
}

export async function collectFlowLibraryObjects(linkedDependencies) {
  const libraries = [];
  for (const dependency of linkedDependencies) {
    for (const library of dependency.guestLink?.libraries ?? []) {
      libraries.push(await verifyGuestLinkLibrary(library));
    }
  }
  return collectGuestLinkLibraries(libraries);
}

export function guestLinkLibraryEntries(libraries = []) {
  return libraries.map(({ objectBytes, name, version, language, namespace, sha256, kind }) => ({
    objectBytes,
    metadata: {
      name, version, language, namespace, sha256,
      ...(kind ? { kind } : {}),
      file: `libraries/${name}-${version}-${sha256.slice(0, 12)}.${kind === "archive" ? "a" : "o"}`,
    },
  }));
}

export function withLibraryContext(error, libraries) {
  if (!libraries?.length) return error;
  const wrapped = new Error(`${error.message}\nGuest-link libraries: ${libraries.map(library => JSON.stringify(library.name)).join(", ")}.`, { cause: error });
  if (error.report) wrapped.report = error.report;
  return wrapped;
}
