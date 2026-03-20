import {
  decodeModuleBundleEntryPayload,
  findModuleBundleEntry,
} from "../bundle/codec.js";
import {
  SDS_DEPLOYMENT_ENTRY_ID,
  SDS_DEPLOYMENT_MEDIA_TYPE,
  SDS_DEPLOYMENT_SECTION_NAME,
} from "../bundle/constants.js";
import { ProtocolRole, ProtocolTransportKind } from "../runtime/constants.js";

export const DEPLOYMENT_PLAN_FORMAT_VERSION = 1;

export const InputBindingSourceKind = Object.freeze({
  PUBSUB: "pubsub",
  PROTOCOL_STREAM: "protocol-stream",
  CATALOG_SYNC: "catalog-sync",
});

const InputBindingSourceKindSet = new Set(Object.values(InputBindingSourceKind));
const ProtocolRoleSet = new Set(Object.values(ProtocolRole));
const ProtocolTransportKindSet = new Set(Object.values(ProtocolTransportKind));

function normalizeString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value === true;
}

function normalizeInteger(value, fallback = 0) {
  const normalized = Number(value ?? fallback);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(normalized));
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeString(entry))
    .filter((entry) => entry !== null);
}

export function normalizeProtocolTransportKindName(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (normalized === "websocket") {
    return ProtocolTransportKind.WS;
  }
  if (normalized === "pipe") {
    return ProtocolTransportKind.WASI_PIPE;
  }
  return normalized.length > 0 ? normalized : null;
}

export function normalizeProtocolRoleName(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (normalized === "handler") {
    return ProtocolRole.HANDLE;
  }
  return normalized.length > 0 ? normalized : null;
}

export function normalizeInputBindingSourceKindName(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  return normalized.length > 0 ? normalized : null;
}

function normalizeProtocolInstallation(value = {}) {
  return {
    protocolId: normalizeString(value.protocolId),
    wireId: normalizeString(value.wireId),
    transportKind: normalizeProtocolTransportKindName(value.transportKind),
    role: normalizeProtocolRoleName(value.role),
    peerId: normalizeString(value.peerId),
    listenMultiaddrs: normalizeStringArray(value.listenMultiaddrs),
    advertisedMultiaddrs: normalizeStringArray(value.advertisedMultiaddrs),
    nodeInfoUrl: normalizeString(value.nodeInfoUrl),
    serviceName: normalizeString(value.serviceName),
    resolvedPort: normalizeInteger(value.resolvedPort),
    artifactCid: normalizeString(value.artifactCid),
    description: normalizeString(value.description),
  };
}

function normalizeInputBinding(value = {}) {
  return {
    bindingId: normalizeString(value.bindingId),
    targetPluginId: normalizeString(value.targetPluginId),
    targetMethodId: normalizeString(value.targetMethodId),
    targetInputPortId: normalizeString(value.targetInputPortId),
    sourceKind: normalizeInputBindingSourceKindName(value.sourceKind),
    topic: normalizeString(value.topic),
    wireId: normalizeString(value.wireId),
    nodeInfoUrl: normalizeString(value.nodeInfoUrl),
    multiaddrs: normalizeStringArray(value.multiaddrs),
    allowPeerIds: normalizeStringArray(value.allowPeerIds),
    allowServerKeys: normalizeStringArray(value.allowServerKeys),
    deliveryMode: normalizeString(value.deliveryMode),
    description: normalizeString(value.description),
  };
}

export function normalizeDeploymentPlan(value = {}) {
  return {
    formatVersion: normalizeInteger(
      value.formatVersion,
      DEPLOYMENT_PLAN_FORMAT_VERSION,
    ),
    pluginId: normalizeString(value.pluginId),
    version: normalizeString(value.version),
    artifactCid: normalizeString(value.artifactCid),
    bundleCid: normalizeString(value.bundleCid),
    environmentId: normalizeString(value.environmentId),
    protocolInstallations: Array.isArray(value.protocolInstallations)
      ? value.protocolInstallations.map((entry) =>
          normalizeProtocolInstallation(entry),
        )
      : [],
    inputBindings: Array.isArray(value.inputBindings)
      ? value.inputBindings.map((entry) => normalizeInputBinding(entry))
      : [],
  };
}

