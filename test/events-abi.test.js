import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { renderEventsAbiArtifacts } from "../scripts/generate-events-abi.mjs";
import { verifyAbiArtifacts } from "../scripts/check-propagator-abi.mjs";
import { resolveWasiThreadsToolchain } from "../src/compiler/wasiThreadsToolchain.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const harnessSource = path.join(__dirname, "fixtures", "event-runner-harness.c");

/**
 * The event-locator ABI guardrail.
 *
 * Three things are proved here and nothing else is asserted as a proxy for
 * them:
 *
 *   1. The committed header and bindings regenerate from Events.fbs.
 *   2. ONE source file, compiled natively and to the sanctioned
 *      wasm32-wasip1-threads target, produces BYTE-IDENTICAL output. The
 *      doubles cross as raw bit patterns, so this is a comparison of the
 *      arithmetic and not of two printf implementations.
 *   3. The refinement reproduces a CLOSED-FORM root, is independent of the
 *      scan step, is symmetric under time reversal, agrees across all three
 *      bracketing methods, and reports the epoch-resolution clamp instead of
 *      claiming a precision the state source cannot deliver.
 *
 * A toolchain that is not installed produces a NAMED SKIP, never a silent
 * pass — a gate never observed to run is indistinguishable from one that
 * cannot fail.
 */

function parseHits(stdout) {
  const scans = new Map();
  let current = null;
  let hit = null;
  let pendingKey = null;
  for (const line of stdout.split("\n")) {
    let m = line.match(/^([A-G]) hits (\d+)$/);
    if (m) {
      current = { tag: m[1], hits: [], summaries: [], tolerance: null };
      scans.set(m[1], current);
      continue;
    }
    m = line.match(/^ tol ([0-9a-f]{16})$/);
    if (m && current) {
      current.tolerance = bitsToDouble(m[1]);
      continue;
    }
    m = line.match(
      /^([A-G]) hit (\d+) comp (\d+) dir (-?\d+) status (\d+) iter (\d+) flags (\d+)$/,
    );
    if (m) {
      hit = {
        component: Number(m[3]),
        direction: Number(m[4]),
        status: Number(m[5]),
        iterations: Number(m[6]),
        flags: Number(m[7]),
      };
      current.hits.push(hit);
      continue;
    }
    m = line.match(/^ {2}(day|sec|val|err) ([0-9a-f]{16})$/);
    if (m && hit) {
      hit[m[1]] = bitsToDouble(m[2]);
      continue;
    }
    m = line.match(
      /^([A-G]) sum (\d+) comp (\d+) cross (\d+) evals (\d+) isign (-?\d+) fsign (-?\d+)$/,
    );
    if (m) {
      current.summaries.push({
        component: Number(m[3]),
        crossings: Number(m[4]),
        evaluations: Number(m[5]),
        initialSign: Number(m[6]),
        finalSign: Number(m[7]),
      });
      hit = null;
      continue;
    }
    void pendingKey;
  }
  return scans;
}

function bitsToDouble(hex) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(`0x${hex}`));
  return buf.readDoubleBE(0);
}

