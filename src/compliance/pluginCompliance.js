import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  DefaultInvokeExports,
  DefaultManifestExports,
  DrainPolicy,
  ExternalInterfaceDirection,
  ExternalInterfaceKind,
  InvokeSurface,
  ProtocolRole,
  ProtocolTransportKind,
  RuntimeTarget,
} from "../runtime/constants.js";
import {
  RecommendedCapabilityIds,
  StandaloneWasiCapabilityIds,
} from "../capabilities.js";

const RecommendedCapabilitySet = new Set(RecommendedCapabilityIds);
const StandaloneWasiCapabilitySet = new Set(StandaloneWasiCapabilityIds);
const RecommendedRuntimeTargets = Object.freeze(Object.values(RuntimeTarget));
const RecommendedRuntimeTargetSet = new Set(RecommendedRuntimeTargets);
const DrainPolicySet = new Set(Object.values(DrainPolicy));
const InvokeSurfaceSet = new Set(Object.values(InvokeSurface));
const ExternalInterfaceDirectionSet = new Set(
  Object.values(ExternalInterfaceDirection),
);
const ExternalInterfaceKindSet = new Set(Object.values(ExternalInterfaceKind));
const ProtocolRoleSet = new Set(Object.values(ProtocolRole));
const ProtocolTransportKindSet = new Set(Object.values(ProtocolTransportKind));
const BrowserIncompatibleCapabilitySet = new Set([
  "filesystem",
  "pipe",
  "network",
  "tcp",
  "udp",
  "mqtt",
  "tls",
  "database",
  "storage_adapter",
  "storage_write",
  "protocol_dial",
  "protocol_handle",
  "process_exec",
  "wallet_sign",
  "ipfs",
  "scene_access",
  "entity_access",
  "render_hooks",
]);
const StandaloneWasiProtocolTransportKindSet = new Set([
  ProtocolTransportKind.WASI_PIPE,
]);
const IgnoredDirectoryNames = new Set([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".turbo",
  "build",
  "Build",
  "dist",
  "coverage",
  "node_modules",
  "vendor",
  "docs-html",
  "out",
]);

function createIssue(severity, code, message, location) {
  return { severity, code, message, location };
}

function pushIssue(issues, severity, code, message, location) {
  issues.push(createIssue(severity, code, message, location));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNonEmptyByteSequence(value) {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength > 0;
  }
  return false;
}

function normalizeTypeIdentityString(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  return value.trim().toLowerCase();
}

function normalizeTypeIdentityBytes(value) {
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
  }
  const bytes = ArrayBuffer.isView(value)
    ? Array.from(value)
    : Array.isArray(value)
      ? value
      : null;
  if (!bytes || bytes.length === 0) {
    return null;
  }
  return bytes
    .map((entry) => Number(entry).toString(16).padStart(2, "0"))
    .join("");
}

function allowedTypesReferToSameLogicalSchema(left, right) {
  const leftSchemaName = normalizeTypeIdentityString(left?.schemaName);
  const rightSchemaName = normalizeTypeIdentityString(right?.schemaName);
  if (leftSchemaName && rightSchemaName && leftSchemaName === rightSchemaName) {
    return true;
  }

  const leftFileIdentifier = normalizeTypeIdentityString(left?.fileIdentifier);
  const rightFileIdentifier = normalizeTypeIdentityString(right?.fileIdentifier);
  if (
    leftFileIdentifier &&
    rightFileIdentifier &&
    leftFileIdentifier === rightFileIdentifier
  ) {
    return true;
  }

  const leftSchemaHash = normalizeTypeIdentityBytes(left?.schemaHash);
  const rightSchemaHash = normalizeTypeIdentityBytes(right?.schemaHash);
  if (leftSchemaHash && rightSchemaHash && leftSchemaHash === rightSchemaHash) {
    return true;
  }

  return false;
}

function normalizePayloadWireFormatName(value) {
  if (value === undefined || value === null || value === "") {
    return "flatbuffer";
  }
  if (value === 0) {
    return "flatbuffer";
  }
  if (value === 1) {
    return "aligned-binary";
  }
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (normalized === "flatbuffer") {
    return "flatbuffer";
  }
  if (normalized === "aligned-binary") {
    return "aligned-binary";
  }
  return null;
}

function validateStringField(issues, value, location, label) {
  if (!isNonEmptyString(value)) {
    pushIssue(issues, "error", "missing-string", `${label} must be a non-empty string.`, location);
    return false;
  }
  return true;
}

function validateIntegerField(
  issues,
  value,
  location,
  label,
  { min = null, max = null } = {},
) {
  if (!Number.isInteger(value)) {
    pushIssue(issues, "error", "invalid-integer", `${label} must be an integer.`, location);
    return false;
  }
  if (min !== null && value < min) {
    pushIssue(
      issues,
      "error",
      "integer-range",
      `${label} must be greater than or equal to ${min}.`,
      location,
    );
    return false;
  }
  if (max !== null && value > max) {
    pushIssue(
      issues,
      "error",
      "integer-range",
      `${label} must be less than or equal to ${max}.`,
      location,
    );
    return false;
  }
  return true;
}

function validateOptionalIntegerField(
  issues,
  value,
  location,
  label,
  options = {},
) {
  if (value === undefined || value === null) {
    return true;
  }
  return validateIntegerField(issues, value, location, label, options);
}

