// =============================================================================
// Two-body propagator — the playground's WORKED propagator example
// =============================================================================
//
// This is templates/propagator-module/src/__MODULE_NAME_SNAKE__.cpp with its
// two TODO blocks FILLED IN: a closed-form two-body (Keplerian) propagation
// from OMM mean elements to an ECEF state vector.
//
// Why a worked example and not just the scaffold: the scaffold deliberately
// holds the entity motionless, which exercises every byte of the wire contract
// but matches no physical anchor. This file produces numbers that can be
// CHECKED — the playground drives it against the SDK's independent two-body
// reference (src/conformance/twoBodyReference.js, via buildSelfTestCorpus())
// and reports a real Tier-B verdict rather than a green light for a stub.
//
// The model is the corpus's model, stated plainly:
//   two-body point mass, WGS-72 mu, no drag, no J2, no third bodies.
// Anything a real SGP4 does that this does not, it does not claim to do.
//
// Everything OUTSIDE the two marked physics regions is the template's ABI
// plumbing, unchanged. Read the template for why each obligation exists.
// =============================================================================

#include "space_data_module_invoke.h"
#include "orbpro/orbpro_propagator_abi.h"

#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

#define ORBPRO_ABI_EXPORT(name) __attribute__((export_name(name))) extern "C"

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kTwoPi = 2.0 * kPi;
constexpr double kDegToRad = kPi / 180.0;
constexpr double kSecondsPerDay = 86400.0;
constexpr double kJ2000Jd = 2451545.0;

// WGS-72 gravitational parameter, m^3/s^2 — the model OMM mean elements are
// fitted under. Using WGS-84's mu here would shift every semi-major axis by
// metres and fail Tier B for a reason no error message would name.
constexpr double kMu = 398600.8e9;

// Earth rotation rate, rad/s (IAU 1982). Used for the ECI->ECEF velocity
// transport term, which is the half of the frame conversion that is easy to
// forget and impossible to see in a position-only plot.
constexpr double kEarthRotationRate = 7.292115146706979e-5;

constexpr int32_t kOk = 0;
constexpr int32_t kErrNotInitialized = -1;
constexpr int32_t kErrBadEntityIndex = -2;
constexpr int32_t kErrNullOutput = -3;
constexpr int32_t kErrBadInput = -4;
constexpr int32_t kErrNotConverged = -5;
constexpr int32_t kErrUnphysical = -6;

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

std::vector<Entity>* g_entities = nullptr;

std::vector<Entity>& entities() {
  if (g_entities == nullptr) {
    g_entities = new std::vector<Entity>();
  }
  return *g_entities;
}

// --- PHYSICS 1 of 2 ---------------------------------------------------------
// Kepler's equation, M = E - e*sin(E), solved by Newton-Raphson.
//
// Returns false rather than a wrong answer when it does not converge — the
// caller turns that into the ABI's own kErrNotConverged. A propagator that
// returns its last iterate as if it had converged is the silent-wrong-numbers
// failure the whole harness exists to prevent.
bool solve_kepler(double mean_anomaly, double eccentricity, double* out_eccentric) {
  double mean = std::fmod(mean_anomaly, kTwoPi);
  if (mean < 0.0) {
    mean += kTwoPi;
  }
  double ecc_anom = eccentricity < 0.8 ? mean : kPi;
  for (int iteration = 0; iteration < 200; ++iteration) {
    const double f = ecc_anom - eccentricity * std::sin(ecc_anom) - mean;
    const double fp = 1.0 - eccentricity * std::cos(ecc_anom);
    const double delta = f / fp;
    ecc_anom -= delta;
    if (std::fabs(delta) < 1e-15) {
      *out_eccentric = ecc_anom;
      return true;
    }
  }
  return false;
}

// Greenwich Mean Sidereal Time, radians (IAU 1982).
double gmst_radians(double julian_date) {
  const double tut1 = (julian_date - kJ2000Jd) / 36525.0;
  const double seconds = 67310.54841 +
                         (876600.0 * 3600.0 + 8640184.812866) * tut1 +
                         0.093104 * tut1 * tut1 - 6.2e-6 * tut1 * tut1 * tut1;
  double gmst = std::fmod(seconds * (kTwoPi / kSecondsPerDay), kTwoPi);
  if (gmst < 0.0) {
    gmst += kTwoPi;
  }
  return gmst;
}
// --- END PHYSICS 1 of 2 -----------------------------------------------------

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

  // The real semi-major axis, a = (mu / n^2)^(1/3), derived ONCE on the way in
  // — never re-derived per propagate() call. The template's fixed 7000 km
  // placeholder lives here in the scaffold.
  out->semi_major_axis_m =
      std::cbrt(kMu / (mean_motion_rad_s * mean_motion_rad_s));
  return true;
}