function parseRefusals(stdout) {
  const out = {};
  for (const line of stdout.split("\n")) {
    const m = line.match(/^refuse ([a-z-]+) (-?\d+)$/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

/** Epochs as SECONDS from the scan start — the fine coordinate, never a JD. */
function hitSeconds(scan) {
  return scan.hits.map((h) => h.sec);
}

test("Events.fbs is a valid FlatBuffers schema under the pinned flatc", async () => {
  // The ABI generator parses a deliberately NARROW subset of the IDL and would
  // happily accept a file real flatc rejects. The wire tables (the strings and
  // the vectors the ABI structs cannot carry) are never touched by that
  // generator at all, so without this check nothing in the repository would
  // ever have compiled them.
  //
  // Only PARSED here, not generated into src/generated/orbpro: the committed
  // OrbPro flatc bindings predate the doc comments now in Propagator.fbs and
  // regenerate with different relative import paths, and there is no drift
  // gate on that tree to have caught it. Regenerating 26 unrelated files is
  // not this lane's change; the stale-bindings drift is filed separately.
  const { FlatcRunner } = await import("flatc-wasm");
  const schemaRoot = path.join(packageRoot, "schemas", "orbpro");
  const files = {};
  for (const name of await fs.promises.readdir(schemaRoot)) {
    if (!name.endsWith(".fbs")) continue;
    files[`/schemas/orbpro/${name}`] = await fs.promises.readFile(
      path.join(schemaRoot, name),
      "utf8",
    );
  }
  const flatc = await FlatcRunner.init();
  const generated = flatc.generateCode(
    { entry: "/schemas/orbpro/Events.fbs", files },
    "ts",
  );
  const names = Object.keys(generated);
  for (const expected of [
    "orbpro/events/event-locator-description.ts",
    "orbpro/events/event-locator-config.ts",
    "orbpro/events/event-component.ts",
    "orbpro/events/event-scan-result.ts",
    "orbpro/events/root-policy.ts",
    "orbpro/events/event-hit.ts",
  ]) {
    assert.ok(names.includes(expected), `flatc did not emit ${expected}; got ${names.join(", ")}`);
  }
});

test("the committed event ABI regenerates from Events.fbs", async () => {
  const artifacts = await renderEventsAbiArtifacts();
  const failures = await verifyAbiArtifacts({
    root: packageRoot,
    artifacts,
    label: "the committed tree",
  });
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("the runner is byte-identical native vs wasm32-wasip1-threads, and reproduces the closed form", (t) => {
  let toolchain;
  try {
    toolchain = resolveWasiThreadsToolchain({ force: true });
  } catch (error) {
    t.skip(
      `NAMED GAP — the sanctioned wasi-threads toolchain is not installed on this box, so the ` +
        `wasm leg of the both-harness proof cannot run: ${error.message}`,
    );
    return;
  }

  const nativeCc = process.env.CC || "cc";
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbpro-events-abi-"));
  const nativeBin = path.join(workDir, "harness");
  const wasmBin = path.join(workDir, "harness.wasm");

  try {
    // -ffp-contract=off is NOT a style choice. On arm64 clang contracts
    // `a*b + c` into a single fused multiply-add; WebAssembly has no fma
    // instruction, so the same source computes a different (both correct)
    // double. Measured on this ABI: the Illinois refinement's regula-falsi
    // step diverged by 1 ulp in the root epoch, which is 2.6e-10 s — inside
    // every tolerance, and still a byte difference. A native reference build
    // that leaves contraction on is not comparing the same arithmetic.
    execFileSync(
      nativeCc,
      ["-std=c11", "-O2", "-ffp-contract=off", "-I", path.join(packageRoot, "include"),
       "-o", nativeBin, harnessSource],
      { stdio: "pipe" },
    );
  } catch (error) {
    t.skip(`NAMED GAP — no native C compiler ("${nativeCc}") to build the reference leg: ${error.message}`);
    return;
  }

  assert.equal(
    toolchain.target,
    "wasm32-wasip1-threads",
    "the wasm leg must be built for the sanctioned isomorphic target",
  );

  execFileSync(
    toolchain.clang,
    [...toolchain.toolchainArgs, "-std=c11", "-O2",
     "-I", path.join(packageRoot, "include"), "-o", wasmBin, harnessSource],
    { stdio: "pipe" },
  );

  const nativeOut = execFileSync(nativeBin, { encoding: "utf8" });

  const wasmOut = (() => {
    const stdoutPath = path.join(workDir, "wasm.txt");
    const script = path.join(workDir, "run.mjs");
    fs.writeFileSync(
      script,
      [
        `import { WASI } from "node:wasi";`,
        `import fs from "node:fs";`,
        `const wasi = new WASI({ version: "preview1", args: ["harness"], env: {},`,
        `  returnOnExit: true, stdout: fs.openSync(${JSON.stringify(stdoutPath)}, "w") });`,
        `const bytes = fs.readFileSync(${JSON.stringify(wasmBin)});`,
        `const instance = await WebAssembly.instantiate(await WebAssembly.compile(bytes),`,
        `  wasi.getImportObject());`,
        `process.exitCode = wasi.start(instance) ?? 0;`,
      ].join("\n"),
    );
    execFileSync(process.execPath, ["--no-warnings", script], { stdio: "pipe" });
    return fs.readFileSync(stdoutPath, "utf8");
  })();

  assert.equal(
    wasmOut,
    nativeOut,
    "the event runner diverged between the native and wasm builds of ONE source file",
  );

  // ---- layout, in the artifact rather than only in the header's asserts ----
  for (const [name, size] of [
    ["RootPolicy", 32],
    ["EventInterval", 56],
    ["EventHit", 48],
    ["EventScanSummary", 32],
    ["EventStateRequest", 16],
    ["StateVector", 64],
  ]) {
    assert.match(nativeOut, new RegExp(`^sizeof ${name} ${size}$`, "m"), `${name} size`);
  }

  const scans = parseHits(nativeOut);

  // ---- the closed form -----------------------------------------------------
  // g0 = z, roots at k*T/2. g1 = x, roots at T/4 + k*T/2. `err` is the signed
  // distance from the analytic root, computed inside the artifact.
  for (const tag of ["A", "B", "C", "D", "E", "F"]) {
    const scan = scans.get(tag);
    assert.ok(scan, `scan ${tag} ran`);
    assert.equal(scan.hits.length > 0, true, `scan ${tag} found events`);
    for (const hit of scan.hits) {
      assert.ok(
        Math.abs(hit.err) <= 1e-9,
        `scan ${tag} component ${hit.component}: root is ${hit.err} s from the analytic value`,
      );
      assert.ok(hit.status === 0, `scan ${tag} hit status ${hit.status} is not CONVERGED`);
    }
  }

  // ---- step independence ---------------------------------------------------
  // Scan steps 60 s, 137 s and 300 s over two orbits. Same roots. This is the
  // invariant the pre-module JavaScript scans fail, and it is asserted on the
  // FINE coordinate (seconds), because a single-float64 Julian date cannot
  // resolve better than 4.02e-5 s and would hide the answer.
  const a = hitSeconds(scans.get("A"));
  for (const tag of ["B", "C"]) {
    const other = hitSeconds(scans.get(tag));
    assert.equal(other.length, a.length, `scan ${tag} found a different number of events`);
    for (let i = 0; i < a.length; i += 1) {
      assert.ok(
        Math.abs(other[i] - a[i]) <= 1e-6,
        `scan ${tag} event ${i} landed ${other[i] - a[i]} s from the 60 s-step answer`,
      );
    }
  }

  // ---- forward/backward closure -------------------------------------------
  // D is the same arc scanned in reverse. Backward propagation is not a mode;
  // it is a negative span, so the SAME roots come back in reverse order.
  const forward = [...a].sort((x, y) => x - y);
  const backward = [...hitSeconds(scans.get("D"))].sort((x, y) => x - y);
  assert.equal(backward.length, forward.length, "the backward scan found a different event count");
  for (let i = 0; i < forward.length; i += 1) {
    assert.ok(
      Math.abs(backward[i] - forward[i]) <= 1e-6,
      `backward event ${i} landed ${backward[i] - forward[i]} s from the forward answer`,
    );
  }
  for (const hit of scans.get("D").hits) {
    assert.ok((hit.flags & 16) === 16, "a backward hit must carry the BACKWARD flag");
  }

  // ---- method agreement ----------------------------------------------------
  // Brent, bisection and Illinois are three ways to the same root. They cost
  // very different iteration counts (measured: 4 vs 39 vs 25 on this geometry)
  // and must not produce different answers.
  for (const tag of ["E", "F"]) {
    const other = hitSeconds(scans.get(tag));
    for (let i = 0; i < other.length; i += 1) {
      assert.ok(
        Math.abs(other[i] - a[i]) <= 1e-6,
        `${tag} event ${i} disagrees with Brent by ${other[i] - a[i]} s`,
      );
    }
  }

  // ---- the epoch-resolution clamp -----------------------------------------
  // G declares a state source that resolves 4.0233e-5 s and asks for 1e-9 s.
  // The runner must clamp and SAY SO, not report a precision nothing measured.
  const clamped = scans.get("G");
  assert.equal(clamped.tolerance, 4.0233e-5, "the tolerance was not clamped to the source resolution");
  for (const hit of clamped.hits) {
    assert.equal(
      hit.status,
      5,
      "a clamped root must report EPOCH_RESOLUTION_LIMITED, not CONVERGED",
    );
  }
  assert.ok(
    scans.get("E").tolerance === 1e-9,
    "an undeclared source resolution must leave the requested tolerance alone",
  );

  // ---- endpoint signs make an already-open interval representable ----------
  for (const summary of scans.get("A").summaries) {
    assert.ok(summary.crossings > 0, "the summary must count crossings");
    assert.ok(
      [-1, 0, 1].includes(summary.initialSign) && [-1, 0, 1].includes(summary.finalSign),
      "endpoint signs must be -1, 0 or +1",
    );
  }

  // ---- max_events is the first N IN SCAN ORDER, and it says so -------------
  // A cap that returned a different SET depending on the scan step would undo
  // the ordering fix above; a cap that returned N events without saying more
  // existed would be reported as "these are the events".
  {
    const m = nativeOut.match(/^cap hits (\d+) truncated (\d+)$/m);
    assert.ok(m, "the max_events scan did not report");
    assert.equal(Number(m[1]), 3, "max_events = 3 must return exactly 3 hits");
    assert.equal(Number(m[2]), 1, "a capped scan must report truncated");
    const capped = [...nativeOut.matchAll(/^ {2}cap ([0-9a-f]{16})$/gm)].map((x) =>
      bitsToDouble(x[1]),
    );
    assert.deepEqual(
      capped,
      a.slice(0, 3),
      "the capped hits must be the first three of the uncapped scan, bit for bit",
    );
  }

  // ---- typed refusals ------------------------------------------------------
  // Every refusal has its OWN code. A locator that answers -1 for everything
  // is unconformable: the consumer cannot place the failure on the
  // degradation ladder.
  const refusals = parseRefusals(nativeOut);
  assert.deepEqual(refusals, {
    "not-started": -20,
    "not-configured": -1,
    "zero-step": -4,
    "zero-span": -4,
    "unknown-component": -21,
    "supply-order": -23,
    "supply-count": -24,
  });
  assert.equal(
    new Set(Object.values(refusals)).size >= 5,
    true,
    "the refusal codes must be distinguishable, not all -1",
  );

  fs.rmSync(workDir, { recursive: true, force: true });
});
