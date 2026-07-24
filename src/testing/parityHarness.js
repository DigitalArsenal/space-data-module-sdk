/**
 * Tri-runtime parity harness — ONE dist/isomorphic/module.wasm, THREE lanes:
 *
 *   1. "browser"          — real headless Chrome (COOP/COEP-served page, the SDK
 *                           browser WASI shim; never jsdom).
 *   2. "wasmedge"         — native WasmEdge binary, version-locked to the pin.
 *   3. "docker-wasmedge"  — pinned Docker WasmEdge container.
 *
 * Identical inputs (the SAME encoded stdin bytes, the SAME scripted guest env
 * and args, delivered explicitly — never ambient host state) must produce
 * byte-identical outputs and identical error/trap classes across every lane
 * and every thread count. Any divergence is a P1 SDK defect and the harness
 * FAILS LOUDLY: non-zero exit, per-case mismatch report with SHA-256 digests
 * and the first divergent byte offset.
 *
 * The WasmEdge version pin (native binary AND docker image) lives in ONE
 * place: src/testing/wasmedgePin.json. Both wasmedge lanes verify the live
 * runtime against that pin before executing anything; drift is itself a
 * failure ("pin-drift"), never a warning.
 *
 * Node-only module (lane runners spawn processes / servers). The browser-side
 * code that runs inside Chrome is bundled from parityBrowserRunner.js.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { encodePluginInvokeRequest } from "../invoke/codec.js";
import { toUint8Array } from "../runtime/bufferLike.js";
import { toLoadableWasmBytes } from "./browserModuleHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PARITY_LANES = Object.freeze([
  "browser",
  "wasmedge",
  "docker-wasmedge",
]);

export const DEFAULT_THREAD_ENV_VAR = "SDM_PARITY_THREADS";
export const DEFAULT_THREAD_COUNTS = Object.freeze([1]);

/** Exit classes every lane runner must normalize to. */
export const ExitClass = Object.freeze({
  Ok: "ok",
  GuestError: "guest-error",
  Trap: "trap",
  HarnessFailure: "harness-failure",
});

// --- Pin (single source of truth) ------------------------------------------

/**
 * Load the WasmEdge runtime pin. This is THE one place the native-binary and
 * docker-image versions come from; the docker image tag is derived here and
 * nowhere else, so the pair can only bump together.
 */
export function loadWasmEdgePin() {
  const pinPath = path.join(__dirname, "wasmedgePin.json");
  const pin = JSON.parse(readFileSync(pinPath, "utf8"));
  const version = String(pin.wasmedgeVersion ?? "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `wasmedgePin.json wasmedgeVersion must be a semver string, got "${version}".`,
    );
  }
  const repository = String(pin.dockerImageRepository ?? "").trim();
  if (!repository) {
    throw new Error("wasmedgePin.json dockerImageRepository is required.");
  }
  return Object.freeze({
    wasmedgeVersion: version,
    dockerImageRepository: repository,
    dockerImage: `${repository}:${version}`,
    dockerfilePath: path.join(__dirname, String(pin.dockerfile)),
    dockerfileContextDir: path.dirname(
      path.join(__dirname, String(pin.dockerfile)),
    ),
    pinPath,
  });
}

/**
 * Assert a `wasmedge --version` style output matches the pin exactly.
 * Loud pin-drift error otherwise — drift between the host-embedded runtime
 * and the container runtime is itself a defect, never a warning.
 */
export function assertWasmEdgeVersionMatchesPin(versionOutput, pin, context) {
  const match = /wasmedge version\s+([0-9]+\.[0-9]+\.[0-9]+)/i.exec(
    String(versionOutput ?? ""),
  );
  if (!match) {
    throw new Error(
      `PARITY PIN-DRIFT (${context}): could not parse a WasmEdge version from: ${String(versionOutput).trim().slice(0, 200)}`,
    );
  }
  if (match[1] !== pin.wasmedgeVersion) {
    throw new Error(
      `PARITY PIN-DRIFT (${context}): runtime reports WasmEdge ${match[1]} but src/testing/wasmedgePin.json pins ${pin.wasmedgeVersion}. ` +
        "Host and container WasmEdge versions pin and bump TOGETHER; align the runtime with the pin (or bump the pin pair deliberately).",
    );
  }
  return match[1];
}

