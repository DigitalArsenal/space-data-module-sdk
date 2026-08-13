/**
 * `space-data-module conformance propagator --self-test` — must exit 0 BY
 * failing (finding §5). A gate never observed to fail is indistinguishable
 * from one that cannot fail, so the runner ships with a battery of mock
 * propagators, each carrying ONE planted defect drawn from a real defect this
 * program found in the wild, and requires the suite to catch every one of
 * them — plus a conformant baseline it must NOT flag.
 *
 * The mocks implement the same driver interface the WASM ABI driver exposes,
 * so the suite under test is byte-for-byte the suite that adjudicates real
 * artifacts. No toolchain, no artifact, no network.
 */

import { ORBPRO_STATE_VECTOR, ReferenceFrame, StateFlags, ErrorCode, REQUIRED_ABI_EXPORTS } from "./abiDriver.js";
import { computeVerdict, runPropagatorSuite } from "./propagatorSuite.js";
import { BANDS_DEFAULT, buildSelfTestCorpus } from "./selfTestCorpus.js";
import { propagateTwoBody } from "./twoBodyReference.js";

const PAGE = 65536;

/** Encode a state through the GENERATED layout, so byte-identity is honest. */
function packStateVector(state) {
  const bytes = new Uint8Array(ORBPRO_STATE_VECTOR.size);
  const view = new DataView(bytes.buffer);
  const { offsets } = ORBPRO_STATE_VECTOR;
  view.setFloat64(offsets.epoch, state.epoch, true);
  for (const axis of [0, 1, 2]) {
    view.setFloat64(offsets.position + axis * 8, state.position[axis], true);
    view.setFloat64(offsets.velocity + axis * 8, state.velocity[axis], true);
  }
  view.setUint8(offsets.reference_frame, state.referenceFrame);
  bytes[offsets.reference_frame + 1] = state.reserved?.[0] ?? 0;
  bytes[offsets.reference_frame + 2] = state.reserved?.[1] ?? 0;
  bytes[offsets.reference_frame + 3] = state.reserved?.[2] ?? 0;
  view.setUint32(offsets.flags, state.flags, true);
  return bytes;
}

function decodePacked(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { offsets } = ORBPRO_STATE_VECTOR;
  return {
    epoch: view.getFloat64(offsets.epoch, true),
    position: [0, 1, 2].map((axis) => view.getFloat64(offsets.position + axis * 8, true)),
    velocity: [0, 1, 2].map((axis) => view.getFloat64(offsets.velocity + axis * 8, true)),
    referenceFrame: view.getUint8(offsets.reference_frame),
    reserved: [1, 2, 3].map((i) => view.getUint8(offsets.reference_frame + i)),
    flags: view.getUint32(offsets.flags, true),
  };
}

/**
 * A mock propagator with a simulated linear memory (never shrinks, grows in
 * whole pages — WebAssembly semantics, so the leak test measures the same
 * thing it measures on a real artifact).
 */
class MockPropagatorDriver {
  constructor(defect = null) {
    this.defect = defect;
    this.records = null;
    // One page: tight enough that a per-cycle leak of a few KiB reaches a
    // page boundary inside the self-test's measurement window.
    this.capacityBytes = PAGE;
    this.arenaBytes = 0;
    this.bumpBytes = 0;
    this.callSerial = 0;
  }

  exportNames() {
    if (this.defect === "missing-exports") {
      return REQUIRED_ABI_EXPORTS.filter((name) => name !== "plugin_destroy");
    }
    return [...REQUIRED_ABI_EXPORTS];
  }

  memoryBytes() {
    return this.capacityBytes;
  }

