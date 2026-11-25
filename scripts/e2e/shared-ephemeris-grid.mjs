// E2E (#1104): Shared Resident Ephemeris Grid ($SCR / RuntimeRegionStore),
// pluggable propagators (propagator/sdn-ap default, propagator/sgp4-xp, propagator/sgp4)
// with declared-theory enforcement, multi-module read-only SAB attach/splice/invalidation,
// and bit-identical tri-runtime parity across Browser (SAB+Workers + direct externalArena),
// Native WasmEdge, and Docker WasmEdge at 1, 2, and 4 threads for two distinct modules.
//
// Usage: node scripts/e2e/shared-ephemeris-grid.mjs

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { chromium } from "playwright-core";

import { compileModuleFromSource } from "../../src/compiler/compileModule.js";
import { validateArtifactWithStandards } from "../../src/compliance/index.js";
import { loadStandardsCatalog, resolveStandardsTypeRef } from "../../src/standards/index.js";
import { decodePluginInvokeResponse } from "../../src/invoke/index.js";
import { WASI_THREAD_POOL_WORKER_BUNDLE } from "../../src/host/hostWorkerBundleSources.js";
import {
  DEFAULT_PROPAGATOR_ID,
  SCR_GRID_STATE_FLOATS,
  SCR_RADIUS_BAND_FLOATS,
  SCR_ROLE,
  SUPPORTED_PROPAGATOR_IDS,
  StaleGridLeaseError,
  TheoryMismatchError,
  createRuntimeHost,
  decodeScrGridFlatBuffer,
} from "../../src/runtime-host/index.js";
import {
  formatParityReport,
  normalizeParityFixture,
  runParityHarness,
} from "../../src/testing/parityHarness.js";
import { resolveHeadlessShell } from "../../src/testing/headlessShell.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);

const SCR_TYPE = {
  schemaName: "SCR.fbs",
  fileIdentifier: "$SCR",
  rootTypeName: "SCR",
  wireFormat: "flatbuffer",
};

const CAT_TYPE = {
  schemaName: "CAT.fbs",
  fileIdentifier: "$CAT",
  rootTypeName: "CAT",
  wireFormat: "flatbuffer",
};

const typeSet = (setId, type) => ({ setId, allowedTypes: [type] });

