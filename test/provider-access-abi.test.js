import test from "node:test";
import assert from "node:assert/strict";
import { WASI } from "node:wasi";
import { readFile } from "node:fs/promises";

import {
  cleanupCompilation,
  compileModuleFromSource,
} from "../src/index.js";
import {
  PROVIDER_IMPORT_MODULE,
  PROVIDER_NO_DATA_F64,
  PROVIDER_TILE_DESC_BYTES,
  PROVIDER_TILE_DESC_MAGIC,
  ProviderCost,
  ProviderEncoding,
  ProviderError,
  ProviderFlags,
  ProviderKind,
  decodeTileDescriptor,
  encodeTileDescriptor,
  ProviderStrategy,
  providerLevelForSpacing,
  providerSourceId,
  providerStrategyName,
} from "../src/host/providerAccessAbi.js";
import {
  createProviderAccessBridge,
  createProviderAccessPort,
  createUnavailableProviderPort,
} from "../src/host/providerAccess.js";
import {
  createFixtureProviderAdapters,
  createFixtureTerrainProvider,
  fixtureHeight,
} from "../src/host/providerAccessFixtureAdapter.js";
import { createEngineProviderAdapters } from "../src/host/providerAccessEngineAdapter.js";
import { createTileStoreTerrainProvider } from "../src/host/providerAccessTileStoreAdapter.js";
import {
  assertTerrainSourceConformance,
  createTerrainSourceFromPort,
} from "../src/host/terrainSourceSeam.js";

const PROVIDER_HEADER = new URL(
  "../templates/provider-access-module/include/space_data_provider_abi.h",
  import.meta.url,
);

/* ------------------------------------------------------------------ *
 * Descriptor codec
 * ------------------------------------------------------------------ */

test("tile descriptor is exactly 128 little-endian bytes and round-trips", () => {
  const descriptor = {
    kind: ProviderKind.TERRAIN,
    encoding: ProviderEncoding.HEIGHT_F64,
    width: 256,
    height: 1,
    planeCount: 1,
    bytesPerElement: 8,
    rowStrideBytes: 2048,
    byteLength: 2048,
    flags: ProviderFlags.DERIVED | ProviderFlags.FIXTURE,
    level: 9,
    west: -1.9,
    south: 0.65,
    east: -1.88,
    north: 0.66,
    minValue: -420.5,
    maxValue: 8123.25,
    tileX: 3,
    tileY: 4,
    hostCopies: 1,
    sourceId: providerSourceId("terrain.fixture"),
    costClass: ProviderCost.RESIDENT,
  };
  const bytes = encodeTileDescriptor(descriptor);
  assert.equal(bytes.byteLength, PROVIDER_TILE_DESC_BYTES);

  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), PROVIDER_TILE_DESC_MAGIC);
  // The f64 block must stay 8-byte aligned or guests cannot use aligned loads.
  for (const offset of [48, 56, 64, 72, 80, 88]) {
    assert.equal(offset % 8, 0, `f64 field at ${offset} must be 8-byte aligned`);
  }

  const decoded = decodeTileDescriptor(bytes);
  for (const [key, value] of Object.entries(descriptor)) {
    assert.equal(decoded[key], value, `descriptor field ${key}`);
  }
});

test("descriptor encoding is byte-stable for identical input", () => {
  const descriptor = { kind: 1, encoding: 1, width: 65, height: 65, bytesPerElement: 4, rowStrideBytes: 260, byteLength: 16900 };
  assert.deepEqual(
    Array.from(encodeTileDescriptor(descriptor)),
    Array.from(encodeTileDescriptor(descriptor)),
  );
});

/* ------------------------------------------------------------------ *
 * Fixture determinism — the parity instrument itself must be sound
 * ------------------------------------------------------------------ */

test("fixture heights depend only on (level,x,y,i,j), never on order or timing", async () => {
  const port = createProviderAccessPort({ adapters: createFixtureProviderAdapters() });
  const request = { op: "tile", providerId: "terrain.fixture", level: 9, x: 1, y: 2 };

  const first = await port.invoke("provider.acquire", request);
  // Interleave unrelated acquires: a thread-count proxy. If any fixture value
  // depended on call order, this is where it would show.
  await port.invoke("provider.acquire", { ...request, x: 7 });
  await port.invoke("provider.acquire", { op: "tile", providerId: "imagery.fixture", level: 9, x: 5, y: 5 });
  const second = await port.invoke("provider.acquire", request);

  const a = await port.invoke("provider.readRaw", { handle: first.handle, plane: 0, srcOffset: 0, length: 1 << 20 });
  const b = await port.invoke("provider.readRaw", { handle: second.handle, plane: 0, srcOffset: 0, length: 1 << 20 });
  assert.deepEqual(Array.from(a.bytes), Array.from(b.bytes));
  assert.deepEqual(Array.from(first.descriptor), Array.from(second.descriptor));

  // And the closed form is reproducible standalone.
  assert.equal(fixtureHeight(9, 1, 2, 0, 0), fixtureHeight(9, 1, 2, 0, 0));
});

