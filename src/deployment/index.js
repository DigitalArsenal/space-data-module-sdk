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

export const DeploymentBindingMode = Object.freeze({
  LOCAL: "local",
  DELEGATED: "delegated",
});

export const ScheduleBindingKind = Object.freeze({
  INTERVAL: "interval",
  CRON: "cron",
  ONCE: "once",
});

const InputBindingSourceKindSet = new Set(Object.values(InputBindingSourceKind));
const DeploymentBindingModeSet = new Set(Object.values(DeploymentBindingMode));
const ProtocolRoleSet = new Set(Object.values(ProtocolRole));
const ProtocolTransportKindSet = new Set(Object.values(ProtocolTransportKind));
const ScheduleBindingKindSet = new Set(Object.values(ScheduleBindingKind));

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

function normalizeRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...value };
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

export function normalizeDeploymentBindingModeName(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (normalized === "remote") {
    return DeploymentBindingMode.DELEGATED;
  }
  return normalized.length > 0 ? normalized : null;
}

export function normalizeScheduleBindingKindName(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (normalized === "startup") {
    return ScheduleBindingKind.ONCE;
  }
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

function normalizeScheduleBinding(value = {}) {
  return {
    scheduleId: normalizeString(value.scheduleId),
    bindingMode: normalizeDeploymentBindingModeName(value.bindingMode),
    triggerId: normalizeString(value.triggerId),
    targetMethodId: normalizeString(value.targetMethodId),
    targetInputPortId: normalizeString(value.targetInputPortId),
    scheduleKind: normalizeScheduleBindingKindName(value.scheduleKind),
    cron: normalizeString(value.cron),
    intervalMs: normalizeInteger(value.intervalMs),
    runAtStartup: normalizeBoolean(value.runAtStartup),
    startupDelayMs: normalizeInteger(value.startupDelayMs),
    timezone: normalizeString(value.timezone),
    description: normalizeString(value.description),
  };
}

function normalizeServiceBinding(value = {}) {
  return {
    serviceId: normalizeString(value.serviceId),
    bindingMode: normalizeDeploymentBindingModeName(value.bindingMode),
    serviceKind: normalizeString(value.serviceKind),
    triggerId: normalizeString(value.triggerId),
    protocolId: normalizeString(value.protocolId),
    routePath: normalizeString(value.routePath),
    method: normalizeString(value.method),
    transportKind: normalizeProtocolTransportKindName(value.transportKind),
    adapter: normalizeString(value.adapter),
    listenHost: normalizeString(value.listenHost),
    listenPort: normalizeInteger(value.listenPort),
    remoteUrl: normalizeString(value.remoteUrl),
    allowTransports: normalizeStringArray(value.allowTransports),
    authPolicyId: normalizeString(value.authPolicyId),
    description: normalizeString(value.description),
    properties: normalizeRecord(value.properties),
  };
}

function normalizeAuthPolicy(value = {}) {
  return {
    policyId: normalizeString(value.policyId),
    bindingMode: normalizeDeploymentBindingModeName(value.bindingMode),
    targetKind: normalizeString(value.targetKind),
    targetId: normalizeString(value.targetId),
    adapter: normalizeString(value.adapter),
    walletProfileId: normalizeString(value.walletProfileId),
    trustMapId: normalizeString(value.trustMapId),
    allowPeerIds: normalizeStringArray(value.allowPeerIds),
    allowServerKeys: normalizeStringArray(value.allowServerKeys),
    allowEntityIds: normalizeStringArray(value.allowEntityIds),
    requireSignedRequests: normalizeBoolean(value.requireSignedRequests),
    requireEncryptedTransport: normalizeBoolean(value.requireEncryptedTransport),
    description: normalizeString(value.description),
    properties: normalizeRecord(value.properties),
  };
}

function normalizePublicationBinding(value = {}) {
  return {
    publicationId: normalizeString(value.publicationId),
    bindingMode: normalizeDeploymentBindingModeName(value.bindingMode),
    sourceKind: normalizeString(value.sourceKind),
    sourceMethodId: normalizeString(value.sourceMethodId),
    sourceOutputPortId: normalizeString(value.sourceOutputPortId),
    sourceNodeId: normalizeString(value.sourceNodeId),
    sourceTriggerId: normalizeString(value.sourceTriggerId),
    topic: normalizeString(value.topic),
    wireId: normalizeString(value.wireId),
    schemaName: normalizeString(value.schemaName),
    mediaType: normalizeString(value.mediaType),
    archivePath: normalizeString(value.archivePath),
    queryServiceId: normalizeString(value.queryServiceId),
    emitPnm: normalizeBoolean(value.emitPnm),
    emitFlatbufferArchive: normalizeBoolean(value.emitFlatbufferArchive),
    pinPolicy: normalizeString(value.pinPolicy),
    maxRecords: normalizeInteger(value.maxRecords),
    maxBytes: normalizeInteger(value.maxBytes),
    minLivelinessSeconds: normalizeInteger(value.minLivelinessSeconds),
    recordRangeStartField: normalizeString(value.recordRangeStartField),
    recordRangeStopField: normalizeString(value.recordRangeStopField),
    description: normalizeString(value.description),
    properties: normalizeRecord(value.properties),
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
    scheduleBindings: Array.isArray(value.scheduleBindings)
      ? value.scheduleBindings.map((entry) => normalizeScheduleBinding(entry))
      : [],
    serviceBindings: Array.isArray(value.serviceBindings)
      ? value.serviceBindings.map((entry) => normalizeServiceBinding(entry))
      : [],
    authPolicies: Array.isArray(value.authPolicies)
      ? value.authPolicies.map((entry) => normalizeAuthPolicy(entry))
      : [],
    publicationBindings: Array.isArray(value.publicationBindings)
      ? value.publicationBindings.map((entry) =>
          normalizePublicationBinding(entry),
        )
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
  validateOptionalStringField(
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

function validateBindingModeField(issues, value, location, label) {
  const normalized = normalizeDeploymentBindingModeName(value);
  if (
    validateStringField(issues, value, location, label) &&
    !DeploymentBindingModeSet.has(normalized)
  ) {
    pushIssue(
      issues,
      "error",
      "unknown-binding-mode",
      `${label} must be one of: ${Array.from(DeploymentBindingModeSet).join(
        ", ",
      )}.`,
      location,
    );
    return false;
  }
  return true;
}

function validateScheduleBinding(
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
      "invalid-schedule-binding",
      "Schedule binding entries must be objects.",
      location,
    );
    return;
  }
  validateStringField(
    issues,
    binding.scheduleId,
    `${location}.scheduleId`,
    "Schedule binding scheduleId",
  );
  validateBindingModeField(
    issues,
    binding.bindingMode,
    `${location}.bindingMode`,
    "Schedule binding bindingMode",
  );
  const scheduleKind = normalizeScheduleBindingKindName(binding.scheduleKind);
  if (
    validateStringField(
      issues,
      binding.scheduleKind,
      `${location}.scheduleKind`,
      "Schedule binding scheduleKind",
    ) &&
    !ScheduleBindingKindSet.has(scheduleKind)
  ) {
    pushIssue(
      issues,
      "error",
      "unknown-schedule-kind",
      `Schedule binding scheduleKind must be one of: ${Array.from(
        ScheduleBindingKindSet,
      ).join(", ")}.`,
      `${location}.scheduleKind`,
    );
  }
  validateOptionalStringField(
    issues,
    binding.triggerId,
    `${location}.triggerId`,
    "Schedule binding triggerId",
  );
  const hasTriggerId = typeof binding.triggerId === "string" && binding.triggerId.length > 0;
  const targetMethodIdValid =
    validateOptionalStringField(
      issues,
      binding.targetMethodId,
      `${location}.targetMethodId`,
      "Schedule binding targetMethodId",
    ) &&
    typeof binding.targetMethodId === "string" &&
    binding.targetMethodId.length > 0;
  const targetInputPortIdPresent =
    typeof binding.targetInputPortId === "string" &&
    binding.targetInputPortId.length > 0;
  validateOptionalStringField(
    issues,
    binding.targetInputPortId,
    `${location}.targetInputPortId`,
    "Schedule binding targetInputPortId",
  );
  validateOptionalStringField(
    issues,
    binding.cron,
    `${location}.cron`,
    "Schedule binding cron",
  );
  validateOptionalStringField(
    issues,
    binding.timezone,
    `${location}.timezone`,
    "Schedule binding timezone",
  );
  validateOptionalStringField(
    issues,
    binding.description,
    `${location}.description`,
    "Schedule binding description",
  );
  if (!hasTriggerId && !targetMethodIdValid) {
    pushIssue(
      issues,
      "error",
      "missing-schedule-target",
      "Schedule bindings must target either a triggerId or a targetMethodId.",
      location,
    );
  }
  if (
    scheduleKind === ScheduleBindingKind.CRON &&
    !validateStringField(
      issues,
      binding.cron,
      `${location}.cron`,
      "Cron schedule binding cron",
    )
  ) {
    // error already recorded
  }
  if (
    scheduleKind === ScheduleBindingKind.INTERVAL &&
    (!Number.isInteger(binding.intervalMs) || binding.intervalMs <= 0)
  ) {
    pushIssue(
      issues,
      "error",
      "invalid-interval-ms",
      "Interval schedule bindings must define intervalMs greater than 0.",
      `${location}.intervalMs`,
    );
  }
  if (
    scheduleKind === ScheduleBindingKind.ONCE &&
    binding.runAtStartup !== true &&
    (!Number.isInteger(binding.startupDelayMs) || binding.startupDelayMs <= 0)
  ) {
    pushIssue(
      issues,
      "warning",
      "once-schedule-without-startup",
      "Once schedule bindings should either runAtStartup or define startupDelayMs.",
      location,
    );
  }
  if (targetMethodIdValid && manifest) {
    const method = manifestMethodLookup.get(binding.targetMethodId);
    if (!method) {
      pushIssue(
        issues,
        "error",
        "unknown-schedule-binding-method",
        `Schedule binding "${binding.scheduleId ?? "schedule"}" targets unknown method "${binding.targetMethodId}".`,
        `${location}.targetMethodId`,
      );
    } else if (
      targetInputPortIdPresent &&
      !Array.isArray(method.inputPorts)
    ) {
      pushIssue(
        issues,
        "error",
        "unknown-schedule-binding-port",
        `Schedule binding "${binding.scheduleId ?? "schedule"}" targets method "${binding.targetMethodId}" without declared input ports.`,
        `${location}.targetInputPortId`,
      );
    } else if (
      targetInputPortIdPresent &&
      !method.inputPorts.some((port) => port?.portId === binding.targetInputPortId)
    ) {
      pushIssue(
        issues,
        "error",
        "unknown-schedule-binding-port",
        `Schedule binding "${binding.scheduleId ?? "schedule"}" targets unknown input port "${binding.targetInputPortId}" on method "${binding.targetMethodId}".`,
        `${location}.targetInputPortId`,
      );
    }
  }
}

function validateServiceBinding(binding, issues, location) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    pushIssue(
      issues,
      "error",
      "invalid-service-binding",
      "Service binding entries must be objects.",
      location,
    );
    return;
  }
  validateStringField(
    issues,
    binding.serviceId,
    `${location}.serviceId`,
    "Service binding serviceId",
  );
  validateBindingModeField(
    issues,
    binding.bindingMode,
    `${location}.bindingMode`,
    "Service binding bindingMode",
  );
  validateStringField(
    issues,
    binding.serviceKind,
    `${location}.serviceKind`,
    "Service binding serviceKind",
  );
  validateOptionalStringField(
    issues,
    binding.triggerId,
    `${location}.triggerId`,
    "Service binding triggerId",
  );
  validateOptionalStringField(
    issues,
    binding.protocolId,
    `${location}.protocolId`,
    "Service binding protocolId",
  );
  validateOptionalStringField(
    issues,
    binding.routePath,
    `${location}.routePath`,
    "Service binding routePath",
  );
  validateOptionalStringField(
    issues,
    binding.method,
    `${location}.method`,
    "Service binding method",
  );
  if (
    binding.transportKind !== null &&
    binding.transportKind !== undefined &&
    !ProtocolTransportKindSet.has(
      normalizeProtocolTransportKindName(binding.transportKind),
    )
  ) {
    pushIssue(
      issues,
      "error",
      "unknown-service-transport-kind",
      `Service binding transportKind must be one of: ${Array.from(
        ProtocolTransportKindSet,
      ).join(", ")}.`,
      `${location}.transportKind`,
    );
  }
  validateOptionalStringField(
    issues,
    binding.adapter,
    `${location}.adapter`,
    "Service binding adapter",
  );
  validateOptionalStringField(
    issues,
    binding.listenHost,
    `${location}.listenHost`,
    "Service binding listenHost",
  );
  validatePortField(
    issues,
    binding.listenPort,
    `${location}.listenPort`,
    "Service binding listenPort",
  );
  validateOptionalStringField(
    issues,
    binding.remoteUrl,
    `${location}.remoteUrl`,
    "Service binding remoteUrl",
  );
  validateStringArrayField(
    issues,
    binding.allowTransports,
    `${location}.allowTransports`,
    "Service binding allowTransports",
  );
  validateOptionalStringField(
    issues,
    binding.authPolicyId,
    `${location}.authPolicyId`,
    "Service binding authPolicyId",
  );
  validateOptionalStringField(
    issues,
    binding.description,
    `${location}.description`,
    "Service binding description",
  );
}