// --- Fixture normalization ---------------------------------------------------

function decodeBase64(value) {
  return new Uint8Array(Buffer.from(String(value), "base64"));
}

function decodeHex(value) {
  const clean = String(value).replace(/\s+/g, "");
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error("Invalid hex payload in parity fixture.");
  }
  return new Uint8Array(Buffer.from(clean, "hex"));
}

async function resolveCasePayload(spec, fixtureDir, label) {
  if (spec.payloadFile !== undefined) {
    const filePath = path.resolve(fixtureDir, String(spec.payloadFile));
    return new Uint8Array(await readFile(filePath));
  }
  if (spec.payloadBase64 !== undefined) return decodeBase64(spec.payloadBase64);
  if (spec.payloadHex !== undefined) return decodeHex(spec.payloadHex);
  if (spec.payloadUtf8 !== undefined) {
    return new TextEncoder().encode(String(spec.payloadUtf8));
  }
  if (spec.payload !== undefined) {
    const bytes = toUint8Array(spec.payload);
    if (bytes) return bytes;
  }
  throw new Error(
    `Parity fixture ${label}: input needs payloadFile, payloadBase64, payloadHex, payloadUtf8, or payload bytes.`,
  );
}

function normalizeEnv(env, label) {
  if (env === undefined || env === null) return {};
  if (typeof env !== "object" || Array.isArray(env)) {
    throw new Error(`Parity fixture ${label}: env must be a plain object.`);
  }
  const normalized = {};
  for (const [key, value] of Object.entries(env)) {
    normalized[String(key)] = String(value);
  }
  return normalized;
}

function normalizeExpect(expect, label) {
  if (expect === undefined || expect === null) return null;
  const value = String(expect);
  if (
    value !== ExitClass.Ok &&
    value !== ExitClass.GuestError &&
    value !== ExitClass.Trap
  ) {
    throw new Error(
      `Parity fixture ${label}: expect must be "ok", "guest-error", or "trap" (omit for class-parity-only).`,
    );
  }
  return value;
}

function normalizeThreadCounts(threadCounts, label) {
  if (threadCounts === undefined || threadCounts === null) return null;
  if (!Array.isArray(threadCounts) || threadCounts.length === 0) {
    throw new Error(
      `Parity fixture ${label}: threadCounts must be a non-empty array.`,
    );
  }
  const counts = threadCounts.map((value) => {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(
        `Parity fixture ${label}: thread counts must be positive integers.`,
      );
    }
    return count;
  });
  return Object.freeze([...new Set(counts)]);
}

/**
 * Normalize a parity fixture document into an executable plan. Every case is
 * reduced to EXACT stdin bytes here, once, on the orchestrating side — all
 * lanes then receive the identical bytes (base64 across the browser wire).
 *
 * Fixture shape:
 * {
 *   name, threadEnvVar?, threadCounts?, env?, args?,
 *   cases: [{
 *     id,
 *     request?: {methodId, inputs:[{portId, payloadFile|payloadBase64|payloadHex|payloadUtf8, typeRef?}], ...},
 *     stdinFile? | stdinBase64? | stdinHex? | stdinUtf8?,
 *     env?, args?, expect?: "ok"|"guest-error"|"trap", threadCounts?
 *   }]
 * }
 */
