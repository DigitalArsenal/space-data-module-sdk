// The on-disk guest-link layout a flow links (src/flow/flowCompiler.js reads it):
//
//   <dir>/module-link.o                    the prefixed guest-link object
//   <dir>/metadata.json                    format, language, threadModel, symbolPrefix, methodSymbols
//                                          (+ libraries, below)
//   <dir>/libraries/<name>-<version>-<sha12>.o
//                                          each shared library object the module links
//                                          (compile option `libraries`), listed in
//                                          metadata.libraries as { name, version, language,
//                                          namespace, sha256, file }
//
// metadata.version is 1 without libraries (the layout module build scripts have
// always written) and 2 with them: a flow compiler that does not link library
// objects must not take such a module.

import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";

/**
 * Write a compilation's guest-link object, its library objects and
 * metadata.json into `dir` (usually `<package>/dist/guest-link`). `metadata`
 * adds fields to metadata.json. Returns the metadata written.
 */
export async function writeGuestLinkFiles(compilation, dir, metadata = {}) {
  const guestLink = compilation?.guestLink;
  if (!guestLink?.objectBytes?.length) {
    throw new Error("writeGuestLinkFiles needs a compilation with a guest-link object.");
  }
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "module-link.o"), guestLink.objectBytes);
  const libraries = Array.isArray(guestLink.libraries) ? guestLink.libraries : [];
  const librariesDir = path.join(dir, "libraries");
  await rm(librariesDir, { recursive: true, force: true });
  const libraryEntries = [];
  for (const library of libraries) {
    const file = `libraries/${library.name}-${library.version}-${library.sha256.slice(0, 12)}.o`;
    await mkdir(librariesDir, { recursive: true });
    await writeFile(path.join(dir, file), library.objectBytes);
    libraryEntries.push({
      name: library.name,
      version: library.version,
      language: library.language,
      namespace: library.namespace,
      sha256: library.sha256,
      file,
    });
  }
  const written = {
    version: libraryEntries.length > 0 ? 2 : 1,
    format: guestLink.format,
    language: guestLink.language,
    threadModel: guestLink.threadModel,
    symbolPrefix: guestLink.symbolPrefix,
    methodSymbols: guestLink.methodSymbols,
    ...(libraryEntries.length > 0 ? { libraries: libraryEntries } : {}),
    ...metadata,
  };
  await writeFile(path.join(dir, "metadata.json"), `${JSON.stringify(written, null, 2)}\n`);
  return written;
}
