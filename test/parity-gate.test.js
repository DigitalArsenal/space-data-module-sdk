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
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

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
  resolveReactorEntry as resolveReactorEntryForTest,
  wasmEdgeProbeArgs as wasmEdgeProbeArgsForTest,
  declaredRuntimeTargets,
  laneIsInDeclaredScope,
  LANE_RUNTIME_TARGET,
  runParityGate,
} from "../src/testing/parityGate.js";
import { appendWasmCustomSection } from "../src/bundle/wasm.js";
import { SDS_MANIFEST_SECTION_NAME } from "../src/bundle/constants.js";
import { encodePluginManifest } from "../src/manifest/index.js";
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

/** exports: ["name", ...] — all bound to function index 0. */
function buildWasmWithExports(exports) {
  const typeSection = section(1, [...uleb(1), 0x60, ...uleb(0), ...uleb(0)]);
  const functionSection = section(3, [...uleb(1), ...uleb(0)]);
  const entries = [];
  for (const name of exports) {
    entries.push(...str(name), 0x00, ...uleb(0));
  }
  const exportSection = section(7, [...uleb(exports.length), ...entries]);
  const body = [...uleb(0), 0x0b];
  const codeSection = section(10, [...uleb(1), ...uleb(body.length), ...body]);
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...typeSection,
    ...functionSection,
    ...exportSection,
    ...codeSection,
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

// REGRESSION (closed-modules-rf-artifacts-are-emcc-shaped, 2026-08-08).
//
// The RF family's CORRECT shape — clang `-mexec-model=reactor`, no `_start` —
// could not be probed at all: `wasmedge --enable-threads artifact.wasm` refuses
// the invocation with "A function name is required when reactor mode is
// enabled." on stderr, exit 1, and NO runtime diagnostic. That fell through to
// `probe-failure`, so the wasmedge lane "violated" while the browser lane
// passed and the gate reported a P1 cross-runtime DIVERGENCE against a
// perfectly isomorphic artifact. The gate was failing modules for the gate's
// own inability to invoke them, which is the most expensive kind of false
// positive: it makes the correct fix look like the defect.
test("probe: reactor-mode refusal is a PROBE defect, never charged to the artifact", () => {
  const probe = classifyWasmEdgeProbe({
    code: 1,
    signal: null,
    stderrText: "A function name is required when reactor mode is enabled.",
    guestOutputLength: 0,
  });
  assert.equal(probe.outcome, "probe-failure");
  assert.match(probe.detail, /PROBE defect, not an artifact defect/);
});

test("probe: a reactor artifact is invoked at its `_initialize` entry in BOTH WasmEdge lanes", () => {
  // Instantiation must be OBSERVED (exit 0 from a named entry), never inferred
  // from an error string. Both lanes must derive the invocation identically or
  // they can disagree about an artifact for reasons that are not the artifact.
  const reactor = wasmEdgeProbeArgsForTest({
    basename: "artifact.wasm",
    reactorEntry: "_initialize",
  });
  assert.deepEqual(reactor, [
    "--enable-threads",
    "--reactor",
    "artifact.wasm",
    "_initialize",
  ]);

  const command = wasmEdgeProbeArgsForTest({
    basename: "artifact.wasm",
    reactorEntry: null,
  });
  assert.deepEqual(command, ["--enable-threads", "artifact.wasm"]);
});

test("probe: `_start` wins over `_initialize` — a command artifact is not a reactor", () => {
  const commandModule = buildWasmWithExports(["_start", "_initialize"]);
  assert.equal(resolveReactorEntryForTest(commandModule), null);

  const reactorModule = buildWasmWithExports(["_initialize", "plugin_init"]);
  assert.equal(resolveReactorEntryForTest(reactorModule), "_initialize");

  const bareLibrary = buildWasmWithExports(["plugin_init"]);
  assert.equal(resolveReactorEntryForTest(bareLibrary), null);
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


// --- declared runtime-target scoping ------------------------------------------
//
// Composed flows DERIVE their runtimeTargets, so an artifact that legitimately
// runs on one leg only now exists. The browser harness refuses such an
// artifact by name — correctly — and before this scoping the gate classed that
// refusal as a TRAP and scored it a P1 cross-runtime divergence. A gate that
// fails the artifacts the compiler is supposed to emit is worse than no gate:
// it makes the correct fix look like the defect.

test("a lane the artifact declared itself out of is in scope for nobody, and disagrees with nobody", () => {
  assert.equal(laneIsInDeclaredScope("browser", ["wasmedge"]), false);
  assert.equal(laneIsInDeclaredScope("wasmedge-native", ["wasmedge"]), true);
  assert.equal(laneIsInDeclaredScope("wasmedge-docker", ["wasmedge"]), true);
  assert.equal(laneIsInDeclaredScope("browser", ["browser", "wasmedge"]), true);
  // wasi is the portability baseline: it satisfies both legs.
  assert.equal(laneIsInDeclaredScope("browser", ["wasi"]), true);
  assert.equal(laneIsInDeclaredScope("wasmedge-native", ["wasi"]), true);
  // An artifact that declares nothing is unconstrained.
  assert.equal(laneIsInDeclaredScope("browser", []), true);
  assert.equal(laneIsInDeclaredScope("browser", undefined), true);

  assert.equal(LANE_RUNTIME_TARGET.browser, "browser");
  assert.equal(LANE_RUNTIME_TARGET["wasmedge-native"], "wasmedge");
  assert.equal(LANE_RUNTIME_TARGET["wasmedge-docker"], "wasmedge");
});

test("out-of-declared-scope is not a divergence, and every other pairing still is", () => {
  assert.equal(
    lanesAgree(ContractVerdict.OutOfDeclaredScope, ContractVerdict.Satisfied),
    true,
  );
  assert.equal(
    lanesAgree(ContractVerdict.Satisfied, ContractVerdict.OutOfDeclaredScope),
    true,
  );
  assert.equal(
    lanesAgree(ContractVerdict.OutOfDeclaredScope, ContractVerdict.Violated),
    true,
    "a lane the artifact does not claim carries no behaviour to compare",
  );
  // The gate must still be able to fail.
  assert.equal(lanesAgree(ContractVerdict.Satisfied, ContractVerdict.Violated), false);
  assert.equal(lanesAgree(ContractVerdict.Satisfied, ContractVerdict.Unavailable), false);
});

test("declaredRuntimeTargets reads the artifact's own record, and is silent when there is none", () => {
  // A synthetic module with no SDS manifest section declares nothing.
  assert.deepEqual(declaredRuntimeTargets(buildWasm([])), []);
  // The repo's own shipped vector carries a real manifest.
  const vector = readFileSync(
    path.join(REPO_ROOT, "examples/single-file-bundle/vectors/single-file-module.wasm"),
  );
  const targets = declaredRuntimeTargets(new Uint8Array(vector));
  assert.ok(Array.isArray(targets));
});

test("the wasi baseline does not admit a lane for a capability that lane cannot serve", () => {
  // `pipe` is in BOTH the standalone-WASI capability subset and the
  // browser-incompatible set, so a `runtimeTargets:["wasi"]` artifact carrying
  // it passes compliance and would otherwise be admitted to the browser lane
  // against the SDK's own policy.
  assert.equal(laneIsInDeclaredScope("browser", ["wasi"], ["logging"]), true);
  assert.equal(laneIsInDeclaredScope("browser", ["wasi"], ["pipe"]), false);
  assert.equal(laneIsInDeclaredScope("wasmedge-native", ["wasi"], ["pipe"]), true);
  // Capability records, not just plain strings.
  assert.equal(
    laneIsInDeclaredScope("browser", ["wasi"], [{ name: "pipe", required: true }]),
    false,
  );
});

test("an artifact cannot certify itself by scoping out of every lane", async (t) => {
  // THE NEGATIVE CONTROL FOR THE SCOPING ITSELF. Scoping a lane out is a
  // legitimate statement about where an artifact runs; it must never become a
  // way to be certified without being run. One manifest string would otherwise
  // disarm the whole gate.
  // A module with NO manifest of its own, so the one appended below is the
  // only declaration the gate can find. (A shipped vector already carries an
  // embedded $PLG, and the first one located wins.)
  const bytes = buildWasm([]);
  const dir = await mkdtemp(path.join(os.tmpdir(), "parity-scope-control-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const write = async (name, runtimeTargets) => {
    const manifest = {
      pluginId: `com.digitalarsenal.test.${name}`,
      name,
      version: "1.0.0",
      pluginFamily: "foundation",
      capabilities: [],
      invokeSurfaces: ["command"],
      runtimeTargets,
      methods: [],
      schemasUsed: [],
      abiVersion: 1,
    };
    const artifactPath = path.join(dir, `${name}.wasm`);
    await writeFile(
      artifactPath,
      appendWasmCustomSection(
        new Uint8Array(bytes),
        SDS_MANIFEST_SECTION_NAME,
        encodePluginManifest(manifest),
      ),
    );
    return artifactPath;
  };

  const offRoadPath = await write("off-road", ["node"]);
  const singleLanePath = await write("browser-only", ["browser"]);
  const manifestPath = path.join(dir, "gate.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      name: "scope-negative-control",
      artifacts: [
        { id: "off-road", path: offRoadPath, surface: "module", profile: "command" },
        { id: "browser-only", path: singleLanePath, surface: "module", profile: "command" },
      ],
    }),
  );

  const report = await runParityGate({
    manifestPath,
    lanes: ["browser", "wasmedge-native", "wasmedge-docker"],
    // Every lane is deliberately unavailable: this test is about the SCOPING
    // decision, which is made from the artifact's own declaration and must
    // stand on its own before any lane runs.
    chromeBinary: path.join(dir, "no-such-chrome"),
    wasmedgeBinary: path.join(dir, "no-such-wasmedge"),
    dockerBinary: path.join(dir, "no-such-docker"),
    autoBuildDockerImage: false,
    log: () => {},
  });

  assert.equal(report.ok, false);
  assert.ok(
    report.failures.some(
      (failure) =>
        failure.artifact === "off-road" &&
        failure.kind === "artifact-out-of-every-lane",
    ),
    `expected artifact-out-of-every-lane, got ${JSON.stringify(report.failures)}`,
  );
});

test("the gate manifest's lane claim outranks the artifact's own declaration", async (t) => {
  // An artifact must not be able to shrink what it is examined on by editing
  // its own $PLG. The manifest is the SDK's claim about what it certifies.
  const bytes = buildWasm([]);
  const dir = await mkdtemp(path.join(os.tmpdir(), "parity-expected-lanes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const manifest = {
    pluginId: "com.digitalarsenal.test.shrinker",
    name: "shrinker",
    version: "1.0.0",
    pluginFamily: "foundation",
    capabilities: [],
    invokeSurfaces: ["command"],
    runtimeTargets: ["wasmedge"],
    methods: [],
    schemasUsed: [],
    abiVersion: 1,
  };
  const artifactPath = path.join(dir, "shrinker.wasm");
  await writeFile(
    artifactPath,
    appendWasmCustomSection(
      new Uint8Array(bytes),
      SDS_MANIFEST_SECTION_NAME,
      encodePluginManifest(manifest),
    ),
  );
  const manifestPath = path.join(dir, "gate.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      name: "expected-lanes-control",
      artifacts: [
        {
          id: "shrinker",
          path: artifactPath,
          surface: "module",
          profile: "command",
          expectedLanes: ["browser"],
        },
      ],
    }),
  );

  const report = await runParityGate({
    manifestPath,
    lanes: ["browser", "wasmedge-native", "wasmedge-docker"],
    chromeBinary: path.join(dir, "no-such-chrome"),
    wasmedgeBinary: path.join(dir, "no-such-wasmedge"),
    dockerBinary: path.join(dir, "no-such-docker"),
    autoBuildDockerImage: false,
    log: () => {},
  });

  assert.equal(report.ok, false);
  assert.ok(
    report.failures.some(
      (failure) =>
        failure.artifact === "shrinker" &&
        failure.kind === "expected-lane-not-compared" &&
        /browser/.test(failure.message),
    ),
    `expected expected-lane-not-compared, got ${JSON.stringify(report.failures)}`,
  );
});
