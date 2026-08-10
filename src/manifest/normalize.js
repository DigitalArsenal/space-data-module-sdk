import {
  AcceptedTypeSetT,
  BuildArtifactT,
  CapabilityKind,
  DrainPolicy as ManifestDrainPolicy,
  HostCapabilityT,
  InvokeSurface,
  MethodManifestT,
  PluginFamily,
  PluginManifestT,
  PortManifestT,
  ProtocolSpecT,
  TimerSpecT,
} from "../generated/orbpro/manifest.js";
import { FlatBufferTypeRefT } from "../generated/orbpro/stream/flat-buffer-type-ref.js";
import { ProtocolRole, ProtocolTransportKind } from "../runtime/constants.js";

/**
 * The manifest-string → PluginFamily vocabulary. This is the WHOLE vocabulary:
 * anything not in here is refused by name, never coerced.
 *
 * `datasource` is the ONE alias, kept because manifests in the field spell it
 * both ways. Do not add aliases casually — an alias is a second spelling of a
 * family, and every one of them is a place two modules can disagree about what
 * they are.
 */
export const pluginFamilyByName = Object.freeze({
  sensor: PluginFamily.SENSOR,
  propagator: PluginFamily.PROPAGATOR,
  renderer: PluginFamily.RENDERER,
  analysis: PluginFamily.ANALYSIS,
  data_source: PluginFamily.DATA_SOURCE,
  datasource: PluginFamily.DATA_SOURCE,
  comms: PluginFamily.COMMS,
  shader: PluginFamily.SHADER,
  sdf: PluginFamily.SDF,
  infrastructure: PluginFamily.INFRASTRUCTURE,
  flow: PluginFamily.FLOW,
  bridge: PluginFamily.BRIDGE,
  maneuver: PluginFamily.MANEUVER,
  orbit_determination: PluginFamily.ORBIT_DETERMINATION,
  foundation: PluginFamily.FOUNDATION,
  parser: PluginFamily.PARSER,
  validator: PluginFamily.VALIDATOR,
  exporter: PluginFamily.EXPORTER,
  publisher: PluginFamily.PUBLISHER,
  basilisk: PluginFamily.BASILISK,
});

/** Every accepted family string, sorted — the vocabulary a refusal names. */
export const PluginFamilyNames = Object.freeze(
  Object.keys(pluginFamilyByName).sort(),
);

/**
 * SDK family → authoritative SDS `pluginCategory` member name.
 *
 * SDS (spacedatastandards.org `schema/PLG/main.fbs`) is the source of truth for
 * what families exist; this SDK enum is a projection of it. The two DO NOT
 * share ordinals — they diverge from index 5 (SDK `COMMS = 5`, SDS `EW = 5`) —
 * so this mapping is BY NAME and must stay explicit. Never convert one enum to
 * the other numerically.
 *
 * Two entries have no 1:1 SDS member and are recorded honestly rather than
 * hidden. Both are filed in graph/tasks/sds-plugin-category-projection-gaps.md:
 *   - ORBIT_DETERMINATION → Analysis (SDS has no OD category yet)
 *   - SDF, BRIDGE         → Analysis / Infrastructure (SDK-local concepts)
 */
export const sdsPluginCategoryByFamily = Object.freeze({
  [PluginFamily.SENSOR]: "Sensor",
  [PluginFamily.PROPAGATOR]: "Propagator",
  [PluginFamily.RENDERER]: "Renderer",
  [PluginFamily.ANALYSIS]: "Analysis",
  [PluginFamily.DATA_SOURCE]: "DataSource",
  [PluginFamily.COMMS]: "Comms",
  [PluginFamily.SHADER]: "Shader",
  [PluginFamily.SDF]: "Analysis",
  [PluginFamily.INFRASTRUCTURE]: "Infrastructure",
  [PluginFamily.FLOW]: "Flow",
  [PluginFamily.BRIDGE]: "Infrastructure",
  [PluginFamily.MANEUVER]: "Maneuver",
  [PluginFamily.ORBIT_DETERMINATION]: "Analysis",
  [PluginFamily.FOUNDATION]: "Foundation",
  [PluginFamily.PARSER]: "Parser",
  [PluginFamily.VALIDATOR]: "Validator",
  [PluginFamily.EXPORTER]: "Exporter",
  [PluginFamily.PUBLISHER]: "Publisher",
  [PluginFamily.BASILISK]: "Basilisk",
});

const PluginFamilyValues = Object.freeze(
  new Set(Object.values(pluginFamilyByName)),
);