export async function normalizeParityFixture(fixture, options = {}) {
  if (!fixture || typeof fixture !== "object") {
    throw new Error("Parity fixture must be an object.");
  }
  const fixtureDir = options.fixtureDir ?? process.cwd();
  const name = String(fixture.name ?? "parity-fixture");
  const threadEnvVar = String(fixture.threadEnvVar ?? DEFAULT_THREAD_ENV_VAR);
  const fixtureThreadCounts =
    normalizeThreadCounts(fixture.threadCounts, name) ?? DEFAULT_THREAD_COUNTS;
  const fixtureEnv = normalizeEnv(fixture.env, name);
  const fixtureArgs = Array.isArray(fixture.args)
    ? fixture.args.map(String)
    : [];

  if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) {
    throw new Error(`Parity fixture ${name}: cases[] must be non-empty.`);
  }

  const cases = [];
  const seenIds = new Set();
  for (const caseSpec of fixture.cases) {
    const id = String(caseSpec?.id ?? "").trim();
    if (!id) throw new Error(`Parity fixture ${name}: every case needs an id.`);
    if (seenIds.has(id)) {
      throw new Error(`Parity fixture ${name}: duplicate case id "${id}".`);
    }
    seenIds.add(id);
    const label = `${name}/${id}`;

    let stdinBytes;
    if (caseSpec.request !== undefined) {
      const request = caseSpec.request;
      const inputs = [];
      for (const input of request.inputs ?? []) {
        inputs.push({
          ...input,
          payload: await resolveCasePayload(input, fixtureDir, label),
          payloadFile: undefined,
          payloadBase64: undefined,
          payloadHex: undefined,
          payloadUtf8: undefined,
        });
      }
      stdinBytes = encodePluginInvokeRequest({ ...request, inputs });
    } else if (caseSpec.stdinFile !== undefined) {
      stdinBytes = new Uint8Array(
        await readFile(path.resolve(fixtureDir, String(caseSpec.stdinFile))),
      );
    } else if (caseSpec.stdinBase64 !== undefined) {
      stdinBytes = decodeBase64(caseSpec.stdinBase64);
    } else if (caseSpec.stdinHex !== undefined) {
      stdinBytes = decodeHex(caseSpec.stdinHex);
    } else if (caseSpec.stdinUtf8 !== undefined) {
      stdinBytes = new TextEncoder().encode(String(caseSpec.stdinUtf8));
    } else {
      throw new Error(
        `Parity fixture ${label}: case needs request or stdinFile/stdinBase64/stdinHex/stdinUtf8.`,
      );
    }

    cases.push(
      Object.freeze({
        id,
        stdinBytes,
        env: Object.freeze({ ...fixtureEnv, ...normalizeEnv(caseSpec.env, label) }),
        args: Object.freeze(
          Array.isArray(caseSpec.args) ? caseSpec.args.map(String) : fixtureArgs,
        ),
        expect: normalizeExpect(caseSpec.expect, label),
        threadCounts:
          normalizeThreadCounts(caseSpec.threadCounts, label) ??
          fixtureThreadCounts,
      }),
    );
  }

  return Object.freeze({ name, threadEnvVar, cases: Object.freeze(cases) });
}

export async function loadParityFixture(fixturePath) {
  const resolved = path.resolve(fixturePath);
  const fixture = JSON.parse(await readFile(resolved, "utf8"));
  return normalizeParityFixture(fixture, {
    fixtureDir: path.dirname(resolved),
  });
}

// --- Diff engine --------------------------------------------------------------

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function firstDivergentOffset(a, b) {
  const limit = Math.min(a.length, b.length);
  for (let index = 0; index < limit; index += 1) {
    if (a[index] !== b[index]) return index;
  }
  return a.length === b.length ? -1 : limit;
}

function hexWindow(bytes, offset, radius = 8) {
  const start = Math.max(0, offset - radius);
  const end = Math.min(bytes.length, offset + radius);
  return Buffer.from(bytes.subarray(start, end)).toString("hex");
}

function runKey(run) {
  return `${run.lane}@t${run.threadCount}`;
}