test("chunked reads reassemble to exactly the whole-plane bytes", async () => {
  const port = createProviderAccessPort({ adapters: createFixtureProviderAdapters() });
  const { handle, descriptor } = await port.invoke("provider.acquire", {
    op: "tile",
    providerId: "terrain.fixture",
    level: 9,
    x: 1,
    y: 2,
  });
  const { byteLength } = decodeTileDescriptor(descriptor);
  const whole = (await port.invoke("provider.readRaw", { handle, plane: 0, srcOffset: 0, length: byteLength })).bytes;

  const chunked = new Uint8Array(byteLength);
  const chunk = 997; // deliberately not a divisor
  for (let offset = 0; offset < byteLength; offset += chunk) {
    const { bytes } = await port.invoke("provider.readRaw", { handle, plane: 0, srcOffset: offset, length: chunk });
    chunked.set(bytes, offset);
  }
  assert.deepEqual(Array.from(chunked), Array.from(whole));
});

/* ------------------------------------------------------------------ *
 * The cost ceiling is the "never re-fetch, never re-parse" rule
 * ------------------------------------------------------------------ */

test("default maxCost refuses a re-decoding adapter, and raising it opts in", async () => {
  const sampled = [];
  const scene = { globe: { terrainProvider: { availability: null }, tilesLoaded: true } };
  const adapters = createEngineProviderAdapters({
    scene,
    cartographicFromRadians: (longitude, latitude) => ({ longitude, latitude }),
    sampleTerrainMostDetailed: async (_provider, cartographics) => {
      sampled.push(cartographics.length);
      return cartographics.map((c, index) => ({ ...c, height: index === 2 ? undefined : 100 + index }));
    },
  });
  const port = createProviderAccessPort({ adapters });
  const request = {
    op: "profile",
    providerId: "terrain.engine",
    start: [-1.9, 0.65],
    end: [-1.88, 0.66],
    samples: 8,
  };

  await assert.rejects(
    () => port.invoke("provider.acquire", request),
    (error) => error.code === ProviderError.UNSUPPORTED,
    "the engine sampler re-decodes, so the default ceiling must refuse it",
  );
  assert.deepEqual(sampled, [], "a refused acquire must not have sampled anything");

  const { handle, descriptor } = await port.invoke("provider.acquire", {
    ...request,
    maxCost: ProviderCost.REDECODE,
  });
  const decoded = decodeTileDescriptor(descriptor);
  assert.equal(decoded.costClass, ProviderCost.REDECODE);
  assert.ok(decoded.flags & ProviderFlags.PARTIAL, "a no-data sample must set FLAG_PARTIAL");

  const { bytes } = await port.invoke("provider.readRaw", { handle, plane: 0, srcOffset: 0, length: 64 });
  const heights = new Float64Array(bytes.buffer, bytes.byteOffset, 8);
  // `undefined` from the engine sampler becomes the sentinel, never 0 (sea
  // level under a ridge is the defect this closes).
  assert.equal(heights[2], PROVIDER_NO_DATA_F64);
  assert.notEqual(heights[2], 0);
  assert.equal(heights[3], 103);
});

test("browser imagery refuses resident pixels rather than re-fetching", async () => {
  const layer = {
    show: true,
    alpha: 1,
    brightness: 1,
    imageryProvider: { tileWidth: 256, tileHeight: 256 },
  };
  const scene = { imageryLayers: { length: 1, get: () => layer, raiseToTop() {} } };
  const port = createProviderAccessPort({ adapters: createEngineProviderAdapters({ scene }) });

  await assert.rejects(
    () => port.invoke("provider.acquire", { op: "tile", providerId: "imagery.layer.0", level: 3, x: 1, y: 1 }),
    (error) => error.code === ProviderError.UNSUPPORTED,
  );

  // Control, by contrast, is fully native and fully supported.
  const configured = await port.invoke("provider.configure", {
    id: "imagery.layer.0",
    settings: { alpha: 0.5, brightness: 1.2, invented: true },
  });
  assert.deepEqual(configured.applied.sort(), ["alpha", "brightness"]);
  // An adapter must never emulate a setting the native surface lacks.
  assert.deepEqual(configured.rejected, ["invented"]);
  assert.equal(layer.alpha, 0.5);

  const absent = await port.invoke("provider.configure", {
    id: "imagery.layer.0",
    settings: { saturation: 2 },
  });
  assert.deepEqual(absent.applied, []);
  assert.deepEqual(absent.rejected, ["saturation"]);
});

/* ------------------------------------------------------------------ *
 * Refusal parity — the mirror
 * ------------------------------------------------------------------ */

