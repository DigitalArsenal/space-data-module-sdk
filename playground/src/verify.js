/**
 * The playground's VERIFY and RUN stages — in the browser, against the bytes
 * the browser just compiled.
 *
 * WHAT RUNS HERE, AND WHAT HONESTLY CANNOT (Janus ruling, 2026-08-14)
 * -------------------------------------------------------------------
 * RUNS IN-BROWSER:
 *   - artifact shape: analyzeWasmThreadFeatures() over the emitted bytes,
 *     plus explicit assertions that this single-thread artifact carries NO
 *     wasi_thread_start export and NO emscripten worker imports.
 *   - the propagator conformance suite: runPropagatorSuite() driven through
 *     PropagatorAbiDriver over a real WebAssembly.instantiate(). Tier 0
 *     (exports), Tier B (numeric anchors from buildSelfTestCorpus(), which
 *     generates from the SDK's INDEPENDENT two-body closed form), Tier C
 *     (invariants), Tier 4 (leak/lifecycle).
 *
 * DEFERRED — reported as a named GAP, never as a pass:
 *   - `space-data-module check` / manifest+standards validation: it reads the
 *     repo and the pinned SDS catalog from disk (node-only).
 *   - `space-data-module conformance propagator`: its loader is
 *     loadPropagatorArtifact(), which is node:fs + node:wasi. The SUITE it
 *     runs is the same one used here; the CLI wrapper is what is node-only.
 *   - the tri-runtime parity gate (browser / WasmEdge / Docker WasmEdge
 *     byte-identical execution). One runtime cannot certify three.
 *   - the isomorphic wasm32-wasip1-threads artifact. compileWithWasiThreads
 *     shells out to a system clang; there is no browser path to it, so the
 *     playground never claims one.
 */

import {
  PropagatorAbiDriver,
  REQUIRED_ABI_EXPORTS,
} from "../../src/conformance/abiDriver.js";
import {
  computeVerdict,
  runPropagatorSuite,
} from "../../src/conformance/propagatorSuite.js";
import { buildSelfTestCorpus } from "../../src/conformance/selfTestCorpus.js";
import { propagateTwoBody } from "../../src/conformance/twoBodyReference.js";
import { analyzeWasmThreadFeatures } from "../../src/compiler/pthreadArtifactGuard.js";
import { createBrowserWasiShim } from "../../src/host/wasiShim.js";
import { ORBPRO_STATE_VECTOR } from "../../src/generated/orbpro/propagator-abi.js";

export { propagateTwoBody, ORBPRO_STATE_VECTOR };

/**
 * DEFECT COMPENSATION, named rather than hidden.
 *
 * src/conformance/propagatorSuite.js:323 compares state-vector bytes with
 * node's `Buffer.compare(Buffer.from(a), Buffer.from(b))`. Everything else in
 * the suite is runtime-neutral, so that one line is the only thing standing
 * between the shipped conformance kit and a browser. Without this shim the
 * tierC/determinism-byte-identity check reports "Buffer is not defined" — a
 * FAIL that says nothing about the module under test.
 *
 * The real fix is to drop `Buffer` from the suite in favour of a plain
 * Uint8Array comparison; that file sits outside this task's claimed write
 * scope (module-sdk is whole-component-claimed by sdk-docs-site-harness-
 * families), so it is filed as its own graph task rather than edited here.
 * This shim installs ONLY the two members the suite touches, and only if
 * nothing already provides them — it must never quietly stand in for a real
 * Buffer somewhere else.
 */
function installBufferCompareShim() {
  if (typeof globalThis.Buffer !== "undefined") return;
  globalThis.Buffer = {
    from(value) {
      return value instanceof Uint8Array ? value : new Uint8Array(value);
    },
    compare(a, b) {
      if (a.length !== b.length) return a.length < b.length ? -1 : 1;
      for (let index = 0; index < a.length; index += 1) {
        if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
      }
      return 0;
    },
  };
}