/**
 * Thrown when a manifest declares a family the SDK does not know.
 *
 * It is a THROW and not a fallback on purpose. The old code returned
 * `PluginFamily.ANALYSIS` for anything unrecognized, which is why 19
 * first-party modules shipped mislabelled and family-typed resolution only
 * ever worked for propagators: a typo and a deliberate new family were
 * indistinguishable, and both were silent.
 *
 * Ruling: graph/findings/official-harness-shapes.md §4.7 / §8.3
 */
export class UnknownPluginFamilyError extends Error {
  constructor(value) {
    super(
      `Unknown pluginFamily ${JSON.stringify(value)}. ` +
        `The manifest vocabulary is: ${PluginFamilyNames.join(", ")}. ` +
        `Families are NOT invented in a manifest — the SDK enum ` +
        `(schemas/PluginManifest.fbs PluginFamily) is a projection of the ` +
        `authoritative SDS pluginCategory vocabulary, and a new family is ` +
        `appended there first.`,
    );
    this.name = "UnknownPluginFamilyError";
    this.code = "unknown-plugin-family";
    this.value = value;
    this.validFamilies = PluginFamilyNames;
  }
}

const drainPolicyByName = Object.freeze({
  "single-shot": ManifestDrainPolicy.SINGLE_SHOT,
  "drain-until-yield": ManifestDrainPolicy.DRAIN_UNTIL_YIELD,
  "drain-to-empty": ManifestDrainPolicy.DRAIN_TO_EMPTY,
});

const capabilityKindByName = Object.freeze({
  clock: CapabilityKind.CLOCK,
  random: CapabilityKind.RANDOM,
  logging: CapabilityKind.LOGGING,
  timers: CapabilityKind.TIMERS,
  schedule_cron: CapabilityKind.SCHEDULE_CRON,
  cron: CapabilityKind.SCHEDULE_CRON,
  pubsub: CapabilityKind.PUBSUB,
  http: CapabilityKind.HTTP,
  filesystem: CapabilityKind.FILESYSTEM,
  pipe: CapabilityKind.PIPE,
  network: CapabilityKind.NETWORK,
  database: CapabilityKind.DATABASE,
  protocol_dial: CapabilityKind.PROTOCOL_DIAL,
  protocol_handle: CapabilityKind.PROTOCOL_HANDLE,
  tls: CapabilityKind.TLS,
  mqtt: CapabilityKind.MQTT,
  websocket: CapabilityKind.WEBSOCKET,
  tcp: CapabilityKind.TCP,
  udp: CapabilityKind.UDP,
  process_exec: CapabilityKind.PROCESS_EXEC,
  exec: CapabilityKind.PROCESS_EXEC,
  context_read: CapabilityKind.CONTEXT_READ,
  context_write: CapabilityKind.CONTEXT_WRITE,
  storage_adapter: CapabilityKind.STORAGE_ADAPTER,
  storage_query: CapabilityKind.STORAGE_QUERY,
  storage_write: CapabilityKind.STORAGE_WRITE,
  storage_ingest: CapabilityKind.STORAGE_INGEST,
  wallet_sign: CapabilityKind.WALLET_SIGN,
  ipfs: CapabilityKind.IPFS,
  crypto_hash: CapabilityKind.CRYPTO_HASH,
  crypto_sign: CapabilityKind.CRYPTO_SIGN,
  crypto_verify: CapabilityKind.CRYPTO_VERIFY,
  crypto_encrypt: CapabilityKind.CRYPTO_ENCRYPT,
  crypto_decrypt: CapabilityKind.CRYPTO_DECRYPT,
  crypto_key_agreement: CapabilityKind.CRYPTO_KEY_AGREEMENT,
  crypto_kdf: CapabilityKind.CRYPTO_KDF,
  scene_access: CapabilityKind.SCENE_ACCESS,
  entity_access: CapabilityKind.ENTITY_ACCESS,
  render_hooks: CapabilityKind.RENDER_HOOKS,
});

const invokeSurfaceByName = Object.freeze({
  direct: InvokeSurface.DIRECT,
  command: InvokeSurface.COMMAND,
});

const protocolTransportKindByName = Object.freeze({
  libp2p: ProtocolTransportKind.LIBP2P,
  http: ProtocolTransportKind.HTTP,
  ws: ProtocolTransportKind.WS,
  websocket: ProtocolTransportKind.WS,
  "wasi-pipe": ProtocolTransportKind.WASI_PIPE,
  wasi_pipe: ProtocolTransportKind.WASI_PIPE,
  pipe: ProtocolTransportKind.WASI_PIPE,
});

