/**
 * The self-test's corpus: generated at runtime from the independent two-body
 * closed form, in exactly the vectors.json format the real kits use
 * (space-data-network-modules propagator/keplerian-reference/vectors/ is the
 * committed exemplar). Generating rather than committing keeps the self-test
 * free of a data file that could drift from the generator — the corpus IS the
 * generator here, which is admissible only because the self-test's job is to
 * prove the SUITE can fail, not to conformance-test a real module.
 */

import { ReferenceFrame, StateFlags } from "./abiDriver.js";
import { GENERIC_ELEMENTS } from "./propagatorSuite.js";
import { MU, propagateTwoBody } from "./twoBodyReference.js";

/** The exemplar corpus's tolerance bands, per quantity. */
export const BANDS_DEFAULT = Object.freeze({
  position: Object.freeze({ abs: 1e-6, rel: 1e-9 }),
  velocity: Object.freeze({ abs: 1e-9, rel: 1e-9 }),
  time: Object.freeze({ abs: 1e-9, rel: 0 }),
});

export function buildSelfTestCorpus() {
  const offsetsMinutes = [0, 45, 720];
  const cases = [];
  for (const elements of GENERIC_ELEMENTS) {
    for (const minutes of offsetsMinutes) {
      const julianDate = elements.epochJd + minutes / 1440;
      const { position, velocity } = propagateTwoBody(elements, julianDate);
      cases.push({
        id: `self-test-${elements.noradCatId}@+${minutes}min`,
        tier: "B",
        operation: "plugin_propagate",
        params: { elements, julianDate },
        expect: {
          "position.0": position[0],
          "position.1": position[1],
          "position.2": position[2],
          "velocity.0": velocity[0],
          "velocity.1": velocity[1],
          "velocity.2": velocity[2],
          epoch: julianDate,
          reference_frame: ReferenceFrame.ECEF,
          flags: StateFlags.VALID,
        },
        band: BANDS_DEFAULT,
      });
    }
  }

  return {
    schemaVersion: 1,
    conformance: {
      model: "two-body point-mass, no drag, no J2, no third bodies",
      mu: MU,
      units: "SI throughout: metres, metres/second, Julian days, degrees on input",
      outputFrame: `ECEF (${ReferenceFrame.ECEF})`,
    },
    tolerancePolicy: "fail <=> |observed - expected| > abs + rel * |expected|",
    invariants: [
      { id: "vis-viva-closure", tier: "C", applies: "every propagated state" },
      { id: "period-closure", tier: "C", applies: "every element set" },
      { id: "determinism", tier: "C", applies: "every case" },
      { id: "frame-and-flags-declared", tier: "C", applies: "every propagated state" },
      { id: "refusal-is-typed", tier: "C", applies: "every documented failure" },
    ],
    cases,
  };
}
