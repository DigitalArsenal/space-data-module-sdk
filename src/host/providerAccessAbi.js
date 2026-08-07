/**
 * Provider Access ABI — constants, descriptor codec, and the guest import
 * bridge. See docs/provider-access-abi.md for the normative contract.
 *
 * One generalized port for imagery/terrain providers, two planes:
 *
 *   CONTROL  provider.* operations on the existing space_data_module_host
 *            sync hostcall bridge (metadata only, JSON envelopes)
 *   DATA     three dedicated imports on `space_data_provider` that write
 *            decoded provider bytes straight into guest linear memory
 *
 * Every parameter and every result across the boundary is i32. No i64 appears
 * anywhere in a signature — the i64 legalization mismatch measured on this SDK
 * is sidestepped by construction, not by convention. Every 64-bit quantity
 * (rectangles, height extrema) travels inside the descriptor struct in guest
 * memory as plain little-endian IEEE-754.
 */

export const PROVIDER_IMPORT_MODULE = "space_data_provider";

/** Capability + scope. Both already exist; this ABI adds no new host capability. */
export const PROVIDER_CAPABILITY_ID = "scene_access";
export const PROVIDER_CAPABILITY_SCOPE = "provider.v1";

export const PROVIDER_ABI_VERSION = 1;
export const PROVIDER_TILE_DESC_MAGIC = 0x53445054; // 'SDPT'
export const PROVIDER_TILE_DESC_BYTES = 128;

export const ProviderKind = Object.freeze({
  TERRAIN: 1,
  IMAGERY: 2,
});

export const ProviderEncoding = Object.freeze({
  HEIGHT_F32: 1,
  HEIGHT_F64: 2,
  RGBA8: 16,
  RGB8: 17,
  GRAY8: 18,
  GRAY16: 19,
  RGBA_F32: 20,
});

export const ProviderFlags = Object.freeze({
  INTERPOLATED: 1 << 0,
  STAGED: 1 << 1,
  PARTIAL: 1 << 2,
  DERIVED: 1 << 3,
  FIXTURE: 1 << 4,
});

/**
 * What an acquire actually cost. `maxCost` on the request defaults to
 * DEQUANTIZE — that default IS the "never re-fetch, never re-parse" rule,
 * enforced by the ABI instead of by discipline.
 */
export const ProviderCost = Object.freeze({
  RESIDENT: 0,
  DEQUANTIZE: 1,
  REDECODE: 2,
  REFETCH: 3,
  READBACK: 4,
});

export const DEFAULT_MAX_COST = ProviderCost.DEQUANTIZE;

/**
 * How the level was chosen. Carried in the DESCRIPTOR, not just in a JS
 * return value, because the consumers that most need provenance are wasm
 * modules. Names mirror the consumer's existing vocabulary verbatim.
 */
export const ProviderStrategy = Object.freeze({
  DEFAULT: 0,
  GRID_MATCHED_LEVEL: 1,
  MOST_DETAILED: 2,
  FIXED_LEVEL: 3,
});

const STRATEGY_NAMES = Object.freeze({
  [ProviderStrategy.DEFAULT]: "default",
  [ProviderStrategy.GRID_MATCHED_LEVEL]: "grid-matched-level",
  [ProviderStrategy.MOST_DETAILED]: "most-detailed",
  [ProviderStrategy.FIXED_LEVEL]: "fixed-level",
});

export function providerStrategyName(strategy) {
  return STRATEGY_NAMES[strategy] ?? "default";
}

export const ProviderError = Object.freeze({
  INVALID_REQUEST: -1,
  NO_CAPABILITY: -2,
  NO_PROVIDER: -3,
  NOT_READY: -4,
  NOT_AVAILABLE: -5,
  BOUNDS: -6,
  BAD_HANDLE: -7,
  BAD_PLANE: -8,
  UNSUPPORTED: -9,
  TIMEOUT: -10,
  HOST: -11,
  PORT_UNAVAILABLE: -12,
});

const ERROR_NAMES = Object.freeze(
  Object.fromEntries(
    Object.entries(ProviderError).map(([name, code]) => [
      code,
      `SDM_PROVIDER_E_${name}`,
    ]),
  ),
);