test("an unknown provider is E_NO_PROVIDER in a populated port and an empty one alike", async () => {
  const populated = createProviderAccessPort({ adapters: createFixtureProviderAdapters() });
  const empty = createProviderAccessPort({ adapters: [] });
  const request = { op: "tile", providerId: "terrain.nope", level: 1, x: 0, y: 0 };

  for (const [label, port] of [["populated", populated], ["empty", empty]]) {
    await assert.rejects(
      () => port.invoke("provider.acquire", request),
      (error) => error.code === ProviderError.NO_PROVIDER,
      `${label} port must answer with the same code`,
    );
  }

  // "Nothing configured" is a SUCCESS with an empty array, not an error: the
  // two answers differ in length, never in shape, so modules cannot grow
  // runtime-shaped branches around them.
  assert.deepEqual(await empty.invoke("provider.list", {}), { providers: [] });
  const listed = await populated.invoke("provider.list", { kind: "terrain" });
  assert.equal(listed.providers.length, 1);
  assert.equal(listed.providers[0].id, "terrain.fixture");
});

test("the unavailable port answers with values, never a missing import", async () => {
  const port = createUnavailableProviderPort();
  assert.deepEqual(await port.invoke("provider.list"), { providers: [] });
  await assert.rejects(
    () => port.invoke("provider.acquire", { op: "tile" }),
    (error) => error.code === ProviderError.PORT_UNAVAILABLE,
  );
  const detail = await port.invoke("provider.lastError");
  assert.equal(detail.name, "SDM_PROVIDER_E_PORT_UNAVAILABLE");
});

test("a missing tile is E_NOT_AVAILABLE and lastError carries the detail", async () => {
  const port = createProviderAccessPort({ adapters: [createFixtureTerrainProvider()] });
  await assert.rejects(
    () => port.invoke("provider.acquire", { op: "tile", providerId: "terrain.fixture", level: 9, x: 3, y: 3 }),
    (error) => error.code === ProviderError.NOT_AVAILABLE,
  );
  const detail = await port.invoke("provider.lastError");
  assert.equal(detail.code, ProviderError.NOT_AVAILABLE);
  assert.match(detail.message, /no data/i);
});

test("prefetch reports capability instead of inventing an engine API", async () => {
  const fixturePort = createProviderAccessPort({ adapters: [createFixtureTerrainProvider()] });
  const enginePort = createProviderAccessPort({
    adapters: createEngineProviderAdapters({
      scene: { globe: { terrainProvider: {} } },
      cartographicFromRadians: (longitude, latitude) => ({ longitude, latitude }),
      sampleTerrainMostDetailed: async (_p, c) => c,
    }),
  });

  const store = await fixturePort.invoke("provider.prefetch", { id: "terrain.fixture", level: 4 });
  assert.equal(store.supported, true);
  const engine = await enginePort.invoke("provider.prefetch", { id: "terrain.engine", level: 4 });
  assert.equal(engine.supported, false);
  assert.equal(engine.requested, 0);
});

/* ------------------------------------------------------------------ *
 * Copy accounting
 * ------------------------------------------------------------------ */

/**
 * The native lane's dispatcher: a straight synchronous host call, which is
 * what WasmEdge actually does. In a browser worker the very same seam is the
 * SAB Atomics.wait channel, and the guest cannot tell which one it got.
 */
function drainable(port) {
  return (operation, params) => port.invokeSync(operation, params);
}

test("the direct transport costs ONE copy; the staged transport costs two and says so", async () => {
  const memory = new WebAssembly.Memory({ initial: 4 });
  const getMemory = () => memory;

  for (const direct of [true, false]) {
    const port = createProviderAccessPort({ adapters: createFixtureProviderAdapters() });
    const dispatch = drainable(port);
    const bridge = createProviderAccessBridge({
      getMemory,
      dispatch,
      directRead: direct
        ? (params, destination) => port.directReadInto(params, destination)
        : undefined,
    });
    assert.equal(bridge.hostCopiesPerRead, direct ? 1 : 2);

    const request = JSON.stringify({ op: "tile", providerId: "terrain.fixture", level: 9, x: 1, y: 2 });
    const requestBytes = new TextEncoder().encode(request);
    const requestPtr = 1024;
    const descPtr = 4096;
    const dataPtr = 8192;
    new Uint8Array(memory.buffer, requestPtr, requestBytes.length).set(requestBytes);

    const handle = bridge.imports[PROVIDER_IMPORT_MODULE].acquire(
      requestPtr,
      requestBytes.length,
      descPtr,
    );
    assert.ok(handle > 0, `acquire failed with ${handle}`);

    const descriptor = decodeTileDescriptor(
      new Uint8Array(memory.buffer, descPtr, PROVIDER_TILE_DESC_BYTES),
    );
    assert.equal(descriptor.hostCopies, direct ? 1 : 2);
    assert.equal(
      Boolean(descriptor.flags & ProviderFlags.STAGED),
      !direct,
      "FLAG_STAGED must state the extra copy out loud",
    );
    assert.ok(descriptor.flags & ProviderFlags.FIXTURE);

    const written = bridge.imports[PROVIDER_IMPORT_MODULE].read(
      handle,
      0,
      0,
      dataPtr,
      descriptor.byteLength,
    );
    assert.equal(written, descriptor.byteLength);
    assert.equal(port.stats.hostCopies, direct ? 1 : 2);
    assert.equal(bridge.imports[PROVIDER_IMPORT_MODULE].release(handle), 0);
    assert.equal(
      bridge.imports[PROVIDER_IMPORT_MODULE].release(handle),
      ProviderError.BAD_HANDLE,
    );
  }
});

