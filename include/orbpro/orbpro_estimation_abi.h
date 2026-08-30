/* ===========================================================================
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source of truth : schemas/orbpro/Estimation.fbs
 * Generator       : shared schema ABI renderer
 * Drift gate      : analysis/estimation/tests/abi_schema_lock.test.mjs  (runs in `npm test`)
 * Contract        : docs/families/estimation.md
 *
 * Edit the .fbs and regenerate. A hand edit here is erased by the next run and
 * failed by the gate in between — which is the point: this file existing in
 * five hand-maintained copies is the drift that
 * graph/findings/official-harness-shapes.md §3 forbids.
 * ===========================================================================
 */

#ifndef ORBPRO_ESTIMATION_ABI_H
#define ORBPRO_ESTIMATION_ABI_H

#include <stdint.h>
#include <stddef.h> /* offsetof */
#include "orbpro/orbpro_propagator_abi.h"

/* Fixed-layout estimation ABI; valid in C and C++. */
#if defined(__cplusplus)
#define ORBPRO_ABI_STATIC_ASSERT(cond, msg) static_assert(cond, msg)
#else
#define ORBPRO_ABI_STATIC_ASSERT(cond, msg) _Static_assert(cond, msg)
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* ========================================================================= */
/* MeasurementKind */
/* ========================================================================= */

/** MeasurementKind */
typedef enum {
    ORBPRO_MEASUREMENT_RANGE = 0,
    ORBPRO_MEASUREMENT_RANGE_RATE = 1,
    ORBPRO_MEASUREMENT_DOPPLER = 2,
    ORBPRO_MEASUREMENT_AZIMUTH_ELEVATION = 3,
    ORBPRO_MEASUREMENT_X_EAST_Y_NORTH = 4,
    ORBPRO_MEASUREMENT_X_SOUTH_Y_EAST = 5,
    ORBPRO_MEASUREMENT_RIGHT_ASCENSION_DECLINATION = 6,
    ORBPRO_MEASUREMENT_POSITION_VECTOR = 7,
    ORBPRO_MEASUREMENT_SEQUENTIAL_RANGE = 8,
    ORBPRO_MEASUREMENT_PSEUDONOISE_RANGE = 9,
    ORBPRO_MEASUREMENT_TIME_CORRELATED_PHASE = 10,
    ORBPRO_MEASUREMENT_RELAY_RANGE = 11,
    ORBPRO_MEASUREMENT_RELAY_DOPPLER = 12,
    ORBPRO_MEASUREMENT_RELAY_DIFFERENCED_DOPPLER = 13,
    ORBPRO_MEASUREMENT_BISTATIC_RANGE = 14,
    ORBPRO_MEASUREMENT_SKIN_RANGE = 15,
    ORBPRO_MEASUREMENT_CROSSLINK_RANGE = 16,
    ORBPRO_MEASUREMENT_CROSSLINK_RANGE_RATE = 17,
    ORBPRO_MEASUREMENT_LASER_RANGE = 18,
    ORBPRO_MEASUREMENT_TIME_DIFFERENCE_OF_ARRIVAL = 19,
    ORBPRO_MEASUREMENT_FREQUENCY_DIFFERENCE_OF_ARRIVAL = 20,
} OrbProMeasurementKind;

/* ========================================================================= */
/* TroposphereKind */
/* ========================================================================= */

/** TroposphereKind */
typedef enum {
    ORBPRO_TROPOSPHERE_NONE = 0,
    ORBPRO_TROPOSPHERE_HOPFIELD_SAASTAMOINEN = 1,
    ORBPRO_TROPOSPHERE_MARINI = 2,
} OrbProTroposphereKind;

/* ========================================================================= */
/* IonosphereKind */
/* ========================================================================= */

/** IonosphereKind */
typedef enum {
    ORBPRO_IONOSPHERE_NONE = 0,
    ORBPRO_IONOSPHERE_TOTAL_ELECTRON_CONTENT = 1,
    ORBPRO_IONOSPHERE_REFERENCE_PROFILE = 2,
} OrbProIonosphereKind;

/* ========================================================================= */
/* EstimatorKind */
/* ========================================================================= */

/** EstimatorKind */
typedef enum {
    ORBPRO_ESTIMATOR_BATCH_WEIGHTED_LEAST_SQUARES = 0,
    ORBPRO_ESTIMATOR_EXTENDED_KALMAN_FILTER = 1,
    ORBPRO_ESTIMATOR_UNSCENTED_KALMAN_FILTER = 2,
    ORBPRO_ESTIMATOR_EXTENDED_KALMAN_FILTER_WITH_RTS = 3,
} OrbProEstimatorKind;

