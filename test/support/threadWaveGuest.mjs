// A wasi-threads guest that spawns WAVES of threads inside ONE invoke, the
// shape of conjunction screening (a coarse wave, then a refine wave): every
// wave is pthread_create x K, then pthread_join x K, then the next wave.
//
// A host that recycles a finished thread only through the owner's event loop
// (the owner is blocked in the guest for the whole invoke) can serve at most
// poolSize spawns per invoke; this guest needs waves x K.
//
// Environment:
//   SDM_PARITY_THREADS = N   lanes per wave (the parity harness sets it)
//   SDM_WAVE_MODE            "" : the main thread runs one stripe and spawns
//                                 N - 1 threads (waves of poolSize - 1 when
//                                 the pool holds N workers)
//                            "all": N threads per wave, the main thread only
//                                 joins (waves of poolSize)
//                            "nested": the main thread runs one stripe and
//                                 spawns ONE thread, which spawns the other
//                                 N - 2 and joins them (spawns from a guest
//                                 thread that is not the main thread)
//   SDM_WAVES                waves per invoke (default 3)
//   SDM_WAVE_ROUNDS          mixing rounds per cell (default 2048)
//
// The work is a fixed 840-cell grid (840 = lcm(1..8)), so the response bytes
// never depend on N or the mode: parity compares them across lanes AND thread
// counts. A declined spawn fails the invoke with status 20 + wave (30 + wave
// from the nested spawner) and error "thread-spawn-declined", the way
// std::thread aborts on EAGAIN.

import { compileModuleFromSource } from "../../src/compiler/compileModule.js";
import { resolveWasiThreadsToolchain } from "../../src/compiler/wasiThreadsToolchain.js";

export const THREAD_WAVE_COUNT = 3;
export const THREAD_WAVE_ENV = "SDM_PARITY_THREADS";
export const THREAD_WAVE_MODE_ENV = "SDM_WAVE_MODE";

export const THREAD_WAVE_IDENTITY = Object.freeze({
  schemaName: "CAT.fbs",
  fileIdentifier: "$CAT",
  rootTypeName: "CAT",
});

const port = (portId) => ({
  portId,
  required: true,
  minStreams: 1,
  maxStreams: 1,
  acceptedTypeSets: [
    {
      setId: "catalog",
      allowedTypes: [{ ...THREAD_WAVE_IDENTITY, wireFormat: "flatbuffer" }],
    },
  ],
});

export const THREAD_WAVE_MANIFEST = Object.freeze({
  pluginId: "com.digitalarsenal.test.thread-waves",
  name: "Thread waves",
  version: "0.1.0",
  pluginFamily: "analysis",
  runtimeTargets: ["browser", "wasmedge"],
  invokeSurfaces: ["command", "direct"],
  methods: [
    {
      methodId: "waves",
      displayName: "Waves",
      inputPorts: [port("request")],
      outputPorts: [port("response")],
      maxBatch: 1,
      drainPolicy: "single-shot",
    },
  ],
});

