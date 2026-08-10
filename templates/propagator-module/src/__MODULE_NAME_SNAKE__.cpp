// =============================================================================
// __MODULE_NAME__ — SDN propagator module
// =============================================================================
//
// Scaffolded from space-data-module-sdk's propagator-module template. This
// file implements every OBLIGATION of the official OrbPro WASM propagator
// ABI — exports, wire layout, units, frames, identity, threading discipline,
// error codes, and lifetime — and leaves exactly ONE thing for you to fill
// in: the orbital mechanics inside `propagate_entity()`, marked below.
//
// See README.md in this directory for the full obligation checklist, and
// `orbpro/orbpro_propagator_abi.h` (generated from the pinned
// space-data-module-sdk and inlined into this build by build.js) for the
// normative wire-level contract.
//
// Build: `npm run build` -> dist/isomorphic/module.wasm
//        (SDK compiler lane, clang wasm32-wasip1-threads per the
//         isomorphic-pthreads law; NEVER emcc -pthread)
// =============================================================================

#include "space_data_module_invoke.h"

// The ONE source of the ABI. Generated from schemas/orbpro/Propagator.fbs in
// space-data-module-sdk and inlined here by build.js. Do not retype these
// structs into a local copy — that is exactly the drift this generated
// header exists to end.
#include "orbpro/orbpro_propagator_abi.h"

#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

// -----------------------------------------------------------------------------
// ABI §4 — export macro. `export_name` puts the symbol in the module's
// export table directly. The SDK compiler exports the invoke-surface symbol
// (`ingest_omm` below) for you from plugin-manifest.json; the PROPAGATOR ABI
// entry points are not methodIds, so they announce themselves here.
// -----------------------------------------------------------------------------
#define ORBPRO_ABI_EXPORT(name) __attribute__((export_name(name))) extern "C"