/* ========================================================================= */
/* ProcessNoiseKind */
/* ========================================================================= */

/** ProcessNoiseKind */
typedef enum {
    ORBPRO_PROCESS_NOISE_NONE = 0,
    ORBPRO_PROCESS_NOISE_STATE_NOISE_COMPENSATION = 1,
    ORBPRO_PROCESS_NOISE_DYNAMIC_MODEL_COMPENSATION = 2,
} OrbProProcessNoiseKind;

/* ========================================================================= */
/* InitialOrbitKind */
/* ========================================================================= */

/** InitialOrbitKind */
typedef enum {
    ORBPRO_IOD_GAUSS = 0,
    ORBPRO_IOD_LAPLACE = 1,
    ORBPRO_IOD_GIBBS = 2,
    ORBPRO_IOD_HERRICK_GIBBS = 3,
} OrbProInitialOrbitKind;

/* ========================================================================= */
/* EstimationStatus */
/* ========================================================================= */

/** EstimationStatus */
typedef enum {
    ORBPRO_ESTIMATION_INTERNAL = -20,
    ORBPRO_ESTIMATION_PROPAGATOR_PROTOCOL = -19,
    ORBPRO_ESTIMATION_BUFFER_TOO_SMALL = -18,
    ORBPRO_ESTIMATION_NOT_CONVERGED = -5,
    ORBPRO_ESTIMATION_BAD_INPUT = -4,
    ORBPRO_ESTIMATION_NULL_OUTPUT = -3,
    ORBPRO_ESTIMATION_NOT_CONFIGURED = -1,
    ORBPRO_ESTIMATION_OK = 0,
} OrbProEstimationStatus;

/* ========================================================================= */
/* OrbProEstimationEpoch — 16 bytes, 8-byte aligned */
/* ========================================================================= */

/**
 *
 * Binary layout (derived from the IDL, not hand-written):
 *
 *   Offset  Size  Field
 *   ------  ----  -----------------------------------------
 *        0     8  jd_day
 *        8     8  seconds
 */
typedef struct {
    double jd_day;
    double seconds;
} OrbProEstimationEpoch;

ORBPRO_ABI_STATIC_ASSERT(sizeof(OrbProEstimationEpoch) == 16,
    "OrbProEstimationEpoch must be 16 bytes");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationEpoch, jd_day) == 0,
    "OrbProEstimationEpoch.jd_day must be at offset 0");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationEpoch, seconds) == 8,
    "OrbProEstimationEpoch.seconds must be at offset 8");

/**
 * Zero an entire OrbProEstimationEpoch, INCLUDING its alignment padding.
 * Start every write here — see the note above about scratch buffers.
 */
static inline void orbpro_estimation_epoch_init(OrbProEstimationEpoch* value) {
    for (size_t i = 0; i < sizeof(*value); ++i) {
        ((unsigned char*)value)[i] = 0;
    }
}

/* ========================================================================= */
/* OrbProEstimationObservation — 376 bytes, 8-byte aligned */
/* ========================================================================= */

/**
 * One observation in SI units. The first value_count lanes of value and
 * sigma are meaningful. station_position_m is in the request frame.
 *
 * Binary layout (derived from the IDL, not hand-written):
 *
 *   Offset  Size  Field
 *   ------  ----  -----------------------------------------
 *        0    16  epoch
 *       16    32  value
 *       48    32  sigma
 *       80    24  station_position_m
 *      104    24  station_velocity_mps
 *      128    24  station_east
 *      152    24  station_north
 *      176    24  station_up
 *      200    24  remote_position_m
 *      224    24  remote_velocity_mps
 *      248     8  frequency_hz
 *      256     8  transmitter_delay_seconds
 *      264     8  receiver_delay_seconds
 *      272     8  transponder_delay_seconds
 *      280     8  elevation_rad
 *      288     8  station_latitude_rad
 *      296     8  station_height_m
 *      304     8  pressure_hpa
 *      312     8  temperature_k
 *      320     8  relative_humidity
 *      328     8  wavelength_m
 *      336     8  total_electron_content
 *      344     8  total_electron_content_rate_per_second
 *      352     4  turnaround_numerator
 *      356     4  turnaround_denominator
 *      360     2  kind
 *      362     1  value_count
 *      363     1  flags
 *      364     4  transmitter_index
 *      368     4  receiver_index
 *      372     4  (alignment padding — MUST be written as zero)
 */
