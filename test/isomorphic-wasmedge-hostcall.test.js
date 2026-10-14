// The isomorphic loader's WasmEdge leg runs an artifact that imports the typed hostcall bridge
// (space_data_module_host) on the SDK's runner, threaded or not. The plain WasmEdge CLI provides WASI only, so a
// single-thread module-host-abi artifact (the od module's shape: _start + plugin_invoke_stream, no wasi.thread-spawn)
// failed there with "unknown import space_data_module_host.call". A WASI-only artifact still runs on plain wasmedge.
//
// Real artifacts through the real runtimes: the fixtures are compiled by the SDK compiler and run on the installed
// WasmEdge; the test is skipped, visibly, when WasmEdge is not installed.

import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileModuleFromSource, cleanupCompilation } from "../src/compiler/compileModule.js";
import { encodePluginInvokeRequest, decodePluginInvokeResponse } from "../src/invoke/index.js";
import { createBrowserModuleHarness } from "../src/host/browserModuleHarness.js";
import { loadModule, WASMEDGE_UNSUPPORTED_MESSAGE } from "../src/host/isomorphicLoader.js";
import { createStandaloneHarness } from "../src/testing/isomorphicHarness.js";

const wasmEdgeAvailable = spawnSync("wasmedge", ["--version"], { stdio: "ignore" }).status === 0;
const skip = !wasmEdgeAvailable && "Install wasmedge (on PATH) to run the WasmEdge leg.";

const BRIDGED_GUEST = `
#include <string>
#include "space_data_module_invoke.h"
#include "typedHostcall.hpp"

static int answer(const std::string& s) {
  return plugin_push_output("response", "CAT.fbs", "$CAT", reinterpret_cast<const uint8_t*>(s.data()), static_cast<uint32_t>(s.size())) < 0 ? 1 : 0;
}
extern "C" {
int read_config(void) {
  const sdm_piv::Config c = sdm_piv::get_config();
  if (!c.ok()) return answer("0 " + c.error_code() + " " + c.error_message());
  return answer("1 " + std::to_string(c.size()) + " " + std::string(c.string("name")) + "|" + std::string(c.string("targets.0.provider_id")));
}
int read_clock(void) {
  auto r = sdm_piv::call("clock.now");
  return answer(r.ok() ? std::string("1") : "0 " + r.error_code() + " " + r.error_message());
}
int no_call(void) { return answer("no hostcall"); }
}
`;

const WASI_ONLY_GUEST = `
#include <string>
#include "space_data_module_invoke.h"
extern "C" int no_call(void) {
  const std::string s = "no hostcall";
  return plugin_push_output("response", "CAT.fbs", "$CAT", reinterpret_cast<const uint8_t*>(s.data()), static_cast<uint32_t>(s.size())) < 0 ? 1 : 0;
}
`;

const identity = { schemaName: "CAT.fbs", fileIdentifier: "$CAT", rootTypeName: "CAT" };
const responsePort = {
  portId: "response", required: true, minStreams: 1, maxStreams: 1,
  acceptedTypeSets: [{ setId: "catalog", allowedTypes: [{ ...identity, wireFormat: "flatbuffer" }] }],
};
const method = (methodId) => ({ methodId, displayName: methodId, inputPorts: [], outputPorts: [responsePort], maxBatch: 1, drainPolicy: "single-shot" });
const CONFIG = { name: "gfs", targets: [{ provider_id: "noaa" }] };

