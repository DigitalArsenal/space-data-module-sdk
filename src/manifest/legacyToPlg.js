/**
 * Convert a legacy PluginManifest-shaped JS object (the internal "PMAN"
 * schema used prior to SDK 0.8.x) to an object accepted by
 * `encodePlgManifest`.
 *
 * This lets plugin-manifest.json files authored against the old schema
 * continue to work while the embedded manifest bytes switch to the
 * canonical spacedatastandards.org PLG schema.
 *
 * Compatibility mappings:
 *   - plugin_family → plugin_type (best-effort; families without a PLG
 *     counterpart fall back to `Analysis`).
 *   - methods[].input_ports/output_ports are preserved as PLG METHODS and
 *     summarized into EntryFunction.input_schemas/output_schema for older
 *     consumers.
 *   - schemas_used are preserved as PLG SCHEMAS_USED and summarized into
 *     required_schemas by type name.
 *   - capabilities[] are preserved both as simple PluginCapability metadata
 *     and as richer PLGHostCapability records for host/runtime gating.
 */

import { CapabilityKind } from "../generated/orbpro/manifest/capability-kind.js";
import { PluginFamily } from "../generated/orbpro/manifest/plugin-family.js";

const FAMILY_TO_PLUGIN_TYPE = Object.freeze({
  sensor: "sensor",
  propagator: "propagator",
  renderer: "renderer",
  analysis: "analysis",
  data_source: "datasource",
  datasource: "datasource",
  comms: "comms",
  shader: "shader",
  sdf: "shader",
  infrastructure: "analysis",
  flow: "analysis",
  bridge: "analysis",
});

function normalizePluginTypeFromFamily(family) {
  let key;
  if (typeof family === "number" && typeof PluginFamily[family] === "string") {
    key = PluginFamily[family].toLowerCase();
  } else if (typeof family === "string") {
    key = family.trim().toLowerCase().replace(/-/g, "_");
  } else {
    return "analysis";
  }
  return FAMILY_TO_PLUGIN_TYPE[key] ?? "analysis";
}

function normalizeCapabilityName(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && typeof CapabilityKind[value] === "string") {
    return CapabilityKind[value].toLowerCase();
  }
  return null;
}

function firstTypeName(port) {
  if (!port || typeof port !== "object") {
    return null;
  }
  const sets = port.acceptedTypeSets ?? port.accepted_type_sets;
  if (!Array.isArray(sets)) {
    return null;
  }
  for (const set of sets) {
    const allowed = set?.allowedTypes ?? set?.allowed_types;
    if (!Array.isArray(allowed)) continue;
    for (const entry of allowed) {
      if (typeof entry === "string" && entry.length > 0) {
        return entry;
      }
      if (entry && typeof entry === "object") {
        const name =
          entry.schemaName ??
          entry.schema_name ??
          entry.name ??
          entry.typeName ??
          entry.type_name;
        if (typeof name === "string" && name.length > 0) {
          return name;
        }
      }
    }
    // Fallback: if allowedTypes is empty, use the set_id as a schema hint.
    const setId = set?.setId ?? set?.set_id;
    if (typeof setId === "string" && setId.length > 0) {
      return setId;
    }
  }
  return null;
}

function toEntryFunction(method) {
  const name = method?.methodId ?? method?.method_id ?? method?.name;
  if (typeof name !== "string" || name.length === 0) {
    return null;
  }
  const inputPorts = method?.inputPorts ?? method?.input_ports ?? [];
  const outputPorts = method?.outputPorts ?? method?.output_ports ?? [];
  const inputSchemas = Array.isArray(inputPorts)
    ? inputPorts.map((port) => firstTypeName(port)).filter(Boolean)
    : [];
  const outputSchema = Array.isArray(outputPorts)
    ? firstTypeName(outputPorts[0])
    : null;
  const description =
    typeof method?.description === "string" ? method.description : undefined;
  return {
    name,
    description,
    inputSchemas,
    outputSchema: outputSchema || undefined,
  };
}