typedef struct {
    double epoch[2];
    double value[4];
    double sigma[4];
    double station_position_m[3];
    double station_velocity_mps[3];
    double station_east[3];
    double station_north[3];
    double station_up[3];
    double remote_position_m[3];
    double remote_velocity_mps[3];
    double frequency_hz;
    double transmitter_delay_seconds;
    double receiver_delay_seconds;
    double transponder_delay_seconds;
    double elevation_rad;
    double station_latitude_rad;
    double station_height_m;
    double pressure_hpa;
    double temperature_k;
    double relative_humidity;
    double wavelength_m;
    double total_electron_content;
    double total_electron_content_rate_per_second;
    uint32_t turnaround_numerator;
    uint32_t turnaround_denominator;
    uint16_t kind;
    uint8_t value_count;
    uint8_t flags;
    uint32_t transmitter_index;
    uint32_t receiver_index;
    uint8_t _reserved[4]; /**< Alignment padding at offset 372. MUST be 0. */
} OrbProEstimationObservation;

ORBPRO_ABI_STATIC_ASSERT(sizeof(OrbProEstimationObservation) == 376,
    "OrbProEstimationObservation must be 376 bytes");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, epoch) == 0,
    "OrbProEstimationObservation.epoch must be at offset 0");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, value) == 16,
    "OrbProEstimationObservation.value must be at offset 16");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, sigma) == 48,
    "OrbProEstimationObservation.sigma must be at offset 48");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, station_position_m) == 80,
    "OrbProEstimationObservation.station_position_m must be at offset 80");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, station_velocity_mps) == 104,
    "OrbProEstimationObservation.station_velocity_mps must be at offset 104");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, station_east) == 128,
    "OrbProEstimationObservation.station_east must be at offset 128");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, station_north) == 152,
    "OrbProEstimationObservation.station_north must be at offset 152");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, station_up) == 176,
    "OrbProEstimationObservation.station_up must be at offset 176");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, remote_position_m) == 200,
    "OrbProEstimationObservation.remote_position_m must be at offset 200");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, remote_velocity_mps) == 224,
    "OrbProEstimationObservation.remote_velocity_mps must be at offset 224");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, frequency_hz) == 248,
    "OrbProEstimationObservation.frequency_hz must be at offset 248");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, transmitter_delay_seconds) == 256,
    "OrbProEstimationObservation.transmitter_delay_seconds must be at offset 256");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, receiver_delay_seconds) == 264,
    "OrbProEstimationObservation.receiver_delay_seconds must be at offset 264");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, transponder_delay_seconds) == 272,
    "OrbProEstimationObservation.transponder_delay_seconds must be at offset 272");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, elevation_rad) == 280,
    "OrbProEstimationObservation.elevation_rad must be at offset 280");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, station_latitude_rad) == 288,
    "OrbProEstimationObservation.station_latitude_rad must be at offset 288");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, station_height_m) == 296,
    "OrbProEstimationObservation.station_height_m must be at offset 296");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, pressure_hpa) == 304,
    "OrbProEstimationObservation.pressure_hpa must be at offset 304");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, temperature_k) == 312,
    "OrbProEstimationObservation.temperature_k must be at offset 312");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, relative_humidity) == 320,
    "OrbProEstimationObservation.relative_humidity must be at offset 320");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, wavelength_m) == 328,
    "OrbProEstimationObservation.wavelength_m must be at offset 328");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, total_electron_content) == 336,
    "OrbProEstimationObservation.total_electron_content must be at offset 336");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, total_electron_content_rate_per_second) == 344,
    "OrbProEstimationObservation.total_electron_content_rate_per_second must be at offset 344");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, turnaround_numerator) == 352,
    "OrbProEstimationObservation.turnaround_numerator must be at offset 352");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, turnaround_denominator) == 356,
    "OrbProEstimationObservation.turnaround_denominator must be at offset 356");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, kind) == 360,
    "OrbProEstimationObservation.kind must be at offset 360");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, value_count) == 362,
    "OrbProEstimationObservation.value_count must be at offset 362");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, flags) == 363,
    "OrbProEstimationObservation.flags must be at offset 363");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, transmitter_index) == 364,
    "OrbProEstimationObservation.transmitter_index must be at offset 364");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationObservation, receiver_index) == 368,
    "OrbProEstimationObservation.receiver_index must be at offset 368");

/**
 * Zero an entire OrbProEstimationObservation, INCLUDING its alignment padding.
 * Start every write here — see the note above about scratch buffers.
 */
