/**
 * A deterministic, non-physics reference receipt for exercising the
 * estimation-family conformance evaluator. Real modules replace every value
 * with measurements produced by their compiled WASM artifact. Keeping the
 * evaluator's own known-good input here lets the negative controls prove that
 * each required lane can fail without shipping a second JS estimator.
 */

const reference = {
  schemaVersion: 1,
  family: "estimation",
  artifact: { sha256: "reference-estimation-artifact" },
  runtime: {
    browser: { outputSha256: "reference-output" },
    wasmedge: { outputSha256: "reference-output" },
    threads: {
      "1": "reference-output",
      "2": "reference-output",
      "4": "reference-output",
      "8": "reference-output",
    },
  },
  batch: {
    positionAbsoluteErrorM: 0.25,
    positionRelativeError: 4e-8,
    covarianceRssRelativeError: 0.02,
    residualRmsRelativeError: 2e-8,
    rejectedExpected: [7, 19],
    rejectedActual: [7, 19],
    iterationCount: 4,
    iterationCovarianceCount: 4,
    iterationCovariancesSpd: true,
  },
  filter: {
    positionErrorM: 0.65,
    smootherPositionErrorM: 0.21,
    smootherCovarianceMonotone: true,
    neesMean: 6.02,
    nees95Lower: 5.34,
    nees95Upper: 6.70,
    sncCovarianceGrowthRatio: 1.21,
    dmcCovarianceGrowthRatio: 1.58,
    ekfUkfCovarianceDifference: 0.08,
  },
  measurements: {
    rangeMaxRelativeError: 6e-16,
    rangeRateMaxRelativeError: 5e-16,
    azElMaxRelativeError: 5e-16,
    raDecMaxRelativeError: 5e-16,
    lightTimeMagnitudeErrorM: 2e-10,
    sagnacMagnitudeErrorM: 2e-10,
  },
  media: {
    hopfieldSaastamoinenMaxRelativeError: 6e-5,
    mariniMaxRelativeError: 7e-5,
    p531PublishedPrecisionError: 0,
  },
  iod: {
    gaussPrintedPrecisionError: 0,
    laplacePrintedPrecisionError: 0,
    gibbsPrintedPrecisionError: 0,
    herrickGibbsPrintedPrecisionError: 0,
  },
  simulator: {
    runs: 200,
    stateInsideThreeSigmaFraction: 0.965,
    recoveredNoiseSigmaRelativeError: 0.031,
  },
  invariants: {
    covarianceSymmetric: true,
    covariancePositiveDefinite: true,
    residualOrthogonalityMax: 3e-11,
    actualOcmCovariance: true,
  },
};

export const ESTIMATION_REFERENCE_EVIDENCE = Object.freeze(reference);

export function makeEstimationReferenceEvidence() {
  return structuredClone(reference);
}