/**
 * Instantiate compiled bytes under the SDK's browser WASI shim and wrap them
 * in the conformance driver.
 *
 * `_start` is deliberately NOT called — exactly as the node driver documents:
 * for an artifact declaring the command invoke surface, `_start` is the
 * stdin-driven invoke loop and would block forever. The propagator ABI is a
 * set of directly-callable exports, which is how the engine calls it too.
 */
export async function instantiateDriver(wasmBytes) {
  const module = await WebAssembly.compile(wasmBytes);
  const shim = createBrowserWasiShim({ args: ["module"], env: {} });
  const instance = await WebAssembly.instantiate(module, shim.imports);
  // The shim reads guest linear memory through whatever the instance exports;
  // it must be handed that memory before the first WASI call.
  shim.setMemory(instance.exports.memory);
  // Standalone-wasm reactors expose `_initialize`; running it is what makes
  // C++ global constructors (the module's std::vector state, the embedded
  // manifest tables) exist before the first ABI call.
  if (typeof instance.exports._initialize === "function") {
    instance.exports._initialize();
  }
  return new PropagatorAbiDriver(instance);
}

/** The named gaps this lane cannot adjudicate. Rendered, never hidden. */
export const BROWSER_LANE_GAPS = Object.freeze([
  {
    id: "isomorphic-wasip1-threads-artifact",
    detail:
      "This is the emception em++ STANDALONE_WASM single-thread teaching build. " +
      "The module's shipped artifact is clang wasm32-wasip1-threads (wasi-sequential) " +
      "built by the SDK's node lane; it cannot be produced in a browser and is not " +
      "produced here. These bytes must never be published as dist/isomorphic/module.wasm.",
  },
  {
    id: "tri-runtime-parity",
    detail:
      "browser / WasmEdge / Docker-WasmEdge byte-identical execution is the parity " +
      "gate's verdict (npm run gate:parity). One runtime cannot certify three.",
  },
  {
    id: "manifest-standards-validation",
    detail:
      "`space-data-module check` validates the manifest against the pinned SDS " +
      "catalog on disk — node-only. The manifest embedded in these bytes was " +
      "generated at build time by that same SDK code, but is not re-validated here.",
  },
  {
    id: "artifact-signing-and-publication",
    detail:
      "protect / sign / PMM publication is a key-holding lane and deliberately has " +
      "no browser path.",
  },
]);

/**
 * Artifact-shape checks appropriate to THIS lane.
 *
 * Note what is NOT called: assertSequentialArtifact(). It requires the
 * sanctioned wasm32-wasip1-threads target and would correctly reject em++
 * output — invoking it here and catching the failure would be theatre.
 * analyzeWasmThreadFeatures() is the honest read.
 */
export function inspectArtifact(wasmBytes) {
  const checks = [];
  let features = null;
  try {
    features = analyzeWasmThreadFeatures(wasmBytes);
  } catch (error) {
    checks.push({
      id: "artifact/thread-features",
      status: "fail",
      detail: `could not analyze the emitted wasm: ${error.message}`,
    });
    return { features: null, checks };
  }

  checks.push({
    id: "artifact/thread-features",
    status: "pass",
    detail:
      `hasSharedMemory=${features.hasSharedMemory} usesAtomics=${features.usesAtomics} ` +
      `hasWasiThreadSpawnImport=${features.hasWasiThreadSpawnImport} ` +
      `isIsomorphicPthreads=${features.isIsomorphicPthreads}`,
  });

  const exportsThreadStart = Boolean(features.hasWasiThreadStartExport);
  checks.push({
    id: "artifact/no-wasi-thread-start",
    status: exportsThreadStart ? "fail" : "pass",
    detail: exportsThreadStart
      ? "artifact exports wasi_thread_start — a single-thread teaching build must not"
      : "no wasi_thread_start export, as a single-thread build requires",
  });

  const workerImports = features.emscriptenThreadHooks ?? [];
  checks.push({
    id: "artifact/no-emscripten-worker-imports",
    status: workerImports.length === 0 ? "pass" : "fail",
    detail:
      workerImports.length === 0
        ? "no emscripten Web-Worker thread imports"
        : `emscripten worker imports present: ${workerImports.join(", ")}`,
  });

  return { features, checks };
}