static inline void orbpro_estimation_observation_init(OrbProEstimationObservation* value) {
    for (size_t i = 0; i < sizeof(*value); ++i) {
        ((unsigned char*)value)[i] = 0;
    }
}

/**
 * Set OrbProEstimationObservation.kind AND clear the 0 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_estimation_observation_set_kind(OrbProEstimationObservation* value, OrbProMeasurementKind v) {
    value->kind = (uint16_t)v;
}

/* ========================================================================= */
/* OrbProEstimationErrorModel — 72 bytes, 8-byte aligned */
/* ========================================================================= */

/**
 *
 * Binary layout (derived from the IDL, not hand-written):
 *
 *   Offset  Size  Field
 *   ------  ----  -----------------------------------------
 *        0     8  noise_sigma
 *        8     8  bias
 *       16     8  bias_sigma
 *       24     8  correlation_time_seconds
 *       32     8  minimum_value
 *       40     8  maximum_value
 *       48     8  sigma_edit_threshold
 *       56     8  random_seed
 *       64     2  measurement_kind
 *       66     1  troposphere
 *       67     1  ionosphere
 *       68     1  flags
 *       69     3  (alignment padding — MUST be written as zero)
 */
typedef struct {
    double noise_sigma;
    double bias;
    double bias_sigma;
    double correlation_time_seconds;
    double minimum_value;
    double maximum_value;
    double sigma_edit_threshold;
    uint64_t random_seed;
    uint16_t measurement_kind;
    uint8_t troposphere;
    uint8_t ionosphere;
    uint8_t flags;
    uint8_t _reserved[3]; /**< Alignment padding at offset 69. MUST be 0. */
} OrbProEstimationErrorModel;

ORBPRO_ABI_STATIC_ASSERT(sizeof(OrbProEstimationErrorModel) == 72,
    "OrbProEstimationErrorModel must be 72 bytes");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationErrorModel, noise_sigma) == 0,
    "OrbProEstimationErrorModel.noise_sigma must be at offset 0");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationErrorModel, bias) == 8,
    "OrbProEstimationErrorModel.bias must be at offset 8");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationErrorModel, bias_sigma) == 16,
    "OrbProEstimationErrorModel.bias_sigma must be at offset 16");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationErrorModel, correlation_time_seconds) == 24,
    "OrbProEstimationErrorModel.correlation_time_seconds must be at offset 24");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationErrorModel, minimum_value) == 32,
    "OrbProEstimationErrorModel.minimum_value must be at offset 32");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationErrorModel, maximum_value) == 40,
    "OrbProEstimationErrorModel.maximum_value must be at offset 40");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationErrorModel, sigma_edit_threshold) == 48,
    "OrbProEstimationErrorModel.sigma_edit_threshold must be at offset 48");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationErrorModel, random_seed) == 56,
    "OrbProEstimationErrorModel.random_seed must be at offset 56");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationErrorModel, measurement_kind) == 64,
    "OrbProEstimationErrorModel.measurement_kind must be at offset 64");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationErrorModel, troposphere) == 66,
    "OrbProEstimationErrorModel.troposphere must be at offset 66");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationErrorModel, ionosphere) == 67,
    "OrbProEstimationErrorModel.ionosphere must be at offset 67");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationErrorModel, flags) == 68,
    "OrbProEstimationErrorModel.flags must be at offset 68");

/**
 * Zero an entire OrbProEstimationErrorModel, INCLUDING its alignment padding.
 * Start every write here — see the note above about scratch buffers.
 */
static inline void orbpro_estimation_error_model_init(OrbProEstimationErrorModel* value) {
    for (size_t i = 0; i < sizeof(*value); ++i) {
        ((unsigned char*)value)[i] = 0;
    }
}

/**
 * Set OrbProEstimationErrorModel.measurement_kind AND clear the 0 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_estimation_error_model_set_measurement_kind(OrbProEstimationErrorModel* value, OrbProMeasurementKind v) {
    value->measurement_kind = (uint16_t)v;
}

/**
 * Set OrbProEstimationErrorModel.troposphere AND clear the 0 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_estimation_error_model_set_troposphere(OrbProEstimationErrorModel* value, OrbProTroposphereKind v) {
    value->troposphere = (uint8_t)v;
}

/**
 * Set OrbProEstimationErrorModel.ionosphere AND clear the 0 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_estimation_error_model_set_ionosphere(OrbProEstimationErrorModel* value, OrbProIonosphereKind v) {
    value->ionosphere = (uint8_t)v;
}

/* ========================================================================= */
/* OrbProEstimationConfig — 448 bytes, 8-byte aligned */
/* ========================================================================= */