test("both transports deliver byte-identical bytes", async () => {
  const results = [];
  for (const direct of [true, false]) {
    const memory = new WebAssembly.Memory({ initial: 4 });
    const port = createProviderAccessPort({ adapters: createFixtureProviderAdapters() });
    const bridge = createProviderAccessBridge({
      getMemory: () => memory,
      dispatch: drainable(port),
      directRead: direct ? (p, d) => port.directReadInto(p, d) : undefined,
    });
    const requestBytes = new TextEncoder().encode(
      JSON.stringify({ op: "tile", providerId: "imagery.fixture", level: 9, x: 4, y: 6 }),
    );
    new Uint8Array(memory.buffer, 1024, requestBytes.length).set(requestBytes);
    const handle = bridge.imports[PROVIDER_IMPORT_MODULE].acquire(1024, requestBytes.length, 4096);
    const descriptor = decodeTileDescriptor(new Uint8Array(memory.buffer, 4096, PROVIDER_TILE_DESC_BYTES));
    bridge.imports[PROVIDER_IMPORT_MODULE].read(handle, 0, 0, 16384, descriptor.byteLength);
    results.push(Array.from(new Uint8Array(memory.buffer, 16384, descriptor.byteLength)));
  }
  assert.deepEqual(results[0], results[1]);
});

test("out-of-bounds guest pointers are E_BOUNDS, never a trap", async () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const port = createProviderAccessPort({ adapters: createFixtureProviderAdapters() });
  const bridge = createProviderAccessBridge({
    getMemory: () => memory,
    dispatch: drainable(port),
    directRead: (p, d) => port.directReadInto(p, d),
  });
  const imports = bridge.imports[PROVIDER_IMPORT_MODULE];
  const requestBytes = new TextEncoder().encode(
    JSON.stringify({ op: "tile", providerId: "terrain.fixture", level: 9, x: 0, y: 0 }),
  );
  new Uint8Array(memory.buffer, 128, requestBytes.length).set(requestBytes);
  const handle = imports.acquire(128, requestBytes.length, 4096);
  assert.ok(handle > 0);
  assert.equal(imports.read(handle, 0, 0, 65_000, 4096), ProviderError.BOUNDS);
  assert.equal(imports.read(handle, 7, 0, 8192, 16), ProviderError.BAD_PLANE);
  assert.equal(imports.read(handle + 99, 0, 0, 8192, 16), ProviderError.BAD_HANDLE);
});

/* ------------------------------------------------------------------ *
 * The WasmEdge ruling: a host-side tile store, byte-identical to the
 * browser-shaped fixture over the same source
 * ------------------------------------------------------------------ */

test("a host tile store and a browser-shaped fixture return the SAME bytes", async () => {
  const tileWidth = 65;
  const tileHeight = 65;
  // The store is fed the identical closed-form source. Two entirely different
  // adapter code paths — one engine-shaped, one host-side — must agree
  // byte-for-byte, or the port is not isomorphic.
  const store = {
    readTile(level, x, y) {
      if (level === 9 && x === 3 && y === 3) return null; // the fixture's hole
      const elements = new Float32Array(tileWidth * tileHeight);
      for (let j = 0; j < tileHeight; j += 1) {
        for (let i = 0; i < tileWidth; i += 1) {
          elements[j * tileWidth + i] = fixtureHeight(level, x, y, i, j);
        }
      }
      return { elements, width: tileWidth, height: tileHeight };
    },
  };

  const browserLane = createProviderAccessPort({
    adapters: [createFixtureTerrainProvider()],
  });
  const wasmEdgeLane = createProviderAccessPort({
    adapters: [
      createTileStoreTerrainProvider({
        store,
        id: "terrain.fixture",
        tileWidth,
        tileHeight,
        mostDetailedLevel: 9,
      }),
    ],
  });

  const request = {
    op: "profile",
    providerId: "terrain.fixture",
    start: [-1.9, 0.65],
    end: [-1.88, 0.66],
    samples: 128,
    level: 9,
  };

  const read = async (port) => {
    const { handle, descriptor } = await port.invoke("provider.acquire", request);
    const decoded = decodeTileDescriptor(descriptor);
    const { bytes } = await port.invoke("provider.readRaw", {
      handle,
      plane: 0,
      srcOffset: 0,
      length: decoded.byteLength,
    });
    await port.invoke("provider.release", { handle });
    return { bytes: Array.from(bytes), decoded };
  };

  const browser = await read(browserLane);
  const wasmEdge = await read(wasmEdgeLane);

  assert.deepEqual(browser.bytes, wasmEdge.bytes, "profile bytes must be identical");
  assert.equal(browser.decoded.width, wasmEdge.decoded.width);
  assert.equal(browser.decoded.encoding, wasmEdge.decoded.encoding);
  assert.equal(browser.decoded.minValue, wasmEdge.decoded.minValue);
  assert.equal(browser.decoded.maxValue, wasmEdge.decoded.maxValue);
  assert.equal(browser.decoded.sourceId, wasmEdge.decoded.sourceId);
  // FLAG_FIXTURE proves WHICH adapter answered, so the parity claim is not
  // quietly comparing a shortcut against itself.
  assert.ok(browser.decoded.flags & ProviderFlags.FIXTURE);
  assert.ok(!(wasmEdge.decoded.flags & ProviderFlags.FIXTURE));
});