namespace {

constexpr double kTwoPi = 2.0 * 3.14159265358979323846;
constexpr double kDegToRad = 3.14159265358979323846 / 180.0;
constexpr double kSecondsPerDay = 86400.0;

// -----------------------------------------------------------------------------
// ABI §10 — error codes. Every one of these is a NAMED, documented, negative
// return. A propagator that returns -1 for everything is unconformable: the
// host cannot tell a bad entity index from an uninitialized module, so it
// cannot decide whether to retry, skip, or latch.
// -----------------------------------------------------------------------------
constexpr int32_t kOk = 0;
constexpr int32_t kErrNotInitialized = -1;  // no elements ingested yet
constexpr int32_t kErrBadEntityIndex = -2;  // index >= entity count
constexpr int32_t kErrNullOutput = -3;      // caller passed a null out pointer
constexpr int32_t kErrBadInput = -4;        // malformed / short input buffer
constexpr int32_t kErrNotConverged = -5;    // reserved for iterative solvers
constexpr int32_t kErrUnphysical = -6;      // elements describe no orbit

// -----------------------------------------------------------------------------
// ABI §8 — identity. NORAD_CAT_ID is the identity authority and it is
// carried, not invented. The entity index is a LOCAL handle into this
// module's own array; it is returned by ingest and is meaningless outside
// this module instance.
//
// Note what ingest does NOT do: it never derives "the entity I just
// created" as `count - 1`. Ingest RETURNS the handle it assigned
// (`plugin_ingest_omm_one` below) — the create-returns-handle primitive a
// caller can rely on under a threaded host.
// -----------------------------------------------------------------------------
struct Entity {
  uint32_t norad_cat_id = 0;
  double epoch_jd = 0.0;
  double mean_motion_rad_s = 0.0;
  double semi_major_axis_m = 0.0;
  double eccentricity = 0.0;
  double inclination_rad = 0.0;
  double raan_rad = 0.0;
  double arg_pericenter_rad = 0.0;
  double mean_anomaly_rad = 0.0;
};

// The module's entire mutable state. `plugin_destroy` returns this to
// exactly the shape it has at load time — see ABI §11.
std::vector<Entity>* g_entities = nullptr;

std::vector<Entity>& entities() {
  if (g_entities == nullptr) {
    g_entities = new std::vector<Entity>();
  }
  return *g_entities;
}

/// Adopt one binary OMM record into an entity. Angles arrive in DEGREES and
/// mean motion in REV/DAY (ABI §5, OrbProOMMRecord) and are converted once,
/// here, on the way in — never on the way out.
///
/// TODO: your propagation goes here (part 1 of 2).
///
/// This derives only what the placeholder in `propagate_entity()` needs
/// (mean motion + epoch, for the `semi_major_axis_m` placeholder below). A
/// real propagator will typically also want a genuine semi-major axis from
/// mean motion — `a = (mu / n^2)^(1/3)` under whichever gravity model your
/// element source assumes (WGS-72 for TLE-derived mean elements) — and it
/// will use eccentricity and the three orientation angles converted here,
/// exactly as shown, rather than re-deriving them in `propagate_entity()`.
bool adopt_omm(const OrbProOMMRecord& record, Entity* out) {
  const double mean_motion_rad_s = record.mean_motion * kTwoPi / kSecondsPerDay;
  if (!(mean_motion_rad_s > 0.0) || !std::isfinite(mean_motion_rad_s)) {
    return false;
  }
  if (!(record.eccentricity >= 0.0) || record.eccentricity >= 1.0) {
    return false;
  }
  if (!std::isfinite(record.epoch_jd)) {
    return false;
  }

  out->mean_motion_rad_s = mean_motion_rad_s;
  out->epoch_jd = record.epoch_jd;
  out->eccentricity = record.eccentricity;
  out->inclination_rad = record.inclination * kDegToRad;
  out->raan_rad = record.ra_of_asc_node * kDegToRad;
  out->arg_pericenter_rad = record.arg_of_pericenter * kDegToRad;
  out->mean_anomaly_rad = record.mean_anomaly * kDegToRad;
  out->norad_cat_id = record.norad_cat_id;

  // --- BEGIN TODO: your propagation goes here (semi-major axis) -----------
  // Placeholder: a fixed LEO-ish radius so the module has SOMETHING physical
  // to hold still at. Replace with a = (mu / n^2)^(1/3) or your model's
  // equivalent.
  out->semi_major_axis_m = 7000000.0;
  // --- END TODO -------------------------------------------------------------
  return true;
}

/// Propagate one entity to `julian_date` and write an ABI state vector.
///
/// =============================================================================
/// TODO: your propagation goes here (part 2 of 2).
/// =============================================================================
/// Everything above and below this function's TODO block is ABI plumbing you
/// should not need to touch. The block below currently holds the entity
/// motionless at a fixed position — enough to exercise every byte of the
/// wire contract (frame, units, flags) end to end, but not a real orbit.
/// Replace it with real orbital mechanics (SGP4, a numerical integrator,
/// two-body Kepler, whatever your module's family is) and keep writing
/// through `out` exactly as shown below the TODO block: zero the struct
/// first, set position/velocity in METERS and METERS/SECOND, set the frame
/// explicitly, set VALID last.
int32_t propagate_entity(const Entity& entity, double julian_date, OrbProStateVector* out) {
  if (entity.semi_major_axis_m <= 0.0 || entity.eccentricity < 0.0 ||
      entity.eccentricity >= 1.0) {
    return kErrUnphysical;
  }

  // --- BEGIN TODO: your propagation goes here ------------------------------
  const double x_m = entity.semi_major_axis_m;
  const double y_m = 0.0;
  const double z_m = 0.0;
  const double vx_m_s = 0.0;
  const double vy_m_s = 0.0;
  const double vz_m_s = 0.0;
  // --- END TODO --------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // ABI §5/§6/§7/§11 — WRITING THE STATE VECTOR.
  //
  // orbpro_state_init() zeroes the WHOLE struct — including the three
  // reserved bytes at offsets 57..59 the IDL requires to be zero. The host
  // may reuse one scratch buffer across calls, so a partial write leaves the
  // previous call's bytes behind; start from the initializer, always.
  //
  // Units are METERS and METERS/SECOND. There is no km variant.
  // ---------------------------------------------------------------------------
  orbpro_state_init(out);
  out->epoch = julian_date;
  out->position[0] = x_m;
  out->position[1] = y_m;
  out->position[2] = z_m;
  out->velocity[0] = vx_m_s;
  out->velocity[1] = vy_m_s;
  out->velocity[2] = vz_m_s;
  // ABI §7 — FRAMES. Set explicitly, never left implicit, and with the
  // GENERATED setter — not a bare assignment: it clears the three padding
  // bytes a consumer reading offset 56 as a 32-bit word would otherwise see
  // as garbage. Change ORBPRO_FRAME_ECEF if your propagator's native output
  // frame differs — see OrbProReferenceFrame in orbpro_propagator_abi.h for
  // the full vocabulary.
  orbpro_state_set_reference_frame(out, ORBPRO_FRAME_ECEF);
  out->flags |= (uint32_t)ORBPRO_STATE_VALID;
  return kOk;
}

const plugin_input_frame_t* find_frame(const char* port_id) {
  const uint32_t input_count = plugin_get_input_count();
  for (uint32_t index = 0; index < input_count; ++index) {
    const plugin_input_frame_t* frame = plugin_get_input_frame(index);
    if (frame != nullptr && frame->port_id != nullptr &&
        std::strcmp(frame->port_id, port_id) == 0) {
      return frame;
    }
  }
  return nullptr;
}

}  // namespace