/**
 * Fixed configuration copied byte-for-byte in every runtime. initial_state
 * is Cartesian [x,y,z,vx,vy,vz] in metres and metres per second; covariance
 * is row-major 6 by 6 in matching SI units.
 *
 * Binary layout (derived from the IDL, not hand-written):
 *
 *   Offset  Size  Field
 *   ------  ----  -----------------------------------------
 *        0    16  initial_epoch
 *       16    48  initial_state
 *       64   288  initial_covariance
 *      352    48  process_noise_spectral_density
 *      400     8  state_convergence_tolerance
 *      408     8  rms_convergence_tolerance
 *      416     8  sigma_edit_threshold
 *      424     8  dynamic_model_correlation_time_seconds
 *      432     4  maximum_iterations
 *      436     1  reference_frame
 *      437     1  estimator
 *      438     1  process_noise
 *      439     1  (alignment padding — MUST be written as zero)
 *      440     2  flags
 *      442     6  (alignment padding — MUST be written as zero)
 */
typedef struct {
    double initial_epoch[2];
    double initial_state[6];
    double initial_covariance[36];
    double process_noise_spectral_density[6];
    double state_convergence_tolerance;
    double rms_convergence_tolerance;
    double sigma_edit_threshold;
    double dynamic_model_correlation_time_seconds;
    uint32_t maximum_iterations;
    uint8_t reference_frame;
    uint8_t estimator;
    uint8_t process_noise;
    uint8_t _reserved[1]; /**< Alignment padding at offset 439. MUST be 0. */
    uint16_t flags;
    uint8_t _reserved1[6]; /**< Alignment padding at offset 442. MUST be 0. */
} OrbProEstimationConfig;

ORBPRO_ABI_STATIC_ASSERT(sizeof(OrbProEstimationConfig) == 448,
    "OrbProEstimationConfig must be 448 bytes");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationConfig, initial_epoch) == 0,
    "OrbProEstimationConfig.initial_epoch must be at offset 0");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationConfig, initial_state) == 16,
    "OrbProEstimationConfig.initial_state must be at offset 16");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationConfig, initial_covariance) == 64,
    "OrbProEstimationConfig.initial_covariance must be at offset 64");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationConfig, process_noise_spectral_density) == 352,
    "OrbProEstimationConfig.process_noise_spectral_density must be at offset 352");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationConfig, state_convergence_tolerance) == 400,
    "OrbProEstimationConfig.state_convergence_tolerance must be at offset 400");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationConfig, rms_convergence_tolerance) == 408,
    "OrbProEstimationConfig.rms_convergence_tolerance must be at offset 408");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationConfig, sigma_edit_threshold) == 416,
    "OrbProEstimationConfig.sigma_edit_threshold must be at offset 416");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationConfig, dynamic_model_correlation_time_seconds) == 424,
    "OrbProEstimationConfig.dynamic_model_correlation_time_seconds must be at offset 424");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationConfig, maximum_iterations) == 432,
    "OrbProEstimationConfig.maximum_iterations must be at offset 432");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationConfig, reference_frame) == 436,
    "OrbProEstimationConfig.reference_frame must be at offset 436");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationConfig, estimator) == 437,
    "OrbProEstimationConfig.estimator must be at offset 437");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationConfig, process_noise) == 438,
    "OrbProEstimationConfig.process_noise must be at offset 438");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationConfig, flags) == 440,
    "OrbProEstimationConfig.flags must be at offset 440");

/**
 * Zero an entire OrbProEstimationConfig, INCLUDING its alignment padding.
 * Start every write here — see the note above about scratch buffers.
 */
static inline void orbpro_estimation_config_init(OrbProEstimationConfig* value) {
    for (size_t i = 0; i < sizeof(*value); ++i) {
        ((unsigned char*)value)[i] = 0;
    }
}

/**
 * Set OrbProEstimationConfig.reference_frame AND clear the 0 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_estimation_config_set_reference_frame(OrbProEstimationConfig* value, uint8_t v) {
    value->reference_frame = (uint8_t)v;
}

/**
 * Set OrbProEstimationConfig.estimator AND clear the 0 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_estimation_config_set_estimator(OrbProEstimationConfig* value, OrbProEstimatorKind v) {
    value->estimator = (uint8_t)v;
}

/**
 * Set OrbProEstimationConfig.process_noise AND clear the 1 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_estimation_config_set_process_noise(OrbProEstimationConfig* value, OrbProProcessNoiseKind v) {
    value->process_noise = (uint8_t)v;
    ((unsigned char*)value)[439] = 0;
}

/* ========================================================================= */
/* OrbProEstimationState — 384 bytes, 8-byte aligned */
/* ========================================================================= */

