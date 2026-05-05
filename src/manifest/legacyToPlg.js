/**
 * Convert a legacy PluginManifest-shaped JS object (the internal "PMAN"
 * schema used prior to SDK 0.8.x) to an object accepted by
 * `encodePlgManifest`.
 *
 * This lets plugin-manifest.json files authored against the old schema
 * continue to work while the embedded manifest bytes switch to the
 * canonical spacedatastandards.org PLG schema.
 *
 * Lossy mappings:
 *   - plugin_family → plugin_type (best-effort; families without a PLG
 *     counterpart fall back to `Analysis`).
 *   - methods[].input_ports/output_ports → EntryFunction.input_schemas /
 *     output_schema (first accepted type per port).
 *   - drain_policy, max_batch, port cardinalities, timers, protocols,
 *     invoke_surfaces, runtime_targets, build_artifacts are dropped;
 *     these are runtime-host concerns that live out-of-band under PLG.
 *   - schemas_used → required_schemas (type name only).
 *   - capabilities[] preserved; each entry becomes a
 *     PluginCapability {name, required}. (The "scope" on legacy entries is
 *     folded into the capability name as `kind#scope` if present.)
 */

import { CapabilityKind } from "../generated/orbpro/manifest/capability-kind.js";

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
  if (typeof family !== "string") {
    return "analysis";
  }
  const key = family.trim().toLowerCase().replace(/-/g, "_");
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

  const pluginType = hasLegacyMethods
    ? normalizePluginTypeFromFamily(input.pluginFamily ?? input.plugin_family)
    : typeof input.pluginType === "string"
      ? input.pluginType
      : typeof input.plugin_type === "string"
        ? input.plugin_type
        : normalizePluginTypeFromFamily(input.pluginFamily);

  const entryFunctions = hasPlgEntries
    ? input.entryFunctions
    : hasLegacyMethods
      ? input.methods.map((method) => toEntryFunction(method)).filter(Boolean)
      : [];

  const requiredSchemas = Array.isArray(input.requiredSchemas)
    ? input.requiredSchemas
    : Array.from(
        new Set([
          ...toRequiredSchemas(input.schemasUsed ?? input.schemas_used),
          ...collectEntrySchemas(entryFunctions),
        ]),
      );

  const capabilities = Array.isArray(input.capabilities)
    ? input.capabilities.map((cap) => toPluginCapability(cap)).filter(Boolean)
    : [];

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
    requiredSchemas,
    dependencies: Array.isArray(input.dependencies) ? input.dependencies : [],
    capabilities,
    providerPeerId: input.providerPeerId ?? input.provider_peer_id,
    providerEpmCid: input.providerEpmCid ?? input.provider_epm_cid,
    encrypted: input.encrypted === true,
    requiredScope: input.requiredScope ?? input.required_scope,
    keyId: input.keyId ?? input.key_id,
    allowedDomains: Array.isArray(input.allowedDomains)
      ? input.allowedDomains
      : [],
    maxGrantTimeoutMs: input.maxGrantTimeoutMs ?? input.max_grant_timeout_ms,
    minPermissions: Array.isArray(input.minPermissions)
      ? input.minPermissions
      : Array.isArray(input.runtimeTargets)
        ? input.runtimeTargets
        : [],
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
