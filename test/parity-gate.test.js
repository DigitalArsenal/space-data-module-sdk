// Unit cage for the tri-runtime parity GATE.
//
// Always-on: every assertion here is hermetic (synthetic wasm binaries built
// in-process, plus artifacts that ship in this repo / its node_modules). The
// real-lane run lives in test/parity-gate-lanes.test.js.
//
// The point of this file is that the gate's RULES are provably able to fail.
// A gate nobody has watched fail is indistinguishable from a gate that cannot
// fail — which is exactly what the hardcoded `exit 1` slot was.

import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFileSync } from "node:fs";

import {
  classifyArtifactImports,
  describeClassification,
  readWasmImportDescriptors,
  HOST_SURFACES,
  FLATSQL_IO_IMPORTS,
  HOSTCALL_IMPORTS,
} from "../src/testing/hostContract.js";
import {
  ContractVerdict,
  REPO_ROOT,
  deriveContractVerdict,
  lanesAgree,
  loadGateManifest,
  classifyWasmEdgeProbe,
  formatGateReport,
  gateReceiptDigest,
  packageRootDir,
  DEFAULT_GATE_MANIFEST,
} from "../src/testing/parityGate.js";
import {
  normalizeWasmEdgeOutcome,
  splitWasmEdgeDiagnostics,
} from "../src/testing/wasmedgeOutput.js";

// --- synthetic wasm builder ---------------------------------------------------
// A wasm module with exactly the imports we ask for and nothing else, so the
// classifier is exercised on inputs we fully control.

function uleb(value) {
  const out = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining) byte |= 0x80;
    out.push(byte);
  } while (remaining);
  return out;
}

function str(text) {
  const bytes = [...new TextEncoder().encode(text)];
  return [...uleb(bytes.length), ...bytes];
}

function section(id, payload) {
  return [id, ...uleb(payload.length), ...payload];
}

/** imports: ["mod.name", ...] — all typed () -> (). */
function buildWasm(imports) {
  const typeSection = section(1, [...uleb(1), 0x60, ...uleb(0), ...uleb(0)]);
  const entries = [];
  for (const key of imports) {
    const dot = key.indexOf(".");
    entries.push(
      ...str(key.slice(0, dot)),
      ...str(key.slice(dot + 1)),
      0x00,
      ...uleb(0),
    );
  }
  const importSection = section(2, [...uleb(imports.length), ...entries]);
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...typeSection,
    ...importSection,
  ]);
}

// --- structural classifier ------------------------------------------------------

test("import reader recovers exact descriptors (signatures, not guesses)", () => {
  const bytes = buildWasm(["wasi_snapshot_preview1.fd_write", "env.flatsql_io_open"]);
  const descriptors = readWasmImportDescriptors(bytes);
  assert.equal(descriptors.length, 2);
  assert.deepEqual(
    descriptors.map((entry) => `${entry.module}.${entry.name}`),
    ["wasi_snapshot_preview1.fd_write", "env.flatsql_io_open"],
  );
  assert.equal(descriptors[0].kind, "function");
});

test("a WASI-only artifact is in-surface for every module surface", () => {
  const bytes = buildWasm([
    "wasi_snapshot_preview1.fd_write",
    "wasi_snapshot_preview1.proc_exit",
  ]);
  for (const surface of ["module", "module-standalone"]) {
    const classification = classifyArtifactImports(bytes, surface);
    assert.equal(classification.verdict, "in-surface");
    assert.equal(classification.capabilityImports.length, 0);
  }
});

test("the seven declared flatsql_io_* imports are IN surface for the engine, and OUTSIDE it for a module", () => {
  const bytes = buildWasm([
    "wasi_snapshot_preview1.fd_read",
    ...FLATSQL_IO_IMPORTS,
  ]);
  const engine = classifyArtifactImports(bytes, "flatsql-engine");
  assert.equal(engine.verdict, "in-surface");
  assert.equal(engine.capabilityImports.length, 7);

  // A MODULE that linked the VFS would be claiming a new host capability.
  const asModule = classifyArtifactImports(bytes, "module");
  assert.equal(asModule.verdict, "outside-surface");
  assert.equal(asModule.outsideSurface.length, 7);
});