/**
 *
 * Binary layout (derived from the IDL, not hand-written):
 *
 *   Offset  Size  Field
 *   ------  ----  -----------------------------------------
 *        0    16  epoch
 *       16    48  state
 *       64   288  covariance
 *      352     8  residual_rms
 *      360     8  recovered_noise_sigma
 *      368     4  iteration_count
 *      372     4  accepted_count
 *      376     4  rejected_count
 *      380     1  reference_frame
 *      381     1  converged
 *      382     1  smoothed
 *      383     1  estimator
 */
typedef struct {
    double epoch[2];
    double state[6];
    double covariance[36];
    double residual_rms;
    double recovered_noise_sigma;
    uint32_t iteration_count;
    uint32_t accepted_count;
    uint32_t rejected_count;
    uint8_t reference_frame;
    uint8_t converged;
    uint8_t smoothed;
    uint8_t estimator;
} OrbProEstimationState;

ORBPRO_ABI_STATIC_ASSERT(sizeof(OrbProEstimationState) == 384,
    "OrbProEstimationState must be 384 bytes");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationState, epoch) == 0,
    "OrbProEstimationState.epoch must be at offset 0");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationState, state) == 16,
    "OrbProEstimationState.state must be at offset 16");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationState, covariance) == 64,
    "OrbProEstimationState.covariance must be at offset 64");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationState, residual_rms) == 352,
    "OrbProEstimationState.residual_rms must be at offset 352");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationState, recovered_noise_sigma) == 360,
    "OrbProEstimationState.recovered_noise_sigma must be at offset 360");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationState, iteration_count) == 368,
    "OrbProEstimationState.iteration_count must be at offset 368");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationState, accepted_count) == 372,
    "OrbProEstimationState.accepted_count must be at offset 372");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationState, rejected_count) == 376,
    "OrbProEstimationState.rejected_count must be at offset 376");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationState, reference_frame) == 380,
    "OrbProEstimationState.reference_frame must be at offset 380");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationState, converged) == 381,
    "OrbProEstimationState.converged must be at offset 381");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationState, smoothed) == 382,
    "OrbProEstimationState.smoothed must be at offset 382");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationState, estimator) == 383,
    "OrbProEstimationState.estimator must be at offset 383");

/**
 * Zero an entire OrbProEstimationState, INCLUDING its alignment padding.
 * Start every write here — see the note above about scratch buffers.
 */
static inline void orbpro_estimation_state_init(OrbProEstimationState* value) {
    for (size_t i = 0; i < sizeof(*value); ++i) {
        ((unsigned char*)value)[i] = 0;
    }
}

/**
 * Set OrbProEstimationState.reference_frame AND clear the 0 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_estimation_state_set_reference_frame(OrbProEstimationState* value, uint8_t v) {
    value->reference_frame = (uint8_t)v;
}

/**
 * Set OrbProEstimationState.estimator AND clear the 0 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_estimation_state_set_estimator(OrbProEstimationState* value, OrbProEstimatorKind v) {
    value->estimator = (uint8_t)v;
}

/* ========================================================================= */
/* OrbProFilterEpoch — 696 bytes, 8-byte aligned */
/* ========================================================================= */

/**
 *
 * Binary layout (derived from the IDL, not hand-written):
 *
 *   Offset  Size  Field
 *   ------  ----  -----------------------------------------
 *        0    16  epoch
 *       16    48  filtered_state
 *       64   288  filtered_covariance
 *      352    48  smoothed_state
 *      400   288  smoothed_covariance
 *      688     8  normalized_innovation_squared
 */
typedef struct {
    double epoch[2];
    double filtered_state[6];
    double filtered_covariance[36];
    double smoothed_state[6];
    double smoothed_covariance[36];
    double normalized_innovation_squared;
} OrbProFilterEpoch;

