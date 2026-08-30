/** Estimation-family conformance receipt evaluator. No physics lives here. */

import { computeVerdict } from "./propagatorSuite.js";

const pass = (id, tier, detail) => ({ id, tier, required: true, status: "pass", detail });
const fail = (id, tier, detail) => ({ id, tier, required: true, status: "fail", detail });

function check(checks, id, tier, condition, detail, failure = detail) {
  checks.push(condition ? pass(id, tier, detail) : fail(id, tier, failure));
}

function finiteAtMost(value, limit) {
  return Number.isFinite(value) && value <= limit;
}

function sameSet(left = [], right = []) {
  const a = [...new Set(left)].sort((x, y) => x - y);
  const b = [...new Set(right)].sort((x, y) => x - y);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function runEstimationSuite(evidence) {
  const checks = [];
  const runtimeHashes = [
    evidence?.runtime?.browser?.outputSha256,
    evidence?.runtime?.wasmedge?.outputSha256,
    evidence?.runtime?.threads?.["1"],
    evidence?.runtime?.threads?.["2"],
    evidence?.runtime?.threads?.["4"],
    evidence?.runtime?.threads?.["8"],
  ];
  check(checks, "tier0/tri-runtime-byte-identity", "0",
    runtimeHashes.every(Boolean) && new Set(runtimeHashes).size === 1,
    "browser, WasmEdge and worker widths 1/2/4/8 emitted byte-identical results",
    "missing or divergent browser/WasmEdge/thread-width output digests");

  const batch = evidence?.batch ?? {};
  check(checks, "tierA/batch-state", "A",
    finiteAtMost(batch.positionAbsoluteErrorM, 1) &&
      finiteAtMost(batch.positionRelativeError, 1e-3),
    `absolute=${batch.positionAbsoluteErrorM} m relative=${batch.positionRelativeError}`,
    "batch state exceeds 1 m absolute or 1e-3 relative");
  check(checks, "tierA/batch-covariance", "A",
    finiteAtMost(batch.covarianceRssRelativeError, 0.05),
    `RSS position sigma relative error=${batch.covarianceRssRelativeError}`,
    "batch covariance RSS differs from authority by more than 5%");
  check(checks, "tierA/batch-residual-rms", "A",
    finiteAtMost(batch.residualRmsRelativeError, 1e-6),
    `residual RMS relative error=${batch.residualRmsRelativeError}`,
    "batch residual RMS differs from authority by more than 1e-6 relative");
  check(checks, "tierA/sigma-edit-set", "A",
    sameSet(batch.rejectedExpected, batch.rejectedActual),
    `exact rejected set [${batch.rejectedActual ?? []}]`,
    "sigma editing rejected a different observation set");

  const filter = evidence?.filter ?? {};
  check(checks, "tierA/filter-and-smoother-state", "A",
    finiteAtMost(filter.positionErrorM, 1) &&
      finiteAtMost(filter.smootherPositionErrorM, 0.5),
    `filter=${filter.positionErrorM} m smoother=${filter.smootherPositionErrorM} m`,
    "filter exceeds 1 m or RTS smoother exceeds 0.5 m");
  check(checks, "tierC/smoother-covariance", "C",
    filter.smootherCovarianceMonotone === true,
    "smoothed covariance is no larger than filtered covariance at every epoch");
  check(checks, "tierC/nees-100-run", "C",
    Number.isFinite(filter.neesMean) && filter.neesMean >= filter.nees95Lower &&
      filter.neesMean <= filter.nees95Upper,
    `NEES mean=${filter.neesMean} band=[${filter.nees95Lower},${filter.nees95Upper}]`,
    "100-run NEES lies outside the declared chi-square 95% band");
  check(checks, "tierC/process-noise", "C",
    Number.isFinite(filter.sncCovarianceGrowthRatio) && filter.sncCovarianceGrowthRatio !== 1 &&
      Number.isFinite(filter.dmcCovarianceGrowthRatio) && filter.dmcCovarianceGrowthRatio !== 1,
    `SNC ratio=${filter.sncCovarianceGrowthRatio} DMC ratio=${filter.dmcCovarianceGrowthRatio}`,
    "SNC or DMC failed to change covariance growth");
  check(checks, "tierC/ekf-ukf-not-aliased", "C",
    Number.isFinite(filter.ekfUkfCovarianceDifference) && filter.ekfUkfCovarianceDifference > 0,
    `covariance history distance=${filter.ekfUkfCovarianceDifference}`,
    "EKF and UKF covariance histories are identical");

  const measurement = evidence?.measurements ?? {};
  for (const [name, key] of [["range", "rangeMaxRelativeError"],
    ["range-rate", "rangeRateMaxRelativeError"], ["az-el", "azElMaxRelativeError"],
    ["ra-dec", "raDecMaxRelativeError"]]) {
    check(checks, `tierA/measurement-${name}`, "A", finiteAtMost(measurement[key], 1e-6),
      `max relative error=${measurement[key]}`, `${name} exceeds 1e-6 relative`);
  }
  check(checks, "tierA/light-time", "A", finiteAtMost(measurement.lightTimeMagnitudeErrorM, 1e-6),
    `magnitude error=${measurement.lightTimeMagnitudeErrorM} m`);
  check(checks, "tierA/sagnac", "A", finiteAtMost(measurement.sagnacMagnitudeErrorM, 1e-6),
    `magnitude error=${measurement.sagnacMagnitudeErrorM} m`);

  const media = evidence?.media ?? {};
  check(checks, "tierA/troposphere-hopfield-saastamoinen", "A",
    finiteAtMost(media.hopfieldSaastamoinenMaxRelativeError, 1e-4),
    `relative error=${media.hopfieldSaastamoinenMaxRelativeError}`);
  check(checks, "tierA/troposphere-marini", "A",
    finiteAtMost(media.mariniMaxRelativeError, 1e-4),
    `relative error=${media.mariniMaxRelativeError}`);
  check(checks, "tierB/ionosphere-p531", "B", media.p531PublishedPrecisionError === 0,
    "P.531 table value reproduced to published precision");

  for (const [name, key] of [["gauss", "gaussPrintedPrecisionError"],
    ["laplace", "laplacePrintedPrecisionError"], ["gibbs", "gibbsPrintedPrecisionError"],
    ["herrick-gibbs", "herrickGibbsPrintedPrecisionError"]]) {
    check(checks, `tierB/iod-${name}`, "B", evidence?.iod?.[key] === 0,
      "Vallado worked example reproduced to printed precision");
  }

  const simulator = evidence?.simulator ?? {};
  check(checks, "tierC/simulator-coverage", "C",
    simulator.runs >= 200 && simulator.stateInsideThreeSigmaFraction >= 0.95,
    `${simulator.stateInsideThreeSigmaFraction} inside 3-sigma over ${simulator.runs} runs`);
  check(checks, "tierC/simulator-noise-recovery", "C",
    finiteAtMost(simulator.recoveredNoiseSigmaRelativeError, 0.05),
    `noise sigma relative error=${simulator.recoveredNoiseSigmaRelativeError}`);

  const invariants = evidence?.invariants ?? {};
  check(checks, "tierC/covariance-spd", "C",
    invariants.covarianceSymmetric === true && invariants.covariancePositiveDefinite === true,
    "covariance is symmetric positive definite");
  check(checks, "tierC/residual-orthogonality", "C",
    finiteAtMost(invariants.residualOrthogonalityMax, 1e-8),
    `max normalized normal-equation projection=${invariants.residualOrthogonalityMax}`);
  check(checks, "tierC/ocm-covariance", "C", invariants.actualOcmCovariance === true,
    "the emitted OCM carries the estimator covariance");

  return { checks, verdict: computeVerdict(checks) };
}