test("the sanctioned hostcall bridge is in-surface for a module but not for module-standalone", () => {
  const bytes = buildWasm(["wasi_snapshot_preview1.fd_write", ...HOSTCALL_IMPORTS]);
  assert.equal(classifyArtifactImports(bytes, "module").verdict, "in-surface");
  assert.equal(
    classifyArtifactImports(bytes, "module-standalone").verdict,
    "outside-surface",
  );
});

test("every forbidden import class fires, and names itself", () => {
  const cases = [
    ["emscripten-eh", "env.invoke_vii"],
    ["emscripten-eh", "env.__cxa_throw"],
    ["emscripten-eh", "env.__resumeException"],
    ["emscripten-eh", "env.llvm_eh_typeid_for"],
    ["emscripten-syscall", "env.__syscall_unlinkat"],
    ["emscripten-runtime", "env.emscripten_resize_heap"],
    ["emscripten-runtime", "env.emscripten_notify_memory_growth"],
    ["emscripten-minified", "a.a"],
  ];
  for (const [classId, importName] of cases) {
    const classification = classifyArtifactImports(buildWasm([importName]), "module");
    assert.equal(classification.verdict, "forbidden", importName);
    assert.equal(classification.forbidden[0].classId, classId, importName);
    assert.match(describeClassification(classification), /FORBIDDEN import class/);
  }
});

test("NEGATIVE CONTROL: the installed flatsql wasi artifact is classified from REAL bytes", () => {
  // Whatever version is pinned, the gate must produce a definite verdict from
  // the artifact a consumer would actually load. The emscripten-glue build
  // (^0.4.2) is forbidden; the isomorphic build (>=1.4.4) is in-surface with
  // exactly seven capability imports. Both outcomes are asserted here so this
  // test keeps its teeth across the pin bump instead of being edited away.
  const artifact = path.join(packageRootDir("flatsql"), "wasm", "flatsql-wasi.wasm");
  const classification = classifyArtifactImports(
    new Uint8Array(readFileSync(artifact)),
    "flatsql-engine",
  );
  if (classification.verdict === "forbidden") {
    assert.ok(
      classification.forbidden.some((item) => item.classId === "emscripten-eh"),
      "the emscripten-glue flatsql build must be caught by the EH class",
    );
    assert.ok(classification.forbidden.length >= 40);
    return;
  }
  assert.equal(classification.verdict, "in-surface");
  assert.deepEqual(
    [...classification.capabilityImports].sort(),
    [...FLATSQL_IO_IMPORTS].sort(),
    "an isomorphic flatsql imports the seven declared VFS functions and NOTHING else",
  );
});

test("the emscripten BROWSER flatsql build is always forbidden (it is a different artifact, not a lane)", () => {
  const artifact = path.join(packageRootDir("flatsql"), "wasm", "flatsql.wasm");
  const classification = classifyArtifactImports(
    new Uint8Array(readFileSync(artifact)),
    "flatsql-engine",
  );
  assert.equal(classification.verdict, "forbidden");
  assert.equal(classification.forbidden[0].classId, "emscripten-minified");
});

// --- WasmEdge probe classification ----------------------------------------------

test("WasmEdge probe: an unknown-import diagnostic is parsed into the exact missing import", () => {
  const stderrText = [
    "[2026-08-08 00:00:00.000] [error] instantiation failed: unknown import, Code: 0x302",
    '[2026-08-08 00:00:00.000] [error]     When linking module: "env" , function name: "flatsql_io_open"',
    "[2026-08-08 00:00:00.000] [error]     At AST node: import description",
  ].join("\n");
  const probe = classifyWasmEdgeProbe({ code: 1, signal: null, stderrText });
  assert.equal(probe.outcome, "link-error");
  assert.equal(probe.missingImport, "env.flatsql_io_open");
});

test("WasmEdge probe: linking succeeded even when the GUEST exits nonzero", () => {
  const probe = classifyWasmEdgeProbe({
    code: 1,
    signal: null,
    stderrText: "",
    guestOutputLength: 12,
  });
  assert.equal(probe.outcome, "instantiated");
});