// =============================================================================
// ABI §4 — THE EXPORTED SURFACE
//
// Every export below must exist with exactly this name and signature. None
// of them are TODOs — they are the contract a host program links against.
// =============================================================================

/// ABI §4.2 — `plugin_init_omm(records, count)`: the typed ingest. REPLACES
/// the existing element set. Returns the number of entities now held, or a
/// negative error code.
ORBPRO_ABI_EXPORT("plugin_init_omm")
int32_t plugin_init_omm(const OrbProOMMRecord* records, uint32_t count) {
  if (records == nullptr) {
    return kErrBadInput;
  }
  std::vector<Entity>& store = entities();
  store.clear();
  store.reserve(count);
  for (uint32_t index = 0; index < count; ++index) {
    Entity entity{};
    if (!adopt_omm(records[index], &entity)) {
      return kErrBadInput;
    }
    store.push_back(entity);
  }
  return static_cast<int32_t>(store.size());
}

/// ABI §4.1 — `plugin_init(data, len)`. The generic initializer: accepts a
/// packed array of OrbProOMMRecord and refuses anything that is not a whole
/// number of records rather than silently truncating.
///
/// Returns the number of entities initialized (>0), or a negative error code.
ORBPRO_ABI_EXPORT("plugin_init")
int32_t plugin_init(const uint8_t* data, size_t len) {
  if (data == nullptr || len == 0) {
    return kErrBadInput;
  }
  if (len % sizeof(OrbProOMMRecord) != 0) {
    // A partial trailing record means the caller and this module disagree
    // about the struct size. Refusing is the only safe answer.
    return kErrBadInput;
  }
  const uint32_t count = static_cast<uint32_t>(len / sizeof(OrbProOMMRecord));
  return plugin_init_omm(reinterpret_cast<const OrbProOMMRecord*>(data), count);
}

/// ABI §8 — create-returns-handle. Appends ONE record and RETURNS THE HANDLE
/// IT ASSIGNED. A caller never has to derive "the entity I just created"
/// from the count, which is race-unsafe under a threaded host.
ORBPRO_ABI_EXPORT("plugin_ingest_omm_one")
int32_t plugin_ingest_omm_one(const OrbProOMMRecord* record) {
  if (record == nullptr) {
    return kErrBadInput;
  }
  Entity entity{};
  if (!adopt_omm(*record, &entity)) {
    return kErrBadInput;
  }
  std::vector<Entity>& store = entities();
  store.push_back(entity);
  return static_cast<int32_t>(store.size() - 1);
}

