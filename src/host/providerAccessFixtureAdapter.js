/**
 * Deterministic fixture providers — the parity instrument.
 *
 * Live network providers cannot be byte-parity-tested: two runtimes reading a
 * world terrain service are not obliged to hold the same tiles at the same
 * instant, and asserting so would be false rigor. These fixtures are the
 * source that IS inside the byte envelope, bound identically in the browser,
 * in native WasmEdge and in the Docker WasmEdge container.
 *
 * Every value is produced with IEEE-754 basic operations only: integer
 * arithmetic, +, -, *, and division by powers of two. No transcendental is
 * used anywhere. `Math.sin` and friends are NOT bit-reproducible across
 * engines, and a fixture whose bytes depend on a libm implementation would be
 * testing the libm, not the ABI.
 */

import {
  PROVIDER_NO_DATA_F64,
  ProviderCost,
  ProviderEncoding,
  ProviderKind,
} from "./providerAccessAbi.js";

const TWO_PI = 6.283185307179586;
const PI_OVER_TWO = 1.5707963267948966;

/** FNV-1a over a fixed integer tuple. Exact, order-dependent, no floats. */
function hashInts(...values) {
  let hash = 0x811c9dc5;
  for (const value of values) {
    let word = value >>> 0;
    for (let byte = 0; byte < 4; byte += 1) {
      hash ^= word & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
      word >>>= 8;
    }
  }
  return hash >>> 0;
}

/** Exact: a u32 divided by 2^32 is representable with no rounding. */
function unitOf(hash) {
  return hash / 4294967296;
}

/**
 * Closed-form height field, metres. Deterministic in (level, x, y, i, j) alone
 * — never in wall-clock, iteration order, or thread count, which is what makes
 * "byte-identical at ANY thread count" testable rather than hopeful.
 *
 * A coarse ridge term plus a fine detail term, so a profile across it has real
 * ridges to occlude a radio path.
 */
export function fixtureHeight(level, tileX, tileY, i, j) {
  const ridge = unitOf(hashInts(level, tileX, tileY, i >>> 3, j >>> 3));
  const detail = unitOf(hashInts(level ^ 0x5a5a, tileX, tileY, i, j));
  // 0..8500 m from the ridge term, 0..250 m of detail, floor at -420 m.
  return ridge * 8500 - 420 + detail * 250;
}

/** Closed-form RGBA8 pixel field. */
export function fixturePixel(level, tileX, tileY, i, j) {
  const hash = hashInts(level, tileX, tileY, i, j);
  return [
    hash & 0xff,
    (hash >>> 8) & 0xff,
    (hash >>> 16) & 0xff,
    255,
  ];
}

function tileRectangle(level, x, y) {
  const tiles = 1 << level;
  const width = TWO_PI / (tiles * 2);
  const height = Math.PI / tiles;
  const west = -Math.PI + x * width;
  const north = PI_OVER_TWO - y * height;
  return { west, south: north - height, east: west + width, north };
}

function resolveLevel(request, fallback) {
  const level = request?.level;
  if (level === "mostDetailed" || level === undefined || level === null) {
    return fallback;
  }
  const numeric = Number(level);
  if (!Number.isInteger(numeric) || numeric < 0) {
    return fallback;
  }
  return numeric;
}

/**
 * Great-circle-shaped position interpolation, done HOST-side so that two
 * runtimes sampling the same start/end agree byte-for-byte. Linear in radians:
 * exact under IEEE-754 basic ops, and the fixture's job is reproducibility,
 * not geodesy.
 */
function interpolatePositions(request) {
  if (Array.isArray(request.positions)) {
    return request.positions.map(([lon, lat]) => [Number(lon), Number(lat)]);
  }
  const [lon0, lat0] = request.start ?? [0, 0];
  const [lon1, lat1] = request.end ?? [0, 0];
  const samples = Math.max(2, Math.min(request.samples | 0 || 2, 1 << 20));
  const positions = new Array(samples);
  const last = samples - 1;
  for (let index = 0; index < samples; index += 1) {
    const t = index / last;
    positions[index] = [
      lon0 + (lon1 - lon0) * t,
      lat0 + (lat1 - lat0) * t,
    ];
  }
  return positions;
}

function positionToTileSample(lon, lat, level, tileWidth, tileHeight) {
  const tiles = 1 << level;
  const u = (lon + Math.PI) / TWO_PI;
  const v = (PI_OVER_TWO - lat) / Math.PI;
  const gx = u * tiles * 2;
  const gy = v * tiles;
  const tileX = Math.min(Math.max(Math.floor(gx), 0), tiles * 2 - 1);
  const tileY = Math.min(Math.max(Math.floor(gy), 0), tiles - 1);
  const i = Math.min(Math.max(Math.floor((gx - tileX) * tileWidth), 0), tileWidth - 1);
  const j = Math.min(Math.max(Math.floor((gy - tileY) * tileHeight), 0), tileHeight - 1);
  return { tileX, tileY, i, j };
}