function sha256Hex(bytes) {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function atLeast(version, minimum) {
  const a = version.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

const CONSUMER_A_MANIFEST = {
  pluginId: "com.digitalarsenal.e2e.scr-grid-stats",
  name: "SCR Grid Stats Consumer A",
  version: "0.1.0",
  pluginFamily: "analysis",
  capabilities: [],
  externalInterfaces: [],
  invokeSurfaces: ["direct", "command"],
  runtimeTargets: ["browser", "wasmedge"],
  methods: [
    {
      methodId: "analyze_grid",
      displayName: "Analyze Shared SCR Grid",
      inputPorts: [
        {
          portId: "scr_grid",
          acceptedTypeSets: [typeSet("scr", SCR_TYPE)],
          minStreams: 1,
          maxStreams: 1,
          required: true,
        },
      ],
      outputPorts: [
        {
          portId: "summary",
          acceptedTypeSets: [typeSet("cat", CAT_TYPE)],
          minStreams: 1,
          maxStreams: 1,
          required: true,
        },
      ],
      maxBatch: 1,
      drainPolicy: "single-shot",
    },
  ],
};

const CONSUMER_B_MANIFEST = {
  pluginId: "com.digitalarsenal.e2e.scr-grid-band-screen",
  name: "SCR Grid Band Screener Consumer B",
  version: "0.1.0",
  pluginFamily: "analysis",
  capabilities: [],
  externalInterfaces: [],
  invokeSurfaces: ["direct", "command"],
  runtimeTargets: ["browser", "wasmedge"],
  methods: [
    {
      methodId: "screen_bands",
      displayName: "Screen Shared SCR Grid Bands",
      inputPorts: [
        {
          portId: "scr_grid",
          acceptedTypeSets: [typeSet("scr", SCR_TYPE)],
          minStreams: 1,
          maxStreams: 1,
          required: true,
        },
      ],
      outputPorts: [
        {
          portId: "candidates",
          acceptedTypeSets: [typeSet("cat", CAT_TYPE)],
          minStreams: 1,
          maxStreams: 1,
          required: true,
        },
      ],
      maxBatch: 1,
      drainPolicy: "single-shot",
    },
  ],
};

const SHARED_SCR_C_DECODER = `
#include <math.h>
#include <pthread.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "space_data_module_invoke.h"

#define MAX_OBJECTS 64
#define MAX_THREADS 8

static uint16_t read_u16(const uint8_t *p) {
  uint16_t v;
  memcpy(&v, p, sizeof v);
  return v;
}

static uint32_t read_u32(const uint8_t *p) {
  uint32_t v;
  memcpy(&v, p, sizeof v);
  return v;
}

static int32_t read_i32(const uint8_t *p) {
  int32_t v;
  memcpy(&v, p, sizeof v);
  return v;
}

static float read_f32(const uint8_t *p) {
  float v;
  memcpy(&v, p, sizeof v);
  return v;
}

static uint32_t fb_read_u32_field(const uint8_t *buf, uint32_t table, uint32_t vtable, uint16_t vlen, uint16_t slot, uint32_t def) {
  uint16_t vo = (uint16_t)(4 + 2 * slot);
  if (vo >= vlen) return def;
  uint16_t fo = read_u16(buf + vtable + vo);
  if (fo == 0) return def;
  return read_u32(buf + table + fo);
}

static int fb_read_vector(const uint8_t *buf, uint32_t len, uint32_t table, uint32_t vtable, uint16_t vlen, uint16_t slot, uint32_t elem_size, const uint8_t **out_ptr, uint32_t *out_count) {
  uint16_t vo = (uint16_t)(4 + 2 * slot);
  if (vo >= vlen) {
    *out_ptr = NULL;
    *out_count = 0;
    return 1;
  }
  uint16_t fo = read_u16(buf + vtable + vo);
  if (fo == 0) {
    *out_ptr = NULL;
    *out_count = 0;
    return 1;
  }
  uint32_t fp = table + fo;
  if (fp + 4 > len) return 0;
  uint32_t vec_off = fp + read_u32(buf + fp);
  if (vec_off + 4 > len) return 0;
  uint32_t count = read_u32(buf + vec_off);
  if ((uint64_t)vec_off + 4 + (uint64_t)count * elem_size > len) return 0;
  *out_ptr = buf + vec_off + 4;
  *out_count = count;
  return 1;
}

typedef struct {
  uint32_t first_step;
  uint32_t step_count;
  uint32_t objects;
  const uint8_t *states_ptr;
  const uint8_t *bands_ptr;
} ScrGridView;

static int parse_scr_grid(const uint8_t *buf, uint32_t len, ScrGridView *out) {
  if (!buf || len < 16) return 0;
  if (memcmp(buf + 4, "$SCR", 4) != 0) return 0;
  uint32_t scr_table = read_u32(buf);
  if (scr_table + 4 > len) return 0;
  uint32_t scr_vtable = (uint32_t)((int32_t)scr_table - read_i32(buf + scr_table));
  if (scr_vtable + 4 > len) return 0;
  uint16_t scr_vlen = read_u16(buf + scr_vtable);
  if (scr_vlen <= 6) return 0;
  uint16_t grid_fo = read_u16(buf + scr_vtable + 6);
  if (grid_fo == 0 || scr_table + grid_fo + 4 > len) return 0;
  uint32_t grid_table = scr_table + grid_fo + read_u32(buf + scr_table + grid_fo);
  if (grid_table + 4 > len) return 0;
  uint32_t grid_vtable = (uint32_t)((int32_t)grid_table - read_i32(buf + grid_table));
  if (grid_vtable + 4 > len) return 0;
  uint16_t grid_vlen = read_u16(buf + grid_vtable);

  out->first_step = fb_read_u32_field(buf, grid_table, grid_vtable, grid_vlen, 0, 0);
  out->step_count = fb_read_u32_field(buf, grid_table, grid_vtable, grid_vlen, 1, 0);
  out->objects = fb_read_u32_field(buf, grid_table, grid_vtable, grid_vlen, 2, 0);
  if (out->objects == 0 || out->objects > MAX_OBJECTS || out->step_count == 0) return 0;

  uint32_t states_count = 0, bands_count = 0;
  if (!fb_read_vector(buf, len, grid_table, grid_vtable, grid_vlen, 5, 32, &out->states_ptr, &states_count)) return 0;
  if (!fb_read_vector(buf, len, grid_table, grid_vtable, grid_vlen, 6, 8, &out->bands_ptr, &bands_count)) return 0;
  if (states_count != out->step_count * out->objects || bands_count != out->objects) return 0;
  return 1;
}

static int requested_threads(uint32_t max_work) {
  int t = 1;
  const char *env = getenv("SDM_PARITY_THREADS");
  if (env) t = atoi(env);
  if (t < 1) t = 1;
  if (t > MAX_THREADS) t = MAX_THREADS;
  if ((uint32_t)t > max_work) t = (int)max_work;
  if (t < 1) t = 1;
  return t;
}
`;

const CONSUMER_A_SOURCE = `
${SHARED_SCR_C_DECODER}

typedef struct {
  uint32_t excluded;
  uint64_t min_r_m;
  uint64_t max_r_m;
  uint64_t hash;
} ObjStats;

typedef struct {
  const ScrGridView *grid;
  uint32_t first;
  uint32_t step;
  ObjStats *slots;
} StatsWorkerArg;

static void *stats_worker(void *arg_ptr) {
  StatsWorkerArg *arg = (StatsWorkerArg *)arg_ptr;
  const ScrGridView *g = arg->grid;
  for (uint32_t obj = arg->first; obj < g->objects; obj += arg->step) {
    ObjStats st;
    st.excluded = 0;
    st.min_r_m = UINT64_MAX;
    st.max_r_m = 0;
    st.hash = 14695981039346656037ULL ^ (uint64_t)obj;

    float low_km = read_f32(g->bands_ptr + obj * 8);
    float high_km = read_f32(g->bands_ptr + obj * 8 + 4);
    if (isnan(low_km) || isnan(high_km)) {
      st.excluded = 1;
      st.min_r_m = 0;
      arg->slots[obj] = st;
      continue;
    }

    for (uint32_t s = 0; s < g->step_count; s++) {
      const uint8_t *row = g->states_ptr + ((size_t)s * g->objects + obj) * 32;
      float x = read_f32(row + 0);
      float y = read_f32(row + 4);
      float z = read_f32(row + 8);
      float dev = read_f32(row + 12);
      float vx = read_f32(row + 16);
      float vy = read_f32(row + 20);
      float vz = read_f32(row + 24);
      if (isnan(x) || isnan(y) || isnan(z) || isnan(dev) || isnan(vx) || isnan(vy) || isnan(vz)) {
        st.excluded = 1;
        st.min_r_m = 0;
        st.max_r_m = 0;
        break;
      }
      float r_km = sqrtf(x * x + y * y + z * z);
      uint64_t r_m = (uint64_t)llround((double)r_km * 1000.0);
      if (r_m < st.min_r_m) st.min_r_m = r_m;
      if (r_m > st.max_r_m) st.max_r_m = r_m;

      const float vals[7] = { x, y, z, dev, vx, vy, vz };
      for (int k = 0; k < 7; k++) {
        uint32_t bits = 0;
        memcpy(&bits, &vals[k], 4);
        st.hash ^= bits;
        st.hash *= 1099511628211ULL;
      }
    }
    arg->slots[obj] = st;
  }
  return NULL;
}

typedef struct {
  uint32_t magic;
  uint32_t first_step;
  uint32_t step_count;
  uint32_t objects;
  uint32_t active_objects;
  uint32_t excluded_objects;
  uint64_t global_min_r_m;
  uint64_t global_max_r_m;
  uint64_t digest;
} StatsSummary;

int analyze_grid(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame || !frame->payload) {
    plugin_set_error("missing-scr-grid", "No $SCR grid frame provided.");
    return 3;
  }
  ScrGridView grid;
  if (!parse_scr_grid(frame->payload, frame->payload_length, &grid)) {
    plugin_set_error("invalid-scr-grid", "Malformed $SCR GRID payload.");
    return 4;
  }

  ObjStats slots[MAX_OBJECTS];
  memset(slots, 0, sizeof slots);
  int threads = requested_threads(grid.objects);
  StatsWorkerArg args[MAX_THREADS];
  pthread_t tids[MAX_THREADS];

  for (int t = 0; t < threads; t++) {
    args[t] = (StatsWorkerArg){ &grid, (uint32_t)t, (uint32_t)threads, slots };
  }
  for (int t = 1; t < threads; t++) {
    if (pthread_create(&tids[t], NULL, stats_worker, &args[t]) != 0) {
      plugin_set_error("thread-spawn", "pthread_create failed.");
      return 5;
    }
  }
  stats_worker(&args[0]);
  for (int t = 1; t < threads; t++) {
    pthread_join(tids[t], NULL);
  }

  StatsSummary summary;
  memset(&summary, 0, sizeof summary);
  summary.magic = 0x53435241u;
  summary.first_step = grid.first_step;
  summary.step_count = grid.step_count;
  summary.objects = grid.objects;
  summary.global_min_r_m = UINT64_MAX;
  summary.digest = 14695981039346656037ULL;

  for (uint32_t obj = 0; obj < grid.objects; obj++) {
    if (slots[obj].excluded) {
      summary.excluded_objects += 1;
      continue;
    }
    summary.active_objects += 1;
    if (slots[obj].min_r_m < summary.global_min_r_m) summary.global_min_r_m = slots[obj].min_r_m;
    if (slots[obj].max_r_m > summary.global_max_r_m) summary.global_max_r_m = slots[obj].max_r_m;
    summary.digest ^= slots[obj].hash;
    summary.digest *= 1099511628211ULL;
  }
  if (summary.active_objects == 0) summary.global_min_r_m = 0;

  return plugin_push_output("summary", "CAT.fbs", "$CAT", (const uint8_t *)&summary, (uint32_t)sizeof summary) < 0 ? 1 : 0;
}
`;

const CONSUMER_B_SOURCE = `
${SHARED_SCR_C_DECODER}

typedef struct {
  uint32_t band_overlaps;
  uint32_t candidate_steps;
  uint64_t digest;
} PairBucket;

typedef struct {
  const ScrGridView *grid;
  uint32_t first;
  uint32_t step;
  PairBucket *buckets;
} ScreenWorkerArg;

static void *screen_worker(void *arg_ptr) {
  ScreenWorkerArg *arg = (ScreenWorkerArg *)arg_ptr;
  const ScrGridView *g = arg->grid;
  const float threshold_km = 500.0f;

  for (uint32_t i = arg->first; i < g->objects; i += arg->step) {
    PairBucket b;
    b.band_overlaps = 0;
    b.candidate_steps = 0;
    b.digest = 14695981039346656037ULL ^ (uint64_t)i;

    float low_i = read_f32(g->bands_ptr + i * 8);
    float high_i = read_f32(g->bands_ptr + i * 8 + 4);
    if (isnan(low_i) || isnan(high_i)) {
      arg->buckets[i] = b;
      continue;
    }

    for (uint32_t j = i + 1; j < g->objects; j++) {
      float low_j = read_f32(g->bands_ptr + j * 8);
      float high_j = read_f32(g->bands_ptr + j * 8 + 4);
      if (isnan(low_j) || isnan(high_j)) continue;
      if (high_i + threshold_km < low_j || high_j + threshold_km < low_i) continue;

      b.band_overlaps += 1;
      for (uint32_t s = 0; s < g->step_count; s++) {
        const uint8_t *ri = g->states_ptr + ((size_t)s * g->objects + i) * 32;
        const uint8_t *rj = g->states_ptr + ((size_t)s * g->objects + j) * 32;
        float dx = read_f32(ri + 0) - read_f32(rj + 0);
        float dy = read_f32(ri + 4) - read_f32(rj + 4);
        float dz = read_f32(ri + 8) - read_f32(rj + 8);
        float dev_sum = read_f32(ri + 12) + read_f32(rj + 12);
        float limit = threshold_km + dev_sum;
        float dist = sqrtf(dx * dx + dy * dy + dz * dz);
        if (!isnan(dist) && dist <= limit) {
          b.candidate_steps += 1;
          uint64_t dist_m = (uint64_t)llround((double)dist * 1000.0);
          b.digest ^= (((uint64_t)i << 32) | ((uint64_t)j << 16) | (uint64_t)s) ^ dist_m;
          b.digest *= 1099511628211ULL;
        }
      }
    }
    arg->buckets[i] = b;
  }
  return NULL;
}

typedef struct {
  uint32_t magic;
  uint32_t objects;
  uint32_t step_count;
  uint32_t total_band_overlaps;
  uint32_t total_candidate_steps;
  uint32_t reserved;
  uint64_t digest;
} ScreenDigest;

int screen_bands(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame || !frame->payload) {
    plugin_set_error("missing-scr-grid", "No $SCR grid frame provided.");
    return 3;
  }
  ScrGridView grid;
  if (!parse_scr_grid(frame->payload, frame->payload_length, &grid)) {
    plugin_set_error("invalid-scr-grid", "Malformed $SCR GRID payload.");
    return 4;
  }

  PairBucket buckets[MAX_OBJECTS];
  memset(buckets, 0, sizeof buckets);
  int threads = requested_threads(grid.objects);
  ScreenWorkerArg args[MAX_THREADS];
  pthread_t tids[MAX_THREADS];

  for (int t = 0; t < threads; t++) {
    args[t] = (ScreenWorkerArg){ &grid, (uint32_t)t, (uint32_t)threads, buckets };
  }
  for (int t = 1; t < threads; t++) {
    if (pthread_create(&tids[t], NULL, screen_worker, &args[t]) != 0) {
      plugin_set_error("thread-spawn", "pthread_create failed.");
      return 5;
    }
  }
  screen_worker(&args[0]);
  for (int t = 1; t < threads; t++) {
    pthread_join(tids[t], NULL);
  }

  ScreenDigest digest;
  memset(&digest, 0, sizeof digest);
  digest.magic = 0x53435242u;
  digest.objects = grid.objects;
  digest.step_count = grid.step_count;
  digest.digest = 14695981039346656037ULL;

  for (uint32_t i = 0; i < grid.objects; i++) {
    digest.total_band_overlaps += buckets[i].band_overlaps;
    digest.total_candidate_steps += buckets[i].candidate_steps;
    digest.digest ^= buckets[i].digest;
    digest.digest *= 1099511628211ULL;
  }

  return plugin_push_output("candidates", "CAT.fbs", "$CAT", (const uint8_t *)&digest, (uint32_t)sizeof digest) < 0 ? 1 : 0;
}
`;

// Shared synthetic orbital catalog + pluggable propagator builder (browser-safe).
function buildEphemerisCatalog() {
  return [
    { id: "SAT-AP-01", declaredTheory: "AP", radiusKm: 6878, phase0: 0.0, omega: 0.0011, inc: 0.92, excluded: false },
    { id: "SAT-AP-02", declaredTheory: "AP", radiusKm: 6885, phase0: 0.04, omega: 0.0011, inc: 0.92, excluded: false },
    { id: "SAT-AP-03", declaredTheory: "AP", radiusKm: 7078, phase0: 1.2, omega: 0.0010, inc: 1.71, excluded: false },
    { id: "SAT-AP-04", declaredTheory: "AP", radiusKm: 7090, phase0: 1.25, omega: 0.0010, inc: 1.71, excluded: false },
    { id: "SAT-XP-01", declaredTheory: "SGP4XP", radiusKm: 7180, phase0: 0.5, omega: 0.00095, inc: 1.15, excluded: false },
    { id: "SAT-XP-02", declaredTheory: "SGP4XP", radiusKm: 7195, phase0: 0.52, omega: 0.00095, inc: 1.15, excluded: false },
    { id: "SAT-XP-03", declaredTheory: "SGP4XP", radiusKm: 8000, phase0: 2.1, omega: 0.0008, inc: 0.45, excluded: false },
    { id: "SAT-XP-04", declaredTheory: "SGP4XP", radiusKm: 8050, phase0: 2.12, omega: 0.0008, inc: 0.45, excluded: false },
    { id: "SAT-S4-01", declaredTheory: "SGP4", radiusKm: 6910, phase0: 0.8, omega: 0.00108, inc: 0.92, excluded: false },
    { id: "SAT-S4-02", declaredTheory: "SGP4", radiusKm: 6920, phase0: 0.82, omega: 0.00108, inc: 0.92, excluded: false },
    { id: "SAT-S4-03", declaredTheory: "SGP4", radiusKm: 7450, phase0: 3.1, omega: 0.0009, inc: 1.4, excluded: false },
    { id: "SAT-S4-04", declaredTheory: "SGP4", radiusKm: 7460, phase0: 3.13, omega: 0.0009, inc: 1.4, excluded: false },
    { id: "SAT-EXCL-13", declaredTheory: "AP", radiusKm: 7000, phase0: 0.0, omega: 0.001, inc: 0.5, excluded: true },
  ];
}

function createSyntheticPropagatorSuite() {
  const counts = {
    apGrid: 0,
    apRecord: 0,
    sgp4xpGrid: 0,
    sgp4xpRecord: 0,
    sgp4Grid: 0,
    sgp4Record: 0,
  };

  function writeObjectRows({
    record,
    objectIndex,
    statesView,
    bandsView,
    firstStep,
    stepCount,
    objectCount,
    windowStart,
    stepS,
  }) {
    if (record.excluded) {
      return { excluded: true };
    }
    const r = Number(record.radiusKm);
    const omega = Number(record.omega);
    const phase0 = Number(record.phase0);
    const inc = Number(record.inc);
    const speed = r * omega;
    const theoryBias =
      record.declaredTheory === "AP"
        ? 0.0
        : record.declaredTheory === "SGP4XP"
          ? 2.5
          : 5.0;
    let lowKm = Infinity;
    let highKm = 0;

    for (let s = 0; s < stepCount; s += 1) {
      const t = windowStart + (firstStep + s) * stepS;
      const theta = phase0 + omega * t;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const cosI = Math.cos(inc);
      const sinI = Math.sin(inc);

      const x = Math.fround(r * cosT + theoryBias);
      const y = Math.fround(r * sinT * cosI);
      const z = Math.fround(r * sinT * sinI);
      const vx = Math.fround(-speed * sinT);
      const vy = Math.fround(speed * cosT * cosI);
      const vz = Math.fround(speed * cosT * sinI);
      const dev = Math.fround(0.25 * omega * speed * stepS * stepS);

      const base = (s * objectCount + objectIndex) * SCR_GRID_STATE_FLOATS;
      statesView[base] = x;
      statesView[base + 1] = y;
      statesView[base + 2] = z;
      statesView[base + 3] = dev;
      statesView[base + 4] = vx;
      statesView[base + 5] = vy;
      statesView[base + 6] = vz;
      statesView[base + 7] = 0;

      const rad = Math.hypot(x, y, z);
      if (rad - dev < lowKm) lowKm = rad - dev;
      if (rad + dev > highKm) highKm = rad + dev;
    }

    const bOffset = objectIndex * SCR_RADIUS_BAND_FLOATS;
    bandsView[bOffset] = Math.fround(lowKm);
    bandsView[bOffset + 1] = Math.fround(highKm);
    return { excluded: false };
  }

  const adapters = {
    "propagator/sdn-ap": {
      supportedTheories: ["AP", "SGP4XP", "SGP4"],
      propagateGrid(ctx) {
        counts.apGrid += 1;
        const excludedIndices = [];
        for (const routed of ctx.routedRecords) {
          const res = writeObjectRows({
            ...ctx,
            record: routed.record,
            objectIndex: routed.index,
          });
          if (res.excluded) excludedIndices.push(routed.index);
        }
        return { excludedIndices };
      },
      propagateRecord(ctx) {
        counts.apRecord += 1;
        return writeObjectRows(ctx);
      },
    },
    "propagator/sgp4-xp": {
      supportedTheories: ["SGP4XP", "SGP4"],
      propagateGrid(ctx) {
        counts.sgp4xpGrid += 1;
        const excludedIndices = [];
        for (const routed of ctx.routedRecords) {
          const res = writeObjectRows({
            ...ctx,
            record: routed.record,
            objectIndex: routed.index,
          });
          if (res.excluded) excludedIndices.push(routed.index);
        }
        return { excludedIndices };
      },
      propagateRecord(ctx) {
        counts.sgp4xpRecord += 1;
        return writeObjectRows(ctx);
      },
    },
    "propagator/sgp4": {
      supportedTheories: ["SGP4"],
      propagateGrid(ctx) {
        counts.sgp4Grid += 1;
        const excludedIndices = [];
        for (const routed of ctx.routedRecords) {
          const res = writeObjectRows({
            ...ctx,
            record: routed.record,
            objectIndex: routed.index,
          });
          if (res.excluded) excludedIndices.push(routed.index);
        }
        return { excludedIndices };
      },
      propagateRecord(ctx) {
        counts.sgp4Record += 1;
        return writeObjectRows(ctx);
      },
    },
  };

  return { adapters, counts };
}

async function runBrowserSabDirectParity({
  wasmABytes,
  wasmBBytes,
  expectedShaA,
  expectedShaB,
}) {
  async function browserExercise({ wasmABase64, wasmBBase64 }) {
    if (globalThis.crossOriginIsolated !== true) {
      throw new Error("Headless Chromium page must be crossOriginIsolated (COOP/COEP).");
    }
    if (typeof SharedArrayBuffer !== "function") {
      throw new Error("SharedArrayBuffer unavailable in Chromium.");
    }

    function fromBase64(b64) {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
      return out;
    }

    async function sha256(bytes) {
      const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    }

    const host = createRuntimeHost();
    const { adapters } = createSyntheticPropagatorSuite();
    for (const [id, adapter] of Object.entries(adapters)) {
      host.registerPropagator(id, adapter);
    }
    const catalog = buildEphemerisCatalog();
    const populated = host.populateEphemerisGrid({
      catalogRevision: "rev-1",
      windowStart: 0,
      windowEnd: 960,
      stepS: 120,
      frame: "TEME",
      roleMask: 0x03,
      records: catalog,
    });

    const leaseA = host.attachEphemerisGrid(populated.regionId, {
      moduleId: "consumer-a-browser",
      roleMask: 0x03,
    });
    const leaseB = host.attachEphemerisGrid(populated.regionId, {
      moduleId: "consumer-b-browser",
      roleMask: 0x01,
    });
    if (!leaseA.shared || !leaseB.shared) {
      throw new Error("Browser RuntimeHost ephemeris grid must be SharedArrayBuffer-backed.");
    }
    if (leaseA.arenaBytes.buffer !== leaseB.arenaBytes.buffer) {
      throw new Error("Consumer A and B must share the identical browser SharedArrayBuffer.");
    }

    const scrBytesA = leaseA.encodeScrGridFrame();
    const scrBytesB = leaseB.encodeScrGridFrame();
    if (scrBytesA.byteLength !== scrBytesB.byteLength) {
      throw new Error("Encoded $SCR grid bytes differ between Consumer A and B.");
    }

    async function runDirectModule(wasmBytes, methodId, scrBytes) {
      const harness = await createBrowserModuleHarness({
        wasmSource: wasmBytes,
        surface: "direct",
        sharedMemory: true,
        initialMemoryBytes: 16 * 1024 * 1024,
        maximumMemoryBytes: 64 * 1024 * 1024,
        enableBrowserWasiThreads: true,
        maxThreads: 4,
        wasiThreadWorkerUrl: new URL("/wasi-thread-worker.js", globalThis.location.href).href,
        env: { SDM_PARITY_THREADS: "4" },
      });
      try {
        if (!(harness.memory.buffer instanceof SharedArrayBuffer)) {
          throw new Error("Browser module direct memory must be SharedArrayBuffer.");
        }
        const ptr = harness.instance.exports.plugin_alloc(scrBytes.byteLength);
        if (!ptr || ptr % 8 !== 0) {
          throw new Error(`plugin_alloc returned unaligned/null ptr=${ptr}`);
        }
        new Uint8Array(harness.memory.buffer, ptr, scrBytes.byteLength).set(scrBytes);
        const response = await harness.invokeDirect({
          methodId,
          externalArena: new Uint8Array(harness.memory.buffer),
          inputs: [
            {
              portId: "scr_grid",
              offset: ptr,
              size: scrBytes.byteLength,
              alignment: 8,
              ownership: BufferOwnership.SHARED,
              mutability: BufferMutability.IMMUTABLE,
              typeRef: {
                schemaName: "SCR.fbs",
                fileIdentifier: "$SCR",
                rootTypeName: "SCR",
                wireFormat: "flatbuffer",
              },
            },
          ],
        });
        harness.instance.exports.plugin_free(ptr, scrBytes.byteLength);
        if (response.statusCode !== 0) {
          throw new Error(`Browser direct invoke failed (${response.errorCode}: ${response.errorMessage})`);
        }
        const payload = new Uint8Array(response.outputs[0].payload);
        const spawnCount = harness.threadHost?.spawnCount() ?? 0;
        return { sha256: await sha256(payload), byteLength: payload.byteLength, spawnCount };
      } finally {
        await harness.destroy();
      }
    }

    const resA = await runDirectModule(fromBase64(wasmABase64), "analyze_grid", scrBytesA);
    const resB = await runDirectModule(fromBase64(wasmBBase64), "screen_bands", scrBytesB);
    leaseA.detach();
    leaseB.detach();
    return { resA, resB };
  }

  const bundleSource = `
import {
  SCR_GRID_STATE_FLOATS,
  SCR_RADIUS_BAND_FLOATS,
  createRuntimeHost,
} from ${JSON.stringify(path.join(root, "src/runtime-host/index.js"))};
import { createBrowserModuleHarness } from ${JSON.stringify(path.join(root, "src/host/browserModuleHarness.js"))};
import { BufferOwnership } from ${JSON.stringify(path.join(root, "src/generated/orbpro/stream/buffer-ownership.js"))};
import { BufferMutability } from ${JSON.stringify(path.join(root, "src/generated/orbpro/stream/buffer-mutability.js"))};

${buildEphemerisCatalog.toString()}
${createSyntheticPropagatorSuite.toString()}
const runBrowserSabDirectParity = ${browserExercise.toString()};

self.onmessage = async (event) => {
  try {
    const result = await runBrowserSabDirectParity(event.data);
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: String(error?.stack ?? error) });
  }
};
`;

  const nodeStubPlugin = {
    name: "node-builtin-stub",
    setup(buildPlugin) {
      buildPlugin.onResolve({ filter: /^node:/ }, (args) => ({
        path: args.path,
        namespace: "node-stub",
      }));
      buildPlugin.onLoad({ filter: /.*/, namespace: "node-stub" }, (args) => ({
        contents:
          `const refuse = () => { throw new Error(${JSON.stringify(
            `${args.path} is not available in the browser lane`,
          )}); };\n` +
          "export default new Proxy({}, { get: refuse });\n" +
          "export const readFile = refuse;\n" +
          "export const createHash = refuse;\n" +
          "export const fileURLToPath = refuse;\n" +
          "export const Worker = refuse;\n" +
          "export const randomFillSync = refuse;\n" +
          "export const threadId = 0;\n",
        loader: "js",
      }));
    },
  };

  const bundle = await build({
    plugins: [nodeStubPlugin],
    stdin: {
      contents: bundleSource,
      resolveDir: root,
      sourcefile: "shared-ephemeris-grid-browser.js",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    nodePaths: [path.join(root, "node_modules")],
  });

  const server = http.createServer((req, res) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    if (req.url === "/bundle.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles[0].contents);
    } else if (req.url === "/wasi-thread-worker.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(WASI_THREAD_POOL_WORKER_BUNDLE);
    } else if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><title>Shared Ephemeris Grid Browser SAB Direct E2E</title>');
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    browser = await chromium.launch({
      executablePath: await resolveHeadlessShell(),
      headless: true,
    });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);

    const result = await page.evaluate((payload) => {
      return new Promise((resolve, reject) => {
        const worker = new Worker("/bundle.js", { type: "module" });
        worker.onmessage = (event) => {
          worker.terminate();
          if (event.data?.ok) resolve(event.data.result);
          else reject(new Error(event.data?.error ?? "Unknown worker error"));
        };
        worker.onerror = (err) => {
          worker.terminate();
          reject(new Error(err?.message ?? "Worker error"));
        };
        worker.postMessage(payload);
      });
    }, {
      wasmABase64: Buffer.from(wasmABytes).toString("base64"),
      wasmBBase64: Buffer.from(wasmBBytes).toString("base64"),
    });
    assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join("; ")}`);
    assert.equal(result.resA.sha256, expectedShaA, "Browser SAB direct Consumer A SHA-256 mismatch");
    assert.equal(result.resB.sha256, expectedShaB, "Browser SAB direct Consumer B SHA-256 mismatch");
    assert.ok(result.resA.spawnCount >= 3, `Consumer A expected >=3 browser worker spawns at 4 threads, got ${result.resA.spawnCount}`);
    assert.ok(result.resB.spawnCount >= 3, `Consumer B expected >=3 browser worker spawns at 4 threads, got ${result.resB.spawnCount}`);
    return result;
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const started = Date.now();
  const dir = await mkdtemp(path.join(os.tmpdir(), "sdm-shared-ephemeris-grid-e2e-"));
  try {
    // --- 1. SDS Pin & Standards Catalog Gate ----------------------------------------------------
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const pinned = pkg.dependencies["spacedatastandards.org"];
    const installed = JSON.parse(
      await readFile(require.resolve("spacedatastandards.org/package.json"), "utf8"),
    ).version;
    assert.match(pinned, /^\d+\.\d+\.\d+$/, `spacedatastandards.org must be pinned exactly, got ${pinned}`);
    assert.equal(installed, pinned, `installed spacedatastandards.org ${installed} != pinned ${pinned}`);
    assert.ok(atLeast(installed, "1.294.1"), `spacedatastandards.org ${installed} must be >= 1.294.1`);

    const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
    const lockResolved = lock?.packages?.["node_modules/spacedatastandards.org"]?.resolved ?? "";
    assert.match(
      lockResolved,
      /^https:\/\/registry\.npmjs\.org\/spacedatastandards\.org\/-\/spacedatastandards\.org-1\.294\.1\.tgz$/,
      `package-lock.json must resolve spacedatastandards.org@1.294.1 from npm registry, got ${lockResolved}`,
    );

    const catalog = await loadStandardsCatalog();
    for (const [schemaName, fileIdentifier] of [
      ["SCR.fbs", "$SCR"],
      ["THP.fbs", "$THP"],
      ["TMX.fbs", "$TMX"],
      ["DCO.fbs", "$DCO"],
      ["RBF.fbs", "$RBF"],
      ["RDE.fbs", "$RDE"],
    ]) {
      const resolved = resolveStandardsTypeRef({ schemaName, fileIdentifier }, catalog);
      assert.ok(resolved, `Standards catalog missing ${schemaName} (${fileIdentifier})`);
    }
    console.log(`pin+catalog: spacedatastandards.org@${installed} ($SCR, $THP, $TMX, $DCO, $RBF, $RDE resolved)`);

    // --- 2. Compile Two Distinct wasm32-wasip1-threads Consumer Modules -------------------------
    const wasmAPath = path.join(dir, "consumer-a-stats.wasm");
    const wasmBPath = path.join(dir, "consumer-b-screen.wasm");
    const compileCacheDir = path.join(dir, "compile-cache");

    const compiledA = await compileModuleFromSource({
      manifest: CONSUMER_A_MANIFEST,
      sourceCode: CONSUMER_A_SOURCE,
      language: "c",
      threadModel: "emscripten-pthreads",
      outputPath: wasmAPath,
      compileCache: { dir: compileCacheDir },
    });
    const compiledB = await compileModuleFromSource({
      manifest: CONSUMER_B_MANIFEST,
      sourceCode: CONSUMER_B_SOURCE,
      language: "c",
      threadModel: "emscripten-pthreads",
      outputPath: wasmBPath,
      compileCache: { dir: compileCacheDir },
    });
    assert.equal(compiledA.report.ok, true, "Consumer A compile report failed");
    assert.equal(compiledB.report.ok, true, "Consumer B compile report failed");

    for (const [label, wasmPath, manifest, wasmBytes] of [
      ["Consumer A", wasmAPath, CONSUMER_A_MANIFEST, compiledA.wasmBytes],
      ["Consumer B", wasmBPath, CONSUMER_B_MANIFEST, compiledB.wasmBytes],
    ]) {
      const validation = await validateArtifactWithStandards({ manifest, wasmPath });
      assert.equal(
        validation.ok,
        true,
        `${label} standards validation failed: ${JSON.stringify(validation.errors)}`,
      );
      const compiledModule = await WebAssembly.compile(wasmBytes);
      const imports = WebAssembly.Module.imports(compiledModule);
      assert.ok(
        imports.some((entry) => entry.module === "wasi" && entry.name === "thread-spawn"),
        `${label} must import wasi.thread-spawn`,
      );
      assert.ok(
        !imports.some((entry) => entry.name.includes("emscripten") || entry.name === "__pthread_create_js"),
        `${label} must not contain Emscripten runtime imports`,
      );
    }
    console.log(
      `compiled: Consumer A (${compiledA.wasmBytes.length} B) & Consumer B (${compiledB.wasmBytes.length} B) wasm32-wasip1-threads artifacts validated`,
    );

    // --- 3. RuntimeHost Shared $SCR Grid, Pluggable Propagators, Cache, Lease & Splice ----------
    const host = createRuntimeHost();
    assert.equal(host.propagators.defaultPropagatorId, DEFAULT_PROPAGATOR_ID);
    assert.deepEqual(host.propagators.supportedPropagatorIds, SUPPORTED_PROPAGATOR_IDS);

    const { adapters, counts } = createSyntheticPropagatorSuite();
    for (const [id, adapter] of Object.entries(adapters)) {
      host.registerPropagator(id, adapter);
    }
    assert.deepEqual(host.listPropagators(), [...SUPPORTED_PROPAGATOR_IDS].sort());

    const catalogRecords = buildEphemerisCatalog();

    // Declared-theory enforcement: passing an SGP4XP record to strict propagator/sgp4 must fail loudly.
    assert.throws(
      () =>
        host.populateEphemerisGrid({
          propagatorId: "propagator/sgp4",
          catalogRevision: "mismatch-1",
          windowStart: 0,
          windowEnd: 960,
          stepS: 120,
          records: [catalogRecords[4]], // declaredTheory: "SGP4XP"
        }),
      (error) =>
        error instanceof TheoryMismatchError &&
        error.code === "ERR_DECLARED_THEORY_MISMATCH" &&
        error.declaredTheory === "SGP4XP" &&
        error.propagatorId === "propagator/sgp4",
    );

    // Passing an AP record to propagator/sgp4-xp must fail loudly.
    assert.throws(
      () =>
        host.populateEphemerisGrid({
          propagatorId: "propagator/sgp4-xp",
          catalogRevision: "mismatch-2",
          windowStart: 0,
          windowEnd: 960,
          stepS: 120,
          records: [catalogRecords[0]], // declaredTheory: "AP"
        }),
      (error) =>
        error instanceof TheoryMismatchError &&
        error.declaredTheory === "AP" &&
        error.propagatorId === "propagator/sgp4-xp",
    );

    // Single-theory propagators succeed when records match declared theory.
    const sgp4Only = host.populateEphemerisGrid({
      propagatorId: "propagator/sgp4",
      catalogRevision: "sgp4-rev-1",
      windowStart: 0,
      windowEnd: 240,
      stepS: 120,
      records: catalogRecords.filter((r) => r.declaredTheory === "SGP4"),
    });
    assert.equal(sgp4Only.cacheHit, false);
    assert.equal(counts.sgp4Grid, 1);

    const xpOnly = host.populateEphemerisGrid({
      propagatorId: "propagator/sgp4-xp",
      catalogRevision: "xp-rev-1",
      windowStart: 0,
      windowEnd: 240,
      stepS: 120,
      records: catalogRecords.filter((r) => r.declaredTheory === "SGP4XP"),
    });
    assert.equal(xpOnly.cacheHit, false);
    assert.equal(counts.sgp4xpGrid, 1);

    // Default propagator ("propagator/sdn-ap") populates mixed-theory catalog once into SharedArrayBuffer.
    const populated1 = host.populateEphemerisGrid({
      catalogRevision: "rev-1",
      windowStart: 0,
      windowEnd: 960,
      stepS: 120,
      frame: "TEME",
      roleMask: 0x03,
      records: catalogRecords,
    });
    assert.equal(populated1.cacheHit, false);
    assert.equal(populated1.descriptor.propagatorId, "propagator/sdn-ap");
    assert.equal(populated1.descriptor.roleMask, 0x03);
    assert.equal(populated1.descriptor.catalogRevision, "rev-1");
    assert.equal(populated1.descriptor.stepCount, 9);
    assert.equal(populated1.descriptor.objectCount, 13);
    assert.deepEqual(populated1.excludedIndices, [12]);
    assert.equal(counts.apGrid, 1);

    const arena = host.regions.getRegionArena(populated1.regionId);
    assert.equal(arena.shared, true, "Region arena must be SharedArrayBuffer-backed");
    assert.ok(arena.buffer instanceof SharedArrayBuffer);

    // Different roleMask reuses cached grid with ZERO re-propagation.
    const populated2 = host.populateEphemerisGrid({
      catalogRevision: "rev-1",
      windowStart: 0,
      windowEnd: 960,
      stepS: 120,
      frame: "TEME",
      roleMask: 0x01,
      records: catalogRecords,
    });
    assert.equal(populated2.cacheHit, true);
    assert.equal(populated2.regionId, populated1.regionId);
    assert.equal(populated2.descriptor.roleMask, 0x01);
    assert.equal(counts.apGrid, 1, "roleMask change must NOT re-propagate");

    // Multi-module read-only attach leases sharing the identical SharedArrayBuffer.
    assert.throws(
      () =>
        host.attachEphemerisGrid(populated1.regionId, {
          moduleId: "bad-writer",
          mode: "read-write",
        }),
      /read-only/i,
    );

    const leaseA = host.attachEphemerisGrid(populated1.regionId, {
      moduleId: "consumer-a",
      roleMask: 0x03,
    });
    const leaseB = host.attachEphemerisGrid(populated1.regionId, {
      moduleId: "consumer-b",
      roleMask: 0x01,
    });
    assert.equal(leaseA.shared, true);
    assert.equal(leaseB.shared, true);
    assert.equal(leaseA.arenaBytes.buffer, arena.buffer);
    assert.equal(leaseB.arenaBytes.buffer, arena.buffer);
    assert.equal(host.getEphemerisGrid(populated1.regionId).activeConsumers, 2);

    // Read-only enforcement on views and descriptors.
    assert.throws(() => {
      leaseA.arenaBytes[0] = 0xff;
    }, TypeError);
    assert.throws(() => {
      leaseA.getStatesView()[0] = 999;
    }, TypeError);
    assert.throws(() => {
      leaseA.getBandsView().fill(0);
    }, TypeError);
    assert.throws(() => {
      leaseA.descriptor.roleMask = 0;
    }, TypeError);

    // Verify NaN exclusion on object 12 in shared grid.
    const statesView = leaseA.getStatesView();
    const bandsView = leaseA.getBandsView();
    assert.ok(Number.isNaN(statesView[12 * SCR_GRID_STATE_FLOATS]));
    assert.ok(Number.isNaN(bandsView[12 * SCR_RADIUS_BAND_FLOATS]));

    const extFrame = leaseA.encodeAlignedExternalFrame({ portId: "scr_aligned" });
    assert.equal(extFrame.shared, true);
    assert.equal(extFrame.alignment, 8);
    assert.equal(extFrame.regionId, populated1.regionId);

    const scrBytesA = leaseA.encodeScrGridFrame();
    const scrBytesB = leaseB.encodeScrGridFrame();
    assert.equal(Buffer.compare(Buffer.from(scrBytesA), Buffer.from(scrBytesB)), 0);
    const decodedScr = decodeScrGridFlatBuffer(scrBytesA);
    assert.equal(decodedScr.objectCount, 13);
    assert.equal(decodedScr.stepCount, 9);
    assert.equal(decodedScr.frame, "TEME");
    assert.equal(decodedScr.stepS, 120);

    // Save object 0 and object 1 pre-splice values to verify invariance vs update after splice.
    const obj0PreSplice = Array.from(statesView.subarray(0, SCR_GRID_STATE_FLOATS));
    const obj1PreSpliceX = statesView[1 * SCR_GRID_STATE_FLOATS];

    // Splice 1 object to rev-2 and verify stale lease detection.
    const updatedObj1 = {
      ...catalogRecords[1],
      radiusKm: 6999,
      phase0: 0.77,
    };
    const spliced = host.spliceEphemerisGrid({
      regionId: populated1.regionId,
      newCatalogRevision: "rev-2",
      updatedIndices: [1],
      records: [updatedObj1],
    });
    assert.equal(spliced.propagatedObjectCount, 1);
    assert.equal(spliced.generation, 2);
    assert.equal(counts.apRecord, 1, "splice must re-propagate ONLY the spliced object");
    assert.equal(counts.apGrid, 1, "splice must NOT trigger full-catalog grid propagation");
    assert.equal(leaseA.isCurrent(), false);
    assert.throws(() => leaseA.getStatesView(), StaleGridLeaseError);
    assert.throws(() => leaseA.encodeScrGridFrame(), StaleGridLeaseError);

    const leaseA2 = host.attachEphemerisGrid(populated1.regionId, {
      moduleId: "consumer-a",
      roleMask: 0x03,
    });
    const obj0PostSplice = Array.from(
      leaseA2.getStatesView().subarray(0, SCR_GRID_STATE_FLOATS),
    );
    assert.deepEqual(obj0PostSplice, obj0PreSplice, "Untouched object 0 must remain identical after splice");
    assert.notEqual(
      leaseA2.getStatesView()[1 * SCR_GRID_STATE_FLOATS],
      obj1PreSpliceX,
      "Spliced object 1 state must reflect updated elements",
    );

    const rev2Hit = host.populateEphemerisGrid({
      catalogRevision: "rev-2",
      windowStart: 0,
      windowEnd: 960,
      stepS: 120,
      frame: "TEME",
      records: catalogRecords,
    });
    assert.equal(rev2Hit.cacheHit, true);

    const inv = host.invalidateEphemerisGrid({ catalogRevision: "rev-2" });
    assert.deepEqual(inv.invalidatedRegionIds, [populated1.regionId]);
    assert.equal(leaseA2.isCurrent(), false);
    assert.throws(() => leaseA2.assertCurrent(), StaleGridLeaseError);

    const afterInv = host.populateEphemerisGrid({
      catalogRevision: "rev-2",
      windowStart: 0,
      windowEnd: 960,
      stepS: 120,
      frame: "TEME",
      records: catalogRecords,
    });
    assert.equal(afterInv.cacheHit, false);
    console.log("runtime-host: populate-once cache, SAB sharing, read-only leases, declared-theory routing, splice & invalidation verified");

    // --- 4. Tri-Runtime Multi-Thread Parity (Browser, Native WasmEdge, Docker WasmEdge) -------
    const scrBase64 = Buffer.from(scrBytesA).toString("base64");
    const parityOutputs = {};

    for (const [label, wasmPath, methodId] of [
      ["Consumer A", wasmAPath, "analyze_grid"],
      ["Consumer B", wasmBPath, "screen_bands"],
    ]) {
      const plan = await normalizeParityFixture({
        name: `shared-grid-${methodId}`,
        threadCounts: [1, 2, 4],
        cases: [
          {
            id: "scr-grid-rev1",
            request: {
              methodId,
              inputs: [
                {
                  portId: "scr_grid",
                  payloadBase64: scrBase64,
                  typeRef: SCR_TYPE,
                },
              ],
            },
          },
        ],
      });

      const captured = [];
      const report = await runParityHarness({
        wasmPath,
        plan,
        lanes: ["browser", "wasmedge", "docker-wasmedge"],
        timeoutMs: 120_000,
        log: (line) => console.error(line),
        laneRunners: undefined,
      });
      assert.equal(report.ok, true, `${label} parity failed:\n${formatParityReport(report)}`);
      assert.equal(report.lanes.length, 3, `${label}: expected all 3 parity lanes`);
      assert.equal(report.runs.length, 9, `${label}: expected 3 lanes x 3 threadCounts = 9 runs`);

      // Also decode stdout from native/browser/docker via report.runs stdout digests:
      // runParityHarness guarantees byte-identical stdout across all 9 runs; extract decoded output SHA-256
      // from a local decode check using the identical normalized plan run on native/browser.
      for (const run of report.runs) {
        assert.equal(run.exitClass, "ok", `${label} ${run.lane} T=${run.threadCount}: ${run.exitDetail}`);
        captured.push(run.stdoutSha256);
      }
      assert.equal(new Set(captured).size, 1, `${label}: stdout SHA-256 must match across all 9 runs`);

      // Decode one canonical response to verify real non-empty output payload and capture payload SHA-256.
      const { runNativeWasmEdgeLane } = await import("../../src/testing/parityLanes.js");
      const { loadWasmEdgePin } = await import("../../src/testing/parityHarness.js");
      const nativeCheck = await runNativeWasmEdgeLane({
        wasmPath,
        wasmBytes: await readFile(wasmPath),
        plan,
        pin: loadWasmEdgePin(),
        timeoutMs: 60_000,
      });
      const decoded = decodePluginInvokeResponse(nativeCheck[0].stdout);
      assert.equal(decoded.statusCode, 0);
      const outputPayload = new Uint8Array(decoded.outputs[0].payload);
      const expectedBytes = methodId === "analyze_grid" ? 48 : 32;
      assert.equal(outputPayload.byteLength, expectedBytes, `${label}: expected ${expectedBytes}-byte summary/digest payload`);
      const payloadSha = sha256Hex(outputPayload);
      parityOutputs[methodId] = {
        stdoutSha256: captured[0],
        payloadSha256: payloadSha,
        payloadBytes: outputPayload,
      };
      console.log(
        `parity (${label}): 3 lanes x [1,2,4] threads PASS (stdoutSha256=${captured[0].slice(0, 12)}, payloadSha256=${payloadSha.slice(0, 12)})`,
      );
    }

    // Sanity check decoded values from Consumer A and Consumer B binary structs.
    const viewA = new DataView(parityOutputs.analyze_grid.payloadBytes.buffer);
    assert.equal(viewA.getUint32(0, true), 0x53435241); // 'SCRA'
    assert.equal(viewA.getUint32(8, true), 9); // step_count
    assert.equal(viewA.getUint32(12, true), 13); // objects
    assert.equal(viewA.getUint32(16, true), 12); // active_objects
    assert.equal(viewA.getUint32(20, true), 1); // excluded_objects

    const viewB = new DataView(parityOutputs.screen_bands.payloadBytes.buffer);
    assert.equal(viewB.getUint32(0, true), 0x53435242); // 'SCRB'
    assert.equal(viewB.getUint32(4, true), 13); // objects
    assert.ok(viewB.getUint32(12, true) > 0, "Expected non-zero band overlaps");
    assert.ok(viewB.getUint32(16, true) > 0, "Expected non-zero candidate steps");

    // --- 5. Headless Chromium Direct Surface SAB externalArena Parity -------------------------
    const browserDirect = await runBrowserSabDirectParity({
      wasmABytes: compiledA.wasmBytes,
      wasmBBytes: compiledB.wasmBytes,
      expectedShaA: parityOutputs.analyze_grid.payloadSha256,
      expectedShaB: parityOutputs.screen_bands.payloadSha256,
    });
    console.log(
      `browser-sab-direct: Consumer A (${browserDirect.resA.sha256.slice(0, 12)}, spawns=${browserDirect.resA.spawnCount}) & Consumer B (${browserDirect.resB.sha256.slice(0, 12)}, spawns=${browserDirect.resB.spawnCount}) bit-identical to tri-runtime parity`,
    );

    console.log(`SHARED-EPHEMERIS-GRID PASS in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`SHARED-EPHEMERIS-GRID FAIL: ${error?.stack ?? error}`);
  process.exit(1);
});
