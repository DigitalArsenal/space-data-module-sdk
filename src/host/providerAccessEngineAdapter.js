/**
 * Browser satisfaction — provider access against real engine provider objects.
 *
 * Two tiers, and which one answered is visible to the guest in
 * `descriptor.costClass`:
 *
 *   Tier A  the engine's own ProviderAccessPort, when the engine exposes one.
 *           Walks the loaded tile cache; costClass 0/1. Reaching into a
 *           provider's private fields is ENGINE work — those fields move on
 *           every upstream pin advance, and the engine keeps them tested in
 *           its own gates. The SDK calls the public port and nothing else.
 *
 *   Tier B  public engine API only. Terrain via the engine's exported
 *           most-detailed sampler, which re-requests and re-decodes:
 *           costClass 2. Under the default maxCost of 1 this tier REFUSES with
 *           SDM_PROVIDER_E_UNSUPPORTED; bytes come only from a caller that
 *           explicitly raised its ceiling.
 *
 * Nothing here imports the engine. The scene and the sampler arrive as
 * parameters — the pluggable-provider law applied to the adapter itself.
 */

import {
  PROVIDER_NO_DATA_F64,
  ProviderAccessError,
  ProviderCost,
  ProviderEncoding,
  ProviderError,
  ProviderFlags,
} from "./providerAccessAbi.js";

function engineTerrainProvider(scene) {
  return scene?.globe?.terrainProvider ?? scene?.terrainProvider ?? null;
}

function providerLabel(provider, fallback) {
  if (!provider) return fallback;
  return (
    provider.providerName ??
    provider.credit?.html ??
    provider.constructor?.name ??
    fallback
  );
}

/**
 * Tier B terrain adapter: the exported most-detailed sampler.
 *
 * The sampler mutates `height` on Cartographic-like objects and leaves it
 * `undefined` where there is no data. `undefined` cannot survive into a typed
 * array — it silently becomes 0, i.e. sea level, under a ridge. The ABI's
 * no-data sentinel is applied HERE, at the boundary, so no consumer inherits
 * that defect.
 */
function createSampledTerrainAdapter(options) {
  const scene = options.scene;
  const sampleMostDetailed = options.sampleTerrainMostDetailed;
  const sample = options.sampleTerrain;
  const cartographicFromRadians = options.cartographicFromRadians;
  const id = options.id ?? "terrain.engine";

  if (typeof cartographicFromRadians !== "function") {
    throw new TypeError(
      "The engine terrain adapter requires cartographicFromRadians(lon, lat).",
    );
  }

  async function sampleHeights(positions, level) {
    const cartographics = positions.map(([lon, lat]) =>
      cartographicFromRadians(lon, lat),
    );
    const provider = engineTerrainProvider(scene);
    if (!provider) {
      throw new ProviderAccessError(
        ProviderError.NO_PROVIDER,
        "The scene has no terrain provider.",
        { providerId: id },
      );
    }
    if (Number.isInteger(level) && typeof sample === "function") {
      return sample(provider, level, cartographics);
    }
    if (typeof sampleMostDetailed !== "function") {
      throw new ProviderAccessError(
        ProviderError.UNSUPPORTED,
        "No terrain sampler was supplied to the engine adapter.",
        { providerId: id },
      );
    }
    return sampleMostDetailed(provider, cartographics);
  }

  function pack(sampled) {
    const heights = new Float64Array(sampled.length);
    let min = Infinity;
    let max = -Infinity;
    let partial = false;
    for (let index = 0; index < sampled.length; index += 1) {
      const height = sampled[index]?.height;
      if (typeof height !== "number" || !Number.isFinite(height)) {
        heights[index] = PROVIDER_NO_DATA_F64;
        partial = true;
        continue;
      }
      heights[index] = height;
      if (height < min) min = height;
      if (height > max) max = height;
    }
    return { heights, min, max, partial };
  }

  return {
    id,
    kind: "terrain",
    name: providerLabel(engineTerrainProvider(scene), "Engine terrain"),
    ready: !!engineTerrainProvider(scene),
    minLevel: 0,
    maxLevel: options.maxLevel ?? 0,
    tileWidth: 0,
    tileHeight: 0,
    encoding: ProviderEncoding.HEIGHT_F64,
    // The whole point of the cost class: this tier re-decodes, and says so.
    costClass: ProviderCost.REDECODE,
    credit: options.credit ?? "",
    attributes: { tier: "B", surface: "public-sampler" },

    availability(params) {
      const provider = engineTerrainProvider(scene);
      const availability = provider?.availability;
      if (!availability?.isTileAvailable) return true;
      return !!availability.isTileAvailable(params.level, params.x, params.y);
    },

    prefetch() {
      // Camera-driven engines have no region prefetch. Reported, not invented.
      return { requested: 0, pending: 0, supported: false };
    },

    async awaitReady() {
      const globe = scene?.globe;
      if (!globe) return { ready: false, pending: 0 };
      return { ready: globe.tilesLoaded !== false, pending: 0 };
    },

    async acquireProfile(request) {
      const positions = Array.isArray(request.positions)
        ? request.positions
        : interpolate(request);
      const level = Number.isInteger(request.level) ? request.level : undefined;
      const { heights, min, max, partial } = pack(
        await sampleHeights(positions, level),
      );
      const first = positions[0] ?? [0, 0];
      const last = positions[positions.length - 1] ?? [0, 0];
      return {
        planes: [heights],
        descriptor: {
          encoding: ProviderEncoding.HEIGHT_F64,
          width: heights.length,
          height: 1,
          level,
          minValue: Number.isFinite(min) ? min : 0,
          maxValue: Number.isFinite(max) ? max : 0,
          flags: partial ? ProviderFlags.PARTIAL : 0,
          west: Math.min(first[0], last[0]),
          east: Math.max(first[0], last[0]),
          south: Math.min(first[1], last[1]),
          north: Math.max(first[1], last[1]),
          costClass: ProviderCost.REDECODE,
        },
      };
    },

    async acquireRegion(request) {
      const [west, south, east, north] = request.rectangle ?? [0, 0, 0, 0];
      const width = Math.max(1, request.width | 0);
      const height = Math.max(1, request.height | 0);
      const positions = [];
      for (let row = 0; row < height; row += 1) {
        const lat = north + ((south - north) * row) / height;
        for (let column = 0; column < width; column += 1) {
          positions.push([west + ((east - west) * column) / width, lat]);
        }
      }
      const level = Number.isInteger(request.level) ? request.level : undefined;
      const packed = pack(await sampleHeights(positions, level));
      return {
        planes: [packed.heights],
        descriptor: {
          encoding: ProviderEncoding.HEIGHT_F64,
          width,
          height,
          level,
          minValue: Number.isFinite(packed.min) ? packed.min : 0,
          maxValue: Number.isFinite(packed.max) ? packed.max : 0,
          flags: packed.partial ? ProviderFlags.PARTIAL : 0,
          west,
          south,
          east,
          north,
          costClass: ProviderCost.REDECODE,
        },
      };
    },
  };
}