function validateOptionalBooleanField(issues, value, location, label) {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value !== "boolean") {
    pushIssue(
      issues,
      "error",
      "invalid-boolean",
      `${label} must be a boolean when present.`,
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

function normalizeProtocolTransportKind(value) {
  if (value === undefined || value === null || value === "") {
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
  return normalized;
}

function normalizeProtocolRole(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (normalized === "handler") {
    return ProtocolRole.HANDLE;
  }
  return normalized;
}

function validateAllowedType(type, issues, location) {
  if (!type || typeof type !== "object" || Array.isArray(type)) {
    pushIssue(issues, "error", "invalid-type-record", "Allowed type entries must be objects.", location);
    return;
  }
  const wireFormat = normalizePayloadWireFormatName(type.wireFormat);
  if (wireFormat === null) {
    pushIssue(
      issues,
      "error",
      "invalid-wire-format",
      'Allowed type wireFormat must be "flatbuffer" or "aligned-binary".',
      `${location}.wireFormat`,
    );
    return;
  }
  if (wireFormat === "aligned-binary") {
    if (type.acceptsAnyFlatbuffer === true) {
      pushIssue(
        issues,
        "error",
        "accepts-any-flatbuffer-format-conflict",
        "acceptsAnyFlatbuffer can only be used with flatbuffer wireFormat.",
        `${location}.acceptsAnyFlatbuffer`,
      );
    }
    if (!isNonEmptyString(type.schemaName)) {
      pushIssue(
        issues,
        "error",
        "missing-aligned-schema-name",
        "Aligned-binary allowed types must declare schemaName.",
        `${location}.schemaName`,
      );
    }
    if (!isNonEmptyString(type.rootTypeName)) {
      pushIssue(
        issues,
        "error",
        "missing-aligned-root-type-name",
        "Aligned-binary allowed types must declare rootTypeName.",
        `${location}.rootTypeName`,
      );
    }
    validateOptionalIntegerField(
      issues,
      type.fixedStringLength,
      `${location}.fixedStringLength`,
      "Allowed type fixedStringLength",
      { min: 0 },
    );
    validateIntegerField(
      issues,
      type.byteLength,
      `${location}.byteLength`,
      "Aligned-binary allowed type byteLength",
      { min: 1 },
    );
    validateIntegerField(
      issues,
      type.requiredAlignment,
      `${location}.requiredAlignment`,
      "Aligned-binary allowed type requiredAlignment",
      { min: 1 },
    );
    return;
  }
  if (type.acceptsAnyFlatbuffer === true) {
    return;
  }
  if (
    !isNonEmptyString(type.schemaName) &&
    !isNonEmptyString(type.fileIdentifier) &&
    !hasNonEmptyByteSequence(type.schemaHash)
  ) {
    pushIssue(
      issues,
      "error",
      "missing-type-identity",
      "Allowed type must declare at least one stable identity field: schemaName, fileIdentifier, or schemaHash.",
      location,
    );
  }
  validateOptionalIntegerField(
    issues,
    type.fixedStringLength,
    `${location}.fixedStringLength`,
    "Allowed type fixedStringLength",
    { min: 0 },
  );
  validateOptionalIntegerField(
    issues,
    type.byteLength,
    `${location}.byteLength`,
    "Allowed type byteLength",
    { min: 0 },
  );
  validateOptionalIntegerField(
    issues,
    type.requiredAlignment,
    `${location}.requiredAlignment`,
    "Allowed type requiredAlignment",
    { min: 0 },
  );
}

function validateAcceptedTypeSet(typeSet, issues, location) {
  if (!typeSet || typeof typeSet !== "object" || Array.isArray(typeSet)) {
    pushIssue(issues, "error", "invalid-type-set", "Accepted type sets must be objects.", location);
    return;
  }
  validateStringField(issues, typeSet.setId, `${location}.setId`, "Accepted type set setId");
  if (!Array.isArray(typeSet.allowedTypes) || typeSet.allowedTypes.length === 0) {
    pushIssue(
      issues,
      "error",
      "missing-allowed-types",
      "Accepted type sets must declare one or more allowedTypes.",
      `${location}.allowedTypes`,
    );
    return;
  }
  typeSet.allowedTypes.forEach((allowedType, index) => {
    validateAllowedType(allowedType, issues, `${location}.allowedTypes[${index}]`);
  });

  const regularConcreteTypes = [];
  const alignedTypes = [];

  typeSet.allowedTypes.forEach((allowedType, index) => {
    const wireFormat = normalizePayloadWireFormatName(allowedType?.wireFormat);
    if (wireFormat === "aligned-binary") {
      alignedTypes.push({ allowedType, index });
      return;
    }
    if (wireFormat === "flatbuffer" && allowedType?.acceptsAnyFlatbuffer !== true) {
      regularConcreteTypes.push({ allowedType, index });
    }
  });

  alignedTypes.forEach(({ allowedType, index }) => {
    const hasRegularFallback = regularConcreteTypes.some(({ allowedType: regularType }) =>
      allowedTypesReferToSameLogicalSchema(allowedType, regularType),
    );
    if (!hasRegularFallback) {
      pushIssue(
        issues,
        "error",
        "missing-flatbuffer-fallback",
        "Aligned-binary allowed types must be paired with a regular flatbuffer fallback for the same schema in the same acceptedTypeSet.",
        `${location}.allowedTypes[${index}]`,
      );
    }
  });
}

function validatePort(port, issues, location, label) {
  if (!port || typeof port !== "object" || Array.isArray(port)) {
    pushIssue(issues, "error", "invalid-port", `${label} entries must be objects.`, location);
    return;
  }
  validateStringField(issues, port.portId, `${location}.portId`, `${label} portId`);
  if (!Array.isArray(port.acceptedTypeSets) || port.acceptedTypeSets.length === 0) {
    pushIssue(
      issues,
      "error",
      "missing-accepted-type-sets",
      `${label} must declare one or more acceptedTypeSets.`,
      `${location}.acceptedTypeSets`,
    );
  } else {
    port.acceptedTypeSets.forEach((typeSet, index) => {
      validateAcceptedTypeSet(typeSet, issues, `${location}.acceptedTypeSets[${index}]`);
    });
  }
  const minStreamsValid = validateIntegerField(
    issues,
    port.minStreams,
    `${location}.minStreams`,
    `${label} minStreams`,
    { min: 0 },
  );
  const maxStreamsValid = validateIntegerField(
    issues,
    port.maxStreams,
    `${location}.maxStreams`,
    `${label} maxStreams`,
    { min: 0 },
  );
  if (minStreamsValid && maxStreamsValid && port.maxStreams < port.minStreams) {
    pushIssue(
      issues,
      "error",
      "stream-range",
      `${label} maxStreams must be greater than or equal to minStreams.`,
      location,
    );
  }
  if (typeof port.required !== "boolean") {
    pushIssue(issues, "error", "invalid-required-flag", `${label} required must be a boolean.`, `${location}.required`);
  }
}

function validateExternalInterface(externalInterface, issues, location, declaredCapabilities) {
  if (!externalInterface || typeof externalInterface !== "object" || Array.isArray(externalInterface)) {
    pushIssue(
      issues,
      "error",
      "invalid-external-interface",
      "externalInterfaces entries must be objects.",
      location,
    );
    return;
  }
  validateStringField(
    issues,
    externalInterface.interfaceId,
    `${location}.interfaceId`,
    "External interface interfaceId",
  );
  if (!isNonEmptyString(externalInterface.kind)) {
    pushIssue(issues, "error", "missing-interface-kind", "External interface kind must be a non-empty string.", `${location}.kind`);
  } else if (!ExternalInterfaceKindSet.has(externalInterface.kind)) {
    pushIssue(
      issues,
      "warning",
      "unknown-interface-kind",
      `External interface kind "${externalInterface.kind}" is not in the canonical SDN interface kind set.`,
      `${location}.kind`,
    );
  }
  if (!isNonEmptyString(externalInterface.direction)) {
    pushIssue(
      issues,
      "error",
      "missing-interface-direction",
      "External interface direction must be a non-empty string.",
      `${location}.direction`,
    );
  } else if (!ExternalInterfaceDirectionSet.has(externalInterface.direction)) {
    pushIssue(
      issues,
      "error",
      "invalid-interface-direction",
      `External interface direction "${externalInterface.direction}" is invalid.`,
      `${location}.direction`,
    );
  }
  if (!isNonEmptyString(externalInterface.capability)) {
    pushIssue(
      issues,
      "warning",
      "missing-interface-capability",
      "External interface should declare the coarse capability it consumes.",
      `${location}.capability`,
    );
  } else if (Array.isArray(declaredCapabilities) && !declaredCapabilities.includes(externalInterface.capability)) {
    pushIssue(
      issues,
      "error",
      "undeclared-interface-capability",
      `External interface capability "${externalInterface.capability}" is not declared in manifest.capabilities.`,
      `${location}.capability`,
    );
  }
}

function validateTimer(timer, issues, location, methodLookup, declaredCapabilities) {
  if (!timer || typeof timer !== "object" || Array.isArray(timer)) {
    pushIssue(issues, "error", "invalid-timer", "Timer entries must be objects.", location);
    return;
  }
  const timerIdValid = validateStringField(
    issues,
    timer.timerId,
    `${location}.timerId`,
    "Timer timerId",
  );
  const methodIdValid = validateStringField(
    issues,
    timer.methodId,
    `${location}.methodId`,
    "Timer methodId",
  );
  let method = null;
  if (methodIdValid) {
    method = methodLookup.get(timer.methodId) ?? null;
    if (!method) {
      pushIssue(
        issues,
        "error",
        "unknown-timer-method",
        `Timer "${timer.timerId ?? "timer"}" references unknown method "${timer.methodId}".`,
        `${location}.methodId`,
      );
    }
  }
  if (timer.inputPortId !== undefined && timer.inputPortId !== null) {
    if (!isNonEmptyString(timer.inputPortId)) {
      pushIssue(
        issues,
        "error",
        "invalid-timer-input-port",
        "Timer inputPortId must be a non-empty string when present.",
        `${location}.inputPortId`,
      );
    } else if (
      method &&
      !method.inputPorts.some((port) => port?.portId === timer.inputPortId)
    ) {
      pushIssue(
        issues,
        "error",
        "unknown-timer-input-port",
        `Timer "${timer.timerId ?? "timer"}" references unknown input port "${timer.inputPortId}" on method "${timer.methodId}".`,
        `${location}.inputPortId`,
      );
    }
  }
  if (timer.defaultIntervalMs !== undefined) {
    validateIntegerField(
      issues,
      timer.defaultIntervalMs,
      `${location}.defaultIntervalMs`,
      "Timer defaultIntervalMs",
      { min: 0 },
    );
  }
  if (
    timerIdValid &&
    Array.isArray(declaredCapabilities) &&
    !declaredCapabilities.includes("timers")
  ) {
    pushIssue(
      issues,
      "error",
      "undeclared-timer-capability",
      `Timer "${timer.timerId}" requires the "timers" capability to be declared in manifest.capabilities.`,
      location,
    );
  }
}

function validateProtocol(protocol, issues, location, methodLookup, declaredCapabilities) {
  if (!protocol || typeof protocol !== "object" || Array.isArray(protocol)) {
    pushIssue(
      issues,
      "error",
      "invalid-protocol",
      "Protocol entries must be objects.",
      location,
    );
    return;
  }
  const protocolIdValid = validateStringField(
    issues,
    protocol.protocolId,
    `${location}.protocolId`,
    "Protocol protocolId",
  );
  const methodIdValid = validateStringField(
    issues,
    protocol.methodId,
    `${location}.methodId`,
    "Protocol methodId",
  );
  let method = null;
  if (methodIdValid) {
    method = methodLookup.get(protocol.methodId) ?? null;
    if (!method) {
      pushIssue(
        issues,
        "error",
        "unknown-protocol-method",
        `Protocol "${protocol.protocolId ?? "protocol"}" references unknown method "${protocol.methodId}".`,
        `${location}.methodId`,
      );
    }
  }
  if (protocol.inputPortId !== undefined && protocol.inputPortId !== null) {
    if (!isNonEmptyString(protocol.inputPortId)) {
      pushIssue(
        issues,
        "error",
        "invalid-protocol-input-port",
        "Protocol inputPortId must be a non-empty string when present.",
        `${location}.inputPortId`,
      );
    } else if (
      method &&
      !method.inputPorts.some((port) => port?.portId === protocol.inputPortId)
    ) {
      pushIssue(
        issues,
        "error",
        "unknown-protocol-input-port",
        `Protocol "${protocol.protocolId ?? "protocol"}" references unknown input port "${protocol.inputPortId}" on method "${protocol.methodId}".`,
        `${location}.inputPortId`,
      );
    }
  }
  if (protocol.outputPortId !== undefined && protocol.outputPortId !== null) {
    if (!isNonEmptyString(protocol.outputPortId)) {
      pushIssue(
        issues,
        "error",
        "invalid-protocol-output-port",
        "Protocol outputPortId must be a non-empty string when present.",
        `${location}.outputPortId`,
      );
    } else if (
      method &&
      !method.outputPorts.some((port) => port?.portId === protocol.outputPortId)
    ) {
      pushIssue(
        issues,
        "error",
        "unknown-protocol-output-port",
        `Protocol "${protocol.protocolId ?? "protocol"}" references unknown output port "${protocol.outputPortId}" on method "${protocol.methodId}".`,
        `${location}.outputPortId`,
      );
    }
  }
  const wireIdValid = validateStringField(
    issues,
    protocol.wireId,
    `${location}.wireId`,
    "Protocol wireId",
  );
  const normalizedTransportKind = normalizeProtocolTransportKind(
    protocol.transportKind,
  );
  if (!validateStringField(
    issues,
    protocol.transportKind,
    `${location}.transportKind`,
    "Protocol transportKind",
  )) {
    // already reported
  } else if (!ProtocolTransportKindSet.has(normalizedTransportKind)) {
    pushIssue(
      issues,
      "error",
      "unknown-protocol-transport-kind",
      `Protocol "${protocol.protocolId ?? "protocol"}" transportKind must be one of: ${Array.from(ProtocolTransportKindSet).join(", ")}.`,
      `${location}.transportKind`,
    );
  }
  const normalizedRole = normalizeProtocolRole(protocol.role);
  if (!validateStringField(
    issues,
    protocol.role,
    `${location}.role`,
    "Protocol role",
  )) {
    // already reported
  } else if (!ProtocolRoleSet.has(normalizedRole)) {
    pushIssue(
      issues,
      "error",
      "unknown-protocol-role",
      `Protocol "${protocol.protocolId ?? "protocol"}" role must be one of: ${Array.from(ProtocolRoleSet).join(", ")}.`,
      `${location}.role`,
    );
  }
  validateOptionalStringField(
    issues,
    protocol.specUri,
    `${location}.specUri`,
    "Protocol specUri",
  );
  validateOptionalStringField(
    issues,
    protocol.discoveryKey,
    `${location}.discoveryKey`,
    "Protocol discoveryKey",
  );
  validateOptionalBooleanField(
    issues,
    protocol.autoInstall,
    `${location}.autoInstall`,
    "Protocol autoInstall",
  );
  validateOptionalBooleanField(
    issues,
    protocol.advertise,
    `${location}.advertise`,
    "Protocol advertise",
  );
  validateOptionalBooleanField(
    issues,
    protocol.requireSecureTransport,
    `${location}.requireSecureTransport`,
    "Protocol requireSecureTransport",
  );
  validateOptionalIntegerField(
    issues,
    protocol.defaultPort,
    `${location}.defaultPort`,
    "Protocol defaultPort",
    { min: 0, max: 65535 },
  );
  if (
    protocolIdValid &&
    Array.isArray(declaredCapabilities) &&
    !declaredCapabilities.includes("protocol_handle") &&
    !declaredCapabilities.includes("protocol_dial")
  ) {
    pushIssue(
      issues,
      "error",
      "undeclared-protocol-capability",
      `Protocol "${protocol.protocolId}" requires "protocol_handle" or "protocol_dial" to be declared in manifest.capabilities.`,
      location,
    );
  }
  if (
    protocolIdValid &&
    normalizedRole &&
    (normalizedRole === ProtocolRole.HANDLE ||
      normalizedRole === ProtocolRole.BOTH) &&
    Array.isArray(declaredCapabilities) &&
    !declaredCapabilities.includes("protocol_handle")
  ) {
    pushIssue(
      issues,
      "error",
      "missing-handle-protocol-capability",
      `Protocol "${protocol.protocolId}" with role "${normalizedRole}" requires the "protocol_handle" capability.`,
      location,
    );
  }
  if (
    protocolIdValid &&
    normalizedRole &&
    (normalizedRole === ProtocolRole.DIAL ||
      normalizedRole === ProtocolRole.BOTH) &&
    Array.isArray(declaredCapabilities) &&
    !declaredCapabilities.includes("protocol_dial")
  ) {
    pushIssue(
      issues,
      "error",
      "missing-dial-protocol-capability",
      `Protocol "${protocol.protocolId}" with role "${normalizedRole}" requires the "protocol_dial" capability.`,
      location,
    );
  }
  if (
    protocol.advertise === true &&
    normalizedRole === ProtocolRole.DIAL
  ) {
    pushIssue(
      issues,
      "error",
      "protocol-advertise-role-conflict",
      `Protocol "${protocol.protocolId ?? "protocol"}" cannot advertise when role is "dial".`,
      `${location}.advertise`,
    );
  }
  if (
    normalizedTransportKind === ProtocolTransportKind.LIBP2P &&
    Array.isArray(declaredCapabilities) &&
    !declaredCapabilities.includes("ipfs")
  ) {
    pushIssue(
      issues,
      "error",
      "missing-ipfs-capability",
      `Protocol "${protocol.protocolId ?? "protocol"}" with transportKind "libp2p" requires the "ipfs" capability.`,
      location,
    );
  }
  if (
    wireIdValid &&
    normalizedTransportKind === ProtocolTransportKind.WS &&
    protocol.defaultPort === 443 &&
    protocol.requireSecureTransport !== true
  ) {
    pushIssue(
      issues,
      "warning",
      "insecure-secure-port-hint",
      `Protocol "${protocol.protocolId ?? "protocol"}" uses defaultPort 443 without requireSecureTransport=true.`,
      `${location}.defaultPort`,
    );
  }
}

function validateRuntimeTargets(runtimeTargets, declaredCapabilities, issues, sourceName) {
  if (runtimeTargets === undefined) {
    return;
  }
  if (!Array.isArray(runtimeTargets)) {
    pushIssue(
      issues,
      "error",
      "invalid-runtime-targets",
      "manifest.runtimeTargets must be an array of non-empty strings when present.",
      `${sourceName}.runtimeTargets`,
    );
    return;
  }
  const seenTargets = new Set();
  for (const target of runtimeTargets) {
    if (!isNonEmptyString(target)) {
      pushIssue(
        issues,
        "error",
        "invalid-runtime-target",
        "Runtime target entries must be non-empty strings.",
        `${sourceName}.runtimeTargets`,
      );
      continue;
    }
    if (seenTargets.has(target)) {
      pushIssue(
        issues,
        "warning",
        "duplicate-runtime-target",
        `Runtime target "${target}" is declared more than once.`,
        `${sourceName}.runtimeTargets`,
      );
      continue;
    }
    seenTargets.add(target);
    if (!RecommendedRuntimeTargetSet.has(target)) {
      pushIssue(
        issues,
        "warning",
        "noncanonical-runtime-target",
        `Runtime target "${target}" is not in the current canonical runtime target set.`,
        `${sourceName}.runtimeTargets`,
      );
    }
  }
  if (
    seenTargets.has(RuntimeTarget.BROWSER) &&
    Array.isArray(declaredCapabilities)
  ) {
    for (const capability of declaredCapabilities) {
      if (!BrowserIncompatibleCapabilitySet.has(capability)) {
        continue;
      }
      pushIssue(
        issues,
        "error",
        "capability-runtime-conflict",
        `Capability "${capability}" is not available in the canonical browser runtime target.`,
        `${sourceName}.capabilities`,
      );
    }
  }
}

function validateStandaloneWasiTarget(
  manifest,
  normalizedInvokeSurfaces,
  declaredCapabilities,
  issues,
  sourceName,
) {
  const runtimeTargets = Array.isArray(manifest?.runtimeTargets)
    ? manifest.runtimeTargets
    : [];
  if (!runtimeTargets.includes(RuntimeTarget.WASI)) {
    return;
  }

  if (!normalizedInvokeSurfaces.includes(InvokeSurface.COMMAND)) {
    pushIssue(
      issues,
      "error",
      "missing-wasi-command-surface",
      'Artifacts targeting the canonical "wasi" runtime must declare the "command" invoke surface so they can run as standalone WASI programs without host wrappers.',
      `${sourceName}.invokeSurfaces`,
    );
  }

  if (Array.isArray(declaredCapabilities)) {
    for (const capability of declaredCapabilities) {
      if (!StandaloneWasiCapabilitySet.has(capability)) {
        pushIssue(
          issues,
          "error",
          "capability-wasi-standalone-conflict",
          `Capability "${capability}" is not available to a standalone WASI artifact without host wrappers.`,
          `${sourceName}.capabilities`,
        );
      }
    }
  }

  if (!Array.isArray(manifest?.protocols)) {
    return;
  }
  manifest.protocols.forEach((protocol, index) => {
    const normalizedTransportKind = normalizeProtocolTransportKind(
      protocol?.transportKind,
    );
    if (
      normalizedTransportKind &&
      !StandaloneWasiProtocolTransportKindSet.has(normalizedTransportKind)
    ) {
      pushIssue(
        issues,
        "error",
        "protocol-wasi-standalone-conflict",
        `Protocol "${protocol?.protocolId ?? "protocol"}" uses transportKind "${protocol?.transportKind}", which requires a host wrapper rather than a standalone WASI runtime.`,
        `${sourceName}.protocols[${index}].transportKind`,
      );
    }
  });
}

function validateInvokeSurfaces(invokeSurfaces, issues, sourceName) {
  if (invokeSurfaces === undefined) {
    return [];
  }
  if (!Array.isArray(invokeSurfaces)) {
    pushIssue(
      issues,
      "error",
      "invalid-invoke-surfaces",
      "manifest.invokeSurfaces must be an array of non-empty strings when present.",
      `${sourceName}.invokeSurfaces`,
    );
    return [];
  }

  const seen = new Set();
  const normalized = [];
  for (const surface of invokeSurfaces) {
    if (!isNonEmptyString(surface)) {
      pushIssue(
        issues,
        "error",
        "invalid-invoke-surface",
        "Invoke surface entries must be non-empty strings.",
        `${sourceName}.invokeSurfaces`,
      );
      continue;
    }
    if (!InvokeSurfaceSet.has(surface)) {
      pushIssue(
        issues,
        "error",
        "unknown-invoke-surface",
        `Invoke surface "${surface}" is invalid.`,
        `${sourceName}.invokeSurfaces`,
      );
      continue;
    }
    if (seen.has(surface)) {
      pushIssue(
        issues,
        "warning",
        "duplicate-invoke-surface",
        `Invoke surface "${surface}" is declared more than once.`,
        `${sourceName}.invokeSurfaces`,
      );
      continue;
    }
    seen.add(surface);
    normalized.push(surface);
  }
  return normalized;
}

export function validatePluginManifest(manifest, options = {}) {
  const { sourceName = "manifest" } = options;
  const issues = [];

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    pushIssue(issues, "error", "invalid-manifest", "Manifest must be a JSON object.", sourceName);
    return buildComplianceReport({
      sourceName,
      manifest,
      issues,
      exportNames: [],
      checkedArtifact: false,
    });
  }

  validateStringField(issues, manifest.pluginId, `${sourceName}.pluginId`, "pluginId");
  validateStringField(issues, manifest.name, `${sourceName}.name`, "name");
  validateStringField(issues, manifest.version, `${sourceName}.version`, "version");
  validateStringField(issues, manifest.pluginFamily, `${sourceName}.pluginFamily`, "pluginFamily");

  const declaredCapabilities = manifest.capabilities;
  if (!Array.isArray(declaredCapabilities)) {
    pushIssue(
      issues,
      "warning",
      "missing-capabilities-array",
      "manifest.capabilities should be present as an explicit array, even when empty.",
      `${sourceName}.capabilities`,
    );
  } else {
    const seenCapabilities = new Set();
    for (const capability of declaredCapabilities) {
      if (!isNonEmptyString(capability)) {
        pushIssue(
          issues,
          "error",
          "invalid-capability",
          "Capability entries must be non-empty strings.",
          `${sourceName}.capabilities`,
        );
        continue;
      }
      if (seenCapabilities.has(capability)) {
        pushIssue(
          issues,
          "warning",
          "duplicate-capability",
          `Capability "${capability}" is declared more than once.`,
          `${sourceName}.capabilities`,
        );
      }
      seenCapabilities.add(capability);
      if (!RecommendedCapabilitySet.has(capability)) {
        pushIssue(
          issues,
          "warning",
          "noncanonical-capability",
          `Capability "${capability}" is not in the current canonical SDN coarse capability set.`,
          `${sourceName}.capabilities`,
        );
      }
    }
  }
  validateRuntimeTargets(
    manifest.runtimeTargets,
    declaredCapabilities,
    issues,
    sourceName,
  );
  const normalizedInvokeSurfaces = validateInvokeSurfaces(
    manifest.invokeSurfaces,
    issues,
    sourceName,
  );

  if (!Array.isArray(manifest.externalInterfaces)) {
    pushIssue(
      issues,
      "warning",
      "missing-external-interfaces-array",
      "manifest.externalInterfaces should be present as an explicit array, even when empty.",
      `${sourceName}.externalInterfaces`,
    );
  } else {
    manifest.externalInterfaces.forEach((externalInterface, index) => {
      validateExternalInterface(
        externalInterface,
        issues,
        `${sourceName}.externalInterfaces[${index}]`,
        declaredCapabilities,
      );
    });
  }

  if (!Array.isArray(manifest.methods) || manifest.methods.length === 0) {
    pushIssue(
      issues,
      "error",
      "missing-methods",
      "manifest.methods must declare at least one method.",
      `${sourceName}.methods`,
    );
  } else {
    const seenMethodIds = new Set();
    const methodLookup = new Map();
    manifest.methods.forEach((method, index) => {
      const location = `${sourceName}.methods[${index}]`;
      if (!method || typeof method !== "object" || Array.isArray(method)) {
        pushIssue(issues, "error", "invalid-method", "Method entries must be objects.", location);
        return;
      }
      const methodIdValid = validateStringField(issues, method.methodId, `${location}.methodId`, "methodId");
      if (methodIdValid) {
        if (seenMethodIds.has(method.methodId)) {
          pushIssue(
            issues,
            "error",
            "duplicate-method-id",
            `Method "${method.methodId}" is declared more than once.`,
            `${location}.methodId`,
          );
        }
        seenMethodIds.add(method.methodId);
        methodLookup.set(method.methodId, method);
      }
      if (!Array.isArray(method.inputPorts) || method.inputPorts.length === 0) {
        pushIssue(
          issues,
          "error",
          "missing-input-ports",
          "Methods must declare one or more inputPorts.",
          `${location}.inputPorts`,
        );
      } else {
        method.inputPorts.forEach((port, portIndex) => {
          validatePort(port, issues, `${location}.inputPorts[${portIndex}]`, "Input port");
        });
      }
      if (!Array.isArray(method.outputPorts)) {
        pushIssue(
          issues,
          "error",
          "missing-output-ports",
          "Methods must declare outputPorts as an array.",
          `${location}.outputPorts`,
        );
      } else {
        method.outputPorts.forEach((port, portIndex) => {
          validatePort(port, issues, `${location}.outputPorts[${portIndex}]`, "Output port");
        });
      }
      validateIntegerField(issues, method.maxBatch, `${location}.maxBatch`, "maxBatch", {
        min: 1,
      });
      if (!isNonEmptyString(method.drainPolicy)) {
        pushIssue(
          issues,
          "error",
          "missing-drain-policy",
          "Methods must declare drainPolicy.",
          `${location}.drainPolicy`,
        );
      } else if (!DrainPolicySet.has(method.drainPolicy)) {
        pushIssue(
          issues,
          "error",
          "invalid-drain-policy",
          `Drain policy "${method.drainPolicy}" is invalid.`,
          `${location}.drainPolicy`,
        );
      }
    });

    if (manifest.timers !== undefined && !Array.isArray(manifest.timers)) {
      pushIssue(
        issues,
        "error",
        "invalid-timers-array",
        "manifest.timers must be an array when present.",
        `${sourceName}.timers`,
      );
    } else if (Array.isArray(manifest.timers)) {
      manifest.timers.forEach((timer, index) => {
        validateTimer(
          timer,
          issues,
          `${sourceName}.timers[${index}]`,
          methodLookup,
          declaredCapabilities,
        );
      });
    }

    if (manifest.protocols !== undefined && !Array.isArray(manifest.protocols)) {
      pushIssue(
        issues,
        "error",
        "invalid-protocols-array",
        "manifest.protocols must be an array when present.",
        `${sourceName}.protocols`,
      );
    } else if (Array.isArray(manifest.protocols)) {
      manifest.protocols.forEach((protocol, index) => {
        validateProtocol(
          protocol,
          issues,
          `${sourceName}.protocols[${index}]`,
          methodLookup,
          declaredCapabilities,
        );
      });
    }
  }

  validateStandaloneWasiTarget(
    manifest,
    normalizedInvokeSurfaces,
    declaredCapabilities,
    issues,
    sourceName,
  );

  if (manifest.schemasUsed !== undefined && !Array.isArray(manifest.schemasUsed)) {
    pushIssue(
      issues,
      "error",
      "invalid-schemas-used-array",
      "manifest.schemasUsed must be an array when present.",
      `${sourceName}.schemasUsed`,
    );
  } else if (Array.isArray(manifest.schemasUsed)) {
    manifest.schemasUsed.forEach((typeRef, index) => {
      validateAllowedType(
        typeRef,
        issues,
        `${sourceName}.schemasUsed[${index}]`,
      );
    });
  }

  return buildComplianceReport({
    sourceName,
    manifest,
    issues,
    exportNames: [],
    checkedArtifact: false,
  });
}

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

export async function loadManifestFromFile(manifestPath) {
  const contents = await readFile(manifestPath, "utf8");
  if (contents.length > MAX_MANIFEST_BYTES) {
    throw new Error(
      `Manifest at ${manifestPath} exceeds ${MAX_MANIFEST_BYTES} byte limit.`,
    );
  }
  return JSON.parse(contents);
}

export function getWasmExportNames(wasmBytes) {
  const module = new WebAssembly.Module(wasmBytes);
  return WebAssembly.Module.exports(module).map((entry) => entry.name).sort();
}

export async function getWasmExportNamesFromFile(wasmPath) {
  const wasmBytes = await readFile(wasmPath);
  return getWasmExportNames(wasmBytes);
}

export async function validatePluginArtifact(options) {
  const {
    manifest,
    manifestPath = null,
    wasmPath = null,
    exportNames = null,
    sourceName = manifestPath ?? "manifest",
  } = options;
  const report = validatePluginManifest(manifest, { sourceName });
  const issues = [...report.issues];
  let resolvedExportNames = [];
  let checkedArtifact = false;
  const declaredInvokeSurfaces = Array.isArray(manifest?.invokeSurfaces)
    ? manifest.invokeSurfaces.filter((surface) => InvokeSurfaceSet.has(surface))
    : [];

  if (Array.isArray(exportNames)) {
    resolvedExportNames = [...exportNames];
    checkedArtifact = true;
  } else if (isNonEmptyString(wasmPath)) {
    resolvedExportNames = await getWasmExportNamesFromFile(wasmPath);
    checkedArtifact = true;
  }

  if (checkedArtifact) {
    for (const symbol of [
      DefaultManifestExports.pluginBytesSymbol,
      DefaultManifestExports.pluginSizeSymbol,
    ]) {
      if (!resolvedExportNames.includes(symbol)) {
        pushIssue(
          issues,
          "error",
          "missing-plugin-manifest-export",
          `Plugin artifact is missing required export "${symbol}".`,
          wasmPath ?? sourceName,
        );
      }
    }
    if (declaredInvokeSurfaces.includes(InvokeSurface.DIRECT)) {
      for (const symbol of [
        DefaultInvokeExports.invokeSymbol,
        DefaultInvokeExports.allocSymbol,
        DefaultInvokeExports.freeSymbol,
      ]) {
        if (!resolvedExportNames.includes(symbol)) {
          pushIssue(
            issues,
            "error",
            "missing-plugin-invoke-export",
            `Plugin artifact is missing required direct invoke export "${symbol}".`,
            wasmPath ?? sourceName,
          );
        }
      }
    }
    if (
      declaredInvokeSurfaces.includes(InvokeSurface.COMMAND) &&
      !resolvedExportNames.includes(DefaultInvokeExports.commandSymbol)
    ) {
      pushIssue(
        issues,
        "error",
        "missing-plugin-command-export",
        `Plugin artifact is missing required command export "${DefaultInvokeExports.commandSymbol}".`,
        wasmPath ?? sourceName,
      );
    }
  } else {
    pushIssue(
      issues,
      "warning",
      "artifact-abi-not-checked",
      "No WASM artifact or export list was provided, so ABI export checks were skipped.",
      sourceName,
    );
  }

  return buildComplianceReport({
    sourceName,
    manifest,
    issues,
    exportNames: resolvedExportNames,
    checkedArtifact,
  });
}

function buildComplianceReport({
  sourceName,
  manifest,
  issues,
  exportNames,
  checkedArtifact,
}) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return {
    ok: errors.length === 0,
    sourceName,
    manifest,
    issues,
    errors,
    warnings,
    checkedArtifact,
    exportNames,
  };
}

export async function findManifestFiles(rootDirectory) {
  const manifestPaths = [];
  await walkDirectory(rootDirectory, manifestPaths);
  manifestPaths.sort();
  return manifestPaths;
}

export async function loadComplianceConfig(rootDirectory) {
  for (const candidate of [
    path.join(rootDirectory, "sdn-plugin-compliance.json"),
    path.join(rootDirectory, ".claude", "sdn-plugin-compliance.json"),
  ]) {
    try {
      await access(candidate);
      return {
        path: candidate,
        config: JSON.parse(await readFile(candidate, "utf8")),
      };
    } catch (error) {
      if (error && error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return null;
}

export async function resolveManifestFiles(rootDirectory) {
  const loadedConfig = await loadComplianceConfig(rootDirectory);
  if (!loadedConfig) {
    return findManifestFiles(rootDirectory);
  }

  const { config } = loadedConfig;
  const resolvedPaths = new Set();
  if (Array.isArray(config.manifestPaths)) {
    for (const relativePath of config.manifestPaths) {
      resolvedPaths.add(path.resolve(rootDirectory, relativePath));
    }
  }
  if (Array.isArray(config.scanDirectories)) {
    for (const relativeDirectory of config.scanDirectories) {
      const scanRoot = path.resolve(rootDirectory, relativeDirectory);
      const discoveredPaths = await findManifestFiles(scanRoot);
      for (const discoveredPath of discoveredPaths) {
        resolvedPaths.add(discoveredPath);
      }
    }
  }
  return [...resolvedPaths].sort();
}

async function walkDirectory(currentDirectory, manifestPaths) {
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const resolvedPath = path.join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!IgnoredDirectoryNames.has(entry.name)) {
        await walkDirectory(resolvedPath, manifestPaths);
      }
      continue;
    }
    if (entry.isFile() && entry.name === "manifest.json") {
      manifestPaths.push(resolvedPath);
    }
  }
}
