# Estimation reference module

This is the force-model-blind reference implementation for the fixed
estimation ABI. It demonstrates one covariance-form position update using an
`OrbProEstimationPropagatorSample` supplied by the caller. It never propagates
an orbit and never names a provider: production estimators obtain state and
STM samples from the caller-selected `plugin_propagate` /
`plugin_compute_stm` port.

The reference export is:

```c
int32_t orbpro_estimation_reference_position_update(
    const OrbProEstimationConfig*,
    const OrbProEstimationObservation*,
    const OrbProEstimationPropagatorSample*,
    OrbProEstimationState*);
```

It accepts only a three-lane `POSITION_VECTOR` observation. That narrow shape
is deliberate: the reference proves ABI layout, covariance update, typed
refusal and deterministic bytes. The estimation conformance kit adjudicates
full modules against Orekit, Vallado, media, Monte-Carlo and runtime evidence.
It is not a second JS physics implementation.