function toPluginCapability(capability) {
  if (typeof capability === "string") {
    return { name: capability, required: true };
  }
  if (!capability || typeof capability !== "object") {
    return null;
  }
  const kind =
    normalizeCapabilityName(capability.capability) ??
    normalizeCapabilityName(capability.kind) ??
    normalizeCapabilityName(capability.name);
  if (!kind) {
    return null;
  }
  const scope =
    typeof capability.scope === "string" && capability.scope.trim().length > 0
      ? capability.scope.trim()
      : null;
  const name = scope ? `${kind}#${scope}` : kind;
  const required = capability.required !== false;
  const version =
    typeof capability.version === "string" ? capability.version : undefined;
  return { name, version, required };
}

function toHostCapability(capability) {
  if (typeof capability === "string") {
    return { capability, required: true };
  }
  if (!capability || typeof capability !== "object") {
    return null;
  }
  const kind =
    normalizeCapabilityName(capability.capability) ??
    normalizeCapabilityName(capability.kind) ??
    normalizeCapabilityName(capability.name);
  if (!kind) {
    return null;
  }
  const scope =
    typeof capability.scope === "string" && capability.scope.trim().length > 0
      ? capability.scope.trim()
      : undefined;
  const description =
    typeof capability.description === "string" &&
    capability.description.trim().length > 0
      ? capability.description.trim()
      : undefined;
  return {
    capability: kind,
    ...(scope ? { scope } : {}),
    required: capability.required !== false,
    ...(description ? { description } : {}),
  };
}

function toRequiredSchemas(schemasUsed) {
  if (!Array.isArray(schemasUsed)) {
    return [];
  }
  const names = [];
  for (const entry of schemasUsed) {
    if (typeof entry === "string" && entry.length > 0) {
      names.push(entry);
    } else if (entry && typeof entry === "object") {
      const name =
        entry.schemaName ??
        entry.schema_name ??
        entry.name ??
        entry.typeName ??
        entry.type_name;
      if (typeof name === "string" && name.length > 0) {
        names.push(name);
      }
    }
  }
  // De-duplicate while preserving order.
  return Array.from(new Set(names));
}

function collectEntrySchemas(entryFunctions) {
  const names = [];
  for (const entry of Array.isArray(entryFunctions) ? entryFunctions : []) {
    for (const name of Array.isArray(entry?.inputSchemas)
      ? entry.inputSchemas
      : []) {
      if (typeof name === "string" && name.length > 0) {
        names.push(name);
      }
    }
    if (typeof entry?.outputSchema === "string" && entry.outputSchema.length > 0) {
      names.push(entry.outputSchema);
    }
  }
  return names;
}

/**
 * Convert a legacy PluginManifest-shaped input to a PLG-shaped object.
 * If the input already looks like a PLG object (has entryFunctions OR
 * pluginType, and no `methods`), it is returned as-is with camelCase
 * normalization.
 */
