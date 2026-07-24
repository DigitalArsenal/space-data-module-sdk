import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  PARITY_LANES,
  DEFAULT_THREAD_ENV_VAR,
  ExitClass,
  assertWasmEdgeVersionMatchesPin,
  diffParityRuns,
  formatParityReport,
  loadWasmEdgePin,
  normalizeParityFixture,
  runParityHarness,
  sha256Hex,
} from "../src/testing/parityHarness.js";
import { decodePluginInvokeRequest } from "../src/invoke/codec.js";

// --- Pin: ONE source of truth for the native/docker WasmEdge pair ------------

test("wasmedge pin derives the docker image tag from the single pinned version", () => {
  const pin = loadWasmEdgePin();
  assert.match(pin.wasmedgeVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(pin.dockerImage, `${pin.dockerImageRepository}:${pin.wasmedgeVersion}`);
  assert.ok(pin.dockerfilePath.endsWith("wasmedge-parity.Dockerfile"));
});

test("pin drift between runtime and wasmedgePin.json fails loudly", () => {
  const pin = loadWasmEdgePin();
  assert.equal(
    assertWasmEdgeVersionMatchesPin(
      `wasmedge version ${pin.wasmedgeVersion}\n`,
      pin,
      "test",
    ),
    pin.wasmedgeVersion,
  );
  assert.throws(
    () => assertWasmEdgeVersionMatchesPin("wasmedge version 0.0.1\n", pin, "test"),
    /PARITY PIN-DRIFT/,
  );
  assert.throws(
    () => assertWasmEdgeVersionMatchesPin("no version here", pin, "test"),
    /PARITY PIN-DRIFT/,
  );
});

// --- Fixture normalization -----------------------------------------------------

test("normalizeParityFixture encodes request cases to canonical stdin bytes once", async () => {
  const plan = await normalizeParityFixture({
    name: "fx",
    threadCounts: [1, 4],
    env: { SHARED: "yes" },
    cases: [
      {
        id: "req",
        expect: "ok",
        env: { EXTRA: "1" },
        request: {
          methodId: "echo",
          inputs: [{ portId: "in", payloadUtf8: "hello" }],
        },
      },
      { id: "raw", stdinUtf8: "garbage", threadCounts: [1] },
    ],
  });

  assert.equal(plan.name, "fx");
  assert.equal(plan.threadEnvVar, DEFAULT_THREAD_ENV_VAR);
  assert.equal(plan.cases.length, 2);

  const requestCase = plan.cases[0];
  assert.deepEqual([...requestCase.threadCounts], [1, 4]);
  assert.deepEqual(requestCase.env, { SHARED: "yes", EXTRA: "1" });
  assert.equal(requestCase.expect, "ok");
  const decoded = decodePluginInvokeRequest(requestCase.stdinBytes);
  assert.equal(decoded.methodId, "echo");

  const rawCase = plan.cases[1];
  assert.deepEqual([...rawCase.threadCounts], [1]);
  assert.equal(Buffer.from(rawCase.stdinBytes).toString("utf8"), "garbage");
  assert.equal(rawCase.expect, null);
});

test("normalizeParityFixture rejects duplicate ids, bad expects, empty cases", async () => {
  await assert.rejects(
    normalizeParityFixture({ name: "fx", cases: [] }),
    /cases\[\] must be non-empty/,
  );
  await assert.rejects(
    normalizeParityFixture({
      name: "fx",
      cases: [
        { id: "a", stdinUtf8: "x" },
        { id: "a", stdinUtf8: "y" },
      ],
    }),
    /duplicate case id/,
  );
  await assert.rejects(
    normalizeParityFixture({
      name: "fx",
      cases: [{ id: "a", stdinUtf8: "x", expect: "sorta-ok" }],
    }),
    /expect must be/,
  );
  await assert.rejects(
    normalizeParityFixture({ name: "fx", cases: [{ id: "a" }] }),
    /request or stdinFile/,
  );
});

// --- Diff engine: divergence must FAIL, loudly ----------------------------------

function makePlan(overrides = {}) {
  return {
    name: "diff-plan",
    threadEnvVar: DEFAULT_THREAD_ENV_VAR,
    cases: [
      {
        id: "case-1",
        stdinBytes: new Uint8Array([1]),
        env: {},
        args: [],
        expect: overrides.expect ?? null,
        threadCounts: overrides.threadCounts ?? [1],
      },
    ],
  };
}

function run(lane, threadCount, stdout, extra = {}) {
  return {
    lane,
    caseId: "case-1",
    threadCount,
    exitClass: ExitClass.Ok,
    stdout: Uint8Array.from(stdout),
    ...extra,
  };
}

test("identical runs across three lanes pass", () => {
  const plan = makePlan();
  const runs = [
    run("browser", 1, [9, 9, 9]),
    run("wasmedge", 1, [9, 9, 9]),
    run("docker-wasmedge", 1, [9, 9, 9]),
  ];
  const diff = diffParityRuns(plan, runs);
  assert.equal(diff.ok, true);
  assert.equal(diff.failures.length, 0);
});

test("a single divergent byte in one lane fails loudly with offset + digests", () => {
  const plan = makePlan();
  const diff = diffParityRuns(plan, [
    run("browser", 1, [9, 9, 9]),
    run("wasmedge", 1, [9, 9, 9]),
    run("docker-wasmedge", 1, [9, 8, 9]),
  ]);
  assert.equal(diff.ok, false);
  const failure = diff.failures.find((f) => f.kind === "output-divergence");
  assert.ok(failure, "expected an output-divergence failure");
  assert.match(failure.message, /first divergent byte at offset 1/);
  assert.match(failure.message, /sha256=/);
  assert.match(failure.message, /docker-wasmedge@t1/);
});

test("thread-count divergence WITHIN a lane fails (1/2/4/8 must be byte-identical)", () => {
  const plan = makePlan({ threadCounts: [1, 2] });
  const diff = diffParityRuns(plan, [
    run("wasmedge", 1, [1, 2, 3]),
    run("wasmedge", 2, [1, 2, 4]),
    run("browser", 1, [1, 2, 3]),
    run("browser", 2, [1, 2, 3]),
  ]);
  assert.equal(diff.ok, false);
  assert.ok(
    diff.failures.some(
      (f) => f.kind === "output-divergence" && /wasmedge@t2/.test(f.message),
    ),
  );
});

test("error/trap class divergence across lanes fails", () => {
  const plan = makePlan();
  const diff = diffParityRuns(plan, [
    run("browser", 1, []),
    run("wasmedge", 1, [], { exitClass: ExitClass.Trap, exitDetail: "exit=134" }),
  ]);
  assert.equal(diff.ok, false);
  assert.ok(diff.failures.some((f) => f.kind === "class-divergence"));
});

test("expectation mismatch fails even when lanes agree with each other", () => {
  const plan = makePlan({ expect: ExitClass.Ok });
  const diff = diffParityRuns(plan, [
    run("browser", 1, [], { exitClass: ExitClass.GuestError, exitDetail: "exit=1" }),
    run("wasmedge", 1, [], { exitClass: ExitClass.GuestError, exitDetail: "exit=1" }),
  ]);
  assert.equal(diff.ok, false);
  assert.equal(
    diff.failures.filter((f) => f.kind === "expectation").length,
    2,
  );
});

test("missing lane runs and harness failures are failures, never silent skips", () => {
  const plan = makePlan({ threadCounts: [1, 2] });
  const diff = diffParityRuns(plan, [
    run("browser", 1, [7]),
    run("browser", 2, [7]),
    run("wasmedge", 1, [7]),
    // wasmedge t2 missing
    {
      lane: "docker-wasmedge",
      caseId: "case-1",
      threadCount: 1,
      exitClass: ExitClass.HarnessFailure,
      exitDetail: "docker not installed",
      stdout: new Uint8Array(0),
    },
  ]);
  assert.equal(diff.ok, false);
  assert.ok(diff.failures.some((f) => f.kind === "missing-runs"));
  assert.ok(
    diff.failures.some(
      (f) => f.kind === "harness-failure" && /docker not installed/.test(f.message),
    ),
  );
});

test("persisted-state manifests are compared across every lane that reports one", () => {
  const plan = makePlan();
  const diff = diffParityRuns(plan, [
    run("browser", 1, [1], { stateFiles: null }),
    run("wasmedge", 1, [1], { stateFiles: { "data/store.fsql": "aa".repeat(32) } }),
    run("docker-wasmedge", 1, [1], {
      stateFiles: { "data/store.fsql": "bb".repeat(32) },
    }),
  ]);
  assert.equal(diff.ok, false);
  assert.ok(diff.failures.some((f) => f.kind === "state-divergence"));
});

// --- Orchestrator ---------------------------------------------------------------

async function writeTempWasm() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sdm-parity-test-"));
  const wasmPath = path.join(dir, "module.wasm");
  await writeFile(wasmPath, Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]));
  return wasmPath;
}