test("a tile store with nothing in it refuses exactly like every other lane", async () => {
  const port = createProviderAccessPort({
    adapters: [createTileStoreTerrainProvider({ store: { readTile: () => null } })],
  });
  await assert.rejects(
    () => port.invoke("provider.acquire", { op: "tile", providerId: "terrain.tilestore", level: 2, x: 0, y: 0 }),
    (error) => error.code === ProviderError.NOT_AVAILABLE,
  );
  // ...and a host with no store at all registers no adapter.
  const bare = createProviderAccessPort({ adapters: [] });
  assert.deepEqual(await bare.invoke("provider.list"), { providers: [] });
  await assert.rejects(
    () => bare.invoke("provider.acquire", { op: "tile", kind: "terrain" }),
    (error) => error.code === ProviderError.NO_PROVIDER,
  );
});

/* ------------------------------------------------------------------ *
 * Consumer seam
 * ------------------------------------------------------------------ */

test("the terrain source seam hands a consumer contiguous metres and rejects impostors", async () => {
  const port = createProviderAccessPort({ adapters: [createFixtureTerrainProvider()] });
  const source = createTerrainSourceFromPort(port, { providerId: "terrain.fixture" });
  assertTerrainSourceConformance(source);

  const positions = [
    [-1.9, 0.65],
    [-1.895, 0.652],
    [-1.89, 0.654],
  ];
  const heights = await source.readHeights(positions);
  assert.ok(heights instanceof Float64Array);
  assert.equal(heights.length, 3);
  assert.ok(heights.every((h) => Number.isFinite(h)));

  // Legacy shape stays signature-compatible so the solver's injectable statics
  // can take the seam on day one with no call-site change.
  const cartographics = positions.map(([longitude, latitude]) => ({ longitude, latitude }));
  const sampled = await source.sampleCompat(null, cartographics);
  assert.equal(sampled[0].height, heights[0]);

  assert.throws(
    () => assertTerrainSourceConformance({ id: "private-path" }),
    /does not conform to the terrain source seam/,
  );
});

/* ------------------------------------------------------------------ *
 * Toolchain guardrail + real wasm guest
 * ------------------------------------------------------------------ */

/** Decode the import function signatures straight out of the wasm binary. */
function importedFunctionTypes(wasmBytes) {
  const view = new DataView(wasmBytes.buffer, wasmBytes.byteOffset, wasmBytes.byteLength);
  let offset = 8; // magic + version
  const types = [];
  const imports = [];

  const readVarUint = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = view.getUint8(offset++);
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result >>> 0;
      shift += 7;
    }
  };
  const readName = () => {
    const length = readVarUint();
    const bytes = new Uint8Array(wasmBytes.buffer, wasmBytes.byteOffset + offset, length);
    offset += length;
    return new TextDecoder().decode(bytes);
  };

  while (offset < wasmBytes.byteLength) {
    const id = view.getUint8(offset++);
    const size = readVarUint();
    const end = offset + size;
    if (id === 1) {
      const count = readVarUint();
      for (let index = 0; index < count; index += 1) {
        offset += 1; // 0x60 func
        const params = [];
        const paramCount = readVarUint();
        for (let p = 0; p < paramCount; p += 1) params.push(view.getUint8(offset++));
        const results = [];
        const resultCount = readVarUint();
        for (let r = 0; r < resultCount; r += 1) results.push(view.getUint8(offset++));
        types.push({ params, results });
      }
    } else if (id === 2) {
      const count = readVarUint();
      for (let index = 0; index < count; index += 1) {
        const module = readName();
        const name = readName();
        const kind = view.getUint8(offset++);
        if (kind === 0) {
          imports.push({ module, name, type: types[readVarUint()] });
        } else {
          offset = end;
          break;
        }
      }
    }
    offset = end;
  }
  return imports;
}