/**
 * Compare lane results for one plan. `runs` is a flat array of
 * {lane, caseId, threadCount, exitClass, exitDetail?, stdout, stderr?, stateFiles?}.
 *
 * Rules (per case, across EVERY lane × thread-count run):
 *  - exit classes must all match (and match `expect` when the case sets one);
 *  - when the class is "ok", stdout must be byte-identical everywhere —
 *    within a lane across thread counts AND across lanes;
 *  - persisted state manifests (stateFiles: {relPath: sha256}) must be
 *    identical across every run that reports one (lanes without filesystem
 *    authority report null and are exempt, never silently equal).
 *
 * Returns {ok, failures:[{caseId, kind, message, runs:[...]}], comparisons}.
 */
export function diffParityRuns(plan, runs) {
  const failures = [];
  let comparisons = 0;

  for (const planCase of plan.cases) {
    const caseRuns = runs.filter((run) => run.caseId === planCase.id);
    const expectedRunCount = planCase.threadCounts.length;
    const lanes = [...new Set(caseRuns.map((run) => run.lane))];
    for (const lane of lanes) {
      const laneRuns = caseRuns.filter((run) => run.lane === lane);
      if (laneRuns.length !== expectedRunCount) {
        failures.push({
          caseId: planCase.id,
          kind: "missing-runs",
          message: `lane ${lane} produced ${laneRuns.length}/${expectedRunCount} runs`,
        });
      }
    }
    if (caseRuns.length === 0) {
      failures.push({
        caseId: planCase.id,
        kind: "missing-runs",
        message: "no lane produced a result for this case",
      });
      continue;
    }

    const harnessFailures = caseRuns.filter(
      (run) => run.exitClass === ExitClass.HarnessFailure,
    );
    for (const run of harnessFailures) {
      failures.push({
        caseId: planCase.id,
        kind: "harness-failure",
        message: `${runKey(run)}: ${run.exitDetail ?? "lane failed to execute"}`,
      });
    }
    const usable = caseRuns.filter(
      (run) => run.exitClass !== ExitClass.HarnessFailure,
    );
    if (usable.length === 0) continue;

    // Exit-class parity (+ expectation).
    const reference = usable[0];
    for (const run of usable) {
      comparisons += 1;
      if (planCase.expect && run.exitClass !== planCase.expect) {
        failures.push({
          caseId: planCase.id,
          kind: "expectation",
          message: `${runKey(run)}: expected class "${planCase.expect}", got "${run.exitClass}"${run.exitDetail ? ` (${run.exitDetail})` : ""}`,
        });
      }
      if (run.exitClass !== reference.exitClass) {
        failures.push({
          caseId: planCase.id,
          kind: "class-divergence",
          message: `${runKey(reference)} class "${reference.exitClass}" vs ${runKey(run)} class "${run.exitClass}"${run.exitDetail ? ` (${run.exitDetail})` : ""}`,
        });
      }
    }

    // Byte parity of outputs — only meaningful when everything agrees on "ok".
    const okRuns = usable.filter((run) => run.exitClass === ExitClass.Ok);
    if (okRuns.length > 1) {
      const base = okRuns[0];
      const baseStdout = toUint8Array(base.stdout) ?? new Uint8Array(0);
      for (const run of okRuns.slice(1)) {
        comparisons += 1;
        const stdout = toUint8Array(run.stdout) ?? new Uint8Array(0);
        const offset = firstDivergentOffset(baseStdout, stdout);
        if (offset !== -1) {
          failures.push({
            caseId: planCase.id,
            kind: "output-divergence",
            message:
              `${runKey(base)} stdout sha256=${sha256Hex(baseStdout).slice(0, 16)} len=${baseStdout.length} vs ` +
              `${runKey(run)} sha256=${sha256Hex(stdout).slice(0, 16)} len=${stdout.length}; ` +
              `first divergent byte at offset ${offset} ` +
              `(${runKey(base)}: ${hexWindow(baseStdout, offset)} | ${runKey(run)}: ${hexWindow(stdout, offset)})`,
          });
        }
      }
    }

    // Persisted-state parity across every run that reports a manifest.
    const stateRuns = usable.filter(
      (run) => run.stateFiles && typeof run.stateFiles === "object",
    );
    if (stateRuns.length > 1) {
      const base = stateRuns[0];
      const baseEntries = JSON.stringify(
        Object.entries(base.stateFiles).sort(([a], [b]) => a.localeCompare(b)),
      );
      for (const run of stateRuns.slice(1)) {
        comparisons += 1;
        const entries = JSON.stringify(
          Object.entries(run.stateFiles).sort(([a], [b]) => a.localeCompare(b)),
        );
        if (entries !== baseEntries) {
          failures.push({
            caseId: planCase.id,
            kind: "state-divergence",
            message: `${runKey(base)} persisted-state manifest != ${runKey(run)}: ${baseEntries} vs ${entries}`,
          });
        }
      }
    }
  }

  return { ok: failures.length === 0, failures, comparisons };
}