function validateAuthPolicy(binding, issues, location) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    pushIssue(
      issues,
      "error",
      "invalid-auth-policy",
      "Auth policy entries must be objects.",
      location,
    );
    return;
  }
  validateStringField(
    issues,
    binding.policyId,
    `${location}.policyId`,
    "Auth policy policyId",
  );
  validateBindingModeField(
    issues,
    binding.bindingMode,
    `${location}.bindingMode`,
    "Auth policy bindingMode",
  );
  validateStringField(
    issues,
    binding.targetKind,
    `${location}.targetKind`,
    "Auth policy targetKind",
  );
  validateOptionalStringField(
    issues,
    binding.targetId,
    `${location}.targetId`,
    "Auth policy targetId",
  );
  validateOptionalStringField(
    issues,
    binding.adapter,
    `${location}.adapter`,
    "Auth policy adapter",
  );
  validateOptionalStringField(
    issues,
    binding.walletProfileId,
    `${location}.walletProfileId`,
    "Auth policy walletProfileId",
  );
  validateOptionalStringField(
    issues,
    binding.trustMapId,
    `${location}.trustMapId`,
    "Auth policy trustMapId",
  );
  validateStringArrayField(
    issues,
    binding.allowPeerIds,
    `${location}.allowPeerIds`,
    "Auth policy allowPeerIds",
  );
  validateStringArrayField(
    issues,
    binding.allowServerKeys,
    `${location}.allowServerKeys`,
    "Auth policy allowServerKeys",
  );
  validateStringArrayField(
    issues,
    binding.allowEntityIds,
    `${location}.allowEntityIds`,
    "Auth policy allowEntityIds",
  );
  validateOptionalStringField(
    issues,
    binding.description,
    `${location}.description`,
    "Auth policy description",
  );
  if (
    binding.allowPeerIds.length === 0 &&
    binding.allowServerKeys.length === 0 &&
    binding.allowEntityIds.length === 0 &&
    !binding.walletProfileId &&
    !binding.trustMapId
  ) {
    pushIssue(
      issues,
      "warning",
      "open-auth-policy",
      "Auth policies should declare at least one allow-list or trust map.",
      location,
    );
  }
}