function createIssue(severity, code, message, location) {
  return { severity, code, message, location };
}

function pushIssue(issues, severity, code, message, location) {
  issues.push(createIssue(severity, code, message, location));
}

function validateStringField(issues, value, location, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    pushIssue(
      issues,
      "error",
      "missing-string",
      `${label} must be a non-empty string.`,
      location,
    );
    return false;
  }
  return true;
}

function validateOptionalStringField(issues, value, location, label) {
  if (value === undefined || value === null) {
    return true;
  }
  return validateStringField(issues, value, location, label);
}

function validateStringArrayField(issues, value, location, label) {
  if (!Array.isArray(value)) {
    pushIssue(
      issues,
      "error",
      "invalid-string-array",
      `${label} must be an array of non-empty strings.`,
      location,
    );
    return false;
  }
  let valid = true;
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      valid = false;
      pushIssue(
        issues,
        "error",
        "invalid-string-array-entry",
        `${label} entries must be non-empty strings.`,
        `${location}[${index}]`,
      );
    }
  });
  return valid;
}

function validatePortField(issues, value, location, label) {
  if (value === undefined || value === null) {
    return true;
  }
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    pushIssue(
      issues,
      "error",
      "invalid-port",
      `${label} must be an integer between 0 and 65535 when present.`,
      location,
    );
    return false;
  }
  return true;
}

function roleIncludesRole(declaredRole, runtimeRole) {
  if (declaredRole === runtimeRole) {
    return true;
  }
  return declaredRole === ProtocolRole.BOTH;
}

function buildMethodLookup(manifest) {
  const lookup = new Map();
  if (!Array.isArray(manifest?.methods)) {
    return lookup;
  }
  for (const method of manifest.methods) {
    if (typeof method?.methodId === "string" && method.methodId.trim().length > 0) {
      lookup.set(method.methodId, method);
    }
  }
  return lookup;
}