export function formatParityReport(report) {
  const lines = [];
  const laneSummary = report.lanes
    .map((lane) => `${lane.lane}(${lane.runs} runs, ${lane.durationMs}ms)`)
    .join(", ");
  lines.push(
    `parity ${report.ok ? "PASS" : "FAIL"} fixture=${report.fixture} module=${report.moduleSha256.slice(0, 16)} lanes=[${laneSummary}] comparisons=${report.comparisons}`,
  );
  for (const failure of report.failures) {
    lines.push(
      `  PARITY FAIL case=${failure.caseId ?? "-"} kind=${failure.kind}: ${failure.message}`,
    );
  }
  if (report.ok) {
    lines.push(
      `  ${report.cases.length} case(s) byte-identical across ${report.lanes.length} lane(s).`,
    );
  }
  return lines.join("\n");
}

// --- Orchestrator --------------------------------------------------------------

function applyInjectedDivergence(runs, injectDivergence) {
  if (!injectDivergence) return runs;
  const lane = String(injectDivergence);
  let injected = false;
  const mutated = runs.map((run) => {
    if (run.lane !== lane || injected) return run;
    const stdout = toUint8Array(run.stdout) ?? new Uint8Array(0);
    const flipped = stdout.slice();
    if (flipped.length === 0) {
      return { ...run, exitClass: ExitClass.Trap, exitDetail: "self-test-divergence" };
    }
    flipped[flipped.length - 1] ^= 0xff;
    injected = true;
    return { ...run, stdout: flipped };
  });
  if (!injected && !mutated.some((run) => run.exitDetail === "self-test-divergence")) {
    throw new Error(
      `--self-test-divergence: lane "${lane}" produced no runs to corrupt.`,
    );
  }
  return mutated;
}

/**
 * Run the parity harness.
 *
 * @param {Object} options
 * @param {string} options.wasmPath - the ONE module.wasm (dist/isomorphic).
 * @param {Object} [options.plan] - normalized fixture plan.
 * @param {string} [options.fixturePath] - fixture JSON path (alternative to plan).
 * @param {string[]} [options.lanes] - subset of PARITY_LANES. Defaults to ALL
 *   THREE. Narrowing is always an explicit caller decision — lanes are never
 *   skipped silently, and a single-lane run can never claim parity.
 * @param {Object} [options.laneRunners] - {laneName: async (context) => runs[]}
 *   override for tests. Default runners come from parityLanes.js.
 * @param {string} [options.injectDivergence] - fire-drill: XOR one output byte
 *   of this lane AFTER execution to prove the diff fails loudly end-to-end.
 * @returns {Promise<Object>} report {ok, failures, lanes, cases, ...}
 */