ORBPRO_ABI_STATIC_ASSERT(sizeof(OrbProFilterEpoch) == 696,
    "OrbProFilterEpoch must be 696 bytes");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProFilterEpoch, epoch) == 0,
    "OrbProFilterEpoch.epoch must be at offset 0");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProFilterEpoch, filtered_state) == 16,
    "OrbProFilterEpoch.filtered_state must be at offset 16");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProFilterEpoch, filtered_covariance) == 64,
    "OrbProFilterEpoch.filtered_covariance must be at offset 64");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProFilterEpoch, smoothed_state) == 352,
    "OrbProFilterEpoch.smoothed_state must be at offset 352");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProFilterEpoch, smoothed_covariance) == 400,
    "OrbProFilterEpoch.smoothed_covariance must be at offset 400");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProFilterEpoch, normalized_innovation_squared) == 688,
    "OrbProFilterEpoch.normalized_innovation_squared must be at offset 688");

/**
 * Zero an entire OrbProFilterEpoch, INCLUDING its alignment padding.
 * Start every write here — see the note above about scratch buffers.
 */
static inline void orbpro_filter_epoch_init(OrbProFilterEpoch* value) {
    for (size_t i = 0; i < sizeof(*value); ++i) {
        ((unsigned char*)value)[i] = 0;
    }
}

/* ========================================================================= */
/* OrbProEstimationPropagatorSample — 352 bytes, 8-byte aligned */
/* ========================================================================= */

/**
 * State and state-transition matrix supplied by the propagator port. The STM
 * maps deviations at the estimator epoch to this sample epoch.
 *
 * Binary layout (derived from the IDL, not hand-written):
 *
 *   Offset  Size  Field
 *   ------  ----  -----------------------------------------
 *        0    16  epoch
 *       16    48  state
 *       64   288  stm
 */
typedef struct {
    double epoch[2];
    double state[6];
    double stm[36];
} OrbProEstimationPropagatorSample;

ORBPRO_ABI_STATIC_ASSERT(sizeof(OrbProEstimationPropagatorSample) == 352,
    "OrbProEstimationPropagatorSample must be 352 bytes");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationPropagatorSample, epoch) == 0,
    "OrbProEstimationPropagatorSample.epoch must be at offset 0");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationPropagatorSample, state) == 16,
    "OrbProEstimationPropagatorSample.state must be at offset 16");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEstimationPropagatorSample, stm) == 64,
    "OrbProEstimationPropagatorSample.stm must be at offset 64");

/**
 * Zero an entire OrbProEstimationPropagatorSample, INCLUDING its alignment padding.
 * Start every write here — see the note above about scratch buffers.
 */
static inline void orbpro_estimation_propagator_sample_init(OrbProEstimationPropagatorSample* value) {
    for (size_t i = 0; i < sizeof(*value); ++i) {
        ((unsigned char*)value)[i] = 0;
    }
}

/* ========================================================================= */
/* OrbProInitialOrbitRequest — 240 bytes, 8-byte aligned */
/* ========================================================================= */

/**
 *
 * Binary layout (derived from the IDL, not hand-written):
 *
 *   Offset  Size  Field
 *   ------  ----  -----------------------------------------
 *        0    72  positions_m
 *       72    72  observer_positions_m
 *      144    24  right_ascensions_rad
 *      168    24  declinations_rad
 *      192    16  epochs
 *      208     8  interval_12_seconds
 *      216     8  interval_23_seconds
 *      224     8  gravitational_parameter_m3_s2
 *      232     1  method
 *      233     7  (alignment padding — MUST be written as zero)
 */
typedef struct {
    double positions_m[9];
    double observer_positions_m[9];
    double right_ascensions_rad[3];
    double declinations_rad[3];
    double epochs[2];
    double interval_12_seconds;
    double interval_23_seconds;
    double gravitational_parameter_m3_s2;
    uint8_t method;
    uint8_t _reserved[7]; /**< Alignment padding at offset 233. MUST be 0. */
} OrbProInitialOrbitRequest;

ORBPRO_ABI_STATIC_ASSERT(sizeof(OrbProInitialOrbitRequest) == 240,
    "OrbProInitialOrbitRequest must be 240 bytes");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProInitialOrbitRequest, positions_m) == 0,
    "OrbProInitialOrbitRequest.positions_m must be at offset 0");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProInitialOrbitRequest, observer_positions_m) == 72,
    "OrbProInitialOrbitRequest.observer_positions_m must be at offset 72");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProInitialOrbitRequest, right_ascensions_rad) == 144,
    "OrbProInitialOrbitRequest.right_ascensions_rad must be at offset 144");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProInitialOrbitRequest, declinations_rad) == 168,
    "OrbProInitialOrbitRequest.declinations_rad must be at offset 168");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProInitialOrbitRequest, epochs) == 192,
    "OrbProInitialOrbitRequest.epochs must be at offset 192");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProInitialOrbitRequest, interval_12_seconds) == 208,
    "OrbProInitialOrbitRequest.interval_12_seconds must be at offset 208");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProInitialOrbitRequest, interval_23_seconds) == 216,
    "OrbProInitialOrbitRequest.interval_23_seconds must be at offset 216");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProInitialOrbitRequest, gravitational_parameter_m3_s2) == 224,
    "OrbProInitialOrbitRequest.gravitational_parameter_m3_s2 must be at offset 224");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProInitialOrbitRequest, method) == 232,
    "OrbProInitialOrbitRequest.method must be at offset 232");

