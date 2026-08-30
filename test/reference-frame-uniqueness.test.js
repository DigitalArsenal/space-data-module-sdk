// The ReferenceFrame drift gate, run as a test.
//
// `npm test` globs test/*.test.js, so the script needs a test to reach CI —
// adding scripts/check-reference-frame-uniqueness.mjs alone would leave it
// unrun, which is how a gate becomes decoration.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "scripts", "check-reference-frame-uniqueness.mjs");

test("exactly one ReferenceFrame crosses the ABI seam, with stable numbering", () => {
  const run = spawnSync(process.execPath, [script], { cwd: repoRoot, encoding: "utf8" });
  if (run.stdout) {
    console.log(run.stdout.trim());
  }
  assert.equal(
    run.status,
    0,
    `check-reference-frame-uniqueness failed:\n${run.stderr || run.stdout}`,
  );
  assert.match(run.stdout, /check-reference-frame-uniqueness: PASS/);
});