export async function runParityHarness(options = {}) {
  const wasmPath = options.wasmPath ? path.resolve(options.wasmPath) : null;
  if (!wasmPath) throw new Error("parity harness requires wasmPath.");
  const wasmBytes = new Uint8Array(await readFile(wasmPath));
  // Signed/published artifacts carry appended publication records that wasm
  // engines reject. Strip ONCE here so every lane executes the identical
  // canonical module payload.
  const loadableBytes = toLoadableWasmBytes(wasmBytes);

  const plan =
    options.plan ??
    (options.fixturePath
      ? await loadParityFixture(options.fixturePath)
      : null);
  if (!plan) throw new Error("parity harness requires plan or fixturePath.");

  const laneNames =
    options.lanes && options.lanes.length > 0
      ? options.lanes.map(String)
      : [...PARITY_LANES];
  for (const lane of laneNames) {
    if (!PARITY_LANES.includes(lane)) {
      throw new Error(
        `Unknown parity lane "${lane}". Lanes: ${PARITY_LANES.join(", ")}.`,
      );
    }
  }
  if (new Set(laneNames).size < 2 && !options.allowSingleLane) {
    throw new Error(
      "Parity requires at least two lanes; a single-lane run proves nothing. " +
        "(Pass allowSingleLane for lane bring-up debugging only.)",
    );
  }

  let laneRunners = options.laneRunners;
  if (!laneRunners) {
    const lanesModule = await import("./parityLanes.js");
    laneRunners = lanesModule.defaultParityLaneRunners;
  }

  const context = {
    wasmPath,
    wasmBytes,
    loadableBytes,
    plan,
    pin: loadWasmEdgePin(),
    log: options.log ?? (() => {}),
    chromeBinary: options.chromeBinary,
    wasmedgeBinary: options.wasmedgeBinary,
    dockerBinary: options.dockerBinary,
    dockerPlatform: options.dockerPlatform,
    autoBuildDockerImage: options.autoBuildDockerImage !== false,
    timeoutMs: options.timeoutMs ?? 120_000,
  };

  const allRuns = [];
  const laneStats = [];
  for (const lane of laneNames) {
    const runner = laneRunners[lane];
    if (typeof runner !== "function") {
      throw new Error(`No parity lane runner registered for "${lane}".`);
    }
    const startedAt = Date.now();
    let laneRuns;
    try {
      laneRuns = await runner(context);
    } catch (error) {
      // A lane that cannot execute at all is a loud harness failure for every
      // case — parity is unprovable, so the whole run fails.
      laneRuns = plan.cases.flatMap((planCase) =>
        planCase.threadCounts.map((threadCount) => ({
          lane,
          caseId: planCase.id,
          threadCount,
          exitClass: ExitClass.HarnessFailure,
          exitDetail: error?.message ?? String(error),
          stdout: new Uint8Array(0),
        })),
      );
    }
    laneStats.push({
      lane,
      runs: laneRuns.length,
      durationMs: Date.now() - startedAt,
    });
    allRuns.push(...laneRuns.map((run) => ({ ...run, lane })));
  }

  const runs = applyInjectedDivergence(allRuns, options.injectDivergence);
  const diff = diffParityRuns(plan, runs);

  return {
    ok: diff.ok,
    fixture: plan.name,
    wasmPath,
    artifactSha256: sha256Hex(wasmBytes),
    moduleSha256: sha256Hex(loadableBytes),
    pin: context.pin.wasmedgeVersion,
    lanes: laneStats,
    cases: plan.cases.map((planCase) => planCase.id),
    comparisons: diff.comparisons,
    failures: diff.failures,
    runs: runs.map((run) => ({
      lane: run.lane,
      caseId: run.caseId,
      threadCount: run.threadCount,
      exitClass: run.exitClass,
      exitDetail: run.exitDetail ?? null,
      stdoutSha256: sha256Hex(toUint8Array(run.stdout) ?? new Uint8Array(0)),
      stdoutLength: (toUint8Array(run.stdout) ?? new Uint8Array(0)).length,
    })),
  };
}
