#include "orbpro/orbpro_propagator_abi.h"
#include "orbpro/orbpro_estimation_abi.h"

#include <cmath>
#include <cstdint>

#if defined(__wasm__)
#define ESTIMATION_EXPORT(name) __attribute__((export_name(name))) extern "C"
#else
#define ESTIMATION_EXPORT(name) extern "C"
#endif

extern "C" int abi_probe(void) { return 0; }

ESTIMATION_EXPORT("orbpro_estimation_reference_position_update")
int32_t orbpro_estimation_reference_position_update(
    const OrbProEstimationConfig* config,
    const OrbProEstimationObservation* observation,
    const OrbProEstimationPropagatorSample* sample,
    OrbProEstimationState* output) {
  if (config == nullptr || observation == nullptr || sample == nullptr || output == nullptr) {
    return ORBPRO_ESTIMATION_NULL_OUTPUT;
  }
  if (observation->kind != ORBPRO_MEASUREMENT_POSITION_VECTOR ||
      observation->value_count != 3) {
    return ORBPRO_ESTIMATION_BAD_INPUT;
  }

  orbpro_estimation_state_init(output);
  output->epoch[0] = sample->epoch[0];
  output->epoch[1] = sample->epoch[1];
  for (int axis = 0; axis < 6; ++axis) {
    output->state[axis] = sample->state[axis];
    for (int column = 0; column < 6; ++column) {
      output->covariance[axis * 6 + column] = config->initial_covariance[axis * 6 + column];
    }
  }
  for (int axis = 0; axis < 3; ++axis) {
    const double prior = output->covariance[axis * 6 + axis];
    const double sigma = observation->sigma[axis];
    if (!(prior > 0.0) || !(sigma > 0.0) || !std::isfinite(sigma)) {
      return ORBPRO_ESTIMATION_BAD_INPUT;
    }
    const double measurement_variance = sigma * sigma;
    const double gain = prior / (prior + measurement_variance);
    output->state[axis] += gain * (observation->value[axis] - output->state[axis]);
    output->covariance[axis * 6 + axis] = (1.0 - gain) * prior;
  }
  output->accepted_count = 1;
  output->converged = 1;
  output->estimator = ORBPRO_ESTIMATOR_EXTENDED_KALMAN_FILTER;
  return ORBPRO_ESTIMATION_OK;
}
