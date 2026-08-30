import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  makeEstimationReferenceEvidence,
  runEstimationSelfTest,
  runEstimationSuite,
} from "../src/conformance/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("generated estimation ABI remains synchronized with Estimation.fbs", () => {
  execFileSync(process.execPath, [path.join(root, "scripts/check-estimation-abi.mjs")], {
    cwd: root,
    stdio: "pipe",
  });
  const header = fs.readFileSync(path.join(root, "include/orbpro/orbpro_estimation_abi.h"), "utf8");
  assert.match(header, /OrbProEstimationObservation must be 376 bytes/);
  assert.match(header, /OrbProInitialOrbitRequest must be 240 bytes/);
  assert.match(header, /offsetof\(OrbProEstimationObservation, station_east\) == 128/);
});

test("the estimation conformance reference receipt passes every required tier", () => {
  const report = runEstimationSuite(makeEstimationReferenceEvidence());
  assert.equal(report.verdict, "PASS", JSON.stringify(report, null, 2));
  assert.ok(report.checks.length >= 25);
  assert.ok(report.checks.every((check) => check.required && check.status === "pass"));
});

test("the conformance kit catches the old EKF/UKF alias and a placeholder OCM", () => {
  const alias = makeEstimationReferenceEvidence();
  alias.filter.ekfUkfCovarianceDifference = 0;
  assert.equal(runEstimationSuite(alias).verdict, "FAIL");

  const placeholder = makeEstimationReferenceEvidence();
  placeholder.invariants.actualOcmCovariance = false;
  assert.equal(runEstimationSuite(placeholder).verdict, "FAIL");
});

test("estimation negative controls prove the evaluator can fail", async () => {
  const result = await runEstimationSelfTest();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.controls.length, 3);
});
