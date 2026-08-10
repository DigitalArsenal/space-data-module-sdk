import {
  findManifestFiles,
  getWasmExportNames,
  getWasmExportNamesFromFile,
  hasLegacyPmanManifest,
  loadManifestFromFile,
  loadComplianceConfig,
  locateEmbeddedPlgManifest,
  resolveManifestFiles,
  validatePluginArtifact,
  validatePluginManifest,
} from "./pluginCompliance.js";
import {
  BrowserIncompatibleCapabilityIds,
  EngineHostedCapabilityIds,
  LegIncompatibleCapabilityIds,
  RecommendedCapabilityIds,
  StandaloneWasiCapabilityIds,
  WasmEdgeIncompatibleCapabilityIds,
} from "../capabilities.js";
import { validateManifestAgainstStandardsCatalog } from "../standards/index.js";

function mergeReport(baseReport, issues) {
  const mergedIssues = [...baseReport.issues, ...issues];
  const errors = mergedIssues.filter((issue) => issue.severity === "error");
  const warnings = mergedIssues.filter((issue) => issue.severity === "warning");
  return {
    ...baseReport,
    ok: errors.length === 0,
    issues: mergedIssues,
    errors,
    warnings,
  };
}

export async function validateManifestWithStandards(manifest, options = {}) {
  const baseReport = validatePluginManifest(manifest, options);
  const standards = await validateManifestAgainstStandardsCatalog(
    manifest,
    options,
  );
  return mergeReport(baseReport, standards.issues);
}

export async function validateArtifactWithStandards(options = {}) {
  const baseReport = await validatePluginArtifact(options);
  const standards = await validateManifestAgainstStandardsCatalog(
    options.manifest,
    { ...options, sourceName: baseReport.sourceName },
  );
  return mergeReport(baseReport, standards.issues);
}

export {
  BrowserIncompatibleCapabilityIds,
  EngineHostedCapabilityIds,
  LegIncompatibleCapabilityIds,
  WasmEdgeIncompatibleCapabilityIds,
  findManifestFiles,
  getWasmExportNames,
  getWasmExportNamesFromFile,
  hasLegacyPmanManifest,
  loadManifestFromFile,
  loadComplianceConfig,
  locateEmbeddedPlgManifest,
  RecommendedCapabilityIds,
  StandaloneWasiCapabilityIds,
  resolveManifestFiles,
  validatePluginArtifact,
  validatePluginManifest,
};

export {
  manifestDeclaresHostBoundaryBlindness,
  WildcardJustificationKind,
} from "./pluginCompliance.js";
export {
  isLegacyWildcardPort,
  LegacyWildcardPortLedger,
  LEGACY_WILDCARD_LEDGER_FROZEN_ON,
} from "./legacyWildcardPorts.js";
