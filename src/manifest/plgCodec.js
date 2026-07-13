/**
 * Codec for the canonical spacedatastandards.org `PLG` plugin manifest schema
 * generated from the installed SDS package's `schema/PLG/main.fbs`.
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
  FlatBufferTypeRef,
  PLG,
  PLGAcceptedTypeSet,
  PLGBuildArtifact,
  PLGHostCapability,
  PLGMethodManifest,
  PLGPortManifest,
  PLGProtocolSpec,
  PLGTimerSpec,
  PluginCapability,
  PluginDependency,
  drainBehavior,
  hostCapabilityKind,
  invokeSurfaceKind,
  payloadWireFormat,
  publicationState,
  purchaseTier,
  pluginCategory,
} from "../generated/spacedatastandards/plg/main.js";
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

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeUnsignedInteger(value, fallback = 0) {
  const normalized = Number(value ?? fallback);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(normalized));
}

function canonicalEnumKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
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

const payloadWireFormatByName = Object.freeze({
  flatbuffer: payloadWireFormat.FLATBUFFER,
  aligned_binary: payloadWireFormat.ALIGNED_BINARY,
});

function resolvePayloadWireFormat(value) {
  if (typeof value === "number") {
    return value;
  }
  return payloadWireFormatByName[canonicalEnumKey(value)] ?? payloadWireFormat.FLATBUFFER;
}

function payloadWireFormatName(value) {
  return resolvePayloadWireFormat(value) === payloadWireFormat.ALIGNED_BINARY
    ? "aligned-binary"
    : "flatbuffer";
}

const invokeSurfaceByName = Object.freeze({
  direct: invokeSurfaceKind.DIRECT,
  command: invokeSurfaceKind.COMMAND,
});

function resolveInvokeSurface(value) {
  if (typeof value === "number") {
    return value;
  }
  return invokeSurfaceByName[canonicalEnumKey(value)] ?? null;
}

function invokeSurfaceName(value) {
  return resolveInvokeSurface(value) === invokeSurfaceKind.COMMAND
    ? "command"
    : "direct";
}

const drainPolicyByName = Object.freeze({
  single_shot: drainBehavior.SINGLE_SHOT,
  drain_until_yield: drainBehavior.DRAIN_UNTIL_YIELD,
  drain_to_empty: drainBehavior.DRAIN_TO_EMPTY,
});

function resolveDrainPolicy(value) {
  if (typeof value === "number") {
    return value;
  }
  return drainPolicyByName[canonicalEnumKey(value)] ?? drainBehavior.DRAIN_UNTIL_YIELD;
}

function drainPolicyName(value) {
  switch (resolveDrainPolicy(value)) {
    case drainBehavior.SINGLE_SHOT:
      return "single-shot";
    case drainBehavior.DRAIN_TO_EMPTY:
      return "drain-to-empty";
    case drainBehavior.DRAIN_UNTIL_YIELD:
    default:
      return "drain-until-yield";
  }
}

const hostCapabilityByName = Object.freeze({
  clock: hostCapabilityKind.CLOCK,
  random: hostCapabilityKind.RANDOM,
  logging: hostCapabilityKind.LOGGING,
  timers: hostCapabilityKind.TIMERS,
  pubsub: hostCapabilityKind.PUBSUB,
  protocol_dial: hostCapabilityKind.PROTOCOL_DIAL,
  protocol_handle: hostCapabilityKind.PROTOCOL_HANDLE,
  storage_query: hostCapabilityKind.STORAGE_QUERY,
  scene_access: hostCapabilityKind.SCENE_ACCESS,
  entity_access: hostCapabilityKind.ENTITY_ACCESS,
  render_hooks: hostCapabilityKind.RENDER_HOOKS,
  http: hostCapabilityKind.HTTP,
  filesystem: hostCapabilityKind.FILESYSTEM,
  pipe: hostCapabilityKind.PIPE,
  network: hostCapabilityKind.NETWORK,
  database: hostCapabilityKind.DATABASE,
  storage_adapter: hostCapabilityKind.STORAGE_ADAPTER,
  storage_write: hostCapabilityKind.STORAGE_WRITE,
  wallet_sign: hostCapabilityKind.WALLET_SIGN,
  ipfs: hostCapabilityKind.IPFS,
  tls: hostCapabilityKind.TLS,
  mqtt: hostCapabilityKind.MQTT,
  websocket: hostCapabilityKind.WEBSOCKET,
  tcp: hostCapabilityKind.TCP,
  udp: hostCapabilityKind.UDP,
  process_exec: hostCapabilityKind.PROCESS_EXEC,
  context_read: hostCapabilityKind.CONTEXT_READ,
  context_write: hostCapabilityKind.CONTEXT_WRITE,
  crypto_hash: hostCapabilityKind.CRYPTO_HASH,
  crypto_sign: hostCapabilityKind.CRYPTO_SIGN,
  crypto_verify: hostCapabilityKind.CRYPTO_VERIFY,
  crypto_encrypt: hostCapabilityKind.CRYPTO_ENCRYPT,
  crypto_decrypt: hostCapabilityKind.CRYPTO_DECRYPT,
  crypto_key_agreement: hostCapabilityKind.CRYPTO_KEY_AGREEMENT,
  crypto_kdf: hostCapabilityKind.CRYPTO_KDF,
  schedule_cron: hostCapabilityKind.SCHEDULE_CRON,
  storage_ingest: hostCapabilityKind.STORAGE_INGEST,
});

function resolveHostCapability(value) {
  if (typeof value === "number") {
    return value;
  }
  return hostCapabilityByName[canonicalEnumKey(value)] ?? hostCapabilityKind.CLOCK;
}

function hostCapabilityName(value) {
  const enumName = hostCapabilityKind[resolveHostCapability(value)];
  return typeof enumName === "string" ? enumName.toLowerCase() : "clock";
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
  const source =
    typeof capability === "string" ? { name: capability } : capability ?? {};
  const name =
    typeof source.name === "string"
      ? source.name
      : typeof source.capability === "string"
        ? source.capability
        : null;
  const version =
    typeof source.version === "string" ? source.version : null;
  const required = source.required !== false;

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

function addFlatBufferTypeRef(builder, typeRef = {}) {
  if (typeof typeRef === "string") {
    typeRef = { schemaName: typeRef };
  }
  const schemaName = normalizeOptionalString(
    pick(typeRef, "schemaName", "schema_name", "SCHEMA_NAME", "name"),
  );
  const fileIdentifier = normalizeOptionalString(
    pick(typeRef, "fileIdentifier", "file_identifier", "FILE_IDENTIFIER"),
  );
  const schemaVersion = normalizeOptionalString(
    pick(typeRef, "schemaVersion", "schema_version", "SCHEMA_VERSION"),
  );
  const rootType = normalizeOptionalString(
    pick(typeRef, "rootTypeName", "root_type_name", "rootType", "ROOT_TYPE"),
  );
  const schemaHash = normalizeByteVector(
    pick(typeRef, "schemaHash", "schema_hash", "SCHEMA_HASH"),
  );
  const acceptsAnyFlatbuffer = Boolean(
    pick(
      typeRef,
      "acceptsAnyFlatbuffer",
      "accepts_any_flatbuffer",
      "ACCEPTS_ANY_FLATBUFFER",
    ) ?? false,
  );
  const wireFormat = resolvePayloadWireFormat(
    pick(typeRef, "wireFormat", "wire_format", "WIRE_FORMAT"),
  );
  const fixedStringLength = normalizeUnsignedInteger(
    pick(typeRef, "fixedStringLength", "fixed_string_length", "FIXED_STRING_LENGTH"),
  );
  const byteLength = normalizeUnsignedInteger(
    pick(typeRef, "byteLength", "byte_length", "BYTE_LENGTH"),
  );
  const requiredAlignment = normalizeUnsignedInteger(
    pick(typeRef, "requiredAlignment", "required_alignment", "REQUIRED_ALIGNMENT"),
  );

  const schemaNameOffset = schemaName ? builder.createString(schemaName) : 0;
  const fileIdentifierOffset = fileIdentifier
    ? builder.createString(fileIdentifier)
    : 0;
  const schemaVersionOffset = schemaVersion ? builder.createString(schemaVersion) : 0;
  const rootTypeOffset = rootType ? builder.createString(rootType) : 0;
  const schemaHashOffset = addByteVector(
    builder,
    schemaHash,
    FlatBufferTypeRef.startSchemaHashVector,
  );

  FlatBufferTypeRef.startFlatBufferTypeRef(builder);
  if (schemaNameOffset) FlatBufferTypeRef.addSchemaName(builder, schemaNameOffset);
  if (fileIdentifierOffset)
    FlatBufferTypeRef.addFileIdentifier(builder, fileIdentifierOffset);
  if (schemaVersionOffset)
    FlatBufferTypeRef.addSchemaVersion(builder, schemaVersionOffset);
  if (rootTypeOffset) FlatBufferTypeRef.addRootType(builder, rootTypeOffset);
  if (schemaHashOffset) FlatBufferTypeRef.addSchemaHash(builder, schemaHashOffset);
  if (acceptsAnyFlatbuffer)
    FlatBufferTypeRef.addAcceptsAnyFlatbuffer(builder, acceptsAnyFlatbuffer);
  if (wireFormat !== payloadWireFormat.FLATBUFFER)
    FlatBufferTypeRef.addWireFormat(builder, wireFormat);
  if (fixedStringLength > 0)
    FlatBufferTypeRef.addFixedStringLength(builder, fixedStringLength);
  if (byteLength > 0) FlatBufferTypeRef.addByteLength(builder, byteLength);
  if (requiredAlignment > 0)
    FlatBufferTypeRef.addRequiredAlignment(builder, requiredAlignment);
  return FlatBufferTypeRef.endFlatBufferTypeRef(builder);
}

function typeRefToObject(typeRef) {
  if (!typeRef) {
    return null;
  }
  const schemaHash = typeRef.schemaHashArray?.() ?? null;
  const fixedStringLength = typeRef.FIXED_STRING_LENGTH?.() ?? 0;
  const byteLength = typeRef.BYTE_LENGTH?.() ?? 0;
  const requiredAlignment = typeRef.REQUIRED_ALIGNMENT?.() ?? 0;
  return {
    schemaName: typeRef.SCHEMA_NAME?.() || undefined,
    fileIdentifier: typeRef.FILE_IDENTIFIER?.() || undefined,
    schemaVersion: typeRef.SCHEMA_VERSION?.() || undefined,
    rootTypeName: typeRef.ROOT_TYPE?.() || undefined,
    ...(schemaHash && schemaHash.length > 0 ? { schemaHash } : {}),
    ...(typeRef.ACCEPTS_ANY_FLATBUFFER?.()
      ? { acceptsAnyFlatbuffer: true }
      : {}),
    wireFormat: payloadWireFormatName(typeRef.WIRE_FORMAT?.()),
    ...(fixedStringLength > 0 ? { fixedStringLength } : {}),
    ...(byteLength > 0 ? { byteLength } : {}),
    ...(requiredAlignment > 0 ? { requiredAlignment } : {}),
  };
}

function normalizeAllowedWireFormats(typeSet = {}) {
  const explicit = pick(
    typeSet,
    "allowedWireFormats",
    "allowed_wire_formats",
    "ALLOWED_WIRE_FORMATS",
  );
  const values = Array.isArray(explicit)
    ? explicit.map((entry) => resolvePayloadWireFormat(entry))
    : [];
  if (values.length === 0) {
    for (const allowedType of Array.isArray(typeSet.allowedTypes)
      ? typeSet.allowedTypes
      : []) {
      values.push(resolvePayloadWireFormat(allowedType?.wireFormat));
    }
  }
  const unique = [];
  const seen = new Set();
  for (const value of values.length > 0 ? values : [payloadWireFormat.FLATBUFFER]) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function addAcceptedTypeSet(builder, typeSet = {}) {
  const setId = normalizeOptionalString(
    pick(typeSet, "setId", "set_id", "SET_ID"),
  );
  if (!setId) {
    return 0;
  }
  const allowedTypes = Array.isArray(typeSet.allowedTypes)
    ? typeSet.allowedTypes
    : Array.isArray(typeSet.ALLOWED_TYPES)
      ? typeSet.ALLOWED_TYPES
      : [];
  const allowedTypeOffsets = allowedTypes.map((entry) =>
    addFlatBufferTypeRef(builder, entry),
  );
  const allowedTypesOffset = PLGAcceptedTypeSet.createAllowedTypesVector(
    builder,
    allowedTypeOffsets,
  );
  const allowedWireFormatsOffset =
    PLGAcceptedTypeSet.createAllowedWireFormatsVector(
      builder,
      normalizeAllowedWireFormats(typeSet),
    );
  const description = normalizeOptionalString(
    pick(typeSet, "description", "DESCRIPTION"),
  );
  const setIdOffset = builder.createString(setId);
  const descriptionOffset = description ? builder.createString(description) : 0;
  PLGAcceptedTypeSet.startPLGAcceptedTypeSet(builder);
  PLGAcceptedTypeSet.addSetId(builder, setIdOffset);
  if (allowedTypesOffset)
    PLGAcceptedTypeSet.addAllowedTypes(builder, allowedTypesOffset);
  if (allowedWireFormatsOffset)
    PLGAcceptedTypeSet.addAllowedWireFormats(builder, allowedWireFormatsOffset);
  if (descriptionOffset)
    PLGAcceptedTypeSet.addDescription(builder, descriptionOffset);
  return PLGAcceptedTypeSet.endPLGAcceptedTypeSet(builder);
}

function acceptedTypeSetToObject(typeSet) {
  const allowedTypes = [];
  const allowedTypeCount = typeSet?.allowedTypesLength?.() ?? 0;
  for (let index = 0; index < allowedTypeCount; index += 1) {
    const value = typeRefToObject(typeSet.ALLOWED_TYPES(index));
    if (value) {
      allowedTypes.push(value);
    }
  }
  return {
    setId: typeSet.SET_ID(),
    allowedTypes,
    allowedWireFormats: Array.from(
      typeSet.allowedWireFormatsArray?.() ?? [],
      (value) => payloadWireFormatName(value),
    ),
    description: typeSet.DESCRIPTION() || undefined,
  };
}

function addPortManifest(builder, port = {}) {
  const portId = normalizeOptionalString(pick(port, "portId", "port_id", "PORT_ID"));
  if (!portId) {
    return 0;
  }
  const acceptedTypeSets = Array.isArray(port.acceptedTypeSets)
    ? port.acceptedTypeSets
    : Array.isArray(port.ACCEPTED_TYPE_SETS)
      ? port.ACCEPTED_TYPE_SETS
      : [];
  const acceptedTypeSetOffsets = acceptedTypeSets
    .map((entry) => addAcceptedTypeSet(builder, entry))
    .filter(Boolean);
  const acceptedTypeSetsOffset = PLGPortManifest.createAcceptedTypeSetsVector(
    builder,
    acceptedTypeSetOffsets,
  );
  const displayName = normalizeOptionalString(
    pick(port, "displayName", "display_name", "DISPLAY_NAME"),
  );
  const description = normalizeOptionalString(pick(port, "description", "DESCRIPTION"));
  const portIdOffset = builder.createString(portId);
  const displayNameOffset = displayName ? builder.createString(displayName) : 0;
  const descriptionOffset = description ? builder.createString(description) : 0;
  PLGPortManifest.startPLGPortManifest(builder);
  PLGPortManifest.addPortId(builder, portIdOffset);
  if (displayNameOffset) PLGPortManifest.addDisplayName(builder, displayNameOffset);
  if (acceptedTypeSetsOffset)
    PLGPortManifest.addAcceptedTypeSets(builder, acceptedTypeSetsOffset);
  PLGPortManifest.addMinStreams(
    builder,
    normalizeUnsignedInteger(pick(port, "minStreams", "min_streams", "MIN_STREAMS"), 1),
  );
  PLGPortManifest.addMaxStreams(
    builder,
    normalizeUnsignedInteger(pick(port, "maxStreams", "max_streams", "MAX_STREAMS"), 1),
  );
  PLGPortManifest.addRequired(
    builder,
    pick(port, "required", "REQUIRED") !== false,
  );
  if (descriptionOffset) PLGPortManifest.addDescription(builder, descriptionOffset);
  return PLGPortManifest.endPLGPortManifest(builder);
}

function portManifestToObject(port) {
  const acceptedTypeSets = [];
  const count = port?.acceptedTypeSetsLength?.() ?? 0;
  for (let index = 0; index < count; index += 1) {
    const typeSet = port.ACCEPTED_TYPE_SETS(index);
    if (typeSet) {
      acceptedTypeSets.push(acceptedTypeSetToObject(typeSet));
    }
  }
  return {
    portId: port.PORT_ID(),
    displayName: port.DISPLAY_NAME() || undefined,
    acceptedTypeSets,
    minStreams: port.MIN_STREAMS(),
    maxStreams: port.MAX_STREAMS(),
    required: port.REQUIRED(),
    description: port.DESCRIPTION() || undefined,
  };
}

function addMethodManifest(builder, method = {}) {
  const methodId = normalizeOptionalString(
    pick(method, "methodId", "method_id", "METHOD_ID", "name"),
  );
  if (!methodId) {
    return 0;
  }
  const inputPorts = Array.isArray(method.inputPorts)
    ? method.inputPorts
    : Array.isArray(method.INPUT_PORTS)
      ? method.INPUT_PORTS
      : [];
  const outputPorts = Array.isArray(method.outputPorts)
    ? method.outputPorts
    : Array.isArray(method.OUTPUT_PORTS)
      ? method.OUTPUT_PORTS
      : [];
  const inputPortOffsets = inputPorts
    .map((port) => addPortManifest(builder, port))
    .filter(Boolean);
  const outputPortOffsets = outputPorts
    .map((port) => addPortManifest(builder, port))
    .filter(Boolean);
  const inputPortsOffset = PLGMethodManifest.createInputPortsVector(
    builder,
    inputPortOffsets,
  );
  const outputPortsOffset = PLGMethodManifest.createOutputPortsVector(
    builder,
    outputPortOffsets,
  );
  const displayName = normalizeOptionalString(
    pick(method, "displayName", "display_name", "DISPLAY_NAME"),
  );
  const description = normalizeOptionalString(
    pick(method, "description", "DESCRIPTION"),
  );
  const methodIdOffset = builder.createString(methodId);
  const displayNameOffset = displayName ? builder.createString(displayName) : 0;
  const descriptionOffset = description ? builder.createString(description) : 0;
  PLGMethodManifest.startPLGMethodManifest(builder);
  PLGMethodManifest.addMethodId(builder, methodIdOffset);
  if (displayNameOffset)
    PLGMethodManifest.addDisplayName(builder, displayNameOffset);
  if (inputPortsOffset) PLGMethodManifest.addInputPorts(builder, inputPortsOffset);
  if (outputPortsOffset)
    PLGMethodManifest.addOutputPorts(builder, outputPortsOffset);
  PLGMethodManifest.addMaxBatch(
    builder,
    normalizeUnsignedInteger(pick(method, "maxBatch", "max_batch", "MAX_BATCH"), 1),
  );
  PLGMethodManifest.addDrainPolicy(
    builder,
    resolveDrainPolicy(pick(method, "drainPolicy", "drain_policy", "DRAIN_POLICY")),
  );
  if (descriptionOffset) PLGMethodManifest.addDescription(builder, descriptionOffset);
  return PLGMethodManifest.endPLGMethodManifest(builder);
}

function methodManifestToObject(method) {
  const inputPorts = [];
  const outputPorts = [];
  for (let index = 0; index < (method?.inputPortsLength?.() ?? 0); index += 1) {
    const port = method.INPUT_PORTS(index);
    if (port) inputPorts.push(portManifestToObject(port));
  }
  for (let index = 0; index < (method?.outputPortsLength?.() ?? 0); index += 1) {
    const port = method.OUTPUT_PORTS(index);
    if (port) outputPorts.push(portManifestToObject(port));
  }
  return {
    methodId: method.METHOD_ID(),
    displayName: method.DISPLAY_NAME() || undefined,
    inputPorts,
    outputPorts,
    maxBatch: method.MAX_BATCH(),
    drainPolicy: drainPolicyName(method.DRAIN_POLICY()),
    description: method.DESCRIPTION() || undefined,
  };
}

function addHostCapability(builder, capability = {}) {
  const source =
    typeof capability === "string" ? { capability } : capability ?? {};
  const scope = normalizeOptionalString(pick(source, "scope", "SCOPE"));
  const description = normalizeOptionalString(
    pick(source, "description", "DESCRIPTION"),
  );
  const scopeOffset = scope ? builder.createString(scope) : 0;
  const descriptionOffset = description ? builder.createString(description) : 0;
  PLGHostCapability.startPLGHostCapability(builder);
  PLGHostCapability.addCapability(
    builder,
    resolveHostCapability(pick(source, "capability", "CAPABILITY", "name")),
  );
  if (scopeOffset) PLGHostCapability.addScope(builder, scopeOffset);
  PLGHostCapability.addRequired(
    builder,
    pick(source, "required", "REQUIRED") !== false,
  );
  if (descriptionOffset)
    PLGHostCapability.addDescription(builder, descriptionOffset);
  return PLGHostCapability.endPLGHostCapability(builder);
}

function hostCapabilityToObject(capability) {
  return {
    capability: hostCapabilityName(capability.CAPABILITY()),
    scope: capability.SCOPE() || undefined,
    required: capability.REQUIRED(),
    description: capability.DESCRIPTION() || undefined,
  };
}

function addTimerSpec(builder, timer = {}) {
  const timerId = normalizeOptionalString(pick(timer, "timerId", "timer_id", "TIMER_ID"));
  const methodId = normalizeOptionalString(pick(timer, "methodId", "method_id", "METHOD_ID"));
  if (!timerId || !methodId) {
    return 0;
  }
  const inputPortId = normalizeOptionalString(
    pick(timer, "inputPortId", "input_port_id", "INPUT_PORT_ID"),
  );
  const description = normalizeOptionalString(pick(timer, "description", "DESCRIPTION"));
  const timerIdOffset = builder.createString(timerId);
  const methodIdOffset = builder.createString(methodId);
  const inputPortIdOffset = inputPortId ? builder.createString(inputPortId) : 0;
  const descriptionOffset = description ? builder.createString(description) : 0;
  PLGTimerSpec.startPLGTimerSpec(builder);
  PLGTimerSpec.addTimerId(builder, timerIdOffset);
  PLGTimerSpec.addMethodId(builder, methodIdOffset);
  if (inputPortIdOffset) PLGTimerSpec.addInputPortId(builder, inputPortIdOffset);
  PLGTimerSpec.addDefaultIntervalMs(
    builder,
    toBigInt(pick(timer, "defaultIntervalMs", "default_interval_ms", "DEFAULT_INTERVAL_MS")),
  );
  if (descriptionOffset) PLGTimerSpec.addDescription(builder, descriptionOffset);
  return PLGTimerSpec.endPLGTimerSpec(builder);
}

function timerSpecToObject(timer) {
  return {
    timerId: timer.TIMER_ID(),
    methodId: timer.METHOD_ID(),
    inputPortId: timer.INPUT_PORT_ID() || undefined,
    defaultIntervalMs: timer.DEFAULT_INTERVAL_MS(),
    description: timer.DESCRIPTION() || undefined,
  };
}

function addProtocolSpec(builder, protocol = {}) {
  const protocolId = normalizeOptionalString(
    pick(protocol, "protocolId", "protocol_id", "PROTOCOL_ID"),
  );
  const methodId = normalizeOptionalString(
    pick(protocol, "methodId", "method_id", "METHOD_ID"),
  );
  if (!protocolId || !methodId) {
    return 0;
  }
  const stringFields = {
    inputPortId: normalizeOptionalString(
      pick(protocol, "inputPortId", "input_port_id", "INPUT_PORT_ID"),
    ),
    outputPortId: normalizeOptionalString(
      pick(protocol, "outputPortId", "output_port_id", "OUTPUT_PORT_ID"),
    ),
    description: normalizeOptionalString(pick(protocol, "description", "DESCRIPTION")),
    wireId: normalizeOptionalString(pick(protocol, "wireId", "wire_id", "WIRE_ID")),
    transportKind: normalizeOptionalString(
      pick(protocol, "transportKind", "transport_kind", "TRANSPORT_KIND"),
    ),
    role: normalizeOptionalString(pick(protocol, "role", "ROLE")),
    specUri: normalizeOptionalString(pick(protocol, "specUri", "spec_uri", "SPEC_URI")),
    discoveryKey: normalizeOptionalString(
      pick(protocol, "discoveryKey", "discovery_key", "DISCOVERY_KEY"),
    ),
  };
  const offsets = Object.fromEntries(
    Object.entries(stringFields).map(([key, value]) => [
      key,
      value ? builder.createString(value) : 0,
    ]),
  );
  const protocolIdOffset = builder.createString(protocolId);
  const methodIdOffset = builder.createString(methodId);
  PLGProtocolSpec.startPLGProtocolSpec(builder);
  PLGProtocolSpec.addProtocolId(builder, protocolIdOffset);
  PLGProtocolSpec.addMethodId(builder, methodIdOffset);
  if (offsets.inputPortId) PLGProtocolSpec.addInputPortId(builder, offsets.inputPortId);
  if (offsets.outputPortId)
    PLGProtocolSpec.addOutputPortId(builder, offsets.outputPortId);
  if (offsets.description)
    PLGProtocolSpec.addDescription(builder, offsets.description);
  if (offsets.wireId) PLGProtocolSpec.addWireId(builder, offsets.wireId);
  if (offsets.transportKind)
    PLGProtocolSpec.addTransportKind(builder, offsets.transportKind);
  if (offsets.role) PLGProtocolSpec.addRole(builder, offsets.role);
  if (offsets.specUri) PLGProtocolSpec.addSpecUri(builder, offsets.specUri);
  PLGProtocolSpec.addAutoInstall(
    builder,
    pick(protocol, "autoInstall", "auto_install", "AUTO_INSTALL") !== false,
  );
  PLGProtocolSpec.addAdvertise(
    builder,
    Boolean(pick(protocol, "advertise", "ADVERTISE") ?? false),
  );
  if (offsets.discoveryKey)
    PLGProtocolSpec.addDiscoveryKey(builder, offsets.discoveryKey);
  PLGProtocolSpec.addDefaultPort(
    builder,
    normalizeUnsignedInteger(pick(protocol, "defaultPort", "default_port", "DEFAULT_PORT")),
  );
  PLGProtocolSpec.addRequireSecureTransport(
    builder,
    Boolean(
      pick(
        protocol,
        "requireSecureTransport",
        "require_secure_transport",
        "REQUIRE_SECURE_TRANSPORT",
      ) ?? false,
    ),
  );
  return PLGProtocolSpec.endPLGProtocolSpec(builder);
}

function protocolSpecToObject(protocol) {
  return {
    protocolId: protocol.PROTOCOL_ID(),
    methodId: protocol.METHOD_ID(),
    inputPortId: protocol.INPUT_PORT_ID() || undefined,
    outputPortId: protocol.OUTPUT_PORT_ID() || undefined,
    description: protocol.DESCRIPTION() || undefined,
    wireId: protocol.WIRE_ID() || undefined,
    transportKind: protocol.TRANSPORT_KIND() || undefined,
    role: protocol.ROLE() || undefined,
    specUri: protocol.SPEC_URI() || undefined,
    autoInstall: protocol.AUTO_INSTALL(),
    advertise: protocol.ADVERTISE(),
    discoveryKey: protocol.DISCOVERY_KEY() || undefined,
    defaultPort: protocol.DEFAULT_PORT(),
    requireSecureTransport: protocol.REQUIRE_SECURE_TRANSPORT(),
  };
}

function addBuildArtifact(builder, artifact = {}) {
  const artifactId = normalizeOptionalString(
    pick(artifact, "artifactId", "artifact_id", "ARTIFACT_ID"),
  );
  const path = normalizeOptionalString(pick(artifact, "path", "PATH"));
  if (!artifactId || !path) {
    return 0;
  }
  const kind = normalizeOptionalString(pick(artifact, "kind", "KIND"));
  const target = normalizeOptionalString(pick(artifact, "target", "TARGET"));
  const entrySymbol = normalizeOptionalString(
    pick(artifact, "entrySymbol", "entry_symbol", "ENTRY_SYMBOL"),
  );
  const artifactIdOffset = builder.createString(artifactId);
  const kindOffset = kind ? builder.createString(kind) : 0;
  const pathOffset = builder.createString(path);
  const targetOffset = target ? builder.createString(target) : 0;
  const entrySymbolOffset = entrySymbol ? builder.createString(entrySymbol) : 0;
  PLGBuildArtifact.startPLGBuildArtifact(builder);
  PLGBuildArtifact.addArtifactId(builder, artifactIdOffset);
  if (kindOffset) PLGBuildArtifact.addKind(builder, kindOffset);
  PLGBuildArtifact.addPath(builder, pathOffset);
  if (targetOffset) PLGBuildArtifact.addTarget(builder, targetOffset);
  if (entrySymbolOffset)
    PLGBuildArtifact.addEntrySymbol(builder, entrySymbolOffset);
  return PLGBuildArtifact.endPLGBuildArtifact(builder);
}

function buildArtifactToObject(artifact) {
  return {
    artifactId: artifact.ARTIFACT_ID(),
    kind: artifact.KIND() || undefined,
    path: artifact.PATH(),
    target: artifact.TARGET() || undefined,
    entrySymbol: artifact.ENTRY_SYMBOL() || undefined,
  };
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

  const allowedXpubsOffset = addStringVector(
    builder,
    pick(manifest, "allowedXpubs", "allowed_xpubs", "ALLOWED_XPUBS"),
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

  const invokeSurfaces = pick(
    manifest,
    "invokeSurfaces",
    "invoke_surfaces",
    "INVOKE_SURFACES",
  );
  const invokeSurfaceValues = Array.isArray(invokeSurfaces)
    ? invokeSurfaces.map((entry) => resolveInvokeSurface(entry)).filter((entry) => entry !== null)
    : [];
  const invokeSurfacesOffset =
    invokeSurfaceValues.length > 0
      ? PLG.createInvokeSurfacesVector(builder, invokeSurfaceValues)
      : 0;

  const methods = pick(manifest, "methods", "METHODS");
  const methodOffsets = Array.isArray(methods)
    ? methods.map((method) => addMethodManifest(builder, method)).filter(Boolean)
    : [];
  const methodsOffset =
    methodOffsets.length > 0 ? PLG.createMethodsVector(builder, methodOffsets) : 0;

  const hostCapabilities = pick(
    manifest,
    "hostCapabilities",
    "host_capabilities",
    "HOST_CAPABILITIES",
    "capabilities",
    "CAPABILITIES",
  );
  const hostCapabilityOffsets = Array.isArray(hostCapabilities)
    ? hostCapabilities.map((capability) => addHostCapability(builder, capability))
    : [];
  const hostCapabilitiesOffset =
    hostCapabilityOffsets.length > 0
      ? PLG.createHostCapabilitiesVector(builder, hostCapabilityOffsets)
      : 0;

  const timers = pick(manifest, "timers", "TIMERS");
  const timerOffsets = Array.isArray(timers)
    ? timers.map((timer) => addTimerSpec(builder, timer)).filter(Boolean)
    : [];
  const timersOffset =
    timerOffsets.length > 0 ? PLG.createTimersVector(builder, timerOffsets) : 0;

  const protocols = pick(manifest, "protocols", "PROTOCOLS");
  const protocolOffsets = Array.isArray(protocols)
    ? protocols.map((protocol) => addProtocolSpec(builder, protocol)).filter(Boolean)
    : [];
  const protocolsOffset =
    protocolOffsets.length > 0
      ? PLG.createProtocolsVector(builder, protocolOffsets)
      : 0;

  const schemasUsed = pick(
    manifest,
    "schemasUsed",
    "schemas_used",
    "SCHEMAS_USED",
  );
  const schemaUsedOffsets = Array.isArray(schemasUsed)
    ? schemasUsed.map((schema) => addFlatBufferTypeRef(builder, schema))
    : [];
  const schemasUsedOffset =
    schemaUsedOffsets.length > 0
      ? PLG.createSchemasUsedVector(builder, schemaUsedOffsets)
      : 0;

  const buildArtifacts = pick(
    manifest,
    "buildArtifacts",
    "build_artifacts",
    "BUILD_ARTIFACTS",
  );
  const buildArtifactOffsets = Array.isArray(buildArtifacts)
    ? buildArtifacts.map((artifact) => addBuildArtifact(builder, artifact)).filter(Boolean)
    : [];
  const buildArtifactsOffset =
    buildArtifactOffsets.length > 0
      ? PLG.createBuildArtifactsVector(builder, buildArtifactOffsets)
      : 0;

  const runtimeTargetsOffset = addStringVector(
    builder,
    pick(manifest, "runtimeTargets", "runtime_targets", "RUNTIME_TARGETS"),
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
  if (allowedXpubsOffset)
    PLG.addAllowedXpubs(builder, allowedXpubsOffset);
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
  if (invokeSurfacesOffset) PLG.addInvokeSurfaces(builder, invokeSurfacesOffset);
  if (methodsOffset) PLG.addMethods(builder, methodsOffset);
  if (hostCapabilitiesOffset)
    PLG.addHostCapabilities(builder, hostCapabilitiesOffset);
  if (timersOffset) PLG.addTimers(builder, timersOffset);
  if (protocolsOffset) PLG.addProtocols(builder, protocolsOffset);
  if (schemasUsedOffset) PLG.addSchemasUsed(builder, schemasUsedOffset);
  if (buildArtifactsOffset) PLG.addBuildArtifacts(builder, buildArtifactsOffset);
  if (runtimeTargetsOffset) PLG.addRuntimeTargets(builder, runtimeTargetsOffset);
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
    const entry = root.ENTRY_FUNCTIONS(i);
    if (!entry) continue;
    entryFunctions.push({
      name: entry.NAME(),
      description: entry.DESCRIPTION() || undefined,
      inputSchemas: readStringVector(
        entry,
        "inputSchemasLength",
        "INPUT_SCHEMAS",
      ),
      outputSchema: entry.OUTPUT_SCHEMA() || undefined,
    });
  }

  const capabilities = [];
  const capLen =
    typeof root.capabilitiesLength === "function"
      ? root.capabilitiesLength()
      : 0;
  for (let i = 0; i < capLen; i++) {
    const cap = root.CAPABILITIES(i);
    if (!cap) continue;
    capabilities.push({
      name: cap.NAME() || undefined,
      version: cap.VERSION() || undefined,
      required: !!cap.REQUIRED(),
    });
  }

  const dependencies = [];
  const depLen =
    typeof root.dependenciesLength === "function"
      ? root.dependenciesLength()
      : 0;
  for (let i = 0; i < depLen; i++) {
    const dep = root.DEPENDENCIES(i);
    if (!dep) continue;
    dependencies.push({
      pluginId: dep.PLUGIN_ID() || undefined,
      minVersion: dep.MIN_VERSION() || undefined,
      maxVersion: dep.MAX_VERSION() || undefined,
    });
  }

  const invokeSurfaces = Array.from(
    root.invokeSurfacesArray?.() ?? [],
    (value) => invokeSurfaceName(value),
  );
  const methods = [];
  for (let index = 0; index < (root.methodsLength?.() ?? 0); index += 1) {
    const method = root.METHODS(index);
    if (method) {
      methods.push(methodManifestToObject(method));
    }
  }
  const hostCapabilities = [];
  for (let index = 0; index < (root.hostCapabilitiesLength?.() ?? 0); index += 1) {
    const capability = root.HOST_CAPABILITIES(index);
    if (capability) {
      hostCapabilities.push(hostCapabilityToObject(capability));
    }
  }
  const timers = [];
  for (let index = 0; index < (root.timersLength?.() ?? 0); index += 1) {
    const timer = root.TIMERS(index);
    if (timer) {
      timers.push(timerSpecToObject(timer));
    }
  }
  const protocols = [];
  for (let index = 0; index < (root.protocolsLength?.() ?? 0); index += 1) {
    const protocol = root.PROTOCOLS(index);
    if (protocol) {
      protocols.push(protocolSpecToObject(protocol));
    }
  }
  const schemasUsed = [];
  for (let index = 0; index < (root.schemasUsedLength?.() ?? 0); index += 1) {
    const schema = typeRefToObject(root.SCHEMAS_USED(index));
    if (schema) {
      schemasUsed.push(schema);
    }
  }
  const buildArtifacts = [];
  for (let index = 0; index < (root.buildArtifactsLength?.() ?? 0); index += 1) {
    const artifact = root.BUILD_ARTIFACTS(index);
    if (artifact) {
      buildArtifacts.push(buildArtifactToObject(artifact));
    }
  }

  return {
    pluginId: root.PLUGIN_ID(),
    name: root.NAME(),
    version: root.VERSION(),
    description: root.DESCRIPTION() || undefined,
    tagline: root.TAGLINE() || undefined,
    pluginType: root.PLUGIN_TYPE(),
    publisherName: root.PUBLISHER_NAME() || undefined,
    publisherHandle: root.PUBLISHER_HANDLE() || undefined,
    publisherUrl: root.PUBLISHER_URL() || undefined,
    supportUrl: root.SUPPORT_URL() || undefined,
    tags: readStringVector(root, "tagsLength", "TAGS"),
    features: readStringVector(root, "featuresLength", "FEATURES"),
    screenshotUrls: readStringVector(
      root,
      "screenshotUrlsLength",
      "SCREENSHOT_URLS",
    ),
    bannerUrl: root.BANNER_URL() || undefined,
    abiVersion: root.ABI_VERSION(),
    wasmHash: root.wasmHashArray() ?? null,
    wasmSize: root.WASM_SIZE(),
    wasmCid: root.WASM_CID() || undefined,
    encryptedWasmHash: root.encryptedWasmHashArray() ?? null,
    encryptedWasmSize: root.ENCRYPTED_WASM_SIZE(),
    entryFunctions,
    requiredSchemas: readStringVector(
      root,
      "requiredSchemasLength",
      "REQUIRED_SCHEMAS",
    ),
    dependencies,
    capabilities,
    providerPeerId: root.PROVIDER_PEER_ID() || undefined,
    providerEpmCid: root.PROVIDER_EPM_CID() || undefined,
    encrypted: !!root.ENCRYPTED(),
    requiredScope: root.REQUIRED_SCOPE() || undefined,
    keyId: root.KEY_ID() || undefined,
    allowedXpubs: readStringVector(
      root,
      "allowedXpubsLength",
      "ALLOWED_XPUBS",
    ),
    maxGrantTimeoutMs: root.MAX_GRANT_TIMEOUT_MS(),
    minPermissions: readStringVector(
      root,
      "minPermissionsLength",
      "MIN_PERMISSIONS",
    ),
    createdAt: root.CREATED_AT(),
    updatedAt: root.UPDATED_AT(),
    documentationUrl: root.DOCUMENTATION_URL() || undefined,
    changelogUrl: root.CHANGELOG_URL() || undefined,
    iconUrl: root.ICON_URL() || undefined,
    license: root.LICENSE() || undefined,
    paymentModel: root.PAYMENT_MODEL(),
    priceUsdCents: root.PRICE_USD_CENTS(),
    subscriptionPeriodDays: root.SUBSCRIPTION_PERIOD_DAYS(),
    acceptedPaymentMethods: readStringVector(
      root,
      "acceptedPaymentMethodsLength",
      "ACCEPTED_PAYMENT_METHODS",
    ),
    listingStatus: root.LISTING_STATUS(),
    signature: root.signatureArray() ?? null,
    invokeSurfaces,
    methods,
    hostCapabilities,
    timers,
    protocols,
    schemasUsed,
    buildArtifacts,
    runtimeTargets: readStringVector(root, "runtimeTargetsLength", "RUNTIME_TARGETS"),
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