const protocolRoleByName = Object.freeze({
  handle: ProtocolRole.HANDLE,
  handler: ProtocolRole.HANDLE,
  dial: ProtocolRole.DIAL,
  both: ProtocolRole.BOTH,
});

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSchemaHash(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((byte) => Number(byte) & 0xff);
  }
  const normalized = String(value).trim().replace(/^0x/i, "");
  if (normalized.length === 0 || normalized.length % 2 !== 0) {
    return [];
  }
  const bytes = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(parseInt(normalized.slice(index, index + 2), 16));
  }
  return bytes;
}

function normalizePayloadWireFormat(value) {
  if (value === 1) {
    return "aligned-binary";
  }
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  return normalized === "aligned-binary" ? "aligned-binary" : "flatbuffer";
}

function normalizeUnsignedInteger(value, fallback = 0) {
  const normalized = Number(value ?? fallback);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(normalized));
}

/**
 * Resolve a manifest `pluginFamily` to its enum value, or REFUSE.
 *
 * There is no fallback. See {@link UnknownPluginFamilyError} for why.
 *
 * @param {string|number} value
 * @returns {number} a PluginFamily member
 * @throws {UnknownPluginFamilyError} on an unknown string, an out-of-range
 *   number, or a missing/blank value.
 */
export function normalizePluginFamily(value) {
  if (typeof value === "number") {
    // A numeric family still has to BE one. An out-of-range ordinal is the
    // same defect as an unknown string, and used to sail straight through.
    if (!PluginFamilyValues.has(value)) {
      throw new UnknownPluginFamilyError(value);
    }
    return value;
  }
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  const resolved = pluginFamilyByName[normalized];
  if (resolved === undefined) {
    throw new UnknownPluginFamilyError(value);
  }
  return resolved;
}

function normalizeDrainPolicy(value) {
  if (typeof value === "number") {
    return value;
  }
  const normalized = String(value ?? "drain-until-yield")
    .trim()
    .toLowerCase();
  return (
    drainPolicyByName[normalized] ?? ManifestDrainPolicy.DRAIN_UNTIL_YIELD
  );
}

function normalizeCapabilityKind(value) {
  if (typeof value === "number") {
    return value;
  }
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return capabilityKindByName[normalized] ?? null;
}

function normalizeInvokeSurface(value) {
  if (typeof value === "number") {
    return value;
  }
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return invokeSurfaceByName[normalized] ?? null;
}

function normalizeInvokeSurfaces(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const normalized = [];
  for (const entry of value) {
    const surface = normalizeInvokeSurface(entry);
    if (surface === null || seen.has(surface)) {
      continue;
    }
    seen.add(surface);
    normalized.push(surface);
  }
  return normalized;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value === true;
}

function normalizeProtocolTransportKind(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (normalized.length === 0) {
    return null;
  }
  return protocolTransportKindByName[normalized] ?? normalized;
}

function normalizeProtocolRole(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (normalized.length === 0) {
    return null;
  }
  return protocolRoleByName[normalized] ?? normalized;
}

function toFlatBufferTypeRefT(value = {}) {
  if (value instanceof FlatBufferTypeRefT) {
    return value;
  }
  return new FlatBufferTypeRefT(
    value.schemaName ?? null,
    value.fileIdentifier ?? null,
    normalizeSchemaHash(value.schemaHash),
    value.acceptsAnyFlatbuffer === true,
    normalizePayloadWireFormat(value.wireFormat),
    value.rootTypeName ?? null,
    normalizeUnsignedInteger(value.fixedStringLength),
    normalizeUnsignedInteger(value.byteLength),
    normalizeUnsignedInteger(value.requiredAlignment),
  );
}

function toAcceptedTypeSetT(value = {}) {
  if (value instanceof AcceptedTypeSetT) {
    return value;
  }
  return new AcceptedTypeSetT(
    value.setId ?? null,
    Array.isArray(value.allowedTypes)
      ? value.allowedTypes.map((entry) => toFlatBufferTypeRefT(entry))
      : [],
    value.description ?? null,
  );
}

function toPortManifestT(value = {}) {
  if (value instanceof PortManifestT) {
    return value;
  }
  return new PortManifestT(
    value.portId ?? null,
    value.displayName ?? null,
    Array.isArray(value.acceptedTypeSets)
      ? value.acceptedTypeSets.map((entry) => toAcceptedTypeSetT(entry))
      : [],
    Number(value.minStreams ?? 1),
    Number(value.maxStreams ?? 1),
    value.required !== false,
    value.description ?? null,
  );
}

