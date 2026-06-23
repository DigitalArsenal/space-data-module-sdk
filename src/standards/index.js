import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import { sharedModuleCatalog } from "./sharedCatalog.js";

const require = createRequire(import.meta.url);
const standardsCatalogPromises = new Map();
const knownTypeCatalogPromises = new Map();
const requiredCurrentScvTokens = Object.freeze([
  "SENSOR_LOCAL",
  "table SCVAggregateStatistics",
  "AGGREGATE_STATISTICS:SCVAggregateStatistics",
]);

function resolveStandardsManifestPath(options = {}) {
  const standardsRoot =
    options.standardsRoot ?? process.env.SPACE_DATA_STANDARDS_ROOT;
  if (typeof standardsRoot === "string" && standardsRoot.trim().length > 0) {
    return path.join(standardsRoot, "dist", "manifest.json");
  }

  const packageEntry = require.resolve("spacedatastandards.org");
  return path.join(path.dirname(packageEntry), "dist", "manifest.json");
}

function normalizeSchemaStem(value) {
  const trimmed = String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .pop();
  if (!trimmed) {
    return "";
  }
  const withoutExtension = /\.(bfbs|fbs|json)$/i.test(trimmed)
    ? trimmed.replace(/\.[^.]+$/, "")
    : trimmed;
  return withoutExtension.split(".").pop().toUpperCase();
}

function normalizeFileIdentifier(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\$/, "")
    .toUpperCase();
}

function parseStandardsEntry([schemaCode, entry]) {
  const idl = String(entry?.IDL ?? "");
  const fileIdentifierMatch = idl.match(/file_identifier\s+"([^"]+)"/i);
  const hashMatch = idl.match(/\/\/ Hash:\s*([a-f0-9]+)/i);
  const versionMatch = idl.match(/\/\/ Version:\s*([^\n]+)/i);
  return {
    schemaCode: schemaCode.toUpperCase(),
    schemaName: `${schemaCode.toUpperCase()}.fbs`,
    fileIdentifier: fileIdentifierMatch
      ? normalizeFileIdentifier(fileIdentifierMatch[1])
      : null,
    hash: hashMatch ? hashMatch[1].toLowerCase() : null,
    idl,
    version: versionMatch ? versionMatch[1].trim() : null,
    files: Array.isArray(entry?.files) ? entry.files : [],
  };
}

function validateStandardsCatalogFreshness(catalog, sourceName) {
  const issues = [];
  const scvEntry = catalog.find((entry) => entry.schemaCode === "SCV");
  if (!scvEntry) {
    return issues;
  }
  const missingTokens = requiredCurrentScvTokens.filter(
    (token) => !scvEntry.idl.includes(token),
  );
  if (missingTokens.length > 0) {
    issues.push({
      severity: "error",
      code: "stale-scv-contract",
      message:
        "The loaded spacedatastandards.org SCV catalog is stale and does not " +
        `include required current coverage fields: ${missingTokens.join(", ")}.`,
      location: `${sourceName}.standards.SCV`,
    });
  }
  return issues;
}

export async function loadStandardsCatalog(options = {}) {
  const manifestPath = resolveStandardsManifestPath(options);
  if (!standardsCatalogPromises.has(manifestPath)) {
    standardsCatalogPromises.set(
      manifestPath,
      (async () => {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        return Object.entries(manifest?.STANDARDS ?? {})
          .map(parseStandardsEntry)
          .sort((left, right) => left.schemaCode.localeCompare(right.schemaCode));
      })(),
    );
  }
  return standardsCatalogPromises.get(manifestPath);
}

export async function loadKnownTypeCatalog(options = {}) {
  const manifestPath = resolveStandardsManifestPath(options);
  if (!knownTypeCatalogPromises.has(manifestPath)) {
    knownTypeCatalogPromises.set(
      manifestPath,
      loadStandardsCatalog(options).then((catalog) => [
        ...catalog,
        ...sharedModuleCatalog,
      ]),
    );
  }
  return knownTypeCatalogPromises.get(manifestPath);
}

export function resolveStandardsTypeRef(typeRef, catalog = []) {
  const schemaStem = normalizeSchemaStem(typeRef?.schemaName);
  const fileIdentifier = normalizeFileIdentifier(typeRef?.fileIdentifier);
  if (!schemaStem && !fileIdentifier) {
    return null;
  }
  return (
    catalog.find((entry) => {
      if (schemaStem && entry.schemaCode === schemaStem) {
        return true;
      }
      if (fileIdentifier && entry.fileIdentifier === fileIdentifier) {
        return true;
      }
      return false;
    }) ?? null
  );
}

function collectTypeRefs(manifest) {
  const refs = [];
  for (const method of Array.isArray(manifest?.methods) ? manifest.methods : []) {
    for (const portsKey of ["inputPorts", "outputPorts"]) {
      for (const port of Array.isArray(method?.[portsKey]) ? method[portsKey] : []) {
        for (const typeSet of Array.isArray(port?.acceptedTypeSets)
          ? port.acceptedTypeSets
          : []) {
          for (const allowedType of Array.isArray(typeSet?.allowedTypes)
            ? typeSet.allowedTypes
            : []) {
            refs.push({
              source: `${method?.methodId ?? "method"}.${port?.portId ?? "port"}`,
              typeRef: allowedType,
            });
          }
        }
      }
    }
  }
  for (const typeRef of Array.isArray(manifest?.schemasUsed)
    ? manifest.schemasUsed
    : []) {
    refs.push({
      source: "schemasUsed",
      typeRef,
    });
  }
  return refs;
}

export async function validateManifestAgainstStandardsCatalog(
  manifest,
  options = {},
) {
  const catalog = options.catalog ?? (await loadKnownTypeCatalog(options));
  const sourceName = options.sourceName ?? "manifest";
  const issues = validateStandardsCatalogFreshness(catalog, sourceName);
  for (const { source, typeRef } of collectTypeRefs(manifest)) {
    if (typeRef?.acceptsAnyFlatbuffer === true) {
      continue;
    }
    const resolved = resolveStandardsTypeRef(typeRef, catalog);
    if (!resolved) {
      issues.push({
        severity: "warning",
        code: "unresolved-standards-type",
        message:
          `Type reference from ${source} does not resolve to a known ` +
          "shared-module or `spacedatastandards.org` schema by schemaName " +
          "or fileIdentifier.",
        location: `${sourceName}.${source}`,
      });
    }
  }
  return {
    catalog,
    issues,
  };
}
