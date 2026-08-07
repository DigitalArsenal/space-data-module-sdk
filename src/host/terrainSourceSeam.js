/**
 * Terrain source seam — the one interface a terrain consumer binds to.
 *
 * This exists so that the in-flight RF terrain solver does not ship a private
 * terrain path. It is deliberately tiny and deliberately dual-shaped:
 *
 *   readHeights(positions, out)  the real entry — contiguous metres, one
 *                                Float64Array, no per-sample JS object, no-data
 *                                as the ABI sentinel rather than `undefined`
 *
 *   sampleCompat(provider, ps)   signature-compatible with the sampler the
 *                                solver's injectable statics already hold, so
 *                                the seam can be assigned on day one with no
 *                                call-site change
 *
 * The cutover is therefore two recorded steps, not a rewrite: assign the seam
 * now through the existing statics; move call sites to `readHeights` and make
 * the source an explicit parameter when the engine port lands.
 */

import {
  PROVIDER_NO_DATA_F64,
  ProviderCost,
  ProviderFlags,
  decodeTileDescriptor,
  isProviderNoData,
} from "./providerAccessAbi.js";

const PROVIDER_FLAG_PARTIAL = ProviderFlags.PARTIAL;
const PROVIDER_FLAG_INTERPOLATED = ProviderFlags.INTERPOLATED;

export const TERRAIN_SOURCE_NO_DATA = PROVIDER_NO_DATA_F64;

const REQUIRED_METHODS = Object.freeze([
  "readHeights",
  "readProfile",
  "sampleCompat",
]);
const REQUIRED_FIELDS = Object.freeze(["id", "costClass"]);

/**
 * Prove at wiring time that whatever a consumer was handed is the real seam.
 * A consumer that calls this cannot silently fall back to a private path,
 * because a private path will not conform.
 */
export function assertTerrainSourceConformance(source, label = "terrain source") {
  const problems = [];
  if (!source || typeof source !== "object") {
    throw new TypeError(`${label} must be an object implementing the terrain source seam.`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (source[field] === undefined || source[field] === null) {
      problems.push(`missing field "${field}"`);
    }
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof source[method] !== "function") {
      problems.push(`missing method "${method}()"`);
    }
  }
  if (problems.length > 0) {
    throw new TypeError(
      `${label} does not conform to the terrain source seam: ${problems.join(", ")}. ` +
        "See docs/provider-access-abi.md#consumer-seam--terrain-source.",
    );
  }
  return source;
}

/**
 * Wrap a provider access port as a terrain source.
 *
 * `maxCost` is passed through unchanged: a consumer that wants only resident
 * bytes leaves it at the default and gets a refusal instead of a silent
 * re-decode; a consumer that knowingly accepts the engine's re-decoding
 * sampler raises it and says so in its own source.
 */
export function createTerrainSourceFromPort(port, options = {}) {
  if (!port || typeof port.invoke !== "function") {
    throw new TypeError("createTerrainSourceFromPort requires a provider access port.");
  }
  const providerId = options.providerId ?? null;
  const maxCost = Number.isInteger(options.maxCost)
    ? options.maxCost
    : ProviderCost.DEQUANTIZE;
  const level = options.level ?? "mostDetailed";

  async function acquireProfile(positions, callOptions = {}) {
    const request = {
      op: "profile",
      positions: positions.map((position) => toRadianPair(position)),
      maxCost: callOptions.maxCost ?? maxCost,
    };
    // Spacing wins over level when supplied: a consumer knows the stride it
    // intends to march at, not a provider's level scheme.
    const spacing = callOptions.spacing ?? options.spacing;
    if (spacing !== undefined && spacing !== null) {
      request.spacing = spacing;
    } else {
      request.level = callOptions.level ?? level;
    }
    if (providerId) request.providerId = providerId;
    else request.kind = "terrain";

    const { handle, descriptor } = await port.invoke("provider.acquire", request);
    try {
      const decoded = decodeTileDescriptor(descriptor);
      const { bytes } = await port.invoke("provider.readRaw", {
        handle,
        plane: 0,
        srcOffset: 0,
        length: positions.length * 8,
      });
      return { bytes, decoded };
    } finally {
      await port.invoke("provider.release", { handle });
    }
  }

  function toHeights(bytes) {
    return new Float64Array(
      bytes.buffer,
      bytes.byteOffset,
      Math.floor(bytes.byteLength / 8),
    );
  }

  return {
    id: providerId ?? "terrain.port",
    costClass: maxCost,

    /** Bulk: contiguous metres. `out` is filled and returned when supplied. */
    async readHeights(positions, out, callOptions = {}) {
      const { bytes } = await acquireProfile(positions, callOptions);
      const heights = toHeights(bytes);
      if (!out) return heights.slice();
      out.set(heights.subarray(0, out.length));
      return out;
    },

    /**
     * Heights PLUS provenance.
     *
     * A consumer that cannot see which level answered cannot tell a solve that
     * resolved the ridges from one that interpolated them away, so the level
     * actually used and how it was chosen come back with the data rather than
     * being inferred from the request.
     */
    async readProfile(positions, callOptions = {}) {
      const { bytes, decoded } = await acquireProfile(positions, callOptions);
      const heights = toHeights(bytes);
      return {
        heights: callOptions.out
          ? (callOptions.out.set(heights.subarray(0, callOptions.out.length)),
            callOptions.out)
          : heights.slice(),
        level: decoded.level,
        strategy:
          (callOptions.spacing ?? options.spacing) !== undefined &&
          (callOptions.spacing ?? options.spacing) !== null
            ? "spacing"
            : (callOptions.level ?? level) === "mostDetailed"
              ? "mostDetailed"
              : "fixed",
        costClass: decoded.costClass,
        partial: Boolean(decoded.flags & PROVIDER_FLAG_PARTIAL),
        interpolated: Boolean(decoded.flags & PROVIDER_FLAG_INTERPOLATED),
      };
    },

    /**
     * Legacy shape. Mutates `height` on the supplied cartographics, exactly as
     * the engine sampler does — including leaving no-data samples `undefined`,
     * because that is what the existing call sites expect. New code should use
     * readHeights and the sentinel.
     */
    async sampleCompat(_provider, positions) {
      const heights = await this.readHeights(positions);
      for (let index = 0; index < positions.length; index += 1) {
        const height = heights[index];
        positions[index].height = isProviderNoData(height) ? undefined : height;
      }
      return positions;
    },
  };
}

function toRadianPair(position) {
  if (Array.isArray(position)) return [Number(position[0]), Number(position[1])];
  if (typeof position?.longitude === "number") {
    return [position.longitude, position.latitude];
  }
  throw new TypeError(
    "A terrain sample position must be [lonRadians, latRadians] or a Cartographic.",
  );
}