function validateProtocolInstallation(
  installation,
  issues,
  location,
  manifestProtocolLookup,
) {
  if (!installation || typeof installation !== "object" || Array.isArray(installation)) {
    pushIssue(
      issues,
      "error",
      "invalid-protocol-installation",
      "Protocol installation entries must be objects.",
      location,
    );
    return;
  }
  const protocolIdValid = validateStringField(
    issues,
    installation.protocolId,
    `${location}.protocolId`,
    "Protocol installation protocolId",
  );
  validateStringField(
    issues,
    installation.wireId,
    `${location}.wireId`,
    "Protocol installation wireId",
  );
  const transportKind = normalizeProtocolTransportKindName(
    installation.transportKind,
  );
  if (
    validateStringField(
      issues,
      installation.transportKind,
      `${location}.transportKind`,
      "Protocol installation transportKind",
    ) &&
    !ProtocolTransportKindSet.has(transportKind)
  ) {
    pushIssue(
      issues,
      "error",
      "unknown-protocol-transport-kind",
      `Protocol installation transportKind must be one of: ${Array.from(
        ProtocolTransportKindSet,
      ).join(", ")}.`,
      `${location}.transportKind`,
    );
  }
  const role = normalizeProtocolRoleName(installation.role);
  if (
    validateStringField(
      issues,
      installation.role,
      `${location}.role`,
      "Protocol installation role",
    ) &&
    !ProtocolRoleSet.has(role)
  ) {
    pushIssue(
      issues,
      "error",
      "unknown-protocol-role",
      `Protocol installation role must be one of: ${Array.from(
        ProtocolRoleSet,
      ).join(", ")}.`,
      `${location}.role`,
    );
  }
  validateOptionalStringField(
    issues,
    installation.peerId,
    `${location}.peerId`,
    "Protocol installation peerId",
  );
  validateStringArrayField(
    issues,
    installation.listenMultiaddrs,
    `${location}.listenMultiaddrs`,
    "Protocol installation listenMultiaddrs",
  );
  validateStringArrayField(
    issues,
    installation.advertisedMultiaddrs,
    `${location}.advertisedMultiaddrs`,
    "Protocol installation advertisedMultiaddrs",
  );
  validateOptionalStringField(
    issues,
    installation.nodeInfoUrl,
    `${location}.nodeInfoUrl`,
    "Protocol installation nodeInfoUrl",
  );
  validateOptionalStringField(
    issues,
    installation.serviceName,
    `${location}.serviceName`,
    "Protocol installation serviceName",
  );
  validateOptionalStringField(
    issues,
    installation.artifactCid,
    `${location}.artifactCid`,
    "Protocol installation artifactCid",
  );
  validateOptionalStringField(
    issues,
    installation.description,
    `${location}.description`,
    "Protocol installation description",
  );
  validatePortField(
    issues,
    installation.resolvedPort,
    `${location}.resolvedPort`,
    "Protocol installation resolvedPort",
  );
  if (
    role === ProtocolRole.DIAL &&
    Array.isArray(installation.advertisedMultiaddrs) &&
    installation.advertisedMultiaddrs.length > 0
  ) {
    pushIssue(
      issues,
      "warning",
      "dial-installation-advertises",
      "Dial-only protocol installations should not advertise inbound multiaddrs.",
      `${location}.advertisedMultiaddrs`,
    );
  }
  if (protocolIdValid) {
    const manifestProtocol = manifestProtocolLookup.get(installation.protocolId);
    if (!manifestProtocol) {
      pushIssue(
        issues,
        "warning",
        "unknown-installation-protocol-id",
        `Protocol installation "${installation.protocolId}" does not match a protocol declared in the manifest.`,
        `${location}.protocolId`,
      );
      return;
    }
    if (
      manifestProtocol.wireId &&
      installation.wireId &&
      manifestProtocol.wireId !== installation.wireId
    ) {
      pushIssue(
        issues,
        "error",
        "installation-wire-id-mismatch",
        `Protocol installation "${installation.protocolId}" wireId does not match the manifest.`,
        `${location}.wireId`,
      );
    }
    if (
      manifestProtocol.transportKind &&
      transportKind &&
      manifestProtocol.transportKind !== transportKind
    ) {
      pushIssue(
        issues,
        "error",
        "installation-transport-mismatch",
        `Protocol installation "${installation.protocolId}" transportKind does not match the manifest.`,
        `${location}.transportKind`,
      );
    }
    if (
      manifestProtocol.role &&
      role &&
      !roleIncludesRole(manifestProtocol.role, role)
    ) {
      pushIssue(
        issues,
        "error",
        "installation-role-mismatch",
        `Protocol installation "${installation.protocolId}" role "${role}" is not allowed by the manifest role "${manifestProtocol.role}".`,
        `${location}.role`,
      );
    }
  }
}