test("REGRESSION: a silent nonzero exit is a probe-failure, NEVER an inferred pass", () => {
  // This is the exact shape that produced a FALSE PASS: WasmEdge logs its
  // diagnostics to stdout, so a classifier reading only stderr saw nothing,
  // and the old default was `instantiated`. An acceptance instrument may say
  // "I could not tell". It may never say "fine" by default.
  const probe = classifyWasmEdgeProbe({
    code: 1,
    signal: null,
    stderrText: "",
    guestOutputLength: 0,
  });
  assert.equal(probe.outcome, "probe-failure");
  assert.match(probe.detail, /Refusing to infer a pass/);
});

test("WasmEdge probe: a reactor artifact with no command entry point counts as linked", () => {
  const probe = classifyWasmEdgeProbe({
    code: 1,
    signal: null,
    stderrText: "[2026-08-08 00:00:00.000] [error] wasm function not found: _start",
    guestOutputLength: 0,
  });
  assert.equal(probe.outcome, "instantiated");
});

test("WasmEdge diagnostics are split OUT of the guest's stdout (the runtime logs to stdout)", () => {
  const encoder = new TextEncoder();
  const merged = encoder.encode(
    "$PIVguestbytes\n" +
      '[2026-08-08 00:45:38.689] [error] instantiation failed: unknown import, Code: 0x302\n' +
      '[2026-08-08 00:45:38.689] [error]     When linking module: "env" , function name: "flatsql_io_open"',
  );
  const { stdout, diagnostics } = splitWasmEdgeDiagnostics(merged);
  assert.equal(new TextDecoder().decode(stdout), "$PIVguestbytes");
  assert.match(diagnostics, /unknown import/);
  assert.match(diagnostics, /flatsql_io_open/);

  // Guest-only output is returned untouched — the shim never rewrites a byte
  // the module wrote.
  const guestOnly = encoder.encode("$PIV binary");
  const clean = splitWasmEdgeDiagnostics(guestOnly);
  assert.deepEqual(clean.stdout, guestOnly);
  assert.equal(clean.diagnostics, "");
});

test("normalizeWasmEdgeOutcome merges stderr with stdout-logged diagnostics for classification", () => {
  const encoder = new TextEncoder();
  const normalized = normalizeWasmEdgeOutcome({
    stdout: encoder.encode(
      "out\n[2026-08-08 00:00:00.000] [error] instantiation failed: unknown import, Code: 0x302",
    ),
    stderr: encoder.encode("stderr line"),
  });
  assert.match(normalized.diagnosticText, /stderr line/);
  assert.match(normalized.diagnosticText, /instantiation failed/);
  assert.equal(new TextDecoder().decode(normalized.stdout), "out");
});

// --- verdict rules ---------------------------------------------------------------

const clean = { verdict: "in-surface", capabilityImports: [], forbidden: [], outsideSurface: [] };
const withCapability = {
  verdict: "in-surface",
  capabilityImports: ["env.flatsql_io_open"],
  forbidden: [],
  outsideSurface: [],
};
const forbidden = {
  verdict: "forbidden",
  capabilityImports: [],
  outsideSurface: [],
  forbidden: [{ import: "env.invoke_vi", classId: "emscripten-eh", reason: "glue" }],
};

test("R1: a forbidden import class is Violated in EVERY lane — lanes agreeing it is broken is not parity", () => {
  for (const laneSuppliesCapabilities of [true, false]) {
    const derived = deriveContractVerdict({
      laneSuppliesCapabilities,
      probe: { outcome: "instantiated" },
      structural: forbidden,
    });
    assert.equal(derived.verdict, ContractVerdict.Violated);
  }
});

test("R3/R4: a lane that DOES supply the surface but fails to link a declared capability is a shim gap, not a lane limitation", () => {
  const derived = deriveContractVerdict({
    laneSuppliesCapabilities: true,
    probe: { outcome: "link-error", missingImport: "env.flatsql_io_open" },
    structural: withCapability,
  });
  assert.equal(derived.verdict, ContractVerdict.ShimGap);
});

test("a lane that supplies NO capabilities reports the runner limitation, named — never a silent pass", () => {
  const derived = deriveContractVerdict({
    laneSuppliesCapabilities: false,
    probe: { outcome: "link-error", missingImport: "env.flatsql_io_open" },
    structural: withCapability,
  });
  assert.equal(derived.verdict, ContractVerdict.RunnerCannotSupplyCapability);
  assert.match(derived.reason, /flatsql_io_open/);
});

