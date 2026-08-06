// hard-no-unreleased-deps-gate: generated code in this repo must be
// byte-reproducible from the RELEASED, PUBLISHED spacedatastandards.org
// package this repo pins. Exercises the actual CLI gate script (not a
// reimplementation of its logic) against the real committed tree, plus the
// two refusal paths (dirty-root override, non-tarball lock resolution).

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = path.join(packageRoot, "scripts", "check-generated-bindings.mjs");
const targetFile = path.join(
  packageRoot,
  "src",
  "generated",
  "spacedatastandards",
  "plg",
  "pluginCategory.ts",
);
const lockPath = path.join(packageRoot, "package-lock.json");

function runGate(env = {}) {
  return execFileAsync(process.execPath, [scriptPath], {
    cwd: packageRoot,
    env: { ...process.env, ...env },
  });
}

test("the generated-bindings gate PASSES on the real committed tree against the real pinned package", async () => {
  const { stdout } = await runGate();
  assert.match(stdout, /PASS/);
  assert.match(stdout, /byte-reproducible/);
});

test("the gate refuses SPACE_DATA_STANDARDS_ROOT — never a dirty sibling checkout", async () => {
  await assert.rejects(
    runGate({ SPACE_DATA_STANDARDS_ROOT: "/tmp/definitely-not-a-real-sds-checkout" }),
    (error) => {
      assert.match(error.stderr, /SPACE_DATA_STANDARDS_ROOT is set/);
      assert.match(error.stderr, /refuse/i);
      return true;
    },
  );
});

test("the gate refuses a file: (or unresolved-local) package-lock resolution", async (t) => {
  const original = await fs.readFile(lockPath, "utf8");
  t.after(async () => {
    await fs.writeFile(lockPath, original);
  });
  const lock = JSON.parse(original);
  lock.packages["node_modules/spacedatastandards.org"].resolved =
    "file:../spacedatastandards.org";
  await fs.writeFile(lockPath, JSON.stringify(lock));

  await assert.rejects(runGate(), (error) => {
    assert.match(error.stderr, /not a real released tarball URL/);
    assert.match(error.stderr, /Refusing/);
    return true;
  });
});

test("the gate FAILS and names the field for a 4810b01-shaped hand-committed unreleased binding", async (t) => {
  const original = await fs.readFile(targetFile, "utf8");
  t.after(async () => {
    await fs.writeFile(targetFile, original);
  });
  assert.match(original, /Unspecified = 21/, "fixture assumption: the current committed enum tail");
  const tampered = original.replace(
    "Unspecified = 21",
    "Unspecified = 21,\n\n  /** UNRELEASED — exists only in a dirty SDS working tree. */\n  HackedInUnreleasedField = 22",
  );
  await fs.writeFile(targetFile, tampered);

  await assert.rejects(runGate(), (error) => {
    assert.match(error.stderr, /FAIL/);
    assert.match(error.stderr, /pluginCategory\.ts/);
    assert.match(error.stderr, /HackedInUnreleasedField/);
    assert.match(error.stderr, /not byte-reproducible/);
    return true;
  });
});

test("the gate FAILS when the committed tree is MISSING content the pinned release already has (stale mirror)", async (t) => {
  const original = await fs.readFile(targetFile, "utf8");
  t.after(async () => {
    await fs.writeFile(targetFile, original);
  });
  const stale = original.replace(
    /\n\s*\/\*\*\n\s*\* Maneuver planning[\s\S]*Unspecified = 21\n/,
    "\n",
  );
  assert.notEqual(stale, original, "fixture assumption: Maneuver/Unspecified block is present to strip");
  await fs.writeFile(targetFile, stale);

  await assert.rejects(runGate(), (error) => {
    assert.match(error.stderr, /FAIL/);
    assert.match(error.stderr, /pluginCategory\.ts/);
    return true;
  });
});
