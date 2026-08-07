/*
 * Provider Access ABI — guest header.
 *
 * One generalized port for imagery/terrain providers. Identical import names
 * and signatures in the browser, in native WasmEdge and in Docker WasmEdge.
 *
 * Build: clang --target=wasm32-wasip1-threads (never emcc -pthread).
 * The module is EH-free and there is exactly one dist/isomorphic/module.wasm.
 *
 * NOTE ON TYPES: every parameter and every result below is int32_t. No int64_t
 * appears anywhere in a boundary signature. This is deliberate — a 64-bit
 * import parameter legalizes differently depending on how the host
 * instantiates the module, and the mismatch shows up as a link failure or a
 * silently truncated argument in exactly one runtime. Every 64-bit quantity in
 * this ABI travels inside the descriptor struct below, in guest memory, as
 * plain little-endian IEEE-754 that you read with a normal load.
 *
 * See docs/provider-access-abi.md for the normative contract.
 */

#ifndef SPACE_DATA_PROVIDER_ABI_H
#define SPACE_DATA_PROVIDER_ABI_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define SDM_PROVIDER_IMPORT_MODULE "space_data_provider"
#define SDM_PROVIDER_ABI_VERSION 1
#define SDM_PROVIDER_TILE_DESC_MAGIC 0x53445054u /* 'SDPT' */
#define SDM_PROVIDER_TILE_DESC_BYTES 128

/* ---- kinds ------------------------------------------------------------- */
#define SDM_PROVIDER_KIND_TERRAIN 1u
#define SDM_PROVIDER_KIND_IMAGERY 2u

/* ---- encodings --------------------------------------------------------- */
#define SDM_PROVIDER_ENC_HEIGHT_F32 1u  /* float,  metres above the ellipsoid */
#define SDM_PROVIDER_ENC_HEIGHT_F64 2u  /* double, metres above the ellipsoid */
#define SDM_PROVIDER_ENC_RGBA8 16u
#define SDM_PROVIDER_ENC_RGB8 17u
#define SDM_PROVIDER_ENC_GRAY8 18u
#define SDM_PROVIDER_ENC_GRAY16 19u
#define SDM_PROVIDER_ENC_RGBA_F32 20u

/* ---- flags ------------------------------------------------------------- */
#define SDM_PROVIDER_FLAG_INTERPOLATED (1u << 0)
#define SDM_PROVIDER_FLAG_STAGED (1u << 1)
#define SDM_PROVIDER_FLAG_PARTIAL (1u << 2)
#define SDM_PROVIDER_FLAG_DERIVED (1u << 3)
#define SDM_PROVIDER_FLAG_FIXTURE (1u << 4)

/* ---- cost classes ------------------------------------------------------ *
 * "maxCost" in the acquire request defaults to DEQUANTIZE. That default IS
 * the "never re-fetch, never re-parse" rule, enforced by the ABI rather than
 * by discipline. Raising it is how a caller says out loud that it accepts a
 * cost.
 */
#define SDM_PROVIDER_COST_RESIDENT 0u
#define SDM_PROVIDER_COST_DEQUANTIZE 1u
#define SDM_PROVIDER_COST_REDECODE 2u
#define SDM_PROVIDER_COST_REFETCH 3u
#define SDM_PROVIDER_COST_READBACK 4u

/* ---- level-selection provenance ---------------------------------------- *
 * A consumer that cannot see which level answered cannot tell a solve that
 * resolved the ridges from one that interpolated them away. Names mirror the
 * engine consumer's existing vocabulary.
 */
#define SDM_PROVIDER_STRATEGY_DEFAULT 0u
#define SDM_PROVIDER_STRATEGY_GRID_MATCHED_LEVEL 1u
#define SDM_PROVIDER_STRATEGY_MOST_DETAILED 2u
#define SDM_PROVIDER_STRATEGY_FIXED_LEVEL 3u

/* ---- error codes ------------------------------------------------------- *
 * Negative results from acquire/read/release. Identical value, identical
 * meaning and identical trap class (none — these are VALUES) in every runtime.
 */
#define SDM_PROVIDER_E_INVALID_REQUEST (-1)
#define SDM_PROVIDER_E_NO_CAPABILITY (-2)
#define SDM_PROVIDER_E_NO_PROVIDER (-3)
#define SDM_PROVIDER_E_NOT_READY (-4)
#define SDM_PROVIDER_E_NOT_AVAILABLE (-5)
#define SDM_PROVIDER_E_BOUNDS (-6)
#define SDM_PROVIDER_E_BAD_HANDLE (-7)
#define SDM_PROVIDER_E_BAD_PLANE (-8)
#define SDM_PROVIDER_E_UNSUPPORTED (-9)
#define SDM_PROVIDER_E_TIMEOUT (-10)
#define SDM_PROVIDER_E_HOST (-11)
#define SDM_PROVIDER_E_PORT_UNAVAILABLE (-12)

/* ---- no-data sentinel -------------------------------------------------- *
 * NOT NaN. WebAssembly does not canonicalize NaN payloads across every
 * producing operation, so two runtimes can hold different bits for "a NaN" and
 * a byte-identical-output assertion would fail on semantically equal values.
 * These have exactly one encoding each and are never a real terrain height.
 */
#define SDM_PROVIDER_NO_DATA_F32_BITS 0xFF7FFFFFu
#define SDM_PROVIDER_NO_DATA_F64_BITS 0xFFEFFFFFFFFFFFFFull

static inline int sdm_provider_is_no_data_f64(double value) {
  uint64_t bits;
  __builtin_memcpy(&bits, &value, sizeof bits);
  return bits == SDM_PROVIDER_NO_DATA_F64_BITS;
}

