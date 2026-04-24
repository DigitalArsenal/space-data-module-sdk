/**
 * Codec for the canonical spacedatastandards.org `PLG` plugin manifest schema
 * (vendored at `schemas/spacedatastandards/PLG.fbs`, v1.0.5).
 *
 * This codec replaces the older internal `PluginManifest` (`PMAN`) schema as
 * the on-the-wire manifest format embedded in plugin wasm artifacts.
 *
 * Input shape: a plain JSON-ish object with camelCase field names mirroring
 * the PLG schema (plugin_id/pluginId both accepted). Unknown fields are
 * ignored. All fields except PLUGIN_ID/NAME/VERSION are optional.
 */
import * as flatbuffers from "flatbuffers/mjs/flatbuffers.js";

import {
  EntryFunction,
  PLG,
  PluginCapability,
  PluginDependency,
  publicationState,
  purchaseTier,
  pluginCategory,
} from "../generated/spacedatastandards/plg/index.js";
import { toUint8Array } from "../runtime/bufferLike.js";

export const PLG_FILE_IDENTIFIER = "$PLG";

function pick(manifest, ...keys) {
  for (const key of keys) {
    if (manifest && Object.hasOwn(manifest, key) && manifest[key] !== undefined) {
      return manifest[key];
    }
  }
  return undefined;
}

function toBigInt(value) {
  if (value === undefined || value === null) {
    return 0n;
  }
  if (typeof value === "bigint") {
    return value;
  }
  return BigInt(value);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => typeof entry === "string" && entry.length > 0);
}

function normalizeByteVector(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (Array.isArray(value)) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return toUint8Array(value);
  }
  if (typeof value === "string") {
    // Hex strings are accepted as a convenience for manifest YAML/JSON.
    const hex = value.startsWith("0x") ? value.slice(2) : value;
    if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
      return null;
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  return null;
}

const pluginTypeByName = Object.freeze({
  sensor: pluginCategory.Sensor,
  propagator: pluginCategory.Propagator,
  renderer: pluginCategory.Renderer,
  analysis: pluginCategory.Analysis,
  datasource: pluginCategory.DataSource,
  data_source: pluginCategory.DataSource,
  ew: pluginCategory.EW,
  comms: pluginCategory.Comms,
  physics: pluginCategory.Physics,
  shader: pluginCategory.Shader,
});

function resolvePluginType(value) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return pluginCategory.Analysis;
  }
  const key = value.trim().toLowerCase().replace(/-/g, "_");
  if (Object.hasOwn(pluginTypeByName, key)) {
    return pluginTypeByName[key];
  }
  return pluginCategory.Analysis;
}

const paymentModelByName = Object.freeze({
  free: purchaseTier.Free,
  onetime: purchaseTier.OneTime,
  one_time: purchaseTier.OneTime,
  "one-time": purchaseTier.OneTime,
  subscription: purchaseTier.Subscription,
});

function resolvePaymentModel(value) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return purchaseTier.Free;
  }
  const key = value.trim().toLowerCase();
  return paymentModelByName[key] ?? purchaseTier.Free;
}

const listingStatusByName = Object.freeze({
  public: publicationState.Public,
  unlisted: publicationState.Unlisted,
  retired: publicationState.Retired,
});

function resolveListingStatus(value) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return publicationState.Public;
  }
  const key = value.trim().toLowerCase();
  return listingStatusByName[key] ?? publicationState.Public;
}

function addStringVector(builder, values, addVectorHelper) {
  const strings = normalizeStringArray(values);
  if (strings.length === 0) {
    return 0;
  }
  const offsets = strings.map((str) => builder.createString(str));
  builder.startVector(4, offsets.length, 4);
  for (let index = offsets.length - 1; index >= 0; index--) {
    builder.addOffset(offsets[index]);
  }
  return builder.endVector();
}

function addByteVector(builder, bytes, StartVector) {
  if (!bytes || bytes.length === 0) {
    return 0;
  }
  StartVector(builder, bytes.length);
  for (let index = bytes.length - 1; index >= 0; index--) {
    builder.addInt8(bytes[index]);
  }
  return builder.endVector();
}