function toMethodManifestT(value = {}) {
  if (value instanceof MethodManifestT) {
    return value;
  }
  return new MethodManifestT(
    value.methodId ?? null,
    value.displayName ?? null,
    Array.isArray(value.inputPorts)
      ? value.inputPorts.map((entry) => toPortManifestT(entry))
      : [],
    Array.isArray(value.outputPorts)
      ? value.outputPorts.map((entry) => toPortManifestT(entry))
      : [],
    Number(value.maxBatch ?? 1),
    normalizeDrainPolicy(value.drainPolicy),
    value.description ?? null,
  );
}

function toBuildArtifactT(value = {}) {
  if (value instanceof BuildArtifactT) {
    return value;
  }
  return new BuildArtifactT(
    value.artifactId ?? null,
    value.kind ?? null,
    value.path ?? null,
    value.target ?? null,
    value.entrySymbol ?? null,
  );
}

function toTimerSpecT(value = {}) {
  if (value instanceof TimerSpecT) {
    return value;
  }
  return new TimerSpecT(
    value.timerId ?? null,
    value.methodId ?? null,
    value.inputPortId ?? null,
    BigInt(value.defaultIntervalMs ?? 0),
    value.description ?? null,
  );
}

function toProtocolSpecT(value = {}) {
  if (value instanceof ProtocolSpecT) {
    return value;
  }
  return new ProtocolSpecT(
    normalizeOptionalString(value.protocolId),
    normalizeOptionalString(value.methodId),
    normalizeOptionalString(value.inputPortId),
    normalizeOptionalString(value.outputPortId),
    normalizeOptionalString(value.description),
    normalizeOptionalString(value.wireId),
    normalizeProtocolTransportKind(value.transportKind),
    normalizeProtocolRole(value.role),
    normalizeOptionalString(value.specUri),
    normalizeBoolean(value.autoInstall, true),
    normalizeBoolean(value.advertise, false),
    normalizeOptionalString(value.discoveryKey),
    normalizeUnsignedInteger(value.defaultPort),
    normalizeBoolean(value.requireSecureTransport, false),
  );
}

function toHostCapabilityT(value, warnings) {
  if (value instanceof HostCapabilityT) {
    return value;
  }
  if (typeof value === "string") {
    const capability = normalizeCapabilityKind(value);
    if (capability === null) {
      warnings.push(
        `Capability "${value}" is not representable in the current embedded FlatBuffer manifest schema and was omitted.`,
      );
      return null;
    }
    return new HostCapabilityT(capability, null, true, null);
  }
  const capability = normalizeCapabilityKind(value?.capability);
  if (capability === null) {
    warnings.push(
      `Capability "${value?.capability ?? "unknown"}" is not representable in the current embedded FlatBuffer manifest schema and was omitted.`,
    );
    return null;
  }
  return new HostCapabilityT(
    capability,
    value?.scope ?? null,
    value?.required !== false,
    value?.description ?? null,
  );
}

export function toEmbeddedPluginManifest(input = {}) {
  if (input instanceof PluginManifestT) {
    return { manifest: input, warnings: [] };
  }

  const warnings = [];
  if (Array.isArray(input.externalInterfaces) && input.externalInterfaces.length > 0) {
    warnings.push(
      "externalInterfaces are not yet representable in the embedded FlatBuffer manifest schema and were omitted from the compiled artifact.",
    );
  }
  const capabilities = Array.isArray(input.capabilities)
    ? input.capabilities
        .map((entry) => toHostCapabilityT(entry, warnings))
        .filter(Boolean)
    : [];

  return {
    manifest: new PluginManifestT(
      input.pluginId ?? null,
      input.name ?? null,
      input.version ?? null,
      normalizePluginFamily(input.pluginFamily),
      Array.isArray(input.methods)
        ? input.methods.map((entry) => toMethodManifestT(entry))
        : [],
      capabilities,
      Array.isArray(input.timers)
        ? input.timers.map((entry) => toTimerSpecT(entry))
        : [],
      Array.isArray(input.protocols)
        ? input.protocols.map((entry) => toProtocolSpecT(entry))
        : [],
      Array.isArray(input.schemasUsed)
        ? input.schemasUsed.map((entry) => toFlatBufferTypeRefT(entry))
        : [],
      Array.isArray(input.buildArtifacts)
        ? input.buildArtifacts.map((entry) => toBuildArtifactT(entry))
        : [],
      Number(input.abiVersion ?? 1),
      normalizeInvokeSurfaces(input.invokeSurfaces),
      Array.isArray(input.runtimeTargets)
        ? input.runtimeTargets
            .map((value) =>
              typeof value === "string" ? value.trim() : String(value ?? "").trim(),
            )
            .filter(Boolean)
        : [],
    ),
    warnings,
  };
}