export function createFixtureTerrainProvider(options = {}) {
  const id = options.id ?? "terrain.fixture";
  const tileWidth = options.tileWidth ?? 65;
  const tileHeight = options.tileHeight ?? 65;
  const maxLevel = options.maxLevel ?? 12;
  const defaultLevel = options.defaultLevel ?? 9;
  // A hole so FLAG_PARTIAL and the no-data sentinel are exercised, not assumed.
  const voidTile = options.voidTile ?? { level: 9, x: 3, y: 3 };

  function isVoid(level, x, y) {
    return (
      voidTile &&
      level === voidTile.level &&
      x === voidTile.x &&
      y === voidTile.y
    );
  }

  return {
    id,
    kind: "terrain",
    name: options.name ?? "Deterministic fixture terrain",
    ready: true,
    minLevel: 0,
    maxLevel,
    tileWidth,
    tileHeight,
    encoding: ProviderEncoding.HEIGHT_F32,
    costClass: ProviderCost.RESIDENT,
    credit: "fixture",
    fixture: true,

    availability({ level, x, y }) {
      return level <= maxLevel && !isVoid(level, x, y);
    },

    prefetch({ level }) {
      // A tile store has no camera: it can genuinely prefetch.
      return { requested: 1 << Math.min(level ?? 0, 8), pending: 0 };
    },

    awaitReady() {
      return { ready: true, pending: 0 };
    },

    acquireTile(request) {
      const level = resolveLevel(request, defaultLevel);
      const x = request.x | 0;
      const y = request.y | 0;
      if (isVoid(level, x, y)) {
        const error = new Error(`Fixture tile ${level}/${x}/${y} has no data.`);
        error.code = -5; // NOT_AVAILABLE
        throw error;
      }
      const heights = new Float32Array(tileWidth * tileHeight);
      let min = Infinity;
      let max = -Infinity;
      for (let j = 0; j < tileHeight; j += 1) {
        for (let i = 0; i < tileWidth; i += 1) {
          const height = fixtureHeight(level, x, y, i, j);
          heights[j * tileWidth + i] = height;
          if (height < min) min = height;
          if (height > max) max = height;
        }
      }
      return {
        planes: [heights],
        descriptor: {
          encoding: ProviderEncoding.HEIGHT_F32,
          width: tileWidth,
          height: tileHeight,
          level,
          tileX: x,
          tileY: y,
          minValue: min,
          maxValue: max,
          costClass: ProviderCost.RESIDENT,
          ...tileRectangle(level, x, y),
        },
      };
    },

    acquireProfile(request) {
      const level = resolveLevel(request, defaultLevel);
      const positions = interpolatePositions(request);
      const heights = new Float64Array(positions.length);
      let min = Infinity;
      let max = -Infinity;
      let partial = false;
      for (let index = 0; index < positions.length; index += 1) {
        const [lon, lat] = positions[index];
        const sample = positionToTileSample(lon, lat, level, tileWidth, tileHeight);
        if (isVoid(level, sample.tileX, sample.tileY)) {
          heights[index] = PROVIDER_NO_DATA_F64;
          partial = true;
          continue;
        }
        // Round through f32 EXACTLY as the source tile stores it. A profile is
        // a sampling OF the source, not a re-derivation at higher precision:
        // without this, reading a tile and interpolating it yourself gives
        // different numbers than asking for a profile through the same point,
        // and any host whose tiles really are f32 diverges from this fixture.
        const height = Math.fround(
          fixtureHeight(level, sample.tileX, sample.tileY, sample.i, sample.j),
        );
        heights[index] = height;
        if (height < min) min = height;
        if (height > max) max = height;
      }
      const first = positions[0];
      const last = positions[positions.length - 1];
      return {
        planes: [heights],
        descriptor: {
          encoding: ProviderEncoding.HEIGHT_F64,
          width: positions.length,
          height: 1,
          level,
          minValue: Number.isFinite(min) ? min : 0,
          maxValue: Number.isFinite(max) ? max : 0,
          flags: partial ? 1 << 2 : 0,
          west: Math.min(first[0], last[0]),
          east: Math.max(first[0], last[0]),
          south: Math.min(first[1], last[1]),
          north: Math.max(first[1], last[1]),
          costClass: ProviderCost.RESIDENT,
        },
      };
    },

    acquireRegion(request) {
      const level = resolveLevel(request, defaultLevel);
      const [west, south, east, north] = request.rectangle ?? [0, 0, 0, 0];
      const width = Math.max(1, request.width | 0);
      const height = Math.max(1, request.height | 0);
      const heights = new Float32Array(width * height);
      let min = Infinity;
      let max = -Infinity;
      for (let row = 0; row < height; row += 1) {
        const lat = north + ((south - north) * row) / height;
        for (let column = 0; column < width; column += 1) {
          const lon = west + ((east - west) * column) / width;
          const sample = positionToTileSample(lon, lat, level, tileWidth, tileHeight);
          const value = fixtureHeight(
            level,
            sample.tileX,
            sample.tileY,
            sample.i,
            sample.j,
          );
          heights[row * width + column] = value;
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
      return {
        planes: [heights],
        descriptor: {
          encoding: ProviderEncoding.HEIGHT_F32,
          width,
          height,
          level,
          minValue: min,
          maxValue: max,
          west,
          south,
          east,
          north,
          costClass: ProviderCost.RESIDENT,
        },
      };
    },
  };
}

export function createFixtureImageryProvider(options = {}) {
  const id = options.id ?? "imagery.fixture";
  const tileWidth = options.tileWidth ?? 64;
  const tileHeight = options.tileHeight ?? 64;
  const maxLevel = options.maxLevel ?? 12;
  const defaultLevel = options.defaultLevel ?? 9;

  function renderTile(level, x, y, width, height) {
    const pixels = new Uint8Array(width * height * 4);
    for (let j = 0; j < height; j += 1) {
      for (let i = 0; i < width; i += 1) {
        const [r, g, b, a] = fixturePixel(level, x, y, i, j);
        const offset = (j * width + i) * 4;
        pixels[offset] = r;
        pixels[offset + 1] = g;
        pixels[offset + 2] = b;
        pixels[offset + 3] = a;
      }
    }
    return pixels;
  }

  return {
    id,
    kind: "imagery",
    name: options.name ?? "Deterministic fixture imagery",
    ready: true,
    minLevel: 0,
    maxLevel,
    tileWidth,
    tileHeight,
    encoding: ProviderEncoding.RGBA8,
    costClass: ProviderCost.RESIDENT,
    credit: "fixture",
    fixture: true,
    // A fixture imagery source keeps its pixels resident, which a real browser
    // imagery layer does not. That asymmetry is the ABI's cost class doing its
    // job, not a fixture cheating: parity is asserted on THIS source in every
    // lane, and the engine adapter reports its own (higher) cost honestly.

    availability({ level }) {
      return level <= maxLevel;
    },

    configure(settings = {}) {
      const applied = [];
      const rejected = [];
      for (const key of Object.keys(settings)) {
        if (["alpha", "brightness", "show"].includes(key)) applied.push(key);
        else rejected.push(key);
      }
      return { applied, rejected };
    },

    acquireTile(request) {
      const level = resolveLevel(request, defaultLevel);
      const x = request.x | 0;
      const y = request.y | 0;
      return {
        planes: [renderTile(level, x, y, tileWidth, tileHeight)],
        descriptor: {
          encoding: ProviderEncoding.RGBA8,
          width: tileWidth,
          height: tileHeight,
          level,
          tileX: x,
          tileY: y,
          costClass: ProviderCost.RESIDENT,
          ...tileRectangle(level, x, y),
        },
      };
    },

    acquireRegion(request) {
      const level = resolveLevel(request, defaultLevel);
      const [west, south, east, north] = request.rectangle ?? [0, 0, 0, 0];
      const width = Math.max(1, request.width | 0);
      const height = Math.max(1, request.height | 0);
      const pixels = new Uint8Array(width * height * 4);
      for (let row = 0; row < height; row += 1) {
        const lat = north + ((south - north) * row) / height;
        for (let column = 0; column < width; column += 1) {
          const lon = west + ((east - west) * column) / width;
          const sample = positionToTileSample(lon, lat, level, tileWidth, tileHeight);
          const [r, g, b, a] = fixturePixel(
            level,
            sample.tileX,
            sample.tileY,
            sample.i,
            sample.j,
          );
          const offset = (row * width + column) * 4;
          pixels[offset] = r;
          pixels[offset + 1] = g;
          pixels[offset + 2] = b;
          pixels[offset + 3] = a;
        }
      }
      return {
        planes: [pixels],
        descriptor: {
          encoding: ProviderEncoding.RGBA8,
          width,
          height,
          level,
          west,
          south,
          east,
          north,
          costClass: ProviderCost.RESIDENT,
        },
      };
    },
  };
}

export function createFixtureProviderAdapters(options = {}) {
  return [
    createFixtureTerrainProvider(options.terrain ?? {}),
    createFixtureImageryProvider(options.imagery ?? {}),
  ];
}

export const FixtureProviderKinds = ProviderKind;