function validateInputBinding(
  binding,
  issues,
  location,
  manifest,
  manifestMethodLookup,
) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    pushIssue(
      issues,
      "error",
      "invalid-input-binding",
      "Input binding entries must be objects.",
      location,
    );
    return;
  }
  validateStringField(
    issues,
    binding.bindingId,
    `${location}.bindingId`,
    "Input binding bindingId",
  );
  const targetPluginId = normalizeString(binding.targetPluginId);
  const targetMethodIdValid = validateStringField(
    issues,
    binding.targetMethodId,
    `${location}.targetMethodId`,
    "Input binding targetMethodId",
  );
  const targetInputPortIdValid = validateStringField(
    issues,
    binding.targetInputPortId,
    `${location}.targetInputPortId`,
    "Input binding targetInputPortId",
  );
  const sourceKind = normalizeInputBindingSourceKindName(binding.sourceKind);
  if (
    validateStringField(
      issues,
      binding.sourceKind,
      `${location}.sourceKind`,
      "Input binding sourceKind",
    ) &&
    !InputBindingSourceKindSet.has(sourceKind)
  ) {
    pushIssue(
      issues,
      "error",
      "unknown-input-binding-source-kind",
      `Input binding sourceKind must be one of: ${Array.from(
        InputBindingSourceKindSet,
      ).join(", ")}.`,
      `${location}.sourceKind`,
    );
  }
  validateOptionalStringField(
    issues,
    binding.targetPluginId,
    `${location}.targetPluginId`,
    "Input binding targetPluginId",
  );
  validateOptionalStringField(
    issues,
    binding.topic,
    `${location}.topic`,
    "Input binding topic",
  );
  validateOptionalStringField(
    issues,
    binding.wireId,
    `${location}.wireId`,
    "Input binding wireId",
  );
  validateOptionalStringField(
    issues,
    binding.nodeInfoUrl,
    `${location}.nodeInfoUrl`,
    "Input binding nodeInfoUrl",
  );
  validateStringArrayField(
    issues,
    binding.multiaddrs,
    `${location}.multiaddrs`,
    "Input binding multiaddrs",
  );
  validateStringArrayField(
    issues,
    binding.allowPeerIds,
    `${location}.allowPeerIds`,
    "Input binding allowPeerIds",
  );
  validateStringArrayField(
    issues,
    binding.allowServerKeys,
    `${location}.allowServerKeys`,
    "Input binding allowServerKeys",
  );
  validateOptionalStringField(
    issues,
    binding.deliveryMode,
    `${location}.deliveryMode`,
    "Input binding deliveryMode",
  );
  validateOptionalStringField(
    issues,
    binding.description,
    `${location}.description`,
    "Input binding description",
  );
  if (
    sourceKind === InputBindingSourceKind.PUBSUB &&
    !validateStringField(
      issues,
      binding.topic,
      `${location}.topic`,
      "Pubsub input binding topic",
    )
  ) {
    // error already recorded
  }
  if (
    sourceKind === InputBindingSourceKind.PROTOCOL_STREAM &&
    !validateStringField(
      issues,
      binding.wireId,
      `${location}.wireId`,
      "Protocol-stream input binding wireId",
    )
  ) {
    // error already recorded
  }
  const targetsCurrentManifest =
    !targetPluginId ||
    (typeof manifest?.pluginId === "string" && targetPluginId === manifest.pluginId);
  if (!targetsCurrentManifest) {
    return;
  }
  const method = targetMethodIdValid
    ? manifestMethodLookup.get(binding.targetMethodId)
    : null;
  if (targetMethodIdValid && !method) {
    pushIssue(
      issues,
      "error",
      "unknown-input-binding-method",
      `Input binding "${binding.bindingId ?? "binding"}" targets unknown method "${binding.targetMethodId}".`,
      `${location}.targetMethodId`,
    );
  }
  if (
    targetInputPortIdValid &&
    method &&
    !Array.isArray(method.inputPorts)
  ) {
    pushIssue(
      issues,
      "error",
      "unknown-input-binding-port",
      `Input binding "${binding.bindingId ?? "binding"}" targets method "${binding.targetMethodId}" without declared input ports.`,
      `${location}.targetInputPortId`,
    );
  } else if (
    targetInputPortIdValid &&
    method &&
    !method.inputPorts.some((port) => port?.portId === binding.targetInputPortId)
  ) {
    pushIssue(
      issues,
      "error",
      "unknown-input-binding-port",
      `Input binding "${binding.bindingId ?? "binding"}" targets unknown input port "${binding.targetInputPortId}" on method "${binding.targetMethodId}".`,
      `${location}.targetInputPortId`,
    );
  }
}

