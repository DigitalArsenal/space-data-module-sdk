# Estimation

**Status: RATIFIED.** The estimation harness is the measurement-based orbit
determination contract. It covers simulation, batch weighted least squares,
sequential filtering, smoothing, process noise, media corrections, and initial
orbit determination without selecting a propagator implementation.

## Result-model ruling

The result-model decision previously deferred by this family is final:

- `$ODR` is the canonical signed run report. It carries the solver
  configuration, iteration and editing ledgers, estimated parameters, filter
  history, residual statistics, and the estimated Cartesian state.
- `$OCM` is the canonical covariance product named by `ODR.OCM_CONTENT_ID`.
  Its covariance values are the estimator's computed values; a diagonal
  placeholder or an `N/A` solve-for is non-conforming.
- `Estimation.fbs` is the family request/result wire. It may embed the exact
  `$ODR` and `$OCM` bytes for a one-frame invocation result, but it does not
  replace either standards record.
- `$MEM`, `$TRH`, and `$TDM` are supporting input records: measurement error
  and editing policy, tracking hardware, and observations respectively.

This split keeps algorithm telemetry out of a covariance interchange record
while still giving every reported covariance one immutable run provenance.

## Propagator port

The caller supplies `propagator_port_id` and `propagator_capability`. The
estimator consumes `EstimationPropagatorSample` values whose states come from
`plugin_propagate` and whose state-transition matrices come from
`plugin_compute_stm`. The STM maps the a-priori epoch to the sample epoch.

Provider names, provider enums, and a default provider are absent from this
family. A host must reject a request whose named port does not provide both
capabilities. An estimator that imports or selects a concrete propagator is not
an estimation-family module.

## Source of truth and generated header

`schemas/orbpro/Estimation.fbs` is the single layout source.
`include/orbpro/orbpro_estimation_abi.h` is generated from it by the SDK's
schema ABI renderer. Its compile-time size and offset assertions are part of
conformance; handwritten copies are not.

All state components use metres and metres per second. Covariance is row-major
6 by 6 in matching SI units. Observation values use their native SI unit:
metres, metres per second, hertz, or radians. Epochs use the two-double Julian
day representation shared by the propagator family.

Angular and local-plane observations carry the station's inertial east,
north and up unit vectors alongside its inertial position and velocity. A
runtime uses that explicit topocentric basis when it is present; deriving
latitude and longitude from an inertial position rotates the local frame twice
and is non-conformant.

The fixed layouts are:

| Type | Bytes | Alignment |
| --- | ---: | ---: |
| `OrbProEstimationEpoch` | 16 | 8 |
| `OrbProEstimationObservation` | 376 | 8 |
| `OrbProEstimationErrorModel` | 72 | 8 |
| `OrbProEstimationConfig` | 448 | 8 |
| `OrbProEstimationState` | 384 | 8 |
| `OrbProFilterEpoch` | 696 | 8 |
| `OrbProEstimationPropagatorSample` | 352 | 8 |
| `OrbProInitialOrbitRequest` | 240 | 8 |
| `OrbProInitialOrbitResult` | 80 | 8 |

Call each generated `_init` helper before filling a struct. Padding is
contractual and must remain zero so browser, native, and WasmEdge runtimes hash
the same bytes.

## Measurement and estimator roster

The measurement roster contains range, range rate and Doppler; azimuth and
elevation; XEast/YNorth and XSouth/YEast; right ascension and declination;
position vectors; sequential and pseudonoise range; time-correlated phase;
relay range, Doppler and differenced Doppler; bistatic, skin and crosslink
range/range rate; laser range; TDOA; and FDOA.

`EstimatorKind` distinguishes batch weighted least squares, a covariance-form
extended Kalman filter, a sigma-point unscented Kalman filter, and EKF with
Rauch–Tung–Striebel smoothing. Chaining one-observation batch solves is not an
EKF or UKF and fails conformance. SNC and DMC are explicit process-noise kinds.

The initial-orbit entry point exposes Gauss, Laplace, Gibbs, and
Herrick–Gibbs. It returns the middle-epoch Cartesian state and a typed status.

## Result and error contract

Successful estimation produces a populated `OrbProEstimationState`. A batch
result includes convergence, iteration, accepted and rejected counts, RMS,
recovered noise sigma, and covariance. A sequential result includes every
filtered covariance and, for the smoother kind, every smoothed covariance.

The public status vocabulary is:

| Status | Meaning |
| --- | --- |
| `ORBPRO_ESTIMATION_OK` | Result is complete. |
| `ORBPRO_ESTIMATION_NOT_CONFIGURED` | Required family or propagator configuration is absent. |
| `ORBPRO_ESTIMATION_NULL_OUTPUT` | Caller supplied no result destination. |
| `ORBPRO_ESTIMATION_BAD_INPUT` | Shape, unit, enum, sigma, or covariance validation failed. |
| `ORBPRO_ESTIMATION_NOT_CONVERGED` | A valid iteration history exists but the declared convergence criteria were not met. |
| `ORBPRO_ESTIMATION_BUFFER_TOO_SMALL` | Output storage cannot hold the declared result. |
| `ORBPRO_ESTIMATION_PROPAGATOR_PROTOCOL` | State/STM response does not match the request. |
| `ORBPRO_ESTIMATION_INTERNAL` | Numerical or invariant failure not attributable to input. |

No sentinel means success. NaN, an invalid covariance, or a missing required
record is an error. A non-converged batch may be reported only with
`NOT_CONVERGED` and its actual iteration history; it may not be relabelled OK.

## Lifetime and threading

Request, sample, and result buffers are invocation-owned and remain valid only
for the call. Modules copy any state retained between input frames. Family
implementations declare their thread model in `$PLG`; deterministic
six-dimensional sequential implementations may use `wasi-sequential` while
still compiling on the sanctioned `wasm32-wasip1-threads` toolchain. The same
artifact and bytes must pass browser, native, and embedded WasmEdge lanes.

## Conformance kit

The official kit checks:

1. generated ABI sizes, offsets, enum values, zeroed padding, and an
   Estimation.fbs schema-lock regeneration;
2. a positive reference module using caller-supplied state and STM samples;
3. a negative provider-selection control, which fails if a provider name or a
   concrete propagator import is introduced;
4. batch state, covariance, RMS, recovered sigma, and exact edited-set vectors;
5. real EKF and UKF covariance histories, RTS covariance contraction, and
   SNC/DMC growth;
6. the complete measurement roster, light-time and body-rotation corrections,
   media corrections, hardware delay and turnaround handling;
7. deterministic simulation and the four initial-orbit methods; and
8. byte-equivalent results in the browser, native, and WasmEdge lanes.

The kit's reference module is deliberately force-model blind: its propagator
fixture arrives through the same required `propagator_samples` port as a real
provider. Replacing that fixture with a compiled-in trajectory is a failing
negative control, not a reference implementation.

## Manifest surface

An estimation module declares the `estimation` harness family and exposes
`run_estimation`, `simulate_tracking`, and `initial_orbit`. `run_estimation`
requires `request` and `propagator_samples`; `$TDM`, `$MEM`, and `$TRH` are
optional typed ports. It emits the Estimation result wire plus signed `$ODR`
and `$OCM` records. Signatures are applied by the caller's keyslot capability;
private signing material never appears in the estimation module.