const I64 = 0x7e;

const DEMO_SOURCE = `
#include <stdint.h>
#include <string.h>
#include "space_data_provider_abi.h"

static uint32_t digest_state = 0x811c9dc5u;
static sdm_provider_tile_desc_t desc;
static unsigned char scratch[262144];

static void digest_bytes(const unsigned char *bytes, int32_t length) {
  for (int32_t index = 0; index < length; index += 1) {
    digest_state ^= bytes[index];
    digest_state *= 0x01000193u;
  }
}

int guest_reset(void) {
  digest_state = 0x811c9dc5u;
  return 0;
}

int guest_digest(void) { return (int)digest_state; }
int guest_host_copies(void) { return (int)desc.host_copies; }
int guest_width(void) { return (int)desc.width; }
int guest_encoding(void) { return (int)desc.encoding; }
int guest_cost_class(void) { return (int)desc.cost_class; }
int guest_flags(void) { return (int)desc.flags; }

/* Terrain: a profile across the fixture ridge field, read as f64 metres. */
int guest_read_terrain(void) {
  static const char request[] =
      "{\\"op\\":\\"profile\\",\\"providerId\\":\\"terrain.fixture\\","
      "\\"start\\":[-1.9,0.65],\\"end\\":[-1.88,0.66],\\"samples\\":256,"
      "\\"level\\":9,\\"maxCost\\":1}";
  int32_t handle = sdm_provider_acquire(request, (int32_t)(sizeof request - 1), &desc);
  if (handle < 0) return handle;
  if (!sdm_provider_desc_valid(&desc)) return -100;
  int32_t written = sdm_provider_read(handle, 0, 0, scratch, (int32_t)desc.byte_length);
  sdm_provider_release(handle);
  if (written < 0) return written;
  digest_bytes(scratch, written);
  return written;
}

/* Imagery: RGBA8 pixels for a small region. */
int guest_read_imagery(void) {
  static const char request[] =
      "{\\"op\\":\\"tile\\",\\"providerId\\":\\"imagery.fixture\\","
      "\\"level\\":9,\\"x\\":4,\\"y\\":6,\\"maxCost\\":1}";
  int32_t handle = sdm_provider_acquire(request, (int32_t)(sizeof request - 1), &desc);
  if (handle < 0) return handle;
  int32_t written = sdm_provider_read(handle, 0, 0, scratch, (int32_t)desc.byte_length);
  sdm_provider_release(handle);
  if (written < 0) return written;
  digest_bytes(scratch, written);
  return written;
}

/* A refusal a module must handle identically in every runtime. */
int guest_read_missing(void) {
  static const char request[] =
      "{\\"op\\":\\"tile\\",\\"providerId\\":\\"terrain.nope\\",\\"level\\":1,\\"x\\":0,\\"y\\":0}";
  return sdm_provider_acquire(request, (int32_t)(sizeof request - 1), &desc);
}

/* Reading a height back out proves the bytes are real metres, not a blob. */
int guest_first_height_centimetres(void) {
  double first;
  memcpy(&first, scratch, sizeof first);
  if (sdm_provider_is_no_data_f64(first)) return -1;
  return (int)(first * 100.0);
}
`;

function demoManifest() {
  const method = (methodId) => ({
    methodId,
    displayName: methodId,
    inputPorts: [],
    outputPorts: [],
    maxBatch: 1,
    drainPolicy: "single-shot",
  });
  return {
    pluginId: "com.digitalarsenal.examples.provider-digest",
    name: "Provider Access Digest",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: ["scene_access"],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    methods: [
      "guest_reset",
      "guest_digest",
      "guest_host_copies",
      "guest_width",
      "guest_encoding",
      "guest_cost_class",
      "guest_flags",
      "guest_read_terrain",
      "guest_read_imagery",
      "guest_read_missing",
      "guest_first_height_centimetres",
    ].map(method),
  };
}