function validatePublicationBinding(
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
      "invalid-publication-binding",
      "Publication binding entries must be objects.",
      location,
    );
    return;
  }
  validateStringField(
    issues,
    binding.publicationId,
    `${location}.publicationId`,
    "Publication binding publicationId",
  );
  validateBindingModeField(
    issues,
    binding.bindingMode,
    `${location}.bindingMode`,
    "Publication binding bindingMode",
  );
  validateStringField(
    issues,
    binding.sourceKind,
    `${location}.sourceKind`,
    "Publication binding sourceKind",
  );
  validateOptionalStringField(
    issues,
    binding.sourceMethodId,
    `${location}.sourceMethodId`,
    "Publication binding sourceMethodId",
  );
  validateOptionalStringField(
    issues,
    binding.sourceOutputPortId,
    `${location}.sourceOutputPortId`,
    "Publication binding sourceOutputPortId",
  );
  validateOptionalStringField(
    issues,
    binding.sourceNodeId,
    `${location}.sourceNodeId`,
    "Publication binding sourceNodeId",
  );
  validateOptionalStringField(
    issues,
    binding.sourceTriggerId,
    `${location}.sourceTriggerId`,
    "Publication binding sourceTriggerId",
  );
  validateOptionalStringField(
    issues,
    binding.topic,
    `${location}.topic`,
    "Publication binding topic",
  );
  validateOptionalStringField(
    issues,
    binding.wireId,
    `${location}.wireId`,
    "Publication binding wireId",
  );
  validateOptionalStringField(
    issues,
    binding.schemaName,
    `${location}.schemaName`,
    "Publication binding schemaName",
  );
  validateOptionalStringField(
    issues,
    binding.mediaType,
    `${location}.mediaType`,
    "Publication binding mediaType",
  );
  validateOptionalStringField(
    issues,
    binding.archivePath,
    `${location}.archivePath`,
    "Publication binding archivePath",
  );
  validateOptionalStringField(
    issues,
    binding.queryServiceId,
    `${location}.queryServiceId`,
    "Publication binding queryServiceId",
  );
  validateOptionalStringField(
    issues,
    binding.pinPolicy,
    `${location}.pinPolicy`,
    "Publication binding pinPolicy",
  );
  validateOptionalStringField(
    issues,
    binding.recordRangeStartField,
    `${location}.recordRangeStartField`,
    "Publication binding recordRangeStartField",
  );
  validateOptionalStringField(
    issues,
    binding.recordRangeStopField,
    `${location}.recordRangeStopField`,
    "Publication binding recordRangeStopField",
  );
  validateOptionalStringField(
    issues,
    binding.description,
    `${location}.description`,
    "Publication binding description",
  );
  if (
    !binding.sourceMethodId &&
    !binding.sourceNodeId &&
    !binding.sourceTriggerId
  ) {
    pushIssue(
      issues,
      "error",
      "missing-publication-source",
      "Publication bindings must target a sourceMethodId, sourceNodeId, or sourceTriggerId.",
      location,
    );
  }
  if (
    binding.emitPnm === true &&
    !binding.topic &&
    !binding.wireId &&
    !binding.schemaName
  ) {
    pushIssue(
      issues,
      "warning",
      "pnm-without-routing-hint",
      "PNM-emitting publication bindings should declare a topic, wireId, or schemaName.",
      location,
    );
  }
  if (binding.sourceMethodId && manifest) {
    const method = manifestMethodLookup.get(binding.sourceMethodId);
    if (!method) {
      pushIssue(
        issues,
        "error",
        "unknown-publication-binding-method",
        `Publication binding "${binding.publicationId ?? "publication"}" targets unknown method "${binding.sourceMethodId}".`,
        `${location}.sourceMethodId`,
      );
    } else if (
      binding.sourceOutputPortId &&
      !Array.isArray(method.outputPorts)
    ) {
      pushIssue(
        issues,
        "error",
        "unknown-publication-binding-port",
        `Publication binding "${binding.publicationId ?? "publication"}" targets method "${binding.sourceMethodId}" without declared output ports.`,
        `${location}.sourceOutputPortId`,
      );
    } else if (
      binding.sourceOutputPortId &&
      !method.outputPorts.some(
        (port) => port?.portId === binding.sourceOutputPortId,
      )
    ) {
      pushIssue(
        issues,
        "error",
        "unknown-publication-binding-port",
        `Publication binding "${binding.publicationId ?? "publication"}" targets unknown output port "${binding.sourceOutputPortId}" on method "${binding.sourceMethodId}".`,
        `${location}.sourceOutputPortId`,
      );
    }
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
  normalizedPlan.scheduleBindings.forEach((binding, index) => {
    validateScheduleBinding(
      binding,
      issues,
      `deploymentPlan.scheduleBindings[${index}]`,
      manifest,
      methodLookup,
    );
  });
  normalizedPlan.serviceBindings.forEach((binding, index) => {
    validateServiceBinding(
      binding,
      issues,
      `deploymentPlan.serviceBindings[${index}]`,
    );
  });
  normalizedPlan.authPolicies.forEach((binding, index) => {
    validateAuthPolicy(
      binding,
      issues,
      `deploymentPlan.authPolicies[${index}]`,
    );
  });
  normalizedPlan.publicationBindings.forEach((binding, index) => {
    validatePublicationBinding(
      binding,
      issues,
      `deploymentPlan.publicationBindings[${index}]`,
      manifest,
      methodLookup,
    );
  });

  const authPolicyIds = new Set(
    normalizedPlan.authPolicies
      .map((entry) => entry.policyId)
      .filter((entry) => typeof entry === "string" && entry.length > 0),
  );
  normalizedPlan.serviceBindings.forEach((binding, index) => {
    if (binding.authPolicyId && !authPolicyIds.has(binding.authPolicyId)) {
      pushIssue(
        issues,
        "error",
        "unknown-service-auth-policy",
        `Service binding "${binding.serviceId ?? "service"}" references unknown auth policy "${binding.authPolicyId}".`,
        `deploymentPlan.serviceBindings[${index}].authPolicyId`,
      );
    }
  });
  const serviceIds = new Set(
    normalizedPlan.serviceBindings
      .map((entry) => entry.serviceId)
      .filter((entry) => typeof entry === "string" && entry.length > 0),
  );
  normalizedPlan.publicationBindings.forEach((binding, index) => {
    if (binding.queryServiceId && !serviceIds.has(binding.queryServiceId)) {
      pushIssue(
        issues,
        "error",
        "unknown-publication-query-service",
        `Publication binding "${binding.publicationId ?? "publication"}" references unknown query service "${binding.queryServiceId}".`,
        `deploymentPlan.publicationBindings[${index}].queryServiceId`,
      );
    }
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
      "Resolved deployment plan with protocol installations, bindings, schedules, services, auth policy, and publication policy.",
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

function planHasContent(plan) {
  return (
    plan.protocolInstallations.length > 0 ||
    plan.inputBindings.length > 0 ||
    plan.scheduleBindings.length > 0 ||
    plan.serviceBindings.length > 0 ||
    plan.authPolicies.length > 0 ||
    plan.publicationBindings.length > 0 ||
    Boolean(plan.pluginId) ||
    Boolean(plan.version)
  );
}

export function readDeploymentPlanFromBundle(bundleLike) {
  const directPlan = normalizeDeploymentPlan(bundleLike?.deploymentPlan);
  if (planHasContent(directPlan)) {
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