  #reserve(byteLength) {
    this.arenaBytes += byteLength;
    const needed = this.arenaBytes + this.bumpBytes;
    while (needed > this.capacityBytes) {
      this.capacityBytes += PAGE;
    }
  }

  alloc(byteLength) {
    this.bumpBytes += byteLength;
    const needed = this.arenaBytes + this.bumpBytes;
    while (needed > this.capacityBytes) {
      this.capacityBytes += PAGE;
    }
    return 8; // aligned, non-zero; the mock has no real address space
  }

  free() {
    // bump allocator: freed on destroy, like the reference module's arena
  }

  #validate(record) {
    if (!(record.eccentricity < 1) || !(record.meanMotionRevPerDay > 0)) {
      return false;
    }
    return true;
  }

  initFromOmm(records) {
    if (this.defect !== "confident-nonsense") {
      for (const record of records) {
        if (!this.#validate(record)) return ErrorCode.UNPHYSICAL;
      }
    }
    this.records = [...records];
    this.#reserve(records.length * 88);
    return this.records.length;
  }

  ingestOne(record) {
    if (this.defect !== "confident-nonsense" && !this.#validate(record)) {
      return ErrorCode.UNPHYSICAL;
    }
    if (!this.records) this.records = [];
    this.records.push(record);
    this.#reserve(88);
    if (this.defect === "count-fallback") {
      // The defect the create-returns-handle primitive exists to kill: the
      // module "returns success" instead of the handle it assigned.
      return 0;
    }
    return this.records.length - 1;
  }

  #state(julianDate, record) {
    const propagated = propagateTwoBody(record, julianDate);
    let { position, velocity } = propagated;
    if (this.defect === "units-km") {
      position = position.map((value) => value / 1000);
      velocity = velocity.map((value) => value / 1000);
    }
    if (this.defect === "nondeterministic") {
      this.callSerial += 1;
      position = position.map((value) => value + this.callSerial * 1e-9);
    }
    return {
      epoch: julianDate,
      position,
      velocity,
      referenceFrame:
        this.defect === "frame-lies" ? ReferenceFrame.TEME : ReferenceFrame.ECEF,
      reserved: [0, 0, 0],
      flags: StateFlags.VALID,
    };
  }

  propagate(julianDate, entityIndex) {
    if (!this.records || this.records.length === 0) {
      return { status: ErrorCode.NOT_INITIALIZED, state: null, bytes: new Uint8Array(64) };
    }
    if (!(entityIndex >= 0 && entityIndex < this.records.length)) {
      return { status: ErrorCode.BAD_ENTITY_INDEX, state: null, bytes: new Uint8Array(64) };
    }
    const bytes = packStateVector(this.#state(julianDate, this.records[entityIndex]));
    return { status: ErrorCode.OK, state: decodePacked(bytes), bytes };
  }

  propagateBatch(julianDate, count) {
    if (!this.records || this.records.length === 0) {
      return { status: ErrorCode.NOT_INITIALIZED, states: [] };
    }
    if (!(count >= 0 && count <= this.records.length)) {
      return { status: ErrorCode.BAD_ENTITY_INDEX, states: [] };
    }
    const states = [];
    for (let index = 0; index < count; index += 1) {
      const state = this.#state(julianDate, this.records[index]);
      if (this.defect === "batch-divergence") {
        state.position = [state.position[0] + 1e-3, state.position[1], state.position[2]];
      }
      states.push(decodePacked(packStateVector(state)));
    }
    return { status: ErrorCode.OK, states };
  }

  entityCount() {
    return this.records ? this.records.length : 0;
  }

  destroy() {
    this.records = null;
    this.bumpBytes = 0;
    if (this.defect !== "leaky-destroy") {
      this.arenaBytes = 0;
    }
    // capacityBytes deliberately never shrinks: wasm linear memory semantics.
  }
}

/**
 * Every planted defect names the check that must catch it. Each is a real
 * defect class this program found live (finding §4): the 1000x units error,
 * the {} destroy, the silent acceptance of unphysical elements, the count-1
 * identity race, an undeclared frame, a batch path that is not the same
 * physics, nondeterminism.
 */
export const PLANTED_DEFECTS = Object.freeze([
  { defect: "units-km", mustFail: "tierB/anchors" },
  { defect: "leaky-destroy", mustFail: "tier4/lifecycle-leak" },
  { defect: "confident-nonsense", mustFail: "tierC/typed-refusals" },
  { defect: "count-fallback", mustFail: "tierC/create-returns-handle" },
  { defect: "frame-lies", mustFail: "tierC/frame-flags-reserved-declared" },
  { defect: "batch-divergence", mustFail: "tierC/batch-single-agreement" },
  { defect: "nondeterministic", mustFail: "tierC/determinism-byte-identity" },
  { defect: "missing-exports", mustFail: "tier0/instantiation-and-exports" },
]);

/**
 * Run the self-test. Returns {ok, results}: ok only when the baseline mock is
 * clean AND every planted defect is caught by the check that owns it.
 */
export async function runPropagatorSelfTest(options = {}) {
  const corpus = buildSelfTestCorpus();
  // Small leak windows: the mocks' allocator is deterministic, so the steady
  // state is reached immediately; what matters is that the LEAKY mock grows.
  const leak = options.leak ?? { warmupCycles: 6, measureCycles: 40, entities: 128 };
  const results = [];

  const baselineChecks = await runPropagatorSuite(
    async () => new MockPropagatorDriver(null),
    { corpus, leak },
  );
  const baselineVerdict = computeVerdict(baselineChecks);
  const baselineOk = baselineVerdict !== "FAIL";
  results.push({
    scenario: "baseline-conformant-mock",
    expected: "no failures",
    verdict: baselineVerdict,
    ok: baselineOk,
    failed: baselineChecks.filter((check) => check.status === "fail").map((c) => c.id),
  });

  for (const { defect, mustFail } of PLANTED_DEFECTS) {
    const checks = await runPropagatorSuite(
      async () => new MockPropagatorDriver(defect),
      { corpus, leak },
    );
    const verdict = computeVerdict(checks);
    const failedIds = checks.filter((check) => check.status === "fail").map((c) => c.id);
    const caught = verdict === "FAIL" && failedIds.includes(mustFail);
    results.push({
      scenario: `planted:${defect}`,
      expected: `FAIL at ${mustFail}`,
      verdict,
      ok: caught,
      failed: failedIds,
    });
  }

  return { ok: results.every((entry) => entry.ok), results, bands: BANDS_DEFAULT };
}

export function formatSelfTestReport(outcome) {
  const lines = [];
  lines.push(
    `conformance self-test — ${outcome.ok ? "OK (the gate has been seen to fail)" : "BROKEN"}`,
  );
  for (const entry of outcome.results) {
    const marker = entry.ok ? "ok  " : "MISS";
    lines.push(
      `  [${marker}] ${entry.scenario}: expected ${entry.expected}, verdict ${entry.verdict}` +
        (entry.failed.length > 0 ? ` (failed: ${entry.failed.join(", ")})` : ""),
    );
  }
  return lines.join("\n");
}