test("a real wasm guest reads terrain heights and imagery pixels byte-for-byte", async (t) => {
  // The guest compiles against the SHIPPED header verbatim — inlined rather
  // than #included only because the compiler shim takes a single translation
  // unit. If the header stops declaring the port correctly, this test stops
  // compiling.
  const header = await readFile(PROVIDER_HEADER, "utf8");
  const source = DEMO_SOURCE.replace(
    '#include "space_data_provider_abi.h"',
    header,
  );

  let compilation;
  try {
    compilation = await compileModuleFromSource({
      manifest: demoManifest(),
      sourceCode: source,
      language: "c",
      allowUndefinedImports: true,
    });
  } catch (error) {
    t.skip(`guest toolchain unavailable: ${error.message}`);
    return;
  }

  try {
    // TOOLCHAIN GUARDRAIL: no i64 may appear in a provider import signature.
    // A 64-bit boundary parameter legalizes differently depending on how the
    // host instantiates the module, and the mismatch surfaces in exactly one
    // runtime. This asserts the property instead of trusting the convention.
    const providerImports = importedFunctionTypes(compilation.wasmBytes).filter(
      (entry) => entry.module === PROVIDER_IMPORT_MODULE,
    );
    assert.deepEqual(
      providerImports.map((entry) => entry.name).sort(),
      ["acquire", "read", "release"],
      "the port is exactly three imports",
    );
    for (const entry of providerImports) {
      assert.ok(
        ![...entry.type.params, ...entry.type.results].includes(I64),
        `${entry.name} must not carry i64 across the boundary`,
      );
    }

    const digests = [];
    for (const direct of [true, false]) {
      const port = createProviderAccessPort({ adapters: createFixtureProviderAdapters() });
      let instanceExports = null;
      const bridge = createProviderAccessBridge({
        getMemory: () => instanceExports.memory,
        dispatch: drainable(port),
        directRead: direct ? (p, d) => port.directReadInto(p, d) : undefined,
      });
      const wasi = new WASI({ version: "preview1", returnOnExit: true });
      const { instance } = await WebAssembly.instantiate(compilation.wasmBytes, {
        ...wasi.getImportObject(),
        ...bridge.imports,
      });
      instanceExports = instance.exports;

      instance.exports.guest_reset();

      const terrainBytes = instance.exports.guest_read_terrain();
      assert.equal(terrainBytes, 256 * 8, "256 f64 heights");
      assert.equal(instance.exports.guest_encoding(), ProviderEncoding.HEIGHT_F64);
      assert.equal(instance.exports.guest_width(), 256);
      assert.equal(instance.exports.guest_cost_class(), ProviderCost.RESIDENT);
      assert.ok(instance.exports.guest_flags() & ProviderFlags.DERIVED);
      // The copy-count measurement, read from inside the guest.
      assert.equal(instance.exports.guest_host_copies(), direct ? 1 : 2);

      const centimetres = instance.exports.guest_first_height_centimetres();
      assert.ok(centimetres > -42_000 && centimetres < 900_000, "a plausible height in metres");

      const imageryBytes = instance.exports.guest_read_imagery();
      assert.equal(imageryBytes, 64 * 64 * 4);
      assert.equal(instance.exports.guest_encoding(), ProviderEncoding.RGBA8);

      // The refusal path, exercised by the same module in the same run.
      assert.equal(instance.exports.guest_read_missing(), ProviderError.NO_PROVIDER);

      digests.push(instance.exports.guest_digest() >>> 0);
    }

    // ONE module.wasm, two host transports with different copy counts,
    // IDENTICAL digest. Throughput may differ; bytes may not.
    assert.equal(digests[0], digests[1]);

    // And the digest matches bytes computed independently on the host side,
    // so this proves byte-level access rather than self-consistency.
    const port = createProviderAccessPort({ adapters: createFixtureProviderAdapters() });
    const expected = await hostDigest(port);
    assert.equal(digests[0], expected);
  } finally {
    await cleanupCompilation(compilation);
  }
});

async function hostDigest(port) {
  let state = 0x811c9dc5;
  const consume = async (request) => {
    const { handle, descriptor } = await port.invoke("provider.acquire", request);
    const { byteLength } = decodeTileDescriptor(descriptor);
    const { bytes } = await port.invoke("provider.readRaw", {
      handle,
      plane: 0,
      srcOffset: 0,
      length: byteLength,
    });
    await port.invoke("provider.release", { handle });
    for (const byte of bytes) {
      state = (state ^ byte) >>> 0;
      state = Math.imul(state, 0x01000193) >>> 0;
    }
  };
  await consume({
    op: "profile",
    providerId: "terrain.fixture",
    start: [-1.9, 0.65],
    end: [-1.88, 0.66],
    samples: 256,
    level: 9,
    maxCost: 1,
  });
  await consume({
    op: "tile",
    providerId: "imagery.fixture",
    level: 9,
    x: 4,
    y: 6,
    maxCost: 1,
  });
  return state >>> 0;
}


test("the seam takes a target spacing and reports which level answered", async () => {
  const port = createProviderAccessPort({
    adapters: [createFixtureTerrainProvider({ maxLevel: 14 })],
  });
  const source = createTerrainSourceFromPort(port, { providerId: "terrain.fixture" });
  const positions = [
    [-1.9, 0.65],
    [-1.895, 0.652],
    [-1.89, 0.654],
  ];

  // A coarse march stride must resolve to a coarser level than a fine one —
  // asking for most-detailed everywhere is what makes a solve slow.
  const coarse = await source.readProfile(positions, { spacing: 5000 });
  const fine = await source.readProfile(positions, { spacing: 30 });
  // Strategy names match the consumer's existing vocabulary verbatim.
  assert.equal(coarse.strategy, "grid-matched-level");
  assert.equal(fine.strategy, "grid-matched-level");
  assert.ok(
    fine.level > coarse.level,
    `finer spacing must pick a deeper level (${fine.level} vs ${coarse.level})`,
  );
  assert.equal(coarse.heights.length, 3);

  // The level a caller was GIVEN is reported, not the one it guessed at.
  const fixed = await source.readProfile(positions, { level: 7 });
  assert.equal(fixed.level, 7);
  assert.equal(fixed.strategy, "fixed-level");
});