static inline int sdm_provider_is_no_data_f32(float value) {
  uint32_t bits;
  __builtin_memcpy(&bits, &value, sizeof bits);
  return bits == SDM_PROVIDER_NO_DATA_F32_BITS;
}

/* ---- tile descriptor --------------------------------------------------- *
 * 128 bytes, little-endian. All f64 fields are 8-byte aligned, so this struct
 * is read with ordinary aligned loads on every target.
 */
typedef struct sdm_provider_tile_desc {
  uint32_t magic;           /* 0   SDM_PROVIDER_TILE_DESC_MAGIC */
  uint32_t version;         /* 4   SDM_PROVIDER_ABI_VERSION */
  uint32_t kind;            /* 8 */
  uint32_t encoding;        /* 12 */
  uint32_t width;           /* 16  elements per row */
  uint32_t height;          /* 20  rows */
  uint32_t plane_count;     /* 24 */
  uint32_t bytes_per_element; /* 28 */
  uint32_t row_stride_bytes;  /* 32 */
  uint32_t byte_length;     /* 36  plane 0 */
  uint32_t flags;           /* 40 */
  uint32_t level;           /* 44  0xFFFFFFFF for derived tiles */
  double west;              /* 48  radians */
  double south;             /* 56 */
  double east;              /* 64 */
  double north;             /* 72 */
  double min_value;         /* 80  terrain: min height, metres */
  double max_value;         /* 88  terrain: max height, metres */
  uint32_t tile_x;          /* 96 */
  uint32_t tile_y;          /* 100 */
  uint32_t host_copies;     /* 104 host->guest copies per whole-plane read */
  uint32_t source_id;       /* 108 FNV-1a 32 of the provider id */
  uint32_t cost_class;      /* 112 what this acquire actually cost */
  uint32_t strategy;        /* 116 how the level was chosen */
  uint32_t reserved[2];     /* 120 */
} sdm_provider_tile_desc_t;

_Static_assert(sizeof(sdm_provider_tile_desc_t) == SDM_PROVIDER_TILE_DESC_BYTES,
               "sdm_provider_tile_desc_t must be exactly 128 bytes");

/* ---- imports ----------------------------------------------------------- *
 * Open, read, close. Three doors.
 */

/*
 * Acquire pins a provider's decoded buffer host-side and fills `desc`.
 * `request` is UTF-8 JSON:
 *
 *   {"op":"tile","providerId":"...","level":9,"x":1,"y":2}
 *   {"op":"profile","providerId":"...","start":[lon,lat],"end":[lon,lat],
 *    "samples":256,"level":"mostDetailed"}
 *   {"op":"profile","providerId":"...","positionsPtr":P,"positionsCount":N}
 *   {"op":"region","providerId":"...","rectangle":[w,s,e,n],
 *    "width":256,"height":256,"level":9}
 *
 * plus optional "maxCost" (default 1), "plane", and "spacing" (the target
 * sample spacing in METRES — preferred over "level": you know your own march
 * stride, you do not know a provider's level scheme).
 *
 * RASTER IN: a coverage field is commonly 512x512 = 262,144 positions.
 * Encoding those as JSON would be a multi-megabyte request string parsed on
 * every call — a worse cost than the read it is asking for. Pass
 * "positionsPtr"/"positionsCount" instead and the host reads interleaved f64
 * lon/lat pairs straight out of guest memory with ONE copy, symmetric with the
 * way results come back.
 *
 * Returns a handle > 0, or a negative SDM_PROVIDER_E_* code. `desc` is left
 * untouched on failure. The call blocks until the tile is resident.
 */
__attribute__((import_module(SDM_PROVIDER_IMPORT_MODULE),
               import_name("acquire"))) extern int32_t
sdm_provider_acquire_raw(int32_t request_ptr, int32_t request_len,
                         int32_t desc_ptr);

/*
 * Copies at most `dst_len` bytes of `plane`, starting `src_offset` bytes into
 * that plane, into guest memory at `dst_ptr`. Returns bytes written (which may
 * legally be less than dst_len at the tail), or a negative error code.
 *
 * Reading a plane in several chunks yields exactly the same bytes as one
 * whole-plane read.
 */
__attribute__((import_module(SDM_PROVIDER_IMPORT_MODULE),
               import_name("read"))) extern int32_t
sdm_provider_read_raw(int32_t handle, int32_t plane, int32_t src_offset,
                      int32_t dst_ptr, int32_t dst_len);

/* Unpins. Releasing an already-released handle returns E_BAD_HANDLE. */
__attribute__((import_module(SDM_PROVIDER_IMPORT_MODULE),
               import_name("release"))) extern int32_t
sdm_provider_release(int32_t handle);

/* ---- pointer-friendly wrappers ---------------------------------------- */

static inline int32_t sdm_provider_acquire(const char *request,
                                           int32_t request_len,
                                           sdm_provider_tile_desc_t *desc) {
  return sdm_provider_acquire_raw((int32_t)(uintptr_t)request, request_len,
                                  (int32_t)(uintptr_t)desc);
}

static inline int32_t sdm_provider_read(int32_t handle, int32_t plane,
                                        int32_t src_offset, void *dst,
                                        int32_t dst_len) {
  return sdm_provider_read_raw(handle, plane, src_offset,
                               (int32_t)(uintptr_t)dst, dst_len);
}

static inline int sdm_provider_desc_valid(const sdm_provider_tile_desc_t *desc) {
  return desc != 0 && desc->magic == SDM_PROVIDER_TILE_DESC_MAGIC &&
         desc->version == SDM_PROVIDER_ABI_VERSION;
}

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* SPACE_DATA_PROVIDER_ABI_H */
