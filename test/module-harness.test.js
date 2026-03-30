import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  createModuleHarness,
  resolveModuleHarnessLaunchPlan,
} from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_SERVER_PATH = path.resolve(
  __dirname,
  "..",
  "fixtures",
  "process-invoke",
  "echo-plugin-server.mjs",
);

test("createModuleHarness wraps a generic process command runtime", async () => {
  const harness = await createModuleHarness({
    runtime: {
      kind: "process",
      command: process.execPath,
      args: [FIXTURE_SERVER_PATH],
    },
  });

  try {
    const response = await harness.invoke({
      methodId: "echo",
      inputs: [
        {
          portId: "request",
          payload: new TextEncoder().encode("hello module harness"),
        },
      ],
    });

    assert.equal(response.statusCode, 0);
    assert.equal(
      new TextDecoder().decode(response.outputs[0].payload),
      "echo:hello module harness",
    );
    assert.equal(harness.runtime.kind, "process");
  } finally {
    await harness.destroy();
  }
});

test("resolveModuleHarnessLaunchPlan delegates wasmedge profiles to the shared WasmEdge launch planner", () => {
  const plan = resolveModuleHarnessLaunchPlan({
    runtime: {
      kind: "wasmedge",
      wasmPath: "/tmp/module-harness.wasm",
      wasmEdgeRunnerBinary: "/tmp/wasmedge-runner",
    },
  });

  assert.equal(plan.command, "/tmp/wasmedge-runner");
  assert.deepEqual(plan.args, [
    path.resolve("/tmp/module-harness.wasm"),
    "--serve-plugin-invoke",
  ]);
});
