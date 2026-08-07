/**
 * Standards catalog — NODE leg (the `default` condition of `./standards`).
 *
 * Reads the pinned `spacedatastandards.org` manifest off disk. Everything the
 * catalog is then USED for lives in `catalogCore.js` and is shared with the
 * browser leg, so a manifest validated here and a manifest validated in a
 * browser produce the same issues in the same order.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import {
  buildStandardsCatalog,
  validateManifestAgainstCatalog,
  withSharedModuleCatalog,
} from "./catalogCore.js";

export {
  buildStandardsCatalog,
  resolveStandardsTypeRef,
  validateManifestAgainstCatalog,
  withSharedModuleCatalog,
} from "./catalogCore.js";

const require = createRequire(import.meta.url);
const standardsCatalogPromises = new Map();
const knownTypeCatalogPromises = new Map();

function resolveStandardsManifestPath(options = {}) {
  const standardsRoot =
    options.standardsRoot ?? process.env.SPACE_DATA_STANDARDS_ROOT;
  if (typeof standardsRoot === "string" && standardsRoot.trim().length > 0) {
    return path.join(standardsRoot, "dist", "manifest.json");
  }

  const packageEntry = require.resolve("spacedatastandards.org");
  return path.join(path.dirname(packageEntry), "dist", "manifest.json");
}

export async function loadStandardsCatalog(options = {}) {
  const manifestPath = resolveStandardsManifestPath(options);
  if (!standardsCatalogPromises.has(manifestPath)) {
    standardsCatalogPromises.set(
      manifestPath,
      (async () =>
        buildStandardsCatalog(
          JSON.parse(await readFile(manifestPath, "utf8")),
        ))(),
    );
  }
  return standardsCatalogPromises.get(manifestPath);
}

export async function loadKnownTypeCatalog(options = {}) {
  const manifestPath = resolveStandardsManifestPath(options);
  if (!knownTypeCatalogPromises.has(manifestPath)) {
    knownTypeCatalogPromises.set(
      manifestPath,
      loadStandardsCatalog(options).then(withSharedModuleCatalog),
    );
  }
  return knownTypeCatalogPromises.get(manifestPath);
}

export async function validateManifestAgainstStandardsCatalog(
  manifest,
  options = {},
) {
  const catalog = options.catalog ?? (await loadKnownTypeCatalog(options));
  return validateManifestAgainstCatalog(catalog, manifest, options);
}
