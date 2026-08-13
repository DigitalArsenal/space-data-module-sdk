/**
 * The propagator-family conformance suite — W1.4 of
 * graph/tasks/official-harness-shapes-program.md, the runner the finding's §5
 * promises: one command, family-dispatched, shipped with its own negative
 * control.
 *
 * Tier structure (finding §5):
 *   Tier 0 — structural: real instantiation + required export set. Full
 *            cross-runtime parity stays the parity-gate's job (the existing
 *            gate, unchanged); this runner reports that lane as a GAP rather
 *            than quietly re-certifying half of it.
 *   Tier B — anchors from the module's vectors corpus (vectors.json +
 *            PROVENANCE.md format). The corpus is the MODULE's: anchors are
 *            model-specific, so a two-body corpus is never forced onto an
 *            SGP4 module. No corpus => Tier B is a named gap, not a pass.
 *   Tier C — invariants with no stored expectation. PHYSICS invariants
 *            (vis-viva, period closure) run only where the corpus declares
 *            them applicable to the module's model; ABI-BEHAVIOUR invariants
 *            (determinism, frame/flags/reserved declaration, batch/single
 *            agreement, typed refusals, create-returns-handle) are
 *            model-independent and always run.
 *   Tier 4 — lifecycle: the leak test (docs/propagator-abi.md §Lifetime),
 *            destroy idempotence, and the negative control proving the leak
 *            metric can move at all. A gate never observed to fail is
 *            indistinguishable from one that cannot fail.
 *
 * Every check runs against the driver INTERFACE (abiDriver.js), so the
 * self-test can prove the suite catches planted defects without a toolchain.
 */

import {
  ErrorCode,
  REQUIRED_ABI_EXPORTS,
  ReferenceFrame,
  StateFlags,
} from "./abiDriver.js";
import {
  EARTH_ROTATION_RATE,
  SECONDS_PER_DAY,
  withinBand,
} from "./twoBodyReference.js";

export const DEFAULT_LEAK_OPTIONS = Object.freeze({
  warmupCycles: 20,
  measureCycles: 200,
  entities: 256,
});

/** PASS / PASS-WITH-GAPS / FAIL — the gauntlet's verdict vocabulary. */
export function computeVerdict(checks) {
  if (checks.some((check) => check.status === "fail")) return "FAIL";
  if (checks.some((check) => check.status === "gap")) return "PASS-WITH-GAPS";
  return "PASS";
}

/**
 * Inputs used for model-independent checks when no corpus is supplied.
 *
 * Near-circular, with mean anomalies at 0/180: the period-closure invariant
 * compares radii one period apart, and the Julian-date grid carries ~4e-5 s
 * of rounding at these magnitudes, so elements are chosen (as the reference
 * corpus chose Molniya-at-perigee) where the radius is insensitive to that
 * epsilon rather than papering over it with a looser band.
 */
export const GENERIC_ELEMENTS = Object.freeze(
  Array.from({ length: 5 }, (_, index) =>
    Object.freeze({
      epochJd: 2460000.5,
      meanMotionRevPerDay: 15.5 - index * 0.7,
      eccentricity: 0.0006703 + index * 0.0005,
      inclinationDeg: 51.64 + index * 5,
      raOfAscNodeDeg: (208.9163 + index * 17) % 360,
      argOfPericenterDeg: (30.8756 + index * 23) % 360,
      meanAnomalyDeg: (index * 180) % 360,
      noradCatId: 25544 + index,
    }),
  ),
);

function corpusInvariantIds(corpus) {
  return new Set((corpus?.invariants ?? []).map((entry) => entry.id));
}

function corpusElements(corpus) {
  const cases = corpus?.cases ?? [];
  const elements = cases.map((entry) => entry.params.elements);
  return elements.length > 0 ? elements : [...GENERIC_ELEMENTS];
}

function pass(id, tier, required, detail) {
  return { id, tier, required, status: "pass", detail };
}
function fail(id, tier, required, detail) {
  return { id, tier, required, status: "fail", detail };
}
function gap(id, tier, detail) {
  return { id, tier, required: false, status: "gap", detail };
}

/**
 * Run the suite. `driverFactory` returns a FRESH driver per call — checks that
 * depend on pre-ingest state (typed refusals) or memory baselines (leak)
 * must not inherit another check's arena.
 */