async function compileFixture(t, sourceCode, methods) {
  const compilation = await compileModuleFromSource({
    language: "c++", sourceCode, allowUndefinedImports: true, threadModel: "single-thread",
    manifest: {
      pluginId: "com.digitalarsenal.test.wasmedge-hostcall", name: "WasmEdge hostcall", version: "0.1.0", pluginFamily: "analysis",
      runtimeTargets: ["browser", "wasmedge"], invokeSurfaces: ["direct", "command"],
      methods: methods.map(method),
    },
  });
  t.after(() => cleanupCompilation(compilation));
  const dir = await mkdtemp(path.join(os.tmpdir(), "sdm-wasmedge-hostcall-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const wasmPath = path.join(dir, "module.wasm");
  await writeFile(wasmPath, compilation.wasmBytes);
  const imports = WebAssembly.Module.imports(await WebAssembly.compile(compilation.wasmBytes));
  const exports = WebAssembly.Module.exports(await WebAssembly.compile(compilation.wasmBytes)).map((entry) => entry.name);
  return { compilation, wasmPath, imports, exports };
}

const text = (response) => {
  assert.equal(response.statusCode, 0, response.errorMessage ?? "");
  return new TextDecoder().decode(response.outputs[0].payload);
};

test("a single-thread artifact that imports space_data_module_host runs on the SDK runner on the WasmEdge leg", { skip, timeout: 600_000 }, async (t) => {
  const { compilation, wasmPath, imports, exports } = await compileFixture(t, BRIDGED_GUEST, ["read_config", "read_clock", "no_call"]);
  assert.ok(imports.some((entry) => entry.module === "space_data_module_host" && entry.name === "call"), "the fixture imports the bridge");
  assert.ok(!imports.some((entry) => entry.module === "wasi" && entry.name === "thread-spawn"), "the fixture is single-threaded");
  assert.ok(exports.includes("_start") && exports.includes("plugin_invoke_stream"), "the od shape: command and direct entries");

  const expected = {
    read_config: "1 2 gfs|noaa",
    read_clock: `0 unsupported ${WASMEDGE_UNSUPPORTED_MESSAGE}`,
    no_call: "no hostcall",
  };

  // The browser leg answers plugin.getConfig through its host: the WasmEdge leg must answer the same.
  const browser = await createBrowserModuleHarness({ wasmSource: compilation.wasmBytes, surface: "command", hostOptions: { config: CONFIG } });
  t.after(() => browser.destroy());
  assert.equal(text(await browser.invoke({ methodId: "read_config", inputs: [] })), expected.read_config, "browser leg");

  for (const surface of ["command", "direct"]) {
    const harness = await loadModule({ wasmSource: wasmPath, runtimeKind: "wasmedge", surface, config: CONFIG });
    t.after(() => harness.destroy());
    assert.equal(harness.runtime.kind, "wasmedge");
    assert.equal(harness.runtime.surface, surface);
    assert.notEqual(path.basename(harness.launchPlan.command), "wasmedge", "a bridged artifact never runs on the plain CLI");
    assert.ok(harness.launchPlan.args.includes("--sdm-hostcall-config") && harness.launchPlan.args.includes("--sdm-hostcall-unsupported"),
      "the runner is handed the staged hostcall answers");
    assert.equal(harness.launchPlan.args.includes("--sdm-direct"), surface === "direct");
    for (const [methodId, answer] of Object.entries(expected)) {
      assert.equal(text(await harness.invoke({ methodId, inputs: [] })), answer, `${surface} ${methodId}`);
    }
  }

  // The standalone harness hands the WasmEdge leg the config the browser lane's host serves.
  const standalone = await createStandaloneHarness("wasmedge", wasmPath, { hostOptions: { config: CONFIG } });
  t.after(() => standalone.destroy());
  assert.equal(text(await standalone.invoke({ methodId: "read_config", inputs: [] })), expected.read_config, "standalone harness");

  // Without a config, plugin.getConfig answers an empty one.
  const bare = await loadModule({ wasmSource: wasmPath, runtimeKind: "wasmedge" });
  t.after(() => bare.destroy());
  assert.equal(text(await bare.invoke({ methodId: "read_config", inputs: [] })), "1 0 |");

  // The plain CLI is what failed before: it cannot instantiate the bridged artifact at all.
  const plain = spawnSync("wasmedge", [wasmPath], { input: Buffer.from(encodePluginInvokeRequest({ methodId: "no_call", inputs: [] })) });
  assert.notEqual(plain.status, 0, "plain wasmedge refuses an artifact that imports space_data_module_host");
});

test("a WASI-only artifact still runs on the plain WasmEdge CLI", { skip, timeout: 600_000 }, async (t) => {
  const { wasmPath, imports } = await compileFixture(t, WASI_ONLY_GUEST, ["no_call"]);
  assert.ok(!imports.some((entry) => entry.module === "space_data_module_host"), "the fixture does not import the bridge");
  assert.ok(!imports.some((entry) => entry.module === "wasi" && entry.name === "thread-spawn"), "the fixture is single-threaded");
  const harness = await loadModule({ wasmSource: wasmPath, runtimeKind: "wasmedge" });
  t.after(() => harness.destroy());
  assert.equal(harness.launchPlan.command, "wasmedge");
  assert.ok(!harness.launchPlan.args.includes("--sdm-hostcall-config"));
  const response = decodePluginInvokeResponse(await harness.invokeRaw(encodePluginInvokeRequest({ methodId: "no_call", inputs: [] })));
  assert.equal(text(response), "no hostcall");
});