test("a link error on an import OUTSIDE the surface is a violation even in a capability-less lane", () => {
  const derived = deriveContractVerdict({
    laneSuppliesCapabilities: false,
    probe: { outcome: "link-error", missingImport: "env.something_private" },
    structural: clean,
  });
  assert.equal(derived.verdict, ContractVerdict.Violated);
});

test("R6: an unavailable lane is lexically distinct from a divergence", () => {
  const derived = deriveContractVerdict({
    laneSuppliesCapabilities: true,
    probe: { outcome: "lane-unavailable", detail: "no docker" },
    structural: clean,
  });
  assert.equal(derived.verdict, ContractVerdict.Unavailable);
  assert.notEqual(ContractVerdict.Unavailable, ContractVerdict.Violated);
});

test("lane agreement: satisfied == runner-cannot-supply-capability; everything else must match exactly", () => {
  assert.ok(
    lanesAgree(ContractVerdict.Satisfied, ContractVerdict.RunnerCannotSupplyCapability),
  );
  assert.ok(!lanesAgree(ContractVerdict.Satisfied, ContractVerdict.Violated));
  assert.ok(!lanesAgree(ContractVerdict.Satisfied, ContractVerdict.ShimGap));
  assert.ok(!lanesAgree(ContractVerdict.Satisfied, ContractVerdict.Unavailable));
});

// --- manifest / fresh-worktree isolation -------------------------------------------

test("every gate artifact resolves INSIDE this repo — no shared-checkout coupling", async () => {
  const manifest = await loadGateManifest(DEFAULT_GATE_MANIFEST);
  assert.ok(manifest.artifacts.length >= 3, "the certified set is not a single sample");
  for (const artifact of manifest.artifacts) {
    assert.ok(
      artifact.artifactPath.startsWith(REPO_ROOT + path.sep),
      `${artifact.id} resolves outside the repo: ${artifact.artifactPath} — that is the trap that made the old lane un-runnable`,
    );
    assert.ok(HOST_SURFACES[artifact.surface], `${artifact.id} declares a known surface`);
  }
});

test("the certified set covers an SDK module, a published module, and the flatsql engine", async () => {
  const manifest = await loadGateManifest(DEFAULT_GATE_MANIFEST);
  const ids = manifest.artifacts.map((artifact) => artifact.id);
  assert.ok(ids.includes("sdk-command-module"));
  assert.ok(ids.includes("sdk-published-module"));
  assert.ok(ids.includes("flatsql-standalone"));
  const surfaces = new Set(manifest.artifacts.map((artifact) => artifact.surface));
  assert.ok(surfaces.has("module") && surfaces.has("flatsql-engine"));
});

test("the negative-control manifest exists and declares a known-bad artifact", async () => {
  const manifest = await loadGateManifest(
    path.join(REPO_ROOT, "parity", "negative-control.json"),
  );
  assert.equal(manifest.artifacts.length, 1);
  assert.equal(manifest.artifacts[0].negativeControl, true);
});

// --- report shape -------------------------------------------------------------------

test("the report names the defect class and the receipt digest tracks verdicts", () => {
  const report = {
    ok: false,
    gate: "g",
    pin: "0.16.4",
    lanes: [{ lane: "browser", evidence: "real chrome" }],
    lanesSkipped: [],
    pinVerification: { native: { status: "absent", note: "no native" } },
    artifacts: [
      {
        id: "bad",
        surface: "module",
        profile: "library",
        moduleSha256: "a".repeat(64),
        structural: { summary: "FORBIDDEN import class [emscripten-eh] — 1 import(s)" },
        lanes: [{ lane: "browser", contractVerdict: "violated", reason: "glue" }],
      },
    ],
    behavioral: [],
    failures: [{ artifact: "bad", kind: "forbidden-import-class", message: "glue" }],
  };
  const text = formatGateReport(report);
  assert.match(text, /parity-gate FAIL/);
  assert.match(text, /FORBIDDEN import class/);
  assert.match(text, /PIN GAP/);
  const digest = gateReceiptDigest(report);
  const flipped = gateReceiptDigest({
    ...report,
    artifacts: [
      {
        ...report.artifacts[0],
        lanes: [{ lane: "browser", contractVerdict: "satisfied" }],
      },
    ],
  });
  assert.notEqual(digest, flipped, "the digest must move when a lane verdict moves");
});
