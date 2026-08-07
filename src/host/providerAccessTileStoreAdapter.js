/**
 * WasmEdge satisfaction — a host-side tile store behind the same port.
 *
 * THE RULING. Under WasmEdge, native or in Docker, there is no engine. The
 * server-side satisfaction of this port is a host-side TILE STORE, not a
 * refusal and not an engine port. It serves the identical operations from
 * sources the host can reach, and it does so using ONLY capabilities that
 * already exist — `filesystem` for a local tileset directory, `http` for a
 * remote tile service. It introduces no new generic hook, so it needs no owner
 * sign-off and no new connector.
 *
 * The refusal case still exists and is still first-class: a host with no tile
 * store configured registers no adapter, `provider.list` succeeds with an
 * empty array, and `acquire` answers SDM_PROVIDER_E_NO_PROVIDER — the same
 * code a browser gives for an unknown provider id, reachable and therefore
 * testable in every lane.
 *
 * Node-side wiring of a specific curated source is CONFIGURATION of this
 * adapter, never a change to the ABI.
 */

import {
  PROVIDER_NO_DATA_F64,
  ProviderAccessError,
  ProviderCost,
  ProviderEncoding,
  ProviderError,
  ProviderFlags,
} from "./providerAccessAbi.js";

const TWO_PI = 6.283185307179586;
const PI_OVER_TWO = 1.5707963267948966;

/**
 * A tile store is anything that can answer "give me the decoded elements of
 * tile (level,x,y)". The transport is the caller's business — a preopened
 * directory read through the `filesystem` capability, an HTTP tile service
 * through the `http` capability, or an in-memory map.
 *
 *   readTile(level, x, y) -> { elements: TypedArray, width, height } | null
 *
 * Returning null means "not available" and becomes E_NOT_AVAILABLE. Throwing
 * with `.code` set selects a specific ABI code; anything else becomes E_HOST
 * with the detail on `provider.lastError`.
 */
export function createTileStoreTerrainProvider(options = {}) {
  const store = options.store;
  if (!store || typeof store.readTile !== "function") {
    throw new TypeError(
      "createTileStoreTerrainProvider requires a store with readTile(level, x, y).",
    );
  }
  const id = options.id ?? "terrain.tilestore";
  const tileWidth = options.tileWidth ?? 65;
  const tileHeight = options.tileHeight ?? 65;
  const maxLevel = options.maxLevel ?? 14;
  const defaultLevel = options.defaultLevel ?? 9;
  // A store that decodes on read costs REDECODE; one that memoizes decoded
  // tiles costs RESIDENT. The store declares it; the adapter never guesses.
  const costClass = options.costClass ?? ProviderCost.RESIDENT;

  function resolveLevel(request) {
    const level = request?.level;
    if (level === "mostDetailed" || level === undefined || level === null) {
      return options.mostDetailedLevel ?? maxLevel;
    }
    const numeric = Number(level);
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : defaultLevel;
  }

  function loadTile(level, x, y) {
    const tile = store.readTile(level, x, y);
    return thenish(tile, (resolved) => {
      if (!resolved) {
        throw new ProviderAccessError(
          ProviderError.NOT_AVAILABLE,
          `Tile ${level}/${x}/${y} is not present in the store.`,
          { providerId: id },
        );
      }
      return resolved;
    });
  }

  function sampleTile(tile, i, j) {
    const width = tile.width ?? tileWidth;
    return tile.elements[j * width + i];
  }

  return {
    id,
    kind: "terrain",
    name: options.name ?? "Host tile store terrain",
    ready: true,
    minLevel: options.minLevel ?? 0,
    maxLevel,
    tileWidth,
    tileHeight,
    encoding: ProviderEncoding.HEIGHT_F32,
    costClass,
    credit: options.credit ?? "",
    attributes: { surface: "tile-store" },

    availability(params) {
      if (typeof store.hasTile === "function") {
        return store.hasTile(params.level, params.x, params.y);
      }
      return params.level <= maxLevel;
    },

    prefetch(params) {
      // A tile store has no camera. It can genuinely prefetch, and says so.
      if (typeof store.prefetch === "function") return store.prefetch(params);
      return { requested: 0, pending: 0 };
    },

    awaitReady() {
      return { ready: true, pending: 0 };
    },

    acquireTile(request) {
      const level = resolveLevel(request);
      const x = request.x | 0;
      const y = request.y | 0;
      return thenish(loadTile(level, x, y), (tile) => {
        const elements =
          tile.elements instanceof Float32Array
            ? tile.elements
            : Float32Array.from(tile.elements);
        let min = Infinity;
        let max = -Infinity;
        for (const value of elements) {
          if (value < min) min = value;
          if (value > max) max = value;
        }
        return {
          planes: [elements],
          descriptor: {
            encoding: ProviderEncoding.HEIGHT_F32,
            width: tile.width ?? tileWidth,
            height: tile.height ?? tileHeight,
            level,
            tileX: x,
            tileY: y,
            minValue: Number.isFinite(min) ? min : 0,
            maxValue: Number.isFinite(max) ? max : 0,
            costClass,
            ...tileRectangle(level, x, y),
          },
        };
      });
    },

    async acquireProfile(request) {
      const level = resolveLevel(request);
      const positions = interpolate(request);
      const heights = new Float64Array(positions.length);
      const cache = new Map();
      let min = Infinity;
      let max = -Infinity;
      let partial = false;

      for (let index = 0; index < positions.length; index += 1) {
        const [lon, lat] = positions[index];
        const sample = toTileSample(lon, lat, level, tileWidth, tileHeight);
        const key = `${sample.tileX}/${sample.tileY}`;
        if (!cache.has(key)) {
          try {
            cache.set(key, await loadTile(level, sample.tileX, sample.tileY));
          } catch (error) {
            if (error?.code !== ProviderError.NOT_AVAILABLE) throw error;
            cache.set(key, null);
          }
        }
        const tile = cache.get(key);
        if (!tile) {
          heights[index] = PROVIDER_NO_DATA_F64;
          partial = true;
          continue;
        }
        const value = sampleTile(tile, sample.i, sample.j);
        heights[index] = value;
        if (value < min) min = value;
        if (value > max) max = value;
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
          flags: partial ? ProviderFlags.PARTIAL : 0,
          west: Math.min(first[0], last[0]),
          east: Math.max(first[0], last[0]),
          south: Math.min(first[1], last[1]),
          north: Math.max(first[1], last[1]),
          costClass,
        },
      };
    },

    async acquireRegion(request) {
      const level = resolveLevel(request);
      const [west, south, east, north] = request.rectangle ?? [0, 0, 0, 0];
      const width = Math.max(1, request.width | 0);
      const height = Math.max(1, request.height | 0);
      const values = new Float32Array(width * height);
      const cache = new Map();
      let min = Infinity;
      let max = -Infinity;
      let partial = false;

      for (let row = 0; row < height; row += 1) {
        const lat = north + ((south - north) * row) / height;
        for (let column = 0; column < width; column += 1) {
          const lon = west + ((east - west) * column) / width;
          const sample = toTileSample(lon, lat, level, tileWidth, tileHeight);
          const key = `${sample.tileX}/${sample.tileY}`;
          if (!cache.has(key)) {
            try {
              cache.set(key, await loadTile(level, sample.tileX, sample.tileY));
            } catch (error) {
              if (error?.code !== ProviderError.NOT_AVAILABLE) throw error;
              cache.set(key, null);
            }
          }
          const tile = cache.get(key);
          if (!tile) {
            values[row * width + column] = -3.4028234663852886e38;
            partial = true;
            continue;
          }
          const value = sampleTile(tile, sample.i, sample.j);
          values[row * width + column] = value;
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }

      return {
        planes: [values],
        descriptor: {
          encoding: ProviderEncoding.HEIGHT_F32,
          width,
          height,
          level,
          minValue: Number.isFinite(min) ? min : 0,
          maxValue: Number.isFinite(max) ? max : 0,
          flags: partial ? ProviderFlags.PARTIAL : 0,
          west,
          south,
          east,
          north,
          costClass,
        },
      };
    },
  };
}