function stubRunner(stdoutByCase) {
  return async (context) =>
    context.plan.cases.flatMap((planCase) =>
      planCase.threadCounts.map((threadCount) => ({
        caseId: planCase.id,
        threadCount,
        exitClass: ExitClass.Ok,
        stdout: Uint8Array.from(stdoutByCase[planCase.id] ?? [0]),
      })),
    );
}

test("runParityHarness passes with identical stub lanes and fails with --self-test-divergence", async () => {
  const wasmPath = await writeTempWasm();
  const plan = await normalizeParityFixture({
    name: "stub",
    cases: [{ id: "c", stdinUtf8: "x", expect: "ok" }],
  });
  const laneRunners = {
    browser: stubRunner({ c: [4, 2] }),
    wasmedge: stubRunner({ c: [4, 2] }),
    "docker-wasmedge": stubRunner({ c: [4, 2] }),
  };

  const pass = await runParityHarness({ wasmPath, plan, laneRunners });
  assert.equal(pass.ok, true);
  assert.equal(pass.lanes.length, 3);
  assert.match(formatParityReport(pass), /parity PASS/);

  // Fire drill: the SAME run with one lane's output corrupted by one byte
  // must FAIL loudly — this is the deliberately-divergent proof.
  const drill = await runParityHarness({
    wasmPath,
    plan,
    laneRunners,
    injectDivergence: "docker-wasmedge",
  });
  assert.equal(drill.ok, false);
  const text = formatParityReport(drill);
  assert.match(text, /parity FAIL/);
  assert.match(text, /PARITY FAIL case=c kind=output-divergence/);
  assert.match(text, /first divergent byte/);
});