function addEntryFunction(builder, entry) {
  const name = typeof entry?.name === "string" ? entry.name : null;
  const description =
    typeof entry?.description === "string" ? entry.description : null;
  const inputSchemas = normalizeStringArray(
    entry?.inputSchemas ?? entry?.input_schemas,
  );
  const outputSchema =
    typeof (entry?.outputSchema ?? entry?.output_schema) === "string"
      ? entry.outputSchema ?? entry.output_schema
      : null;

  const nameOffset = name ? builder.createString(name) : 0;
  const descriptionOffset = description ? builder.createString(description) : 0;
  const inputsOffsets = inputSchemas.map((s) => builder.createString(s));
  let inputsVector = 0;
  if (inputsOffsets.length > 0) {
    builder.startVector(4, inputsOffsets.length, 4);
    for (let i = inputsOffsets.length - 1; i >= 0; i--) {
      builder.addOffset(inputsOffsets[i]);
    }
    inputsVector = builder.endVector();
  }
  const outputOffset = outputSchema ? builder.createString(outputSchema) : 0;

  EntryFunction.startEntryFunction(builder);
  if (nameOffset) {
    EntryFunction.addName(builder, nameOffset);
  }
  if (descriptionOffset) {
    EntryFunction.addDescription(builder, descriptionOffset);
  }
  if (inputsVector) {
    EntryFunction.addInputSchemas(builder, inputsVector);
  }
  if (outputOffset) {
    EntryFunction.addOutputSchema(builder, outputOffset);
  }
  return EntryFunction.endEntryFunction(builder);
}

function addPluginCapability(builder, capability) {
  const name = typeof capability?.name === "string" ? capability.name : null;
  const version =
    typeof capability?.version === "string" ? capability.version : null;
  const required = capability?.required !== false;

  const nameOffset = name ? builder.createString(name) : 0;
  const versionOffset = version ? builder.createString(version) : 0;

  PluginCapability.startPluginCapability(builder);
  if (nameOffset) {
    PluginCapability.addName(builder, nameOffset);
  }
  if (versionOffset) {
    PluginCapability.addVersion(builder, versionOffset);
  }
  PluginCapability.addRequired(builder, !!required);
  return PluginCapability.endPluginCapability(builder);
}

function addPluginDependency(builder, dependency) {
  const pluginId =
    typeof (dependency?.pluginId ?? dependency?.plugin_id) === "string"
      ? dependency.pluginId ?? dependency.plugin_id
      : null;
  const minVersion =
    typeof (dependency?.minVersion ?? dependency?.min_version) === "string"
      ? dependency.minVersion ?? dependency.min_version
      : null;
  const maxVersion =
    typeof (dependency?.maxVersion ?? dependency?.max_version) === "string"
      ? dependency.maxVersion ?? dependency.max_version
      : null;

  const pluginIdOffset = pluginId ? builder.createString(pluginId) : 0;
  const minOffset = minVersion ? builder.createString(minVersion) : 0;
  const maxOffset = maxVersion ? builder.createString(maxVersion) : 0;

  PluginDependency.startPluginDependency(builder);
  if (pluginIdOffset) {
    PluginDependency.addPluginId(builder, pluginIdOffset);
  }
  if (minOffset) {
    PluginDependency.addMinVersion(builder, minOffset);
  }
  if (maxOffset) {
    PluginDependency.addMaxVersion(builder, maxOffset);
  }
  return PluginDependency.endPluginDependency(builder);
}

function addOffsetVector(builder, offsets) {
  if (offsets.length === 0) {
    return 0;
  }
  builder.startVector(4, offsets.length, 4);
  for (let index = offsets.length - 1; index >= 0; index--) {
    builder.addOffset(offsets[index]);
  }
  return builder.endVector();
}

/**
 * Encode a PLG manifest object to a canonical `$PLG`-identified FlatBuffer.
 * Returns a Uint8Array over a fresh buffer.
 */