export function providerErrorName(code) {
  return ERROR_NAMES[code] ?? `SDM_PROVIDER_E_UNKNOWN(${code})`;
}

/**
 * No-data sentinels. NaN is deliberately NOT used: WebAssembly does not
 * canonicalize NaN payloads across every producing operation, so two runtimes
 * can legitimately hold different bits for "a NaN" and a byte-identical-output
 * assertion would fail on semantically equal values. -FLT_MAX / -DBL_MAX have
 * exactly one encoding each and are never a real terrain height.
 */
export const PROVIDER_NO_DATA_F32 = -3.4028234663852886e38; // 0xFF7FFFFF
export const PROVIDER_NO_DATA_F64 = -Number.MAX_VALUE; // 0xFFEFFFFFFFFFFFFF

export function isProviderNoData(value) {
  return value === PROVIDER_NO_DATA_F32 || value === PROVIDER_NO_DATA_F64;
}

/** Bytes per element for an encoding, and elements per pixel/sample. */
const ENCODING_LAYOUT = Object.freeze({
  [ProviderEncoding.HEIGHT_F32]: { bytes: 4, components: 1 },
  [ProviderEncoding.HEIGHT_F64]: { bytes: 8, components: 1 },
  [ProviderEncoding.RGBA8]: { bytes: 4, components: 4 },
  [ProviderEncoding.RGB8]: { bytes: 3, components: 3 },
  [ProviderEncoding.GRAY8]: { bytes: 1, components: 1 },
  [ProviderEncoding.GRAY16]: { bytes: 2, components: 1 },
  [ProviderEncoding.RGBA_F32]: { bytes: 16, components: 4 },
});

export function encodingLayout(encoding) {
  const layout = ENCODING_LAYOUT[encoding];
  if (!layout) {
    throw new RangeError(`Unknown provider encoding ${encoding}.`);
  }
  return layout;
}

/**
 * Level selection from a TARGET SAMPLE SPACING, in metres.
 *
 * Callers know the stride they intend to march at; they do not know a
 * provider's level scheme. Asking for "most detailed" everywhere is what makes
 * a solve slow, and asking for coarser than the march stride is what makes it
 * wrong — a coverage solve sampling at its output raster's spacing instead of
 * its profile's mis-reported a 400 m ridge by 27 dB. So the caller states
 * spacing and the port picks the coarsest level that satisfies it.
 *
 * Defined HERE, once, and shared by every adapter: if the browser and the host
 * tile store chose levels by their own arithmetic they would sample different
 * ground and byte parity would be lost for a reason no one could see.
 */
export const PROVIDER_EARTH_CIRCUMFERENCE_METERS = 40075016.6855785;

export function providerLevelForSpacing(spacingMeters, options = {}) {
  const tileWidth = Math.max(2, options.tileWidth ?? 65);
  const maxLevel = options.maxLevel ?? 20;
  const minLevel = options.minLevel ?? 0;
  const spacing = Number(spacingMeters);
  if (!Number.isFinite(spacing) || spacing <= 0) return maxLevel;

  for (let level = minLevel; level <= maxLevel; level += 1) {
    // Level L has 2^(L+1) tiles around the equator, each covering
    // (tileWidth - 1) sample intervals.
    const tilesAcross = Math.pow(2, level + 1);
    const levelSpacing =
      PROVIDER_EARTH_CIRCUMFERENCE_METERS / (tilesAcross * (tileWidth - 1));
    if (levelSpacing <= spacing) return level;
  }
  return maxLevel;
}

/**
 * Resolve a request's level, and report HOW it was resolved. A consumer that
 * cannot see which level answered cannot tell a solve that resolved the ridges
 * from one that interpolated them away, so provenance is returned, never
 * inferred.
 */