function interpolate(request) {
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

/**
 * Imagery through the public engine surface.
 *
 * CONTROL is fully native and fully supported: the imagery layer collection
 * enumerates, orders and configures layers exactly as the engine already does.
 *
 * DATA is not. The engine releases an imagery tile's CPU pixel buffer as soon
 * as the texture is uploaded, so for any tile the renderer has finished with,
 * the decoded pixels are gone. This adapter therefore refuses resident pixel
 * reads with SDM_PROVIDER_E_UNSUPPORTED rather than re-fetching behind the
 * caller's back. Serving them cheaply requires tapping the pixels BEFORE
 * upload, which is an engine change and belongs to the engine's owner.
 */
function createImageryLayerAdapters(scene) {
  const collection = scene?.imageryLayers;
  if (!collection || typeof collection.get !== "function") return [];
  const adapters = [];
  const length = collection.length ?? 0;
  for (let index = 0; index < length; index += 1) {
    const layer = collection.get(index);
    if (!layer) continue;
    const provider = layer.imageryProvider;
    const id = `imagery.layer.${index}`;
    adapters.push({
      id,
      kind: "imagery",
      name: providerLabel(provider, `Imagery layer ${index}`),
      ready: true,
      minLevel: provider?.minimumLevel ?? 0,
      maxLevel: provider?.maximumLevel ?? 0,
      tileWidth: provider?.tileWidth ?? 0,
      tileHeight: provider?.tileHeight ?? 0,
      encoding: ProviderEncoding.RGBA8,
      costClass: ProviderCost.READBACK,
      credit: provider?.credit?.html ?? "",
      attributes: { tier: "B", surface: "imagery-layer", index },

      availability(params) {
        const availability = provider?.availability;
        if (!availability?.isTileAvailable) return true;
        return !!availability.isTileAvailable(params.level, params.x, params.y);
      },

      select() {
        if (typeof collection.raiseToTop === "function") {
          collection.raiseToTop(layer);
        }
      },

      configure(settings = {}) {
        const applied = [];
        const rejected = [];
        // Native layer properties only. An adapter must never emulate a
        // setting the underlying surface does not have.
        const native = [
          "show",
          "alpha",
          "brightness",
          "contrast",
          "hue",
          "saturation",
          "gamma",
        ];
        for (const [key, value] of Object.entries(settings)) {
          if (native.includes(key) && key in layer) {
            layer[key] = value;
            applied.push(key);
          } else {
            rejected.push(key);
          }
        }
        return { applied, rejected };
      },

      prefetch() {
        return { requested: 0, pending: 0, supported: false };
      },

      acquireTile() {
        throw new ProviderAccessError(
          ProviderError.UNSUPPORTED,
          "Imagery pixels are released when the tile is uploaded to the GPU; " +
            "resident pixel reads need an engine-side pre-upload tap. " +
            "Raise maxCost to opt into a re-fetch or a GPU readback.",
          { providerId: id },
        );
      },
    });
  }
  return adapters;
}

/**
 * Build provider adapters from a live engine scene.
 *
 * `scene.providerAccessPort` (Tier A), when the engine exposes it, is used
 * verbatim: the engine owns private-field access, the SDK owns the wasm ABI.
 */
export function createEngineProviderAdapters(options = {}) {
  const scene = options.scene;
  if (!scene) {
    throw new TypeError("createEngineProviderAdapters requires a scene.");
  }

  const enginePort = scene.providerAccessPort ?? options.providerAccessPort;
  if (enginePort && typeof enginePort.adapters === "function") {
    return enginePort.adapters();
  }
  if (Array.isArray(enginePort?.adapters)) {
    return enginePort.adapters;
  }

  const adapters = [];
  if (typeof options.cartographicFromRadians === "function") {
    adapters.push(createSampledTerrainAdapter({ ...options, scene }));
  }
  adapters.push(...createImageryLayerAdapters(scene));
  return adapters;
}