export function encodePlgManifest(manifest = {}) {
  const pluginId = pick(manifest, "pluginId", "plugin_id", "PLUGIN_ID");
  const name = pick(manifest, "name", "NAME");
  const version = pick(manifest, "version", "VERSION");
  if (
    typeof pluginId !== "string" ||
    pluginId.length === 0 ||
    typeof name !== "string" ||
    name.length === 0 ||
    typeof version !== "string" ||
    version.length === 0
  ) {
    throw new Error(
      "encodePlgManifest requires string pluginId, name, and version fields.",
    );
  }

  const builder = new flatbuffers.Builder(1024);

  const pluginIdOffset = builder.createString(pluginId);
  const nameOffset = builder.createString(name);
  const versionOffset = builder.createString(version);

  const description = pick(manifest, "description", "DESCRIPTION");
  const descriptionOffset =
    typeof description === "string" && description.length > 0
      ? builder.createString(description)
      : 0;

  const tagline = pick(manifest, "tagline", "TAGLINE");
  const taglineOffset =
    typeof tagline === "string" && tagline.length > 0
      ? builder.createString(tagline)
      : 0;

  const pluginTypeValue = resolvePluginType(
    pick(manifest, "pluginType", "plugin_type", "PLUGIN_TYPE", "pluginFamily"),
  );

  const publisherName = pick(
    manifest,
    "publisherName",
    "publisher_name",
    "PUBLISHER_NAME",
  );
  const publisherNameOffset =
    typeof publisherName === "string" && publisherName.length > 0
      ? builder.createString(publisherName)
      : 0;

  const publisherHandle = pick(
    manifest,
    "publisherHandle",
    "publisher_handle",
    "PUBLISHER_HANDLE",
  );
  const publisherHandleOffset =
    typeof publisherHandle === "string" && publisherHandle.length > 0
      ? builder.createString(publisherHandle)
      : 0;

  const publisherUrl = pick(
    manifest,
    "publisherUrl",
    "publisher_url",
    "PUBLISHER_URL",
  );
  const publisherUrlOffset =
    typeof publisherUrl === "string" && publisherUrl.length > 0
      ? builder.createString(publisherUrl)
      : 0;

  const supportUrl = pick(manifest, "supportUrl", "support_url", "SUPPORT_URL");
  const supportUrlOffset =
    typeof supportUrl === "string" && supportUrl.length > 0
      ? builder.createString(supportUrl)
      : 0;

  const tagsOffset = addStringVector(
    builder,
    pick(manifest, "tags", "TAGS"),
  );
  const featuresOffset = addStringVector(
    builder,
    pick(manifest, "features", "FEATURES"),
  );
  const screenshotUrlsOffset = addStringVector(
    builder,
    pick(manifest, "screenshotUrls", "screenshot_urls", "SCREENSHOT_URLS"),
  );

  const bannerUrl = pick(manifest, "bannerUrl", "banner_url", "BANNER_URL");
  const bannerUrlOffset =
    typeof bannerUrl === "string" && bannerUrl.length > 0
      ? builder.createString(bannerUrl)
      : 0;

  const abiVersion = Number.isFinite(
    pick(manifest, "abiVersion", "abi_version", "ABI_VERSION"),
  )
    ? Number(pick(manifest, "abiVersion", "abi_version", "ABI_VERSION"))
    : 1;

  const wasmHashBytes = normalizeByteVector(
    pick(manifest, "wasmHash", "wasm_hash", "WASM_HASH"),
  );
  const wasmHashOffset = addByteVector(
    builder,
    wasmHashBytes,
    PLG.startWasmHashVector,
  );

  const wasmSize = toBigInt(
    pick(manifest, "wasmSize", "wasm_size", "WASM_SIZE"),
  );

  const wasmCid = pick(manifest, "wasmCid", "wasm_cid", "WASM_CID");
  const wasmCidOffset =
    typeof wasmCid === "string" && wasmCid.length > 0
      ? builder.createString(wasmCid)
      : 0;

  const encryptedWasmHashBytes = normalizeByteVector(
    pick(
      manifest,
      "encryptedWasmHash",
      "encrypted_wasm_hash",
      "ENCRYPTED_WASM_HASH",
    ),
  );
  const encryptedWasmHashOffset = addByteVector(
    builder,
    encryptedWasmHashBytes,
    PLG.startEncryptedWasmHashVector,
  );

  const encryptedWasmSize = toBigInt(
    pick(
      manifest,
      "encryptedWasmSize",
      "encrypted_wasm_size",
      "ENCRYPTED_WASM_SIZE",
    ),
  );

  const entryFunctions = pick(
    manifest,
    "entryFunctions",
    "entry_functions",
    "ENTRY_FUNCTIONS",
  );
  const entryOffsets = Array.isArray(entryFunctions)
    ? entryFunctions.map((entry) => addEntryFunction(builder, entry))
    : [];
  const entryFunctionsOffset = addOffsetVector(builder, entryOffsets);

  const requiredSchemasOffset = addStringVector(
    builder,
    pick(manifest, "requiredSchemas", "required_schemas", "REQUIRED_SCHEMAS"),
  );

  const dependencies = pick(manifest, "dependencies", "DEPENDENCIES");
  const dependencyOffsets = Array.isArray(dependencies)
    ? dependencies.map((dep) => addPluginDependency(builder, dep))
    : [];
  const dependenciesOffset = addOffsetVector(builder, dependencyOffsets);

  const capabilities = pick(manifest, "capabilities", "CAPABILITIES");
  const capabilityOffsets = Array.isArray(capabilities)
    ? capabilities.map((cap) => addPluginCapability(builder, cap))
    : [];
  const capabilitiesOffset = addOffsetVector(builder, capabilityOffsets);

  const providerPeerId = pick(
    manifest,
    "providerPeerId",
    "provider_peer_id",
    "PROVIDER_PEER_ID",
  );
  const providerPeerIdOffset =
    typeof providerPeerId === "string" && providerPeerId.length > 0
      ? builder.createString(providerPeerId)
      : 0;

  const providerEpmCid = pick(
    manifest,
    "providerEpmCid",
    "provider_epm_cid",
    "PROVIDER_EPM_CID",
  );
  const providerEpmCidOffset =
    typeof providerEpmCid === "string" && providerEpmCid.length > 0
      ? builder.createString(providerEpmCid)
      : 0;

  const encrypted = manifest?.encrypted === undefined
    ? false
    : !!manifest.encrypted;

  const requiredScope = pick(
    manifest,
    "requiredScope",
    "required_scope",
    "REQUIRED_SCOPE",
  );
  const requiredScopeOffset =
    typeof requiredScope === "string" && requiredScope.length > 0
      ? builder.createString(requiredScope)
      : 0;

  const keyId = pick(manifest, "keyId", "key_id", "KEY_ID");
  const keyIdOffset =
    typeof keyId === "string" && keyId.length > 0
      ? builder.createString(keyId)
      : 0;

  const allowedDomainsOffset = addStringVector(
    builder,
    pick(manifest, "allowedDomains", "allowed_domains", "ALLOWED_DOMAINS"),
  );

  const maxGrantTimeoutMs = toBigInt(
    pick(
      manifest,
      "maxGrantTimeoutMs",
      "max_grant_timeout_ms",
      "MAX_GRANT_TIMEOUT_MS",
    ),
  );

  const minPermissionsOffset = addStringVector(
    builder,
    pick(manifest, "minPermissions", "min_permissions", "MIN_PERMISSIONS"),
  );

  const createdAt = toBigInt(
    pick(manifest, "createdAt", "created_at", "CREATED_AT"),
  );
  const updatedAt = toBigInt(
    pick(manifest, "updatedAt", "updated_at", "UPDATED_AT"),
  );

  const documentationUrl = pick(
    manifest,
    "documentationUrl",
    "documentation_url",
    "DOCUMENTATION_URL",
  );
  const documentationUrlOffset =
    typeof documentationUrl === "string" && documentationUrl.length > 0
      ? builder.createString(documentationUrl)
      : 0;

  const changelogUrl = pick(
    manifest,
    "changelogUrl",
    "changelog_url",
    "CHANGELOG_URL",
  );
  const changelogUrlOffset =
    typeof changelogUrl === "string" && changelogUrl.length > 0
      ? builder.createString(changelogUrl)
      : 0;

  const iconUrl = pick(manifest, "iconUrl", "icon_url", "ICON_URL");
  const iconUrlOffset =
    typeof iconUrl === "string" && iconUrl.length > 0
      ? builder.createString(iconUrl)
      : 0;

  const license = pick(manifest, "license", "LICENSE");
  const licenseOffset =
    typeof license === "string" && license.length > 0
      ? builder.createString(license)
      : 0;

  const paymentModelValue = resolvePaymentModel(
    pick(manifest, "paymentModel", "payment_model", "PAYMENT_MODEL"),
  );

  const priceUsdCents = Number.isFinite(
    pick(manifest, "priceUsdCents", "price_usd_cents", "PRICE_USD_CENTS"),
  )
    ? Number(pick(manifest, "priceUsdCents", "price_usd_cents", "PRICE_USD_CENTS"))
    : 0;

  const subscriptionPeriodDays = Number.isFinite(
    pick(
      manifest,
      "subscriptionPeriodDays",
      "subscription_period_days",
      "SUBSCRIPTION_PERIOD_DAYS",
    ),
  )
    ? Number(
        pick(
          manifest,
          "subscriptionPeriodDays",
          "subscription_period_days",
          "SUBSCRIPTION_PERIOD_DAYS",
        ),
      )
    : 0;

  const acceptedPaymentMethodsOffset = addStringVector(
    builder,
    pick(
      manifest,
      "acceptedPaymentMethods",
      "accepted_payment_methods",
      "ACCEPTED_PAYMENT_METHODS",
    ),
  );

  const listingStatusValue = resolveListingStatus(
    pick(manifest, "listingStatus", "listing_status", "LISTING_STATUS"),
  );

  const signatureBytes = normalizeByteVector(
    pick(manifest, "signature", "SIGNATURE"),
  );
  const signatureOffset = addByteVector(
    builder,
    signatureBytes,
    PLG.startSignatureVector,
  );

  PLG.startPLG(builder);
  PLG.addPluginId(builder, pluginIdOffset);
  PLG.addName(builder, nameOffset);
  PLG.addVersion(builder, versionOffset);
  if (descriptionOffset) PLG.addDescription(builder, descriptionOffset);
  if (taglineOffset) PLG.addTagline(builder, taglineOffset);
  PLG.addPluginType(builder, pluginTypeValue);
  if (publisherNameOffset) PLG.addPublisherName(builder, publisherNameOffset);
  if (publisherHandleOffset)
    PLG.addPublisherHandle(builder, publisherHandleOffset);
  if (publisherUrlOffset) PLG.addPublisherUrl(builder, publisherUrlOffset);
  if (supportUrlOffset) PLG.addSupportUrl(builder, supportUrlOffset);
  if (tagsOffset) PLG.addTags(builder, tagsOffset);
  if (featuresOffset) PLG.addFeatures(builder, featuresOffset);
  if (screenshotUrlsOffset)
    PLG.addScreenshotUrls(builder, screenshotUrlsOffset);
  if (bannerUrlOffset) PLG.addBannerUrl(builder, bannerUrlOffset);
  PLG.addAbiVersion(builder, abiVersion);
  if (wasmHashOffset) PLG.addWasmHash(builder, wasmHashOffset);
  if (wasmSize !== 0n) PLG.addWasmSize(builder, wasmSize);
  if (wasmCidOffset) PLG.addWasmCid(builder, wasmCidOffset);
  if (encryptedWasmHashOffset)
    PLG.addEncryptedWasmHash(builder, encryptedWasmHashOffset);
  if (encryptedWasmSize !== 0n)
    PLG.addEncryptedWasmSize(builder, encryptedWasmSize);
  if (entryFunctionsOffset)
    PLG.addEntryFunctions(builder, entryFunctionsOffset);
  if (requiredSchemasOffset)
    PLG.addRequiredSchemas(builder, requiredSchemasOffset);
  if (dependenciesOffset) PLG.addDependencies(builder, dependenciesOffset);
  if (capabilitiesOffset) PLG.addCapabilities(builder, capabilitiesOffset);
  if (providerPeerIdOffset)
    PLG.addProviderPeerId(builder, providerPeerIdOffset);
  if (providerEpmCidOffset)
    PLG.addProviderEpmCid(builder, providerEpmCidOffset);
  PLG.addEncrypted(builder, encrypted);
  if (requiredScopeOffset) PLG.addRequiredScope(builder, requiredScopeOffset);
  if (keyIdOffset) PLG.addKeyId(builder, keyIdOffset);
  if (allowedDomainsOffset)
    PLG.addAllowedDomains(builder, allowedDomainsOffset);
  if (maxGrantTimeoutMs !== 0n)
    PLG.addMaxGrantTimeoutMs(builder, maxGrantTimeoutMs);
  if (minPermissionsOffset)
    PLG.addMinPermissions(builder, minPermissionsOffset);
  if (createdAt !== 0n) PLG.addCreatedAt(builder, createdAt);
  if (updatedAt !== 0n) PLG.addUpdatedAt(builder, updatedAt);
  if (documentationUrlOffset)
    PLG.addDocumentationUrl(builder, documentationUrlOffset);
  if (changelogUrlOffset) PLG.addChangelogUrl(builder, changelogUrlOffset);
  if (iconUrlOffset) PLG.addIconUrl(builder, iconUrlOffset);
  if (licenseOffset) PLG.addLicense(builder, licenseOffset);
  PLG.addPaymentModel(builder, paymentModelValue);
  PLG.addPriceUsdCents(builder, priceUsdCents);
  PLG.addSubscriptionPeriodDays(builder, subscriptionPeriodDays);
  if (acceptedPaymentMethodsOffset)
    PLG.addAcceptedPaymentMethods(builder, acceptedPaymentMethodsOffset);
  PLG.addListingStatus(builder, listingStatusValue);
  if (signatureOffset) PLG.addSignature(builder, signatureOffset);
  const rootOffset = PLG.endPLG(builder);
  PLG.finishPLGBuffer(builder, rootOffset);
  return builder.asUint8Array();
}

