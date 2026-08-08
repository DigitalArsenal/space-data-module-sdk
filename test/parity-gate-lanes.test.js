// REAL-LANE tri-runtime parity gate.
//
// Runs the certified artifact set through a real headless Chrome and the
// pinned WasmEdge runtime (native binary when installed, and/or the pinned
// container). Env-gated because it needs Chrome + Docker (and, on hosts that
// provision it, WasmEdge at the pin):
//
//   SPACE_DATA_MODULE_SDK_ENABLE_PARITY_GATE=1 node --test test/parity-gate-lanes.test.js
//
// Optional:
//   SDM_GATE_REQUIRE_NATIVE_WASMEDGE=1  fail if no host WasmEdge at the pin
//   SDM_GATE_LANES=browser,wasmedge-docker
//   SDM_CHROME_BINARY / SDM_WASMEDGE_BINARY
//
// There are NO silent skips inside the gate: a lane that cannot execute fails
// the run. "Works in X" is not evidence.

import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import path from "node:path";

import {
  REPO_ROOT,
  runParityGate,
  formatGateReport,
  ContractVerdict,
} from "../src/testing/parityGate.js";

const ENABLED = process.env.SPACE_DATA_MODULE_SDK_ENABLE_PARITY_GATE === "1";
const LANES = process.env.SDM_GATE_LANES
  ? process.env.SDM_GATE_LANES.split(",").map((lane) => lane.trim()).filter(Boolean)
  : undefined;
const SKIP = !ENABLED && "set SPACE_DATA_MODULE_SDK_ENABLE_PARITY_GATE=1";

test(
  "tri-runtime parity gate: every certified artifact satisfies the host contract in every lane",
  { skip: SKIP },
  async () => {
    const report = await runParityGate({
      lanes: LANES,
      requireNativeWasmEdge: process.env.SDM_GATE_REQUIRE_NATIVE_WASMEDGE === "1",
      log: (line) => console.error(line),
    });
    if (!report.ok) console.error(formatGateReport(report));
    assert.equal(
      report.ok,
      true,
      "tri-runtime parity must hold across the certified artifact set",
    );

    // A pass is only meaningful if the lanes actually ran.
    assert.ok(
      report.lanes.some((lane) => lane.lane === "browser"),
      "the browser lane must have run",
    );
    assert.ok(
      report.lanes.some((lane) => lane.lane.startsWith("wasmedge")),
      "a WasmEdge lane must have run",
    );
    for (const artifact of report.artifacts) {
      assert.ok(artifact.lanes.length >= 2, `${artifact.id} needs >= 2 lanes`);
      for (const lane of artifact.lanes) {
        assert.ok(
          lane.contractVerdict === ContractVerdict.Satisfied ||
            lane.contractVerdict === ContractVerdict.RunnerCannotSupplyCapability,
          `${artifact.id}/${lane.lane}: ${lane.contractVerdict}`,
        );
      }
    }
    // Behavioral parity really compared something.
    for (const entry of report.behavioral) {
      assert.equal(entry.ok, true, `behavioral parity for ${entry.artifact}`);
      assert.ok(entry.comparisons > 0, `${entry.artifact} produced no comparisons`);
    }
  },
);

test(
  "NEGATIVE CONTROL: a known-bad artifact FAILS the gate on the same real lanes",
  { skip: SKIP },
  async () => {
    const report = await runParityGate({
      manifestPath: path.join(REPO_ROOT, "parity", "negative-control.json"),
      lanes: LANES,
      log: () => {},
    });
    assert.equal(report.ok, false, "the negative control must FAIL the gate");
    assert.ok(
      report.failures.some((failure) => failure.kind === "forbidden-import-class"),
      `expected a forbidden-import-class failure, got: ${report.failures.map((f) => f.kind).join(", ")}`,
    );
    // The failure must name the class, not just say "failed".
    assert.ok(
      report.failures.some((failure) => /emscripten/i.test(failure.message)),
      "the failure must name the emscripten glue class",
    );
    // And it must fail in EVERY lane — an artifact that is broken on one
    // runtime only would be reported as lane-divergence instead.
    const artifact = report.artifacts[0];
    for (const lane of artifact.lanes) {
      assert.equal(lane.contractVerdict, ContractVerdict.Violated, lane.lane);
    }
  },
);

test(
  "NEGATIVE CONTROL: an injected out-of-surface import fails as a contract violation, not as noise",
  { skip: SKIP },
  async () => {
    // The flatsql engine artifact declared against the MODULE surface: its
    // seven VFS imports are legal for the engine and illegal for a module,
    // because a module that links a private VFS is claiming a NEW HOST
    // CAPABILITY (an owner decision). Same bytes, different contract.
    const flatsqlAsModule = path.join(
      REPO_ROOT,
      "node_modules",
      "flatsql",
      "wasm",
      "flatsql-wasi.wasm",
    );
    const report = await runParityGate({
      manifest: {
        name: "surface-mismatch-control",
        manifestPath: "<synthetic>",
        artifacts: [
          {
            id: "flatsql-declared-as-module",
            surface: "module",
            artifactPath: flatsqlAsModule,
            profile: "library",
            fixture: null,
            required: true,
            note: null,
            negativeControl: true,
          },
        ],
      },
      lanes: LANES,
      log: () => {},
    });
    assert.equal(report.ok, false);
    assert.ok(
      report.failures.some(
        (failure) =>
          failure.kind === "contract-violation" ||
          failure.kind === "forbidden-import-class",
      ),
      `expected a contract failure, got: ${report.failures.map((f) => f.kind).join(", ")}`,
    );
  },
);
