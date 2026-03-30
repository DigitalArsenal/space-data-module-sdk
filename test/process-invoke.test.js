import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildWasmEdgeSpawnEnv,
  createPluginInvokeProcessClient,
  resolveWasmEdgePluginLaunchPlan,
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

test("createPluginInvokeProcessClient exchanges length-prefixed invoke envelopes over stdio", async () => {
  const client = await createPluginInvokeProcessClient({
    command: process.execPath,
    args: [FIXTURE_SERVER_PATH],
  });

  try {
    const response = await client.invoke({
      methodId: "echo",
      inputs: [
        {
          portId: "request",
          payload: new TextEncoder().encode("hello harness"),
        },
      ],
    });

    assert.equal(response.statusCode, 0);
    assert.equal(response.errorCode, null);
    assert.equal(response.outputs.length, 1);
    assert.equal(response.outputs[0].portId, "result");
    assert.equal(
      new TextDecoder().decode(response.outputs[0].payload),
      "echo:hello harness",
    );
  } finally {
    await client.destroy();
  }
});

test("resolveWasmEdgePluginLaunchPlan uses the bare WasmEdge CLI by default", () => {
  const plan = resolveWasmEdgePluginLaunchPlan({
    wasmPath: "/tmp/plugin.wasm",
  });

  assert.equal(plan.command, "wasmedge");
  assert.equal(plan.wasmPath, path.resolve("/tmp/plugin.wasm"));
  assert.deepEqual(plan.args, [
    "--enable-threads",
    path.resolve("/tmp/plugin.wasm"),
    "--serve-plugin-invoke",
  ]);
});

test("resolveWasmEdgePluginLaunchPlan uses an explicit host runner when provided", () => {
  const plan = resolveWasmEdgePluginLaunchPlan({
    wasmPath: "/tmp/plugin.wasm",
    wasmEdgeRunnerBinary: "/tmp/wasmedge-runner",
  });

  assert.equal(plan.command, "/tmp/wasmedge-runner");
  assert.deepEqual(plan.args, [
    path.resolve("/tmp/plugin.wasm"),
    "--serve-plugin-invoke",
  ]);
});

test("buildWasmEdgeSpawnEnv removes stale dynamic loader overrides", () => {
  const env = buildWasmEdgeSpawnEnv({
    PATH: process.env.PATH,
    LIBRARY_PATH: "/tmp/wasmedge/lib",
    DYLD_LIBRARY_PATH: "/tmp/wasmedge/lib",
    DYLD_FALLBACK_LIBRARY_PATH: "/tmp/wasmedge/lib",
    DYLD_FRAMEWORK_PATH: "/tmp/wasmedge/lib",
    DYLD_FALLBACK_FRAMEWORK_PATH: "/tmp/wasmedge/lib",
    WASMEDGE_LIB_DIR: "/tmp/wasmedge/lib",
  });

  assert.equal(env.PATH, process.env.PATH);
  assert.equal(env.WASMEDGE_LIB_DIR, "/tmp/wasmedge/lib");
  assert.equal("LIBRARY_PATH" in env, false);
  assert.equal("DYLD_LIBRARY_PATH" in env, false);
  assert.equal("DYLD_FALLBACK_LIBRARY_PATH" in env, false);
  assert.equal("DYLD_FRAMEWORK_PATH" in env, false);
  assert.equal("DYLD_FALLBACK_FRAMEWORK_PATH" in env, false);
});