/// ABI §4.3 — `plugin_propagate(julian_date, entity_index, out)`.
ORBPRO_ABI_EXPORT("plugin_propagate")
int32_t plugin_propagate(double julian_date, uint32_t entity_index, OrbProStateVector* out) {
  if (out == nullptr) {
    return kErrNullOutput;
  }
  std::vector<Entity>& store = entities();
  if (store.empty()) {
    return kErrNotInitialized;
  }
  if (entity_index >= store.size()) {
    return kErrBadEntityIndex;
  }
  return propagate_entity(store[entity_index], julian_date, out);
}

/// ABI §4.4 / §9 — `plugin_propagate_batch(julian_date, out, count)`.
///
/// SHARD-WRITE DISCIPLINE. This module declares `threadModel:
/// "wasi-sequential"` (see plugin-manifest.json's `sequentialJustification`)
/// — it never spawns a thread of its own. That is the STRONG DEFAULT for a
/// propagator, not a shortcut: propagation is embarrassingly parallel ACROSS
/// entities and strictly sequential WITHIN one, and the ABI puts the
/// sharding decision on the HOST (e.g. a frame-worker pool), never on the
/// module. A module that spawned its own pool here would contend with the
/// pool that is already scheduling it. See docs/propagator-abi.md
/// "Threading".
///
/// Declaring no threading of your own does NOT relax the discipline below —
/// it is exactly what MAKES this plain loop safe to run under ANY sharding a
/// host chooses, including calling it concurrently from multiple workers
/// each with a disjoint `[begin, end)` slice of a larger array:
///
///   - Write ONLY the rows in `[0, count)` you were given here. Never write
///     outside that range, and never assume you own the whole array — a
///     host sharding this call gives every worker the SAME base `out`
///     pointer and a disjoint index range.
///   - Never READ a neighbour's row. This function's output for row `i`
///     must depend only on `store[i]` and `julian_date`, never on any other
///     row or on the order rows are visited in.
///   - Hold NO state across rows (no running totals, no "last entity"
///     cache) — each iteration must be independently correct.
///   - On failure, zero the offending row with `orbpro_state_init()` before
///     returning, so a host that ignores the return value still reads a
///     state marked not-valid rather than stale bytes from a previous call.
///     A partially-written batch with no signal is exactly the
///     silent-wrong-numbers failure this ABI exists to prevent.
///
/// If your propagator genuinely needs its OWN internal parallelism (rare —
/// most do not; the host pool is where batch parallelism belongs), declare
/// `threadModel: "emscripten-pthreads"` instead. Be aware the SDK's
/// post-link artifact guard validates the EMITTED wasm, not the manifest's
/// claim: the `-pthread` compiler flag alone does not satisfy it, because a
/// static link drops the thread-spawn runtime unless your code actually
/// references it (e.g. spawns a `std::thread`). See
/// docs/isomorphic-pthreads.md.
ORBPRO_ABI_EXPORT("plugin_propagate_batch")
int32_t plugin_propagate_batch(double julian_date, OrbProStateVector* out, uint32_t count) {
  if (out == nullptr) {
    return kErrNullOutput;
  }
  std::vector<Entity>& store = entities();
  if (store.empty()) {
    return kErrNotInitialized;
  }
  if (count > store.size()) {
    return kErrBadEntityIndex;
  }
  for (uint32_t index = 0; index < count; ++index) {
    const int32_t status = propagate_entity(store[index], julian_date, &out[index]);
    if (status != kOk) {
      orbpro_state_init(&out[index]);
      return status;
    }
  }
  return kOk;
}

/// ABI §4.5 — how many entities are currently held.
ORBPRO_ABI_EXPORT("plugin_entity_count")
int32_t plugin_entity_count(void) {
  return static_cast<int32_t>(entities().size());
}