/**
 * Zero an entire OrbProInitialOrbitRequest, INCLUDING its alignment padding.
 * Start every write here — see the note above about scratch buffers.
 */
static inline void orbpro_initial_orbit_request_init(OrbProInitialOrbitRequest* value) {
    for (size_t i = 0; i < sizeof(*value); ++i) {
        ((unsigned char*)value)[i] = 0;
    }
}

/**
 * Set OrbProInitialOrbitRequest.method AND clear the 7 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_initial_orbit_request_set_method(OrbProInitialOrbitRequest* value, OrbProInitialOrbitKind v) {
    value->method = (uint8_t)v;
    ((unsigned char*)value)[233] = 0;
    ((unsigned char*)value)[234] = 0;
    ((unsigned char*)value)[235] = 0;
    ((unsigned char*)value)[236] = 0;
    ((unsigned char*)value)[237] = 0;
    ((unsigned char*)value)[238] = 0;
    ((unsigned char*)value)[239] = 0;
}

/* ========================================================================= */
/* OrbProInitialOrbitResult — 80 bytes, 8-byte aligned */
/* ========================================================================= */

/**
 *
 * Binary layout (derived from the IDL, not hand-written):
 *
 *   Offset  Size  Field
 *   ------  ----  -----------------------------------------
 *        0    16  epoch
 *       16    48  state
 *       64     4  iterations
 *       68     1  reference_frame
 *       69     3  (alignment padding — MUST be written as zero)
 *       72     4  status
 *       76     4  (alignment padding — MUST be written as zero)
 */
typedef struct {
    double epoch[2];
    double state[6];
    uint32_t iterations;
    uint8_t reference_frame;
    uint8_t _reserved[3]; /**< Alignment padding at offset 69. MUST be 0. */
    int32_t status;
    uint8_t _reserved1[4]; /**< Alignment padding at offset 76. MUST be 0. */
} OrbProInitialOrbitResult;

ORBPRO_ABI_STATIC_ASSERT(sizeof(OrbProInitialOrbitResult) == 80,
    "OrbProInitialOrbitResult must be 80 bytes");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProInitialOrbitResult, epoch) == 0,
    "OrbProInitialOrbitResult.epoch must be at offset 0");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProInitialOrbitResult, state) == 16,
    "OrbProInitialOrbitResult.state must be at offset 16");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProInitialOrbitResult, iterations) == 64,
    "OrbProInitialOrbitResult.iterations must be at offset 64");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProInitialOrbitResult, reference_frame) == 68,
    "OrbProInitialOrbitResult.reference_frame must be at offset 68");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProInitialOrbitResult, status) == 72,
    "OrbProInitialOrbitResult.status must be at offset 72");

/**
 * Zero an entire OrbProInitialOrbitResult, INCLUDING its alignment padding.
 * Start every write here — see the note above about scratch buffers.
 */
static inline void orbpro_initial_orbit_result_init(OrbProInitialOrbitResult* value) {
    for (size_t i = 0; i < sizeof(*value); ++i) {
        ((unsigned char*)value)[i] = 0;
    }
}

/**
 * Set OrbProInitialOrbitResult.reference_frame AND clear the 3 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_initial_orbit_result_set_reference_frame(OrbProInitialOrbitResult* value, uint8_t v) {
    value->reference_frame = (uint8_t)v;
    ((unsigned char*)value)[69] = 0;
    ((unsigned char*)value)[70] = 0;
    ((unsigned char*)value)[71] = 0;
}

/**
 * Set OrbProInitialOrbitResult.status AND clear the 4 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_initial_orbit_result_set_status(OrbProInitialOrbitResult* value, OrbProEstimationStatus v) {
    value->status = (int32_t)v;
    ((unsigned char*)value)[76] = 0;
    ((unsigned char*)value)[77] = 0;
    ((unsigned char*)value)[78] = 0;
    ((unsigned char*)value)[79] = 0;
}

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* ORBPRO_ESTIMATION_ABI_H */