export function resolveRequestLevel(request, options = {}) {
  const fallback = options.defaultLevel ?? options.maxLevel ?? 0;
  const spacing = request?.spacing ?? request?.targetSpacingMeters;
  if (spacing !== undefined && spacing !== null) {
    return {
      level: providerLevelForSpacing(spacing, options),
      // Strategy names match the consumer's existing vocabulary verbatim
      // (RfTerrainAnalysis surfaces them in coverage metadata and in the demo
      // legend). A port that renamed them would force every consumer to keep a
      // translation table.
      strategy: "grid-matched-level",
      strategyCode: ProviderStrategy.GRID_MATCHED_LEVEL,
    };
  }
  const level = request?.level;
  if (level === "mostDetailed") {
    return {
      level: options.mostDetailedLevel ?? options.maxLevel ?? fallback,
      strategy: "most-detailed",
      strategyCode: ProviderStrategy.MOST_DETAILED,
    };
  }
  if (level === undefined || level === null) {
    return { level: fallback, strategy: "default", strategyCode: ProviderStrategy.DEFAULT };
  }
  const numeric = Number(level);
  if (!Number.isInteger(numeric) || numeric < 0) {
    return { level: fallback, strategy: "default", strategyCode: ProviderStrategy.DEFAULT };
  }
  return {
    level: numeric,
    strategy: "fixed-level",
    strategyCode: ProviderStrategy.FIXED_LEVEL,
  };
}

/**
 * Normalize a request's positions into [lon, lat] pairs.
 *
 * Accepts the JSON `positions` array OR the binary `positionsBuffer`
 * (interleaved f64 lon/lat) that the guest bridge materializes from a pointer.
 * Shared by every adapter so a raster field is read identically everywhere.
 */
export function normalizeRequestPositions(request) {
  const buffer = request?.positionsBuffer;
  if (buffer && ArrayBuffer.isView(buffer)) {
    const count = Math.floor(buffer.length / 2);
    const positions = new Array(count);
    for (let index = 0; index < count; index += 1) {
      positions[index] = [buffer[index * 2], buffer[index * 2 + 1]];
    }
    return positions;
  }
  if (Array.isArray(request?.positions)) {
    return request.positions.map((position) =>
      Array.isArray(position)
        ? [Number(position[0]), Number(position[1])]
        : [Number(position.longitude), Number(position.latitude)],
    );
  }
  return null;
}

