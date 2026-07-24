// Tri-runtime parity integration: the REAL three lanes against a real module.
//
// Env-gated because it needs a Chrome/Chromium binary, a native WasmEdge at
// the pinned version, and a Docker daemon (the pinned parity image is built
// on demand). Enable with:
//
//   SPACE_DATA_MODULE_SDK_ENABLE_TRI_RUNTIME_PARITY=1 \
//   [SDM_PARITY_MODULE_WASM=/path/to/dist/isomorphic/module.wasm] \
//   [SDM_WASMEDGE_BINARY=/path/to/wasmedge] \
//   node --test test/parity-tri-lane.test.js
//
// Inside the gate there are NO silent skips: a missing lane dependency fails
// the run — parity evidence, not "works in X".

import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ENABLED =
  process.env.SPACE_DATA_MODULE_SDK_ENABLE_TRI_RUNTIME_PARITY === "1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(
  __dirname,
  "..",
  "fixtures",
  "parity",
  "sgp4-command.json",
);
const DEFAULT_MODULE_WASM = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "main-packages",
  "space-data-network-modules",
  "propagator",
  "sgp4",
  "dist",
  "isomorphic",
  "module.wasm",
);

test(
  "tri-runtime parity: sgp4 module is byte-identical across browser, native WasmEdge, and Docker WasmEdge",
  { skip: !ENABLED && "set SPACE_DATA_MODULE_SDK_ENABLE_TRI_RUNTIME_PARITY=1" },
  async () => {
    const { runParityHarness, formatParityReport } = await import(
      "../src/testing/parityHarness.js"
    );
    const wasmPath =
      process.env.SDM_PARITY_MODULE_WASM ?? DEFAULT_MODULE_WASM;
    await access(wasmPath).catch(() => {
      throw new Error(
        `parity module artifact not found: ${wasmPath} (set SDM_PARITY_MODULE_WASM).`,
      );
    });

    const report = await runParityHarness({
      wasmPath,
      fixturePath: FIXTURE_PATH,
      log: (line) => console.error(line),
    });
    if (!report.ok) {
      console.error(formatParityReport(report));
    }
    assert.equal(report.ok, true, "tri-runtime parity must hold");
    assert.equal(report.lanes.length, 3);
    for (const lane of report.lanes) {
      assert.ok(lane.runs > 0, `${lane.lane} must produce runs`);
    }

    // Fire drill on the same real lanes: one corrupted output byte in one
    // lane must flip the verdict to a loud FAIL.
    const drill = await runParityHarness({
      wasmPath,
      fixturePath: FIXTURE_PATH,
      injectDivergence: "docker-wasmedge",
      log: () => {},
    });
    assert.equal(drill.ok, false, "injected divergence must FAIL the diff");
    assert.ok(
      drill.failures.some((failure) => failure.kind === "output-divergence"),
      "divergence must be reported as output-divergence",
    );
  },
);
