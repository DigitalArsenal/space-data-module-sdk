import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { renderPropagatorAbiArtifacts } from "../scripts/generate-propagator-abi.mjs";
import { verifyAbiArtifacts } from "../scripts/check-propagator-abi.mjs";
import { buildAbiModel, packageRoot } from "../scripts/propagator-abi-model.mjs";
import {
  ORBPRO_STATE_VECTOR,
  ORBPRO_ORBITAL_ELEMENTS,
  ORBPRO_OMM_RECORD,
  ReferenceFrame,
  StateFlags,
} from "../src/generated/orbpro/propagator-abi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * THE INDEPENDENT STATEMENT OF THE CONTRACT.
 *
 * These numbers are hard-coded here ON PURPOSE, and they are the one place in
 * this repository where that is correct. Everything else derives the layout
 * from the IDL; if a bug in the generator moved a field, the generator, the
 * header and the drift gate would all move together and agree with each
 * other — a gate that cannot fail. This table is the outside witness.
 *
 * These values are also LOAD-BEARING beyond compilation: OrbProOMMRecord is
 * persisted verbatim as a SQLite blob by the first-party SGP4 module, so a
 * changed offset here silently invalidates every stored catalogue row. Do not
 * "fix" a mismatch by editing this table.
 */
const ABI_TRUTH = {
  StateVector: {
    size: 64,
    offsets: { epoch: 0, position: 8, velocity: 32, reference_frame: 56, flags: 60 },
  },
  OrbitalElements: {
    size: 64,
    offsets: {
      semi_major_axis: 0,
      eccentricity: 8,
      inclination: 16,
      raan: 24,
      arg_periapsis: 32,
      true_anomaly: 40,
      epoch: 48,
      reserved: 56,
    },
  },
  OMMRecord: {
    size: 88,
    offsets: {
      epoch_jd: 0,
      mean_motion: 8,
      eccentricity: 16,
      inclination: 24,
      ra_of_asc_node: 32,
      arg_of_pericenter: 40,
      mean_anomaly: 48,
      bstar: 56,
      mean_motion_dot: 64,
      mean_motion_ddot: 72,
      norad_cat_id: 80,
    },
  },
};

test("the committed propagator ABI regenerates byte-for-byte from the IDL", async () => {
  const artifacts = await renderPropagatorAbiArtifacts();
  const failures = await verifyAbiArtifacts({
    root: packageRoot,
    artifacts,
    label: "the committed tree",
  });
  assert.deepEqual(
    failures,
    [],
    `propagator ABI drift. Run \`node scripts/generate-propagator-abi.mjs\` and commit.\n${failures.join("\n")}`,
  );
});

test("every ABI struct matches the independently stated layout", async () => {
  const model = await buildAbiModel();
  const byName = new Map(model.structs.map((s) => [s.name, s]));

  assert.deepEqual(
    [...byName.keys()].sort(),
    Object.keys(ABI_TRUTH).sort(),
    "the set of ABI-bearing structs changed; a new struct on this seam is a contract change, " +
      "not a refactor — add it to ABI_TRUTH deliberately and bump the shape version.",
  );

  for (const [name, truth] of Object.entries(ABI_TRUTH)) {
    const struct = byName.get(name);
    assert.equal(struct.size, truth.size, `${name} size`);
    for (const [field, offset] of Object.entries(truth.offsets)) {
      const entry = struct.entries.find((e) => e.kind === "field" && e.name === field);
      assert.ok(entry, `${name}.${field} is missing from the IDL`);
      assert.equal(entry.offset, offset, `${name}.${field} offset`);
    }
  }
});

test("the generated TS bindings agree with the same layout", () => {
  const byConst = {
    StateVector: ORBPRO_STATE_VECTOR,
    OrbitalElements: ORBPRO_ORBITAL_ELEMENTS,
    OMMRecord: ORBPRO_OMM_RECORD,
  };
  for (const [name, truth] of Object.entries(ABI_TRUTH)) {
    const binding = byConst[name];
    assert.equal(binding.size, truth.size, `${name} size (TS)`);
    for (const [field, offset] of Object.entries(truth.offsets)) {
      assert.equal(binding.offsets[field], offset, `${name}.${field} offset (TS)`);
    }
  }
});

