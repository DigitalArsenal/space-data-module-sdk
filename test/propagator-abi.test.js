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

/**
 * THE FROZEN PREFIX — hard-coded, ordinal-pinned, and correct to hard-code.
 *
 * ReferenceFrame 0-5 are burned into compiled WASM artifacts already in the
 * field. See graph/tasks/sdk-reference-frame-enum-unification.md: collapsing
 * the four live ReferenceFrame vocabularies is a wire break, not a refactor.
 * These six may never be renamed, renumbered or reordered, so they are stated
 * here by hand — exactly like ABI_TRUTH above, and for the same reason.
 */
const FROZEN_FRAMES = [
  ["TEME", 0],
  ["J2000", 1],
  ["ICRF", 2],
  ["ECEF", 3],
  ["MCI", 4],
  ["MCMF", 5],
];

/**
 * THE WITNESS FOR THE APPENDED TAIL — schemas/orbpro/reference-frame.lock.json.
 *
 * 6-22 are the GMAT axis roster appended by gmat-08 (cb53733), and the roster
 * is append-only BY DESIGN: it will grow again. Restating all of it by hand is
 * what froze npm at 0.8.15 — cb53733 appended to Propagator.fbs and left this
 * assertion behind, `npm test` went red on origin/main, and
 * .github/workflows/publish.yml runs `npm test` BEFORE `npm publish`, so every
 * v* tag failed and published nothing.
 *
 * The lock file is the right witness for the tail and the generator's own
 * outputs are not (Janus ruling, consult 2026-08-30):
 *
 *   - It is HAND-COMMITTED, not generator output, so this assertion still
 *     catches the generator-bug class the drift gate exists for. Deriving the
 *     expectation from Propagator.fbs or from orbpro_propagator_abi.h would
 *     make this a gate that cannot fail, which is precisely what the ABI_TRUTH
 *     comment above forbids.
 *   - scripts/check-reference-frame-uniqueness.mjs C2 already REFUSES any
 *     append that does not add the same row to this lock in the same commit,
 *     so a lawful append arrives here green and an unlawful one cannot.
 *
 * The generated binding is the SUBJECT of this test, never its witness.
 */
const REFERENCE_FRAME_LOCK = path.join(
  packageRoot,
  "schemas",
  "orbpro",
  "reference-frame.lock.json",
);

/**
 * Pure, so the negative control below can drill it on corrupted rosters in
 * memory rather than by editing files in the repository. Returns the list of
 * complaints; empty means the binding and the committed baseline agree.
 */
function compareFrameRoster(binding, lock) {
  const complaints = [];
  const members = Array.isArray(lock?.members) ? lock.members : [];
  const lockPath = path.relative(packageRoot, REFERENCE_FRAME_LOCK);

  if (lock?.frozenThrough !== 5) {
    complaints.push(
      `the lock declares frozenThrough ${JSON.stringify(lock?.frozenThrough)}; the freeze boundary is 5 and raising it is a wire break, not a refactor`,
    );
  }

  // 1. The frozen prefix, by hand, at its exact index — in the lock AND in the
  //    binding. A renumber inside 0-5 fails here even when every generated
  //    artifact and the lock agree with each other.
  FROZEN_FRAMES.forEach(([name, value], index) => {
    const locked = members[index];
    if (locked?.name !== name || locked?.value !== value) {
      complaints.push(
        `${lockPath} member ${index} is ${JSON.stringify(locked?.name)} = ${locked?.value}; 0-5 are frozen as ${name} = ${value}`,
      );
    }
    if (binding[name] !== value) {
      complaints.push(
        `ReferenceFrame.${name} is ${binding[name]}; 0-5 are frozen and ${name} is ${value}`,
      );
    }
  });

  // 2. The binding and the committed baseline are the same roster, in the same
  //    order, name-for-name and value-for-value.
  const bound = Object.entries(binding);
  if (bound.length !== members.length) {
    complaints.push(
      `the binding declares ${bound.length} frames, ${lockPath} carries ${members.length}`,
    );
  }
  const span = Math.max(bound.length, members.length);
  for (let index = 0; index < span; index += 1) {
    const [boundName, boundValue] = bound[index] ?? [];
    const locked = members[index];
    if (boundName !== locked?.name || boundValue !== locked?.value) {
      complaints.push(
        `member ${index}: the binding says ${JSON.stringify(boundName)} = ${boundValue}, ${lockPath} says ${JSON.stringify(locked?.name)} = ${locked?.value}`,
      );
    }
  }

  // 3. Ascending, contiguous, gap-free and declared exactly once — the
  //    structural half of the append-only rule, asserted on the binding itself
  //    so a gap cannot hide behind an equally-gapped lock.
  const seenNames = new Set();
  const seenValues = new Map();
  bound.forEach(([name, value], index) => {
    if (value !== index) {
      complaints.push(
        `ReferenceFrame.${name} = ${value} breaks the contiguous ascending numbering at index ${index}`,
      );
    }
    if (seenNames.has(name)) {
      complaints.push(`ReferenceFrame.${name} is declared twice`);
    }
    seenNames.add(name);
    if (seenValues.has(value)) {
      complaints.push(
        `ReferenceFrame.${name} and ReferenceFrame.${seenValues.get(value)} are both ${value}`,
      );
    }
    seenValues.set(value, name);
  });

  return complaints;
}

