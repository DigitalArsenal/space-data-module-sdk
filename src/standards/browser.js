/**
 * Standards catalog — BROWSER leg (the `browser` condition of `./standards`).
 *
 * Same catalog, same validation verdicts as the Node leg; only acquisition
 * differs, and that difference is absorbed here rather than by a runtime check
 * inside shared code. A browser has no `require.resolve` and no readFile, so
 * the manifest must be handed in or fetched:
 *
 *   loadStandardsCatalog({ manifest })     // already-parsed manifest.json
 *   loadStandardsCatalog({ manifestUrl })  // fetched, then parsed
 *
 * Neither one supplied is a caller defect, not a fallback: it throws. Silently
 * returning an empty catalog would let a browser "validate" a manifest against
 * nothing and agree with a Node run that actually checked it — exactly the kind
 * of quiet divergence the tri-runtime contract exists to forbid.
 */

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

const standardsCatalogPromises = new Map();
const knownTypeCatalogPromises = new Map();

function catalogCacheKey(options) {
  if (typeof options?.manifestUrl === "string" && options.manifestUrl) {
    return `url:${options.manifestUrl}`;
  }
  return null;
}

async function readManifest(options) {
  if (options?.manifest && typeof options.manifest === "object") {
    return options.manifest;
  }
  if (typeof options?.manifestUrl === "string" && options.manifestUrl) {
    const response = await fetch(options.manifestUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch the spacedatastandards.org manifest from ${options.manifestUrl}: ${response.status}`,
      );
    }
    return response.json();
  }
  throw new Error(
    "The browser standards catalog needs the spacedatastandards.org manifest: " +
      "pass { manifest } (already parsed) or { manifestUrl } (fetched). " +
      "There is no on-disk manifest to read in a browser.",
  );
}

export async function loadStandardsCatalog(options = {}) {
  const key = catalogCacheKey(options);
  if (key === null) {
    return buildStandardsCatalog(await readManifest(options));
  }
  if (!standardsCatalogPromises.has(key)) {
    standardsCatalogPromises.set(
      key,
      (async () => buildStandardsCatalog(await readManifest(options)))(),
    );
  }
  return standardsCatalogPromises.get(key);
}

export async function loadKnownTypeCatalog(options = {}) {
  const key = catalogCacheKey(options);
  if (key === null) {
    return withSharedModuleCatalog(await loadStandardsCatalog(options));
  }
  if (!knownTypeCatalogPromises.has(key)) {
    knownTypeCatalogPromises.set(
      key,
      loadStandardsCatalog(options).then(withSharedModuleCatalog),
    );
  }
  return knownTypeCatalogPromises.get(key);
}

export async function validateManifestAgainstStandardsCatalog(
  manifest,
  options = {},
) {
  const catalog = options.catalog ?? (await loadKnownTypeCatalog(options));
  return validateManifestAgainstCatalog(catalog, manifest, options);
}