export const THREAD_WAVE_SOURCE = `#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "space_data_module_invoke.h"

#define CELLS 840
#define MAX_LANES 64

typedef struct {
  uint32_t wave;
  uint32_t begin;
  uint32_t end;
} stripe_t;

typedef struct {
  uint32_t first;
  uint32_t count;
  int declined;
} coordinator_t;

static uint64_t cells[CELLS];
static stripe_t plan[MAX_LANES];
static uint32_t rounds = 2048;

static uint64_t mix64(uint64_t x) {
  x ^= x >> 33;
  x *= 0xff51afd7ed558ccdULL;
  x ^= x >> 33;
  x *= 0xc4ceb9fe1a85ec53ULL;
  x ^= x >> 33;
  return x;
}

static void run_stripe(const stripe_t *stripe) {
  for (uint32_t i = stripe->begin; i < stripe->end; ++i) {
    uint64_t v = cells[i] ^ ((uint64_t)(stripe->wave + 1) << 40) ^ i;
    for (uint32_t r = 0; r < rounds; ++r) {
      v = mix64(v + r);
    }
    cells[i] = v;
  }
}

static void *thread_main(void *arg) {
  run_stripe((const stripe_t *)arg);
  return 0;
}

/* A guest thread that spawns: it starts stripes first+1 .. first+count-1,
   runs stripe 'first' itself, and joins what it started. */
static void *coordinator_main(void *arg) {
  coordinator_t *coordinator = arg;
  pthread_t nested[MAX_LANES];
  uint32_t created = 0;
  for (uint32_t t = 1; t < coordinator->count; ++t) {
    if (pthread_create(&nested[created], 0, thread_main, &plan[coordinator->first + t]) != 0) {
      coordinator->declined = 1;
      break;
    }
    created += 1;
  }
  if (!coordinator->declined) run_stripe(&plan[coordinator->first]);
  for (uint32_t t = 0; t < created; ++t) pthread_join(nested[t], 0);
  return 0;
}

static long env_long(const char *name, long fallback, long low, long high) {
  const char *text = getenv(name);
  long value = text && *text ? strtol(text, 0, 10) : fallback;
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

static int fail(const char *what, uint32_t wave, uint32_t spawn, uint32_t of, int status) {
  static char message[96];
  snprintf(message, sizeof message, "wave %u %s spawn %u of %u",
           (unsigned)wave, what, (unsigned)spawn, (unsigned)of);
  plugin_set_error("thread-spawn-declined", message);
  return status;
}

int waves(void) {
  const uint32_t lanes = (uint32_t)env_long("${THREAD_WAVE_ENV}", 1, 1, MAX_LANES);
  const uint32_t wave_count = (uint32_t)env_long("SDM_WAVES", ${THREAD_WAVE_COUNT}, 1, 1000000);
  rounds = (uint32_t)env_long("SDM_WAVE_ROUNDS", 2048, 1, 1 << 20);
  const char *mode_text = getenv("${THREAD_WAVE_MODE_ENV}");
  const char *mode = mode_text ? mode_text : "";
  const int spawn_all = strcmp(mode, "all") == 0;
  const int nested = strcmp(mode, "nested") == 0 && lanes > 1;
  const uint32_t spawned = spawn_all ? lanes : lanes - 1;
  const uint32_t stripes = lanes;
  pthread_t threads[MAX_LANES];

  for (uint32_t i = 0; i < CELLS; ++i) cells[i] = i;
  for (uint32_t wave = 0; wave < wave_count; ++wave) {
    for (uint32_t s = 0; s < stripes; ++s) {
      plan[s].wave = wave;
      plan[s].begin = (uint32_t)((uint64_t)CELLS * s / stripes);
      plan[s].end = (uint32_t)((uint64_t)CELLS * (s + 1) / stripes);
    }
    if (nested) {
      coordinator_t coordinator = { 1, lanes - 1, 0 };
      if (pthread_create(&threads[0], 0, coordinator_main, &coordinator) != 0) {
        return fail("declined", wave, 1, spawned, 20 + (int)wave);
      }
      run_stripe(&plan[0]);
      pthread_join(threads[0], 0);
      if (coordinator.declined) {
        return fail("nested thread declined", wave, 2, spawned, 30 + (int)wave);
      }
      continue;
    }
    /* Spawned threads take the LAST 'spawned' stripes; the main thread runs
       stripe 0 unless every stripe was spawned. */
    const uint32_t first_spawned = stripes - spawned;
    uint32_t created = 0;
    int declined = 0;
    for (uint32_t t = 0; t < spawned; ++t) {
      if (pthread_create(&threads[t], 0, thread_main, &plan[first_spawned + t]) != 0) {
        declined = 1;
        break;
      }
      created += 1;
    }
    if (!declined && first_spawned == 1) run_stripe(&plan[0]);
    for (uint32_t t = 0; t < created; ++t) pthread_join(threads[t], 0);
    if (declined) return fail("declined", wave, created + 1, spawned, 20 + (int)wave);
  }

  uint64_t sum = 0x9e3779b97f4a7c15ULL;
  for (uint32_t i = 0; i < CELLS; ++i) sum = mix64(sum ^ cells[i]);
  uint8_t out[8];
  for (int b = 0; b < 8; ++b) out[b] = (uint8_t)(sum >> (8 * b));
  plugin_push_output("response", "${THREAD_WAVE_IDENTITY.schemaName}",
                     "${THREAD_WAVE_IDENTITY.fileIdentifier}", out, sizeof out);
  return 0;
}
`;

export function threadWaveToolchainAvailable() {
  try {
    resolveWasiThreadsToolchain();
    return true;
  } catch {
    return false;
  }
}

/** Compile the guest through the SDK's wasi-threads lane. */
export function compileThreadWaveGuest() {
  return compileModuleFromSource({
    language: "c",
    sourceCode: THREAD_WAVE_SOURCE,
    threadModel: "emscripten-pthreads",
    manifest: THREAD_WAVE_MANIFEST,
  });
}

/** The guest environment for N lanes in one mode. */
export function threadWaveEnv(lanes, { mode = "", waves, rounds } = {}) {
  return {
    [THREAD_WAVE_ENV]: String(lanes),
    ...(mode ? { [THREAD_WAVE_MODE_ENV]: mode } : {}),
    ...(waves ? { SDM_WAVES: String(waves) } : {}),
    ...(rounds ? { SDM_WAVE_ROUNDS: String(rounds) } : {}),
  };
}

/** The one request every lane and thread count answers identically. */
export function threadWaveRequest() {
  return {
    methodId: "waves",
    inputs: [
      {
        portId: "request",
        typeRef: THREAD_WAVE_IDENTITY,
        payload: new Uint8Array(8),
      },
    ],
  };
}

/** Threads the wave guest spawns in one invoke for N lanes. */
export function threadWaveSpawns(lanes, { mode = "", waves = THREAD_WAVE_COUNT } = {}) {
  return waves * (mode === "all" ? lanes : lanes - 1);
}