/** FNV-1a 32. Stable provider-id hash, identical in every runtime. */
export function providerSourceId(id) {
  let hash = 0x811c9dc5;
  const text = String(id ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const DESC_OFFSETS = Object.freeze({
  magic: 0,
  version: 4,
  kind: 8,
  encoding: 12,
  width: 16,
  height: 20,
  planeCount: 24,
  bytesPerElement: 28,
  rowStrideBytes: 32,
  byteLength: 36,
  flags: 40,
  level: 44,
  west: 48,
  south: 56,
  east: 64,
  north: 72,
  minValue: 80,
  maxValue: 88,
  tileX: 96,
  tileY: 100,
  hostCopies: 104,
  sourceId: 108,
  costClass: 112,
  strategy: 116,
});

export const PROVIDER_LEVEL_NONE = 0xffffffff;

/**
 * Serialize a tile descriptor into 128 little-endian bytes. Byte-identical for
 * identical input in every runtime — this buffer is inside the parity envelope.
 */
export function encodeTileDescriptor(desc) {
  const bytes = new Uint8Array(PROVIDER_TILE_DESC_BYTES);
  const view = new DataView(bytes.buffer);
  const u32 = (offset, value) => view.setUint32(offset, value >>> 0, true);
  const f64 = (offset, value) => view.setFloat64(offset, Number(value), true);

  u32(DESC_OFFSETS.magic, PROVIDER_TILE_DESC_MAGIC);
  u32(DESC_OFFSETS.version, PROVIDER_ABI_VERSION);
  u32(DESC_OFFSETS.kind, desc.kind);
  u32(DESC_OFFSETS.encoding, desc.encoding);
  u32(DESC_OFFSETS.width, desc.width);
  u32(DESC_OFFSETS.height, desc.height);
  u32(DESC_OFFSETS.planeCount, desc.planeCount ?? 1);
  u32(DESC_OFFSETS.bytesPerElement, desc.bytesPerElement);
  u32(DESC_OFFSETS.rowStrideBytes, desc.rowStrideBytes);
  u32(DESC_OFFSETS.byteLength, desc.byteLength);
  u32(DESC_OFFSETS.flags, desc.flags ?? 0);
  u32(DESC_OFFSETS.level, desc.level ?? PROVIDER_LEVEL_NONE);
  f64(DESC_OFFSETS.west, desc.west ?? 0);
  f64(DESC_OFFSETS.south, desc.south ?? 0);
  f64(DESC_OFFSETS.east, desc.east ?? 0);
  f64(DESC_OFFSETS.north, desc.north ?? 0);
  f64(DESC_OFFSETS.minValue, desc.minValue ?? 0);
  f64(DESC_OFFSETS.maxValue, desc.maxValue ?? 0);
  u32(DESC_OFFSETS.tileX, desc.tileX ?? PROVIDER_LEVEL_NONE);
  u32(DESC_OFFSETS.tileY, desc.tileY ?? PROVIDER_LEVEL_NONE);
  u32(DESC_OFFSETS.hostCopies, desc.hostCopies ?? 1);
  u32(DESC_OFFSETS.sourceId, desc.sourceId ?? 0);
  u32(DESC_OFFSETS.costClass, desc.costClass ?? ProviderCost.RESIDENT);
  u32(DESC_OFFSETS.strategy, desc.strategy ?? ProviderStrategy.DEFAULT);
  return bytes;
}

/** Inverse of encodeTileDescriptor — used by tests and JS-side consumers. */
export function decodeTileDescriptor(bytes) {
  if (bytes.byteLength < PROVIDER_TILE_DESC_BYTES) {
    throw new RangeError(
      `Tile descriptor requires ${PROVIDER_TILE_DESC_BYTES} bytes, got ${bytes.byteLength}.`,
    );
  }
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    PROVIDER_TILE_DESC_BYTES,
  );
  const u32 = (offset) => view.getUint32(offset, true);
  const f64 = (offset) => view.getFloat64(offset, true);
  const magic = u32(DESC_OFFSETS.magic);
  if (magic !== PROVIDER_TILE_DESC_MAGIC) {
    throw new Error(
      `Tile descriptor magic mismatch: expected 0x${PROVIDER_TILE_DESC_MAGIC.toString(16)}, got 0x${magic.toString(16)}.`,
    );
  }
  return {
    magic,
    version: u32(DESC_OFFSETS.version),
    kind: u32(DESC_OFFSETS.kind),
    encoding: u32(DESC_OFFSETS.encoding),
    width: u32(DESC_OFFSETS.width),
    height: u32(DESC_OFFSETS.height),
    planeCount: u32(DESC_OFFSETS.planeCount),
    bytesPerElement: u32(DESC_OFFSETS.bytesPerElement),
    rowStrideBytes: u32(DESC_OFFSETS.rowStrideBytes),
    byteLength: u32(DESC_OFFSETS.byteLength),
    flags: u32(DESC_OFFSETS.flags),
    level: u32(DESC_OFFSETS.level),
    west: f64(DESC_OFFSETS.west),
    south: f64(DESC_OFFSETS.south),
    east: f64(DESC_OFFSETS.east),
    north: f64(DESC_OFFSETS.north),
    minValue: f64(DESC_OFFSETS.minValue),
    maxValue: f64(DESC_OFFSETS.maxValue),
    tileX: u32(DESC_OFFSETS.tileX),
    tileY: u32(DESC_OFFSETS.tileY),
    hostCopies: u32(DESC_OFFSETS.hostCopies),
    sourceId: u32(DESC_OFFSETS.sourceId),
    costClass: u32(DESC_OFFSETS.costClass),
    strategy: u32(DESC_OFFSETS.strategy),
  };
}

/**
 * Error thrown by adapters that want to select a specific ABI code. Anything
 * else an adapter throws becomes SDM_PROVIDER_E_HOST with the detail available
 * through `provider.lastError`.
 */
export class ProviderAccessError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ProviderAccessError";
    this.code = code;
    this.providerErrorName = providerErrorName(code);
    this.operation = options.operation ?? null;
    this.providerId = options.providerId ?? null;
  }
}

export function providerErrorCodeOf(error) {
  if (error instanceof ProviderAccessError) {
    return error.code;
  }
  if (typeof error?.code === "number" && error.code < 0 && error.code >= -12) {
    return error.code;
  }
  return ProviderError.HOST;
}