/**
 * Tile store backed by the SDK host's `filesystem` capability.
 *
 * Uses only an existing generic hook. `decode(bytes, level, x, y)` is supplied
 * by the caller because a tile format is not the ABI's business.
 */
export function createFilesystemTileStore(options = {}) {
  const host = options.host;
  const root = String(options.root ?? "").replace(/\/+$/, "");
  const decode = options.decode;
  const template = options.template ?? "{level}/{x}/{y}.bin";
  if (!host?.filesystem) {
    throw new TypeError(
      "createFilesystemTileStore requires a host with the filesystem capability.",
    );
  }
  if (typeof decode !== "function") {
    throw new TypeError(
      "createFilesystemTileStore requires decode(bytes, level, x, y).",
    );
  }

  function pathFor(level, x, y) {
    return `${root}/${template
      .replace("{level}", String(level))
      .replace("{x}", String(x))
      .replace("{y}", String(y))}`;
  }

  return {
    async readTile(level, x, y) {
      try {
        const bytes = await host.filesystem.readFile(pathFor(level, x, y));
        if (!bytes) return null;
        return decode(bytes, level, x, y);
      } catch (error) {
        if (
          error?.code === "ENOENT" ||
          /not found|no such file/i.test(error?.message ?? "")
        ) {
          return null;
        }
        throw error;
      }
    },
  };
}

function thenish(value, onValue) {
  return value !== null && typeof value?.then === "function"
    ? value.then(onValue)
    : onValue(value);
}

function tileRectangle(level, x, y) {
  const tiles = 1 << level;
  const width = TWO_PI / (tiles * 2);
  const height = Math.PI / tiles;
  const west = -Math.PI + x * width;
  const north = PI_OVER_TWO - y * height;
  return { west, south: north - height, east: west + width, north };
}

function toTileSample(lon, lat, level, tileWidth, tileHeight) {
  const tiles = 1 << level;
  const gx = ((lon + Math.PI) / TWO_PI) * tiles * 2;
  const gy = ((PI_OVER_TWO - lat) / Math.PI) * tiles;
  const tileX = Math.min(Math.max(Math.floor(gx), 0), tiles * 2 - 1);
  const tileY = Math.min(Math.max(Math.floor(gy), 0), tiles - 1);
  return {
    tileX,
    tileY,
    i: Math.min(Math.max(Math.floor((gx - tileX) * tileWidth), 0), tileWidth - 1),
    j: Math.min(Math.max(Math.floor((gy - tileY) * tileHeight), 0), tileHeight - 1),
  };
}

function interpolate(request) {
  if (Array.isArray(request.positions)) {
    return request.positions.map(([lon, lat]) => [Number(lon), Number(lat)]);
  }
  const [lon0, lat0] = request.start ?? [0, 0];
  const [lon1, lat1] = request.end ?? [0, 0];
  const samples = Math.max(2, request.samples | 0 || 2);
  const positions = new Array(samples);
  const last = samples - 1;
  for (let index = 0; index < samples; index += 1) {
    const t = index / last;
    positions[index] = [lon0 + (lon1 - lon0) * t, lat0 + (lat1 - lat0) * t];
  }
  return positions;
}