test("the frame and flag vocabularies keep their ordinals", () => {
  // These ordinals are frozen by compiled WASM artifacts already in the field.
  // See graph/tasks/sdk-reference-frame-enum-unification.md — collapsing the
  // four live ReferenceFrame vocabularies is a wire break, not a refactor.
  assert.deepEqual(
    { ...ReferenceFrame },
    { TEME: 0, J2000: 1, ICRF: 2, ECEF: 3, MCI: 4, MCMF: 5 },
  );
  assert.deepEqual(
    { ...StateFlags },
    {
      NONE: 0,
      VALID: 1,
      IN_ECLIPSE: 2,
      DECAYED: 4,
      MANEUVERING: 8,
      EXTRAPOLATED: 16,
      HAS_COVARIANCE: 32,
    },
  );
});

test("the generated header states the locks it claims to state", () => {
  const header = fs.readFileSync(
    path.join(packageRoot, "include", "orbpro", "orbpro_propagator_abi.h"),
    "utf8",
  );
  for (const [name, truth] of Object.entries(ABI_TRUTH)) {
    const cName = `OrbPro${name === "StateVector" ? "StateVector" : name === "OrbitalElements" ? "OrbitalElements" : "OMMRecord"}`;
    assert.match(
      header,
      new RegExp(`ORBPRO_ABI_STATIC_ASSERT\\(sizeof\\(${cName}\\) == ${truth.size},`),
      `${cName} has no size lock`,
    );
    for (const [field, offset] of Object.entries(truth.offsets)) {
      assert.match(
        header,
        new RegExp(`offsetof\\(${cName}, ${field}\\) == ${offset},`),
        `${cName}.${field} has no offset lock`,
      );
    }
  }
});

/**
 * The locks are only real if a compiler is asked to evaluate them. A
 * `_Static_assert` in a header nobody compiles is a comment.
 */
test("the generated header compiles and its locks hold under the real wasi target", (t) => {
  const clang = "wasm32-wasi-clang";
  const sysroot = process.env.SDN_WASI_SYSROOT ?? "/opt/homebrew/share/wasi-sysroot";
  if (!fs.existsSync(sysroot)) {
    t.skip(`wasi sysroot not installed at ${sysroot} (brew install wasi-libc wasi-runtimes)`);
    return;
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "orbpro-abi-compile-"));
  const source = path.join(scratch, "abi_probe.c");
  fs.writeFileSync(
    source,
    `#include "orbpro/orbpro_propagator_abi.h"\nint probe(void) { return (int)sizeof(OrbProStateVector); }\n`,
    "utf8",
  );
  try {
    execFileSync(
      clang,
      [
        "--target=wasm32-wasip1-threads",
        `--sysroot=${sysroot}`,
        "-std=c11",
        "-I",
        path.join(packageRoot, "include"),
        "-c",
        source,
        "-o",
        path.join(scratch, "abi_probe.o"),
      ],
      { stdio: "pipe" },
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      t.skip(`${clang} not on PATH (brew install wasi-libc wasi-runtimes)`);
      return;
    }
    throw new Error(
      `the generated ABI header failed to compile under wasm32-wasip1-threads:\n${error.stderr ?? error.message}`,
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

/**
 * A gate never observed to fail is indistinguishable from one that cannot
 * fail (official-harness-shapes finding §5). Drill it: corrupt a copy of the
 * committed tree and require the gate to name the corruption.
 */
test("the drift gate FAILS on a hand-edited header (negative control)", async () => {
  const artifacts = await renderPropagatorAbiArtifacts();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "orbpro-abi-drift-"));
  try {
    for (const [relativePath, text] of artifacts) {
      const target = path.join(scratch, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // The realistic corruption: someone "fixes" a padding byte by hand.
      fs.writeFileSync(target, text.replace("== 88,", "== 96,"), "utf8");
    }
    const failures = await verifyAbiArtifacts({
      root: scratch,
      artifacts,
      label: "the negative-control tree",
    });
    assert.ok(
      failures.length > 0,
      "the drift gate passed a hand-edited ABI header — the gate is not wired to anything",
    );
    assert.match(failures.join("\n"), /orbpro_propagator_abi\.h/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("a missing generated artifact is a failure, not a silent pass", async () => {
  const artifacts = await renderPropagatorAbiArtifacts();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "orbpro-abi-missing-"));
  try {
    const failures = await verifyAbiArtifacts({
      root: scratch,
      artifacts,
      label: "an empty tree",
    });
    assert.equal(failures.length, artifacts.size);
    assert.match(failures.join("\n"), /MISSING/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

void __dirname;