// --- PHYSICS 2 of 2 ---------------------------------------------------------
int32_t propagate_entity(const Entity& entity, double julian_date,
                         OrbProStateVector* out) {
  if (entity.semi_major_axis_m <= 0.0 || entity.eccentricity < 0.0 ||
      entity.eccentricity >= 1.0) {
    return kErrUnphysical;
  }

  const double n = entity.mean_motion_rad_s;
  const double a = entity.semi_major_axis_m;
  const double e = entity.eccentricity;
  const double dt_s = (julian_date - entity.epoch_jd) * kSecondsPerDay;
  const double mean_anomaly = entity.mean_anomaly_rad + n * dt_s;

  double ecc_anom = 0.0;
  if (!solve_kepler(mean_anomaly, e, &ecc_anom)) {
    return kErrNotConverged;
  }

  const double cos_e = std::cos(ecc_anom);
  const double sin_e = std::sin(ecc_anom);
  const double beta = std::sqrt(1.0 - e * e);

  // Perifocal (PQW) position and velocity.
  const double x_pqw = a * (cos_e - e);
  const double y_pqw = a * beta * sin_e;
  const double e_dot = n / (1.0 - e * cos_e);
  const double vx_pqw = -a * sin_e * e_dot;
  const double vy_pqw = a * beta * cos_e * e_dot;

  // PQW -> ECI via the 3-1-3 rotation (RAAN, inclination, argument of
  // perigee). Only the first two columns are needed: z_pqw is identically 0.
  const double c_raan = std::cos(entity.raan_rad);
  const double s_raan = std::sin(entity.raan_rad);
  const double c_inc = std::cos(entity.inclination_rad);
  const double s_inc = std::sin(entity.inclination_rad);
  const double c_argp = std::cos(entity.arg_pericenter_rad);
  const double s_argp = std::sin(entity.arg_pericenter_rad);

  const double r11 = c_raan * c_argp - s_raan * s_argp * c_inc;
  const double r12 = -c_raan * s_argp - s_raan * c_argp * c_inc;
  const double r21 = s_raan * c_argp + c_raan * s_argp * c_inc;
  const double r22 = -s_raan * s_argp + c_raan * c_argp * c_inc;
  const double r31 = s_argp * s_inc;
  const double r32 = c_argp * s_inc;

  const double x_eci = r11 * x_pqw + r12 * y_pqw;
  const double y_eci = r21 * x_pqw + r22 * y_pqw;
  const double z_eci = r31 * x_pqw + r32 * y_pqw;
  const double vx_eci = r11 * vx_pqw + r12 * vy_pqw;
  const double vy_eci = r21 * vx_pqw + r22 * vy_pqw;
  const double vz_eci = r31 * vx_pqw + r32 * vy_pqw;

  // ECI -> ECEF. The velocity carries the -omega x r transport term; dropping
  // it leaves a state whose position is right and whose velocity is wrong by
  // hundreds of m/s, which no position plot will ever show you.
  const double theta = gmst_radians(julian_date);
  const double c_t = std::cos(theta);
  const double s_t = std::sin(theta);

  const double x_m = c_t * x_eci + s_t * y_eci;
  const double y_m = -s_t * x_eci + c_t * y_eci;
  const double z_m = z_eci;
  const double vx_rot = c_t * vx_eci + s_t * vy_eci;
  const double vy_rot = -s_t * vx_eci + c_t * vy_eci;
  const double vx_m_s = vx_rot + kEarthRotationRate * y_m;
  const double vy_m_s = vy_rot - kEarthRotationRate * x_m;
  const double vz_m_s = vz_eci;
  // --- END PHYSICS 2 of 2 ---------------------------------------------------

  orbpro_state_init(out);
  out->epoch = julian_date;
  out->position[0] = x_m;
  out->position[1] = y_m;
  out->position[2] = z_m;
  out->velocity[0] = vx_m_s;
  out->velocity[1] = vy_m_s;
  out->velocity[2] = vz_m_s;
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

ORBPRO_ABI_EXPORT("plugin_init")
int32_t plugin_init(const uint8_t* data, size_t len) {
  if (data == nullptr || len == 0) {
    return kErrBadInput;
  }
  if (len % sizeof(OrbProOMMRecord) != 0) {
    return kErrBadInput;
  }
  const uint32_t count = static_cast<uint32_t>(len / sizeof(OrbProOMMRecord));
  return plugin_init_omm(reinterpret_cast<const OrbProOMMRecord*>(data), count);
}

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

ORBPRO_ABI_EXPORT("plugin_propagate")
int32_t plugin_propagate(double julian_date, uint32_t entity_index,
                         OrbProStateVector* out) {
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

ORBPRO_ABI_EXPORT("plugin_propagate_batch")
int32_t plugin_propagate_batch(double julian_date, OrbProStateVector* out,
                               uint32_t count) {
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

ORBPRO_ABI_EXPORT("plugin_entity_count")
int32_t plugin_entity_count(void) {
  return static_cast<int32_t>(entities().size());
}

ORBPRO_ABI_EXPORT("plugin_destroy")
void plugin_destroy(void) {
  delete g_entities;
  g_entities = nullptr;
}

extern "C" int ingest_omm(void) {
  plugin_reset_output_state();

  const plugin_input_frame_t* frame = find_frame("omm");
  if (frame == nullptr || frame->payload == nullptr) {
    plugin_set_error("missing-omm", "An 'omm' input frame is required.");
    return 3;
  }

  // As in the template: this example implements the port's aligned-binary peer
  // only, and REFUSES the canonical $OMM FlatBuffer by name rather than
  // guessing at bytes it cannot read. The keplerian-reference module in
  // space-data-network-modules is the worked FlatBuffer decode.
  if (frame->payload_length >= 8 && frame->payload[4] == '$' &&
      frame->payload[5] == 'O' && frame->payload[6] == 'M' &&
      frame->payload[7] == 'M') {
    plugin_set_error(
        "unimplemented-omm-flatbuffer",
        "This example accepts the aligned-binary OrbProOMMRecord peer only. See "
        "propagator/keplerian-reference for the canonical $OMM decode.");
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