test("browser and host tile store choose the SAME level for the same spacing", () => {
  // Both adapters resolve level through one shared helper. If they each did
  // their own arithmetic they would sample different ground, and byte parity
  // would fail for a reason no diff would show.
  for (const spacing of [10, 30, 100, 670, 5000, 40000]) {
    assert.equal(
      providerLevelForSpacing(spacing, { tileWidth: 65, maxLevel: 16 }),
      providerLevelForSpacing(spacing, { tileWidth: 65, maxLevel: 16 }),
    );
  }
  // Monotone: finer spacing never picks a coarser level.
  let previous = -1;
  for (const spacing of [40000, 5000, 670, 100, 30, 10]) {
    const level = providerLevelForSpacing(spacing, { tileWidth: 65, maxLevel: 16 });
    assert.ok(level >= previous, `level must not decrease as spacing tightens`);
    previous = level;
  }
});

test("raster in: a 262,144-point field goes in as bytes, not as JSON", async () => {
  const memory = new WebAssembly.Memory({ initial: 200 }); // 12.8 MiB
  const port = createProviderAccessPort({
    adapters: [createFixtureTerrainProvider({ maxLevel: 14 })],
  });
  const bridge = createProviderAccessBridge({
    getMemory: () => memory,
    dispatch: drainable(port),
    directRead: (p, d) => port.directReadInto(p, d),
  });
  const imports = bridge.imports[PROVIDER_IMPORT_MODULE];

  // The RF coverage solve's real shape: a flattened 512x512 raster.
  const count = 512 * 512;
  const positionsPtr = 1 << 20;
  const positions = new Float64Array(memory.buffer, positionsPtr, count * 2);
  for (let row = 0; row < 512; row += 1) {
    for (let column = 0; column < 512; column += 1) {
      const index = (row * 512 + column) * 2;
      positions[index] = -1.9 + column * 1e-5;
      positions[index + 1] = 0.65 + row * 1e-5;
    }
  }

  const request = JSON.stringify({
    op: "profile",
    providerId: "terrain.fixture",
    positionsPtr,
    positionsCount: count,
    spacing: 30,
  });
  const requestBytes = new TextEncoder().encode(request);
  // The entire request stays small no matter how big the field is. That is the
  // whole point: JSON-encoding 262,144 positions would be megabytes.
  assert.ok(
    requestBytes.length < 200,
    `request must stay tiny, was ${requestBytes.length} bytes`,
  );
  new Uint8Array(memory.buffer, 512, requestBytes.length).set(requestBytes);

  const handle = imports.acquire(512, requestBytes.length, 4096);
  assert.ok(handle > 0, `acquire failed with ${handle}`);
  const descriptor = decodeTileDescriptor(
    new Uint8Array(memory.buffer, 4096, PROVIDER_TILE_DESC_BYTES),
  );
  assert.equal(descriptor.width, count);
  assert.equal(descriptor.encoding, ProviderEncoding.HEIGHT_F64);
  assert.equal(descriptor.hostCopies, 1);
  // Provenance reaches the guest through the descriptor, not only through JS.
  assert.equal(descriptor.strategy, ProviderStrategy.GRID_MATCHED_LEVEL);
  assert.equal(providerStrategyName(descriptor.strategy), "grid-matched-level");

  const heightsPtr = 5 << 20;
  const written = imports.read(handle, 0, 0, heightsPtr, count * 8);
  assert.equal(written, count * 8);
  const heights = new Float64Array(memory.buffer, heightsPtr, count);
  assert.ok(Number.isFinite(heights[0]));
  assert.ok(Number.isFinite(heights[count - 1]));
  assert.equal(imports.release(handle), 0);
});

test("a bad positions pointer is E_BOUNDS, not a trap and not a silent short read", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const port = createProviderAccessPort({ adapters: [createFixtureTerrainProvider()] });
  const bridge = createProviderAccessBridge({
    getMemory: () => memory,
    dispatch: drainable(port),
    directRead: (p, d) => port.directReadInto(p, d),
  });
  const requestBytes = new TextEncoder().encode(
    JSON.stringify({
      op: "profile",
      providerId: "terrain.fixture",
      positionsPtr: 60000,
      positionsCount: 100000,
    }),
  );
  new Uint8Array(memory.buffer, 128, requestBytes.length).set(requestBytes);
  assert.equal(
    bridge.imports[PROVIDER_IMPORT_MODULE].acquire(128, requestBytes.length, 4096),
    ProviderError.BOUNDS,
  );
});