/**
 * Run the full browser verify lane.
 *
 * The corpus is buildSelfTestCorpus() — Tier-B anchors generated at runtime
 * from the SDK's independent two-body closed form. That makes the verdict a
 * REAL numeric adjudication for a two-body module and a REAL failure for a
 * module that does not move: a scaffold with unfilled physics fails Tier B
 * here, by name, which is the check working.
 */
export async function verify(wasmBytes) {
  const started = performance.now();
  installBufferCompareShim();
  const artifact = inspectArtifact(wasmBytes);

  const corpus = buildSelfTestCorpus();
  const checks = await runPropagatorSuite(() => instantiateDriver(wasmBytes), {
    corpus,
    // The default 200-cycle leak measurement is a node-CI budget; a browser
    // tab gets a smaller but still falsifiable one.
    leak: { warmupCycles: 5, measureCycles: 40, entities: 64 },
  });

  const allChecks = [
    ...artifact.checks.map((check) => ({ ...check, tier: "artifact", required: true })),
    ...checks,
  ];

  return {
    verdict: computeVerdict(allChecks),
    checks: allChecks,
    requiredExports: REQUIRED_ABI_EXPORTS,
    features: artifact.features,
    corpus: {
      cases: corpus.cases.length,
      model: corpus.conformance.model,
      tolerancePolicy: corpus.tolerancePolicy,
    },
    gaps: BROWSER_LANE_GAPS,
    elapsedMs: performance.now() - started,
  };
}

/** A single element set the RUN stage propagates and plots. ISS-like. */
export const RUN_ELEMENTS = Object.freeze({
  epochJd: 2460000.5,
  meanMotionRevPerDay: 15.5,
  eccentricity: 0.0006703,
  inclinationDeg: 51.64,
  raOfAscNodeDeg: 208.9163,
  argOfPericenterDeg: 30.8756,
  meanAnomalyDeg: 0,
  noradCatId: 25544,
});

/**
 * RUN: drive the compiled module over a time series and return the ephemeris
 * side by side with the independent reference, so the plot is never the only
 * evidence.
 */
export async function run(wasmBytes, { minutes = 95, steps = 96 } = {}) {
  const driver = await instantiateDriver(wasmBytes);
  const ingested = driver.initFromOmm([RUN_ELEMENTS]);
  if (ingested !== 1) {
    throw new Error(
      `plugin_init_omm returned ${ingested} for one record — expected 1`,
    );
  }

  const samples = [];
  let maxPositionErrorM = 0;
  let maxVelocityErrorMs = 0;
  for (let index = 0; index <= steps; index += 1) {
    const offsetMinutes = (minutes * index) / steps;
    const julianDate = RUN_ELEMENTS.epochJd + offsetMinutes / 1440;
    const { status, state } = driver.propagate(julianDate, 0);
    if (status !== 0) {
      throw new Error(
        `plugin_propagate returned ${status} at +${offsetMinutes.toFixed(1)} min ` +
          "(see the ABI error-code table in docs/propagator-abi.md)",
      );
    }
    const reference = propagateTwoBody(RUN_ELEMENTS, julianDate);
    const positionErrorM = Math.hypot(
      state.position[0] - reference.position[0],
      state.position[1] - reference.position[1],
      state.position[2] - reference.position[2],
    );
    const velocityErrorMs = Math.hypot(
      state.velocity[0] - reference.velocity[0],
      state.velocity[1] - reference.velocity[1],
      state.velocity[2] - reference.velocity[2],
    );
    maxPositionErrorM = Math.max(maxPositionErrorM, positionErrorM);
    maxVelocityErrorMs = Math.max(maxVelocityErrorMs, velocityErrorMs);
    samples.push({
      offsetMinutes,
      julianDate,
      position: state.position,
      velocity: state.velocity,
      referencePosition: reference.position,
      referenceVelocity: reference.velocity,
      positionErrorM,
      velocityErrorMs,
      referenceFrame: state.referenceFrame,
      flags: state.flags,
    });
  }
  driver.destroy();

  return {
    elements: RUN_ELEMENTS,
    samples,
    maxPositionErrorM,
    maxVelocityErrorMs,
  };
}