/// ABI §11 — `plugin_destroy()`. THIS ONE MUST BE REAL. It releases this
/// module's storage and returns it to exactly its load-time shape, so N
/// cycles of ingest/propagate/destroy return to baseline. A `{}` body here
/// is a leak, not a stub — do not simplify it away.
ORBPRO_ABI_EXPORT("plugin_destroy")
void plugin_destroy(void) {
  delete g_entities;
  g_entities = nullptr;
}

// =============================================================================
// The SDN invoke surface.
//
// One method, `ingest_omm`, declared in plugin-manifest.json with a TYPED
// input port carrying the ratified SDS `$OMM` file identifier. Note what is
// absent: no `acceptsAnyFlatbuffer` wildcard, and no invented 4-byte type. A
// bare (non-`$`) identifier is a vendor invention and a harness must refuse
// it.
//
// This scaffold's ingest_omm ONLY accepts the port's `aligned-binary` peer
// (records already unpacked to the ABI's binary OrbProOMMRecord layout, the
// same shape `plugin_init` takes) — not the canonical FlatBuffer wire form
// the manifest also declares. That is a deliberate simplification to keep
// this file readable as a starting point; a host that only ever sends the
// canonical FlatBuffer form will get "invalid-omm" from this code as
// written. If you need to honor both wire formats, decode the FlatBuffer
// table yourself — the reference propagator this template is derived from
// (space-data-network/propagator/keplerian-reference) is the worked example
// of a small, hand-rolled, dependency-free vtable reader for `$OMM`.
// =============================================================================

extern "C" int ingest_omm(void) {
  plugin_reset_output_state();

  const plugin_input_frame_t* frame = find_frame("omm");
  if (frame == nullptr || frame->payload == nullptr) {
    plugin_set_error("missing-omm", "An 'omm' input frame is required.");
    return 3;
  }

  // ---------------------------------------------------------------------------
  // TODO(you): decode the CANONICAL $OMM FlatBuffer.
  //
  // The manifest declares this port as ratified SDS `$OMM` in BOTH its
  // canonical FlatBuffer form and its aligned-binary peer, because the
  // validator requires the pair. This scaffold only implements the
  // aligned-binary peer.
  //
  // So it REFUSES the canonical form explicitly, rather than accepting bytes
  // it cannot read. Declaring a typed port and then not honouring it is the
  // defect this harness exists to prevent — a propagator that guesses at
  // unknown bytes produces confident, silently wrong numbers, and no runtime
  // check can catch it.
  //
  // The reference implementation shows the decode:
  //   space-data-network-modules/propagator/keplerian-reference/
  //     src/keplerian_reference_module.cpp   (FlatTable + decode_omm_flatbuffer)
  //     build.js                             (vtable slots derived from the
  //                                           PINNED SDS schema, never hand-typed)
  //
  // Copy it, or drop the canonical entry from your manifest and accept the
  // narrower contract. Do not delete this refusal and hope.
  // ---------------------------------------------------------------------------
  if (frame->payload_length >= 8 && frame->payload[4] == '$' &&
      frame->payload[5] == 'O' && frame->payload[6] == 'M' &&
      frame->payload[7] == 'M') {
    plugin_set_error(
        "unimplemented-omm-flatbuffer",
        "This module declares the canonical $OMM FlatBuffer on its 'omm' port but "
        "does not decode it yet. See the TODO in ingest_omm and the reference "
        "implementation's decode_omm_flatbuffer().");
    return 3;
  }

  if (frame->payload_length == 0 ||
      frame->payload_length % sizeof(OrbProOMMRecord) != 0) {
    plugin_set_error(
        "invalid-omm",
        "The 'omm' payload must be a whole number of 88-byte OrbProOMMRecord entries.");
    return 3;
  }

  const uint32_t count =
      static_cast<uint32_t>(frame->payload_length / sizeof(OrbProOMMRecord));
  const int32_t ingested =
      plugin_init_omm(reinterpret_cast<const OrbProOMMRecord*>(frame->payload), count);
  if (ingested < 0) {
    plugin_set_error("unphysical-omm", "One or more OMM records describe no closed orbit.");
    return 3;
  }
  return 0;
}