test("a lane that cannot execute at all fails the whole run (no silent skip)", async () => {
  const wasmPath = await writeTempWasm();
  const plan = await normalizeParityFixture({
    name: "stub",
    cases: [{ id: "c", stdinUtf8: "x" }],
  });
  const report = await runParityHarness({
    wasmPath,
    plan,
    laneRunners: {
      browser: stubRunner({ c: [1] }),
      wasmedge: stubRunner({ c: [1] }),
      "docker-wasmedge": async () => {
        throw new Error("docker daemon unreachable");
      },
    },
  });
  assert.equal(report.ok, false);
  assert.ok(
    report.failures.some(
      (f) => f.kind === "harness-failure" && /docker daemon unreachable/.test(f.message),
    ),
  );
});

test("single-lane runs are rejected — parity needs at least two runtimes", async () => {
  const wasmPath = await writeTempWasm();
  const plan = await normalizeParityFixture({
    name: "stub",
    cases: [{ id: "c", stdinUtf8: "x" }],
  });
  await assert.rejects(
    runParityHarness({
      wasmPath,
      plan,
      lanes: ["wasmedge"],
      laneRunners: { wasmedge: stubRunner({ c: [1] }) },
    }),
    /at least two lanes/,
  );
  await assert.rejects(
    runParityHarness({ wasmPath, plan, lanes: ["jsdom"], laneRunners: {} }),
    /Unknown parity lane/,
  );
  assert.deepEqual([...PARITY_LANES], ["browser", "wasmedge", "docker-wasmedge"]);
});

test("sha256Hex is stable", () => {
  assert.equal(
    sha256Hex(new Uint8Array(0)),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});