function readFrameLock() {
  return JSON.parse(fs.readFileSync(REFERENCE_FRAME_LOCK, "utf8"));
}

test("the frame and flag vocabularies keep their ordinals", () => {
  const complaints = compareFrameRoster({ ...ReferenceFrame }, readFrameLock());
  assert.deepEqual(
    complaints,
    [],
    [
      "The ReferenceFrame roster and its committed baseline disagree:",
      ...complaints.map((line) => `  - ${line}`),
      "",
      "Appending a frame is lawful. Leaving one half of the append behind is",
      "not: an append lands in ONE commit — schemas/orbpro/Propagator.fbs AND",
      "schemas/orbpro/reference-frame.lock.json — followed by",
      "`node scripts/generate-propagator-abi.mjs` to regenerate the header and",
      "the bindings. Values 0-5 are frozen forever and are restated by hand in",
      "FROZEN_FRAMES above; never edit those to make this pass.",
      "",
      "AND DO NOT LEAVE THIS RED. .github/workflows/publish.yml runs",
      "`npm test` before `npm publish`, so while this fails every v* tag",
      "publishes nothing and leaves a dangling tag behind. That is exactly how",
      "npm sat frozen at 0.8.15 from 2026-08-13 to 2026-08-30.",
    ].join("\n"),
  );

  // StateFlags is a closed bitfield with no append pressure and no lock file,
  // so it stays a flat hand-written statement.
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

/**
 * A gate never observed to fail is indistinguishable from one that cannot fail
 * (official-harness-shapes finding §5) — and this particular gate spent the
 * window between cb53733 and its repair guarding nothing while blocking every
 * release. Drill it in memory, on the corruptions it exists to catch, without
 * touching a file in the repository.
 */
test("the frame-roster comparison FAILS on each corruption it guards (negative control)", () => {
  const lock = readFrameLock();
  assert.deepEqual(
    compareFrameRoster({ ...ReferenceFrame }, lock),
    [],
    "the committed roster must be this control's clean baseline",
  );

  const corruptions = [
    [
      "a renumber inside the frozen 0-5 prefix that the lock agrees with",
      { ...ReferenceFrame, J2000: 2, ICRF: 1 },
      (l) => {
        l.members[1] = { name: "J2000", value: 2 };
        l.members[2] = { name: "ICRF", value: 1 };
      },
    ],
    [
      "a gap in the appended tail that the lock agrees with",
      { ...ReferenceFrame, TOD_FK5: 23 },
      (l) => {
        l.members[22] = { name: "TOD_FK5", value: 23 };
      },
    ],
    [
      "a member dropped from the binding",
      Object.fromEntries(
        Object.entries(ReferenceFrame).filter(([name]) => name !== "TOD_FK5"),
      ),
      () => {},
    ],
    [
      "a duplicate value that the lock agrees with",
      { ...ReferenceFrame, TOD_FK5: 21 },
      (l) => {
        l.members[22] = { name: "TOD_FK5", value: 21 };
      },
    ],
    [
      "the freeze boundary quietly raised past 5",
      { ...ReferenceFrame },
      (l) => {
        l.frozenThrough = 22;
      },
    ],
  ];

  for (const [label, binding, corruptLock] of corruptions) {
    const corrupted = JSON.parse(JSON.stringify(lock));
    corruptLock(corrupted);
    assert.ok(
      compareFrameRoster(binding, corrupted).length > 0,
      `the frame-roster comparison passed ${label} — it is not wired to anything`,
    );
  }
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