function readStringVector(root, lengthFn, getterFn) {
  const length = typeof root[lengthFn] === "function" ? root[lengthFn]() : 0;
  const out = [];
  for (let index = 0; index < length; index++) {
    const value = root[getterFn](index);
    if (typeof value === "string") {
      out.push(value);
    }
  }
  return out;
}

/**
 * Decode a `$PLG`-identified FlatBuffer back to a JS manifest object.
 * Throws if the identifier does not match.
 */
export function decodePlgManifest(data) {
  const bytes = toUint8Array(data);
  if (!bytes) {
    throw new TypeError(
      "decodePlgManifest expects Uint8Array, ArrayBuffer, or ByteBuffer.",
    );
  }
  const bb = new flatbuffers.ByteBuffer(bytes);
  if (!PLG.bufferHasIdentifier(bb)) {
    throw new Error(
      `PLG manifest buffer identifier mismatch (expected ${PLG_FILE_IDENTIFIER}).`,
    );
  }
  const root = PLG.getRootAsPLG(bb);

  const entryFunctions = [];
  const entryLen =
    typeof root.entryFunctionsLength === "function"
      ? root.entryFunctionsLength()
      : 0;
  for (let i = 0; i < entryLen; i++) {
    const entry = root.entryFunctions(i);
    if (!entry) continue;
    entryFunctions.push({
      name: entry.name(),
      description: entry.description() || undefined,
      inputSchemas: readStringVector(
        entry,
        "inputSchemasLength",
        "inputSchemas",
      ),
      outputSchema: entry.outputSchema() || undefined,
    });
  }

  const capabilities = [];
  const capLen =
    typeof root.capabilitiesLength === "function"
      ? root.capabilitiesLength()
      : 0;
  for (let i = 0; i < capLen; i++) {
    const cap = root.capabilities(i);
    if (!cap) continue;
    capabilities.push({
      name: cap.name() || undefined,
      version: cap.version() || undefined,
      required: !!cap.required(),
    });
  }

  const dependencies = [];
  const depLen =
    typeof root.dependenciesLength === "function"
      ? root.dependenciesLength()
      : 0;
  for (let i = 0; i < depLen; i++) {
    const dep = root.dependencies(i);
    if (!dep) continue;
    dependencies.push({
      pluginId: dep.pluginId() || undefined,
      minVersion: dep.minVersion() || undefined,
      maxVersion: dep.maxVersion() || undefined,
    });
  }

  return {
    pluginId: root.pluginId(),
    name: root.name(),
    version: root.version(),
    description: root.description() || undefined,
    tagline: root.tagline() || undefined,
    pluginType: root.pluginType(),
    publisherName: root.publisherName() || undefined,
    publisherHandle: root.publisherHandle() || undefined,
    publisherUrl: root.publisherUrl() || undefined,
    supportUrl: root.supportUrl() || undefined,
    tags: readStringVector(root, "tagsLength", "tags"),
    features: readStringVector(root, "featuresLength", "features"),
    screenshotUrls: readStringVector(
      root,
      "screenshotUrlsLength",
      "screenshotUrls",
    ),
    bannerUrl: root.bannerUrl() || undefined,
    abiVersion: root.abiVersion(),
    wasmHash: root.wasmHashArray() ?? null,
    wasmSize: root.wasmSize(),
    wasmCid: root.wasmCid() || undefined,
    encryptedWasmHash: root.encryptedWasmHashArray() ?? null,
    encryptedWasmSize: root.encryptedWasmSize(),
    entryFunctions,
    requiredSchemas: readStringVector(
      root,
      "requiredSchemasLength",
      "requiredSchemas",
    ),
    dependencies,
    capabilities,
    providerPeerId: root.providerPeerId() || undefined,
    providerEpmCid: root.providerEpmCid() || undefined,
    encrypted: !!root.encrypted(),
    requiredScope: root.requiredScope() || undefined,
    keyId: root.keyId() || undefined,
    allowedDomains: readStringVector(
      root,
      "allowedDomainsLength",
      "allowedDomains",
    ),
    maxGrantTimeoutMs: root.maxGrantTimeoutMs(),
    minPermissions: readStringVector(
      root,
      "minPermissionsLength",
      "minPermissions",
    ),
    createdAt: root.createdAt(),
    updatedAt: root.updatedAt(),
    documentationUrl: root.documentationUrl() || undefined,
    changelogUrl: root.changelogUrl() || undefined,
    iconUrl: root.iconUrl() || undefined,
    license: root.license() || undefined,
    paymentModel: root.paymentModel(),
    priceUsdCents: root.priceUsdCents(),
    subscriptionPeriodDays: root.subscriptionPeriodDays(),
    acceptedPaymentMethods: readStringVector(
      root,
      "acceptedPaymentMethodsLength",
      "acceptedPaymentMethods",
    ),
    listingStatus: root.listingStatus(),
    signature: root.signatureArray() ?? null,
  };
}

/**
 * Verify that a byte buffer carries the canonical PLG file identifier.
 * Returns `true` iff the bytes begin with a FlatBuffer root offset followed
 * by the `$PLG` identifier. Does not throw.
 */
export function isPlgManifestBuffer(data) {
  const bytes = toUint8Array(data);
  if (!bytes || bytes.length < 8) {
    return false;
  }
  const bb = new flatbuffers.ByteBuffer(bytes);
  return PLG.bufferHasIdentifier(bb);
}