export async function runPropagatorSuite(driverFactory, options = {}) {
  const corpus = options.corpus ?? null;
  const leak = { ...DEFAULT_LEAK_OPTIONS, ...(options.leak ?? {}) };
  const invariants = corpusInvariantIds(corpus);
  const elements = corpusElements(corpus);
  const checks = [];

  async function run(id, tier, required, body) {
    let driver;
    try {
      driver = await driverFactory();
    } catch (error) {
      checks.push(
        fail(id, tier, required, `driver failed to instantiate: ${error.message}`),
      );
      return;
    }
    try {
      const detail = await body(driver);
      checks.push(pass(id, tier, required, detail ?? "ok"));
    } catch (error) {
      checks.push(fail(id, tier, required, error.message));
    }
  }

  // ---- Tier 0 — structural ------------------------------------------------
  await run("tier0/instantiation-and-exports", "0", true, async (driver) => {
    const names = new Set(driver.exportNames());
    const missing = REQUIRED_ABI_EXPORTS.filter((name) => !names.has(name));
    if (missing.length > 0) {
      throw new Error(
        `artifact instantiates but is missing required ABI exports: ${missing.join(", ")}`,
      );
    }
    return `all ${REQUIRED_ABI_EXPORTS.length} required exports present`;
  });

  checks.push(
    gap(
      "tier0/parity-gate",
      "0",
      "cross-runtime byte-identity is the parity gate's verdict, not this runner's — " +
        "certify with `space-data-module parity-gate --artifact <id>=<module.wasm>:module`",
    ),
  );

  // ---- Tier B — corpus anchors -------------------------------------------
  if (!corpus || !(corpus.cases?.length > 0)) {
    checks.push(
      gap(
        "tierB/anchors",
        "B",
        "no vectors corpus supplied (--vectors or <package>/vectors/vectors.json) — " +
          "Tier B anchors were not adjudicated; a module without a corpus cannot claim them",
      ),
    );
  } else {
    await run("tierB/anchors", "B", true, async (driver) => {
      let checked = 0;
      for (const testCase of corpus.cases) {
        const { elements: caseElements, julianDate } = testCase.params;
        const ingested = driver.initFromOmm([caseElements]);
        if (ingested !== 1) {
          throw new Error(`${testCase.id}: ingest returned ${ingested}`);
        }
        const { status, state } = driver.propagate(julianDate, 0);
        if (status !== ErrorCode.OK) {
          throw new Error(`${testCase.id}: propagate status ${status}`);
        }
        for (const axis of [0, 1, 2]) {
          const p = state.position[axis];
          const v = state.velocity[axis];
          if (!Number.isFinite(p) || !Number.isFinite(v)) {
            throw new Error(
              `${testCase.id}: non-finite component (NaN is its own failure class, ` +
                `never "a number that happened")`,
            );
          }
          const expectedP = testCase.expect[`position.${axis}`];
          if (!withinBand(p, expectedP, testCase.band.position)) {
            throw new Error(
              `${testCase.id}: position[${axis}] = ${p} but the corpus anchor says ` +
                `${expectedP} (delta ${p - expectedP} m)`,
            );
          }
          const expectedV = testCase.expect[`velocity.${axis}`];
          if (!withinBand(v, expectedV, testCase.band.velocity)) {
            throw new Error(
              `${testCase.id}: velocity[${axis}] = ${v} but the corpus anchor says ` +
                `${expectedV} (delta ${v - expectedV} m/s)`,
            );
          }
        }
        if (!withinBand(state.epoch, testCase.expect.epoch, testCase.band.time)) {
          throw new Error(
            `${testCase.id}: epoch ${state.epoch} vs anchor ${testCase.expect.epoch}`,
          );
        }
        if (
          testCase.expect.reference_frame !== undefined &&
          state.referenceFrame !== testCase.expect.reference_frame
        ) {
          throw new Error(
            `${testCase.id}: reference_frame ${state.referenceFrame} but the corpus ` +
              `declares ${testCase.expect.reference_frame}`,
          );
        }
        checked += 1;
      }
      return `${checked} corpus anchors reproduced within band`;
    });
  }

  // ---- Tier C — physics invariants (corpus-declared applicability) --------
  const mu = corpus?.conformance?.mu;
  if (invariants.has("vis-viva-closure")) {
    if (!Number.isFinite(mu)) {
      checks.push(
        gap(
          "tierC/vis-viva-closure",
          "C",
          "corpus declares vis-viva-closure but carries no conformance.mu",
        ),
      );
    } else {
      await run("tierC/vis-viva-closure", "C", true, (driver) => {
        for (const testCase of corpus.cases) {
          const { elements: caseElements, julianDate } = testCase.params;
          driver.initFromOmm([caseElements]);
          const { state } = driver.propagate(julianDate, 0);
          const [x, y, z] = state.position;
          const [vx, vy, vz] = state.velocity;
          let speed;
          if (state.referenceFrame === ReferenceFrame.ECEF) {
            // Undo the Earth-rotation term to recover inertial magnitudes;
            // magnitudes are frame-independent under a pure rotation.
            const vxi = vx - EARTH_ROTATION_RATE * y;
            const vyi = vy + EARTH_ROTATION_RATE * x;
            speed = Math.hypot(vxi, vyi, vz);
          } else {
            speed = Math.hypot(vx, vy, vz);
          }
          const radius = Math.hypot(x, y, z);
          const n =
            (caseElements.meanMotionRevPerDay * 2 * Math.PI) / SECONDS_PER_DAY;
          const a = Math.cbrt(mu / (n * n));
          const energy = (speed * speed) / 2 - mu / radius;
          const expected = -mu / (2 * a);
          const relative = Math.abs((energy - expected) / expected);
          if (!(relative < 1e-6)) {
            throw new Error(
              `${testCase.id}: specific energy ${energy} vs -mu/2a ${expected} ` +
                `(rel ${relative.toExponential(3)}) — the orbit adjudicated itself and lost`,
            );
          }
        }
        return `${corpus.cases.length} states close vis-viva at rel < 1e-6`;
      });
    }
  } else if (corpus) {
    checks.push(
      gap(
        "tierC/vis-viva-closure",
        "C",
        "corpus does not declare vis-viva-closure applicable to this module's model",
      ),
    );
  } else {
    checks.push(
      gap("tierC/vis-viva-closure", "C", "no corpus — model invariants not declared"),
    );
  }

  if (invariants.has("period-closure")) {
    await run("tierC/period-closure", "C", true, (driver) => {
      const seen = new Set();
      let closed = 0;
      for (const testCase of corpus.cases) {
        const caseElements = testCase.params.elements;
        if (seen.has(caseElements.noradCatId)) continue;
        seen.add(caseElements.noradCatId);
        driver.initFromOmm([caseElements]);
        const periodDays = 1 / caseElements.meanMotionRevPerDay;
        const start = caseElements.epochJd;
        const a = driver.propagate(start, 0).state;
        const b = driver.propagate(start + periodDays, 0).state;
        // Compare RADIUS rather than the rotating-frame vector: the Earth has
        // turned under the orbit in one period.
        const ra = Math.hypot(...a.position);
        const rb = Math.hypot(...b.position);
        if (!(Math.abs(ra - rb) < 1e-3)) {
          throw new Error(
            `period closure for ${caseElements.noradCatId}: |r| went ${ra} -> ${rb}`,
          );
        }
        closed += 1;
      }
      return `${closed} element sets return to the same radius after one period`;
    });
  } else {
    checks.push(
      gap(
        "tierC/period-closure",
        "C",
        corpus
          ? "corpus does not declare period-closure applicable to this module's model"
          : "no corpus — model invariants not declared",
      ),
    );
  }

  // ---- Tier C — ABI-behaviour invariants (always run) ---------------------
  await run("tierC/determinism-byte-identity", "C", true, (driver) => {
    const first = elements[0];
    const jd = first.epochJd + 0.01;
    driver.initFromOmm([first]);
    const a = driver.propagate(jd, 0).bytes;
    const b = driver.propagate(jd, 0).bytes;
    if (Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0) {
      throw new Error("two identical calls diverged — determinism is compared as BYTES");
    }
    // Determinism must survive the lifecycle, not just the call.
    driver.destroy();
    driver.initFromOmm([first]);
    const c = driver.propagate(jd, 0).bytes;
    if (Buffer.compare(Buffer.from(a), Buffer.from(c)) !== 0) {
      throw new Error(
        "output changed after destroy + re-ingest — state leaked across the lifecycle",
      );
    }
    return "byte-identical across repeated calls and a destroy/re-ingest round trip";
  });

  await run("tierC/frame-flags-reserved-declared", "C", true, (driver) => {
    const first = elements[0];
    driver.initFromOmm([first]);
    const { state } = driver.propagate(first.epochJd, 0);
    const declaredFrames = new Set(Object.values(ReferenceFrame));
    if (!declaredFrames.has(state.referenceFrame)) {
      throw new Error(
        `reference_frame ${state.referenceFrame} is not a declared ReferenceFrame member — ` +
          "the harness refuses undeclared frame vocabulary",
      );
    }
    const corpusFrame = corpus?.cases?.[0]?.expect?.reference_frame;
    if (corpusFrame !== undefined && state.referenceFrame !== corpusFrame) {
      throw new Error(
        `the module declares frame ${state.referenceFrame} but its own corpus pins ` +
          `${corpusFrame} — a frame declaration that contradicts the module's corpus is ` +
          "the silently-wrong-numbers defect the harness exists to prevent",
      );
    }
    if ((state.flags & StateFlags.VALID) !== StateFlags.VALID) {
      throw new Error("VALID flag not set on a successful propagation");
    }
    if (state.reserved.some((byte) => byte !== 0)) {
      throw new Error(
        "the three IDL-reserved bytes at reference_frame+1..3 must be zero; non-zero " +
          "means the writer assigned reference_frame directly instead of the generated " +
          "setter, and a consumer reading a 32-bit word there sees garbage",
      );
    }
    return `frame ${state.referenceFrame} declared, VALID set, reserved bytes zero`;
  });

  await run("tierC/batch-single-agreement", "C", true, (driver) => {
    const batchElements = elements.slice(0, Math.min(4, elements.length));
    driver.initFromOmm(batchElements);
    const jd = batchElements[0].epochJd + 0.01;
    const batch = driver.propagateBatch(jd, batchElements.length);
    if (batch.status !== ErrorCode.OK) {
      throw new Error(`propagate_batch status ${batch.status}`);
    }
    for (let index = 0; index < batchElements.length; index += 1) {
      const single = driver.propagate(jd, index).state;
      for (const axis of [0, 1, 2]) {
        if (batch.states[index].position[axis] !== single.position[axis]) {
          throw new Error(
            `entity ${index}: batch and single disagree on position[${axis}] — ` +
              "the batch path is not the same physics",
          );
        }
      }
    }
    return `${batchElements.length} entities agree exactly between batch and single paths`;
  });

  await run("tierC/typed-refusals", "C", true, (driver) => {
    const probe = driver.propagate(2460000.5, 0);
    if (probe.status !== ErrorCode.NOT_INITIALIZED) {
      throw new Error(
        `propagating before ingest returned ${probe.status}, not NOT_INITIALIZED ` +
          `(${ErrorCode.NOT_INITIALIZED}) — a bad index must be distinguishable from an ` +
          "uninitialized module or the host cannot place the failure on the degradation ladder",
      );
    }
    driver.initFromOmm([elements[0]]);
    const badIndex = driver.propagate(2460000.5, 99);
    if (badIndex.status !== ErrorCode.BAD_ENTITY_INDEX) {
      throw new Error(
        `an out-of-range entity index returned ${badIndex.status}, not ` +
          `BAD_ENTITY_INDEX (${ErrorCode.BAD_ENTITY_INDEX})`,
      );
    }
    const hyperbolic = driver.initFromOmm([{ ...elements[0], eccentricity: 1.5 }]);
    if (!(hyperbolic < 0)) {
      throw new Error(
        "e >= 1 was accepted at ingest — a physically impossible result is a refusal, " +
          "not an output propagated into confident nonsense",
      );
    }
    const retrograde = driver.initFromOmm([
      { ...elements[0], meanMotionRevPerDay: -1 },
    ]);
    if (!(retrograde < 0)) {
      throw new Error("a non-positive mean motion was accepted at ingest");
    }
    return "NOT_INITIALIZED, BAD_ENTITY_INDEX and unphysical-ingest refusals all typed";
  });

  await run("tierC/create-returns-handle", "C", true, (driver) => {
    driver.initFromOmm([elements[0]]);
    const handle = driver.ingestOne(elements[1] ?? { ...elements[0], noradCatId: 1 });
    if (handle !== 1) {
      throw new Error(
        `ingest returned ${handle}, not the handle it assigned — "the entity I just ` +
          'created is count-1" is the race the harness exists to kill (finding §4.4)',
      );
    }
    if (driver.entityCount() !== 2) {
      throw new Error(`entity count is ${driver.entityCount()}, expected 2`);
    }
    const roundTrip = driver.propagate(2460000.5, handle);
    if (roundTrip.status !== ErrorCode.OK) {
      throw new Error(`the returned handle does not propagate (status ${roundTrip.status})`);
    }
    return "ingest returns its own handle and the handle works";
  });

  // ---- Tier 4 — lifecycle -------------------------------------------------
  const cycleRecords = (count) =>
    Array.from({ length: count }, (_, index) => ({
      ...elements[0],
      noradCatId: (elements[0].noradCatId ?? 25544) + index,
      meanAnomalyDeg: ((elements[0].meanAnomalyDeg ?? 0) + index) % 360,
    }));

  function cycle(driver, entityCount) {
    const records = cycleRecords(entityCount);
    const ingested = driver.initFromOmm(records);
    if (ingested !== entityCount) {
      throw new Error(`mid-cycle ingest accepted ${ingested}/${entityCount} records`);
    }
    const batch = driver.propagateBatch(elements[0].epochJd + 0.01, entityCount);
    if (batch.status !== ErrorCode.OK) {
      throw new Error(`propagate_batch failed mid-cycle (status ${batch.status})`);
    }
    driver.destroy();
    if (driver.entityCount() !== 0) {
      throw new Error(
        "destroy left entities behind — the module is holding state it said it released",
      );
    }
  }

  await run("tier4/lifecycle-leak", "4", true, (driver) => {
    for (let i = 0; i < leak.warmupCycles; i += 1) cycle(driver, leak.entities);
    const baselineBytes = driver.memoryBytes();
    for (let i = 0; i < leak.measureCycles; i += 1) cycle(driver, leak.entities);
    const growth = driver.memoryBytes() - baselineBytes;
    if (growth !== 0) {
      throw new Error(
        `linear memory grew by ${growth} bytes across ${leak.measureCycles} identical ` +
          `ingest/propagate/destroy cycles (baseline ${baselineBytes}) — destroy that is ` +
          `real reaches a steady state; this leaks ~${(growth / leak.measureCycles).toFixed(1)} ` +
          "bytes per cycle",
      );
    }
    return `zero page growth across ${leak.measureCycles} cycles of ${leak.entities} entities`;
  });

  await run("tier4/destroy-idempotent", "4", true, (driver) => {
    driver.destroy();
    driver.destroy();
    if (driver.entityCount() !== 0) {
      throw new Error("double destroy left a non-zero entity count");
    }
    const dead = driver.propagate(elements[0].epochJd, 0);
    if (dead.status !== ErrorCode.NOT_INITIALIZED) {
      throw new Error(
        `a destroyed module answered ${dead.status} instead of refusing with ` +
          "NOT_INITIALIZED — it is reading freed state",
      );
    }
    if (driver.initFromOmm([elements[0]]) !== 1) {
      throw new Error("module did not come back cleanly after destroy");
    }
    if (driver.propagate(elements[0].epochJd, 0).status !== ErrorCode.OK) {
      throw new Error("post-destroy re-ingest does not propagate");
    }
    return "destroy is idempotent, refuses typed, and the module comes back cleanly";
  });

  await run("tier4/leak-metric-negative-control", "4", true, (driver) => {
    for (let i = 0; i < 5; i += 1) cycle(driver, 64);
    const baselineBytes = driver.memoryBytes();
    let leaked = 0;
    while (driver.memoryBytes() === baselineBytes) {
      driver.alloc(1 << 16);
      leaked += 1;
      if (leaked >= 100000) {
        throw new Error(
          "allocating 64 KiB blocks never grew linear memory — the leak metric " +
            "cannot move, so the leak test above is measuring nothing",
        );
      }
    }
    return `deliberate leak moved the metric after ${leaked} allocations — the gate has been seen to fail`;
  });

  return checks;
}
