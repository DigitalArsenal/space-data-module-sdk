import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import { sharedModuleCatalog } from "./sharedCatalog.js";
import { normalizePayloadSchemaHash } from "../manifest/typeRefs.js";

const require = createRequire(import.meta.url);
const standardsCatalogPromises = new Map();
const knownTypeCatalogPromises = new Map();
const requiredCurrentScvTokens = Object.freeze([
  "SENSOR_LOCAL",
  "table SCVResult",
  "table SCVSensorShapeContract",
  "SAR_ANNULAR_SECTOR",
  "enum scvSensorRangeBoundaryKind",
  "table SCVAggregateStatistics",
  "AGGREGATE_STATISTICS:SCVAggregateStatistics",
  "table SCVPackedRasterProducts",
  "table SCVPackedRasterBand",
  "RASTER_PRODUCTS:SCVPackedRasterProducts",
  "enum scvRasterProductKind",
]);
const currentScvResultFields = Object.freeze(
  new Set([
    "JOB_ID",
    "TRACE_ID",
    "STATUS",
    "TIME_GRID",
    "TARGET_BODY",
    "TOTAL_SENSORS",
    "TOTAL_WINDOWS",
    "CELL_STATS",
    "INTERVALS",
    "LATITUDE_BANDS",
    "TIME_SERIES",
    "HISTOGRAMS",
    "CONTRIBUTIONS",
    "GEOMETRY",
    "RASTER_PRODUCTS",
    "MESSAGE",
    "AGGREGATE_STATISTICS",
    "TARGET_RESULTS",
  ]),
);

function collectFlatbufferTableFields(idl, tableName) {
  const match = String(idl ?? "").match(
    new RegExp(`\\btable\\s+${tableName}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"),
  );
  if (!match) {
    return [];
  }
  return match[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .map((line) => line.match(/^([A-Z0-9_]+)\s*:/)?.[1] ?? null)
    .filter(Boolean);
}

function resolveStandardsManifestPath(options = {}) {
  const standardsRoot =
    options.standardsRoot ?? process.env.SPACE_DATA_STANDARDS_ROOT;
  if (typeof standardsRoot === "string" && standardsRoot.trim().length > 0) {
    return path.join(standardsRoot, "dist", "manifest.json");
  }

  const packageEntry = require.resolve("spacedatastandards.org");
  return path.join(path.dirname(packageEntry), "dist", "manifest.json");
}

function normalizeSchemaName(value) {
  return value === undefined || value === null ? "" : String(value);
}

function normalizeFileIdentifier(value) {
  return value === undefined || value === null ? "" : String(value);
}

function parseStandardsEntry([schemaCode, entry]) {
  const idl = String(entry?.IDL ?? "");
  const fileIdentifierMatch = idl.match(/file_identifier\s+"([^"]+)"/i);
  const hashMatch = idl.match(/\/\/ Hash:\s*([a-f0-9]+)/i);
  const versionMatch = idl.match(/\/\/ Version:\s*([^\n]+)/i);
  const rootTypeMatch = idl.match(/root_type\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/i);
  return {
    schemaCode: schemaCode.toUpperCase(),
    schemaName: `${schemaCode.toUpperCase()}.fbs`,
    fileIdentifier: fileIdentifierMatch
      ? normalizeFileIdentifier(fileIdentifierMatch[1])
      : null,
    hash: hashMatch ? hashMatch[1].toLowerCase() : null,
    rootTypeName: rootTypeMatch ? rootTypeMatch[1] : null,
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
  const unsupportedResultFields = collectFlatbufferTableFields(
    scvEntry.idl,
    "SCVResult",
  ).filter((field) => !currentScvResultFields.has(field));
  if (unsupportedResultFields.length > 0) {
    issues.push({
      severity: "error",
      code: "stale-scv-contract",
      message:
        "The loaded spacedatastandards.org SCV catalog contains unsupported " +
        `SCVResult fields that are not part of the current contract: ${unsupportedResultFields.join(", ")}.`,
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
  const schemaName = normalizeSchemaName(typeRef?.schemaName);
  const fileIdentifier = normalizeFileIdentifier(typeRef?.fileIdentifier);
  if (!schemaName && !fileIdentifier) {
    return null;
  }
  return (
    catalog.find(
      (entry) =>
        (!schemaName || normalizeSchemaName(entry.schemaName) === schemaName) &&
        (!fileIdentifier ||
          normalizeFileIdentifier(entry.fileIdentifier) === fileIdentifier),
    ) ?? null
  );
}

function schemaHashMatchesCatalog(typeRefHash, catalogHash) {
  if (typeRefHash === undefined || typeRefHash === null) return true;
  const declared = normalizePayloadSchemaHash(typeRefHash);
  if (!declared) return true;
  const canonical = normalizePayloadSchemaHash(catalogHash);
  if (!canonical || declared.length !== canonical.length) {
    return false;
  }
  return declared.every((byte, index) => byte === canonical[index]);
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
      const schemaName = normalizeSchemaName(typeRef?.schemaName);
      const fileIdentifier = normalizeFileIdentifier(typeRef?.fileIdentifier);
      const partiallyKnown = catalog.some(
        (entry) =>
          (schemaName && normalizeSchemaName(entry.schemaName) === schemaName) ||
          (fileIdentifier &&
            normalizeFileIdentifier(entry.fileIdentifier) === fileIdentifier),
      );
      issues.push({
        severity: "error",
        code: partiallyKnown
          ? "standards-type-identity-mismatch"
          : "unresolved-standards-type",
        message: partiallyKnown
          ? `Type reference from ${source} mixes a known schemaName or exact four-byte fileIdentifier with a different standards entry.`
          : `Type reference from ${source} does not resolve to a known shared-module or \`spacedatastandards.org\` schema by its exact schemaName and fileIdentifier.`,
        location: `${sourceName}.${source}`,
      });
      continue;
    }
    if (
      typeRef?.rootTypeName &&
      resolved.rootTypeName &&
      typeRef.rootTypeName !== resolved.rootTypeName
    ) {
      issues.push({
        severity: "error",
        code: "standards-root-type-mismatch",
        message: `Type reference from ${source} declares rootTypeName ${JSON.stringify(typeRef.rootTypeName)} but the canonical SDS root is ${JSON.stringify(resolved.rootTypeName)}.`,
        location: `${sourceName}.${source}`,
      });
    }
    if (
      typeRef?.schemaVersion &&
      resolved.version &&
      typeRef.schemaVersion !== resolved.version
    ) {
      issues.push({
        severity: "error",
        code: "standards-schema-version-mismatch",
        message: `Type reference from ${source} declares schemaVersion ${JSON.stringify(typeRef.schemaVersion)} but the canonical SDS version is ${JSON.stringify(resolved.version)}.`,
        location: `${sourceName}.${source}`,
      });
    }
    if (
      resolved.hash &&
      !schemaHashMatchesCatalog(typeRef?.schemaHash, resolved.hash)
    ) {
      issues.push({
        severity: "error",
        code: "standards-schema-hash-mismatch",
        message: `Type reference from ${source} declares a schemaHash that differs from the canonical SDS schema hash.`,
        location: `${sourceName}.${source}`,
      });
    }
  }
  return {
    catalog,
    issues,
  };
}
