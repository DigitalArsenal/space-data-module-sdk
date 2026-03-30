import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";

import {
  resolveWasmEdgeRunnerBuildPlan,
  resolveWasmEdgeRunnerSourcePath,
} from "../src/index.js";

test("resolveWasmEdgeRunnerSourcePath points at the shared SDK pthread runner source", () => {
  const sourcePath = resolveWasmEdgeRunnerSourcePath();

  assert.match(
    sourcePath,
    /space-data-module-sdk\/src\/testing\/native\/wasmedge_emscripten_pthread_runner\.c$/,
  );
});

test("resolveWasmEdgeRunnerBuildPlan derives compiler args from explicit WasmEdge paths", () => {
  const plan = resolveWasmEdgeRunnerBuildPlan({
    outputPath: "/tmp/shared-wasmedge-runner",
    wasmedgeIncludeDir: "/tmp/wasmedge/include",
    wasmedgeLibDir: "/tmp/wasmedge/lib",
  });
  const expectedSharedLibraryName =
    process.platform === "darwin"
      ? "libwasmedge.0.dylib"
      : process.platform === "win32"
        ? "wasmedge.dll"
        : "libwasmedge.so.0";

  assert.equal(plan.outputPath, path.resolve("/tmp/shared-wasmedge-runner"));
  assert.equal(plan.wasmedgeLibDir, path.resolve("/tmp/wasmedge/lib"));
  assert.equal(
    plan.wasmedgeSharedLibraryPath,
    path.join(path.resolve("/tmp/wasmedge/lib"), expectedSharedLibraryName),
  );
  assert.equal(
    plan.runnerSourcePath,
    resolveWasmEdgeRunnerSourcePath(),
  );
  if (process.platform === "darwin") {
    assert.equal(plan.compilerCommand, "xcrun");
    assert.equal(plan.compilerArgs[0], "clang");
  }
  assert.ok(
    plan.compilerArgs.includes(`-I${path.resolve("/tmp/wasmedge/include")}`),
  );
  assert.ok(
    plan.compilerArgs.includes(`-L${path.resolve("/tmp/wasmedge/lib")}`),
  );
  assert.ok(
    plan.compilerArgs.includes(path.resolve("/tmp/shared-wasmedge-runner")),
  );
});
