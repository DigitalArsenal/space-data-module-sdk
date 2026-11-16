import path from "node:path";
import { readFile } from "node:fs/promises";
import { bytesToHex } from "../utils/encoding.js";
import { sha256Bytes } from "../utils/crypto.js";

export async function readGuestLinkLibraries(guestLink, pluginId) {
  const listed = guestLink.metadata?.libraries;
  if (listed === undefined || listed === null) return [];
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
    if (!/^sdm_lib_[A-Za-z0-9_]+_$/.test(String(library?.namespace ?? ""))) {
      throw new Error(`Plugin "${pluginId}": guest-link library ${JSON.stringify(library?.name)} has no sdm_lib_ namespace.`);
    }
    const objectBytes = new Uint8Array(await readFile(resolved));
    const sha256 = bytesToHex(await sha256Bytes(objectBytes));
    if (sha256 !== library.sha256) {
      throw new Error(
        `Plugin "${pluginId}": guest-link library ${file} hashes to ${sha256}, but its metadata records ${library.sha256}.`,
      );
    }
    libraries.push({ ...library, objectBytes });
  }
  return libraries;
}

// Each shared library namespace once, in first-use order. A namespace is the
// library's name, version and a digest of its source, defines, flags and
// toolchain kind, so two modules carrying the same namespace carry the same
// library and the flow links one copy of it.
export function collectFlowLibraryObjects(linkedDependencies) {
  const byNamespace = new Map();
  for (const dependency of linkedDependencies) {
    for (const library of dependency.guestLink?.libraries ?? []) {
      if (!byNamespace.has(library.namespace)) byNamespace.set(library.namespace, library);
    }
  }
  return Array.from(byNamespace.values());
}