export function validateDeploymentPlan(plan, options = {}) {
  const normalizedPlan = normalizeDeploymentPlan(plan);
  const issues = [];
  const manifest = options.manifest ?? null;
  const methodLookup = buildMethodLookup(manifest);
  const protocolLookup = new Map(
    Array.isArray(manifest?.protocols)
      ? manifest.protocols
          .filter((entry) => typeof entry?.protocolId === "string")
          .map((entry) => [entry.protocolId, entry])
      : [],
  );

  if (!Number.isInteger(normalizedPlan.formatVersion) || normalizedPlan.formatVersion < 1) {
    pushIssue(
      issues,
      "error",
      "invalid-format-version",
      "Deployment plan formatVersion must be an integer greater than or equal to 1.",
      "deploymentPlan.formatVersion",
    );
  }
  if (
    manifest?.pluginId &&
    normalizedPlan.pluginId &&
    manifest.pluginId !== normalizedPlan.pluginId
  ) {
    pushIssue(
      issues,
      "error",
      "deployment-plan-plugin-id-mismatch",
      `Deployment plan pluginId "${normalizedPlan.pluginId}" does not match manifest pluginId "${manifest.pluginId}".`,
      "deploymentPlan.pluginId",
    );
  }
  if (
    manifest?.version &&
    normalizedPlan.version &&
    manifest.version !== normalizedPlan.version
  ) {
    pushIssue(
      issues,
      "error",
      "deployment-plan-version-mismatch",
      `Deployment plan version "${normalizedPlan.version}" does not match manifest version "${manifest.version}".`,
      "deploymentPlan.version",
    );
  }

  normalizedPlan.protocolInstallations.forEach((installation, index) => {
    validateProtocolInstallation(
      installation,
      issues,
      `deploymentPlan.protocolInstallations[${index}]`,
      protocolLookup,
    );
  });
  normalizedPlan.inputBindings.forEach((binding, index) => {
    validateInputBinding(
      binding,
      issues,
      `deploymentPlan.inputBindings[${index}]`,
      manifest,
      methodLookup,
    );
  });

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return {
    ok: errors.length === 0,
    plan: normalizedPlan,
    issues,
    errors,
    warnings,
  };
}

export function createDeploymentPlanBundleEntry(plan, options = {}) {
  const normalizedPlan = normalizeDeploymentPlan(plan);
  return {
    entryId: options.entryId ?? SDS_DEPLOYMENT_ENTRY_ID,
    role: options.role ?? "auxiliary",
    sectionName: options.sectionName ?? SDS_DEPLOYMENT_SECTION_NAME,
    payloadEncoding: "json-utf8",
    mediaType: options.mediaType ?? SDS_DEPLOYMENT_MEDIA_TYPE,
    payload: normalizedPlan,
    description:
      options.description ??
      "Resolved deployment plan with protocol installations and input bindings.",
  };
}

function findDeploymentPlanEntryInEntries(entries) {
  if (!Array.isArray(entries)) {
    return null;
  }
  return (
    entries.find((entry) => entry?.entryId === SDS_DEPLOYMENT_ENTRY_ID) ??
    entries.find((entry) => entry?.sectionName === SDS_DEPLOYMENT_SECTION_NAME) ??
    null
  );
}

export function findDeploymentPlanEntry(bundleLike) {
  return (
    findDeploymentPlanEntryInEntries(bundleLike?.entries) ??
    findDeploymentPlanEntryInEntries(bundleLike?.bundle?.entries) ??
    findModuleBundleEntry(bundleLike?.bundle ?? bundleLike, SDS_DEPLOYMENT_ENTRY_ID) ??
    null
  );
}

export function readDeploymentPlanFromBundle(bundleLike) {
  const directPlan = normalizeDeploymentPlan(bundleLike?.deploymentPlan);
  if (
    directPlan.protocolInstallations.length > 0 ||
    directPlan.inputBindings.length > 0 ||
    directPlan.pluginId ||
    directPlan.version
  ) {
    return directPlan;
  }
  const entry = findDeploymentPlanEntry(bundleLike);
  if (!entry) {
    return null;
  }
  if (entry.decodedDeploymentPlan) {
    return normalizeDeploymentPlan(entry.decodedDeploymentPlan);
  }
  if (entry.decodedPayload && typeof entry.decodedPayload === "object") {
    return normalizeDeploymentPlan(entry.decodedPayload);
  }
  if (entry.payload !== undefined) {
    return normalizeDeploymentPlan(decodeModuleBundleEntryPayload(entry));
  }
  return null;
}