export function legacyManifestToPlg(input = {}) {
  if (!input || typeof input !== "object") {
    throw new TypeError("legacyManifestToPlg expects a plain object.");
  }

  const hasLegacyMethods = Array.isArray(input.methods);
  const hasPlgEntries = Array.isArray(input.entryFunctions);
  const schemasUsed = Array.isArray(input.schemasUsed)
    ? input.schemasUsed
    : Array.isArray(input.schemas_used)
      ? input.schemas_used
      : [];

  const pluginType = hasLegacyMethods
    ? normalizePluginTypeFromFamily(input.pluginFamily ?? input.plugin_family)
    : typeof input.pluginType === "string" || typeof input.pluginType === "number"
      ? input.pluginType
      : typeof input.plugin_type === "string" || typeof input.plugin_type === "number"
        ? input.plugin_type
        : normalizePluginTypeFromFamily(input.pluginFamily);

  const entryFunctions = hasPlgEntries
    ? input.entryFunctions
    : hasLegacyMethods
      ? input.methods.map((method) => toEntryFunction(method)).filter(Boolean)
      : [];

  const requiredSchemas = Array.isArray(input.requiredSchemas)
    ? input.requiredSchemas
    : Array.isArray(input.required_schemas)
      ? input.required_schemas
    : Array.from(
        new Set([
          ...toRequiredSchemas(schemasUsed),
          ...collectEntrySchemas(entryFunctions),
        ]),
      );

  const capabilities = Array.isArray(input.capabilities)
    ? input.capabilities.map((cap) => toPluginCapability(cap)).filter(Boolean)
    : [];
  const hostCapabilitySource = Array.isArray(input.hostCapabilities)
    ? input.hostCapabilities
    : Array.isArray(input.host_capabilities)
      ? input.host_capabilities
      : Array.isArray(input.capabilities)
        ? input.capabilities
        : [];
  const hostCapabilities = hostCapabilitySource
    .map((cap) => toHostCapability(cap))
    .filter(Boolean);
  const runtimeTargets = Array.isArray(input.runtimeTargets)
    ? input.runtimeTargets
    : Array.isArray(input.runtime_targets)
      ? input.runtime_targets
      : [];
  const minPermissions = Array.isArray(input.minPermissions)
    ? input.minPermissions
    : Array.isArray(input.min_permissions)
      ? input.min_permissions
      : runtimeTargets;

  return {
    pluginId: input.pluginId ?? input.plugin_id ?? input.PLUGIN_ID,
    name: input.name ?? input.NAME,
    version: input.version ?? input.VERSION,
    description: input.description ?? input.DESCRIPTION,
    tagline: input.tagline ?? input.TAGLINE,
    pluginType,
    publisherName: input.publisherName ?? input.publisher_name,
    publisherHandle: input.publisherHandle ?? input.publisher_handle,
    publisherUrl: input.publisherUrl ?? input.publisher_url,
    supportUrl: input.supportUrl ?? input.support_url,
    tags: Array.isArray(input.tags) ? input.tags : [],
    features: Array.isArray(input.features) ? input.features : [],
    screenshotUrls: Array.isArray(input.screenshotUrls)
      ? input.screenshotUrls
      : [],
    bannerUrl: input.bannerUrl ?? input.banner_url,
    abiVersion: Number(input.abiVersion ?? input.abi_version ?? 1),
    wasmHash: input.wasmHash ?? input.wasm_hash,
    wasmSize: input.wasmSize ?? input.wasm_size,
    wasmCid: input.wasmCid ?? input.wasm_cid,
    entryFunctions,
    methods: Array.isArray(input.methods) ? input.methods : [],
    invokeSurfaces: Array.isArray(input.invokeSurfaces)
      ? input.invokeSurfaces
      : Array.isArray(input.invoke_surfaces)
        ? input.invoke_surfaces
        : [],
    runtimeTargets,
    requiredSchemas,
    schemasUsed,
    dependencies: Array.isArray(input.dependencies) ? input.dependencies : [],
    capabilities,
    hostCapabilities,
    timers: Array.isArray(input.timers) ? input.timers : [],
    protocols: Array.isArray(input.protocols) ? input.protocols : [],
    buildArtifacts: Array.isArray(input.buildArtifacts)
      ? input.buildArtifacts
      : Array.isArray(input.build_artifacts)
        ? input.build_artifacts
        : [],
    providerPeerId: input.providerPeerId ?? input.provider_peer_id,
    providerEpmCid: input.providerEpmCid ?? input.provider_epm_cid,
    encrypted: input.encrypted === true,
    requiredScope: input.requiredScope ?? input.required_scope,
    keyId: input.keyId ?? input.key_id,
    allowedDomains: Array.isArray(input.allowedDomains)
      ? input.allowedDomains
      : [],
    maxGrantTimeoutMs: input.maxGrantTimeoutMs ?? input.max_grant_timeout_ms,
    minPermissions,
    createdAt: input.createdAt ?? input.created_at,
    updatedAt: input.updatedAt ?? input.updated_at,
    documentationUrl: input.documentationUrl ?? input.documentation_url,
    changelogUrl: input.changelogUrl ?? input.changelog_url,
    iconUrl: input.iconUrl ?? input.icon_url,
    license: input.license ?? input.LICENSE,
    paymentModel: input.paymentModel ?? input.payment_model ?? "free",
    priceUsdCents: Number(input.priceUsdCents ?? input.price_usd_cents ?? 0),
    subscriptionPeriodDays: Number(
      input.subscriptionPeriodDays ?? input.subscription_period_days ?? 0,
    ),
    acceptedPaymentMethods: Array.isArray(input.acceptedPaymentMethods)
      ? input.acceptedPaymentMethods
      : [],
    listingStatus: input.listingStatus ?? input.listing_status ?? "public",
    signature: input.signature ?? input.SIGNATURE,
  };
}
