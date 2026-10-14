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

// The typed hostcall bridge in every lane: a single-thread C++ module that imports space_data_module_host and fetches
// its config through plugin.getConfig (typedHostcall.hpp). The browser lane answers through the SDK's dispatch, the
// WasmEdge lanes through the SDK runner replaying the staged $PIV answers; the module's output - its config read back,
// an unsupported operation's typed failure, a method that makes no call - is byte-identical across the three lanes, on
// the command and the direct surface.
const CONFIG_GUEST = `
#include <cstdio>
#include <string>
#include "space_data_module_invoke.h"
#include "typedHostcall.hpp"

static void dump(const sdm_piv::ConfigTable& t, std::string& s) {
  char number[64];
  if (!t.entries()) return;
  for (const auto* e : *t.entries()) {
    s += e->KEY()->str() + "=";
    switch (e->KIND()) {
      case sdn::runtime::configValueKind_String: s += "s:" + (e->STRING_VALUE() ? e->STRING_VALUE()->str() : std::string()); break;
      case sdn::runtime::configValueKind_Number: std::snprintf(number, sizeof number, "n:%g", e->NUMBER_VALUE()); s += number; break;
      case sdn::runtime::configValueKind_Bool: s += e->BOOL_VALUE() ? "b:true" : "b:false"; break;
      case sdn::runtime::configValueKind_NumberList:
        s += "n[";
        for (double v : t.numbers(e->KEY()->c_str())) { std::snprintf(number, sizeof number, "%g,", v); s += number; }
        s += "]";
        break;
      case sdn::runtime::configValueKind_StringList:
        s += "s[";
        for (auto v : t.strings(e->KEY()->c_str())) s += std::string(v) + ",";
        s += "]";
        break;
      case sdn::runtime::configValueKind_TableList:
        s += "[";
        for (size_t i = 0; i < t.tables(e->KEY()->c_str()); ++i) { s += "{"; dump(t.table(e->KEY()->c_str(), i), s); s += "}"; }
        s += "]";
        break;
    }
    s += ";";
  }
}
static int answer(const std::string& s) {
  return plugin_push_output("response", "CAT.fbs", "$CAT", reinterpret_cast<const uint8_t*>(s.data()), static_cast<uint32_t>(s.size())) < 0 ? 1 : 0;
}
extern "C" {
int read_config(void) {
  const sdm_piv::Config c = sdm_piv::get_config();
  if (!c.ok()) return answer("0 " + c.error_code() + " " + c.error_message());
  std::string s;
  dump(c, s);
  return answer("1 " + std::to_string(c.size()) + " " + s + "|" + std::string(c.string("targets.0.provider_id")) + "|" + std::to_string(c.count("targets.0.widths")));
}
int read_clock(void) {
  auto r = sdm_piv::call("clock.now");
  return answer(r.ok() ? std::string("1") : "0 " + r.error_code() + " " + r.error_message());
}
int no_call(void) { return answer("no hostcall"); }
}
`;

test(
  "tri-runtime parity: every lane serves the hostcall bridge - plugin.getConfig answers the case's config, other operations unsupported",
  { skip: !ENABLED && "set SPACE_DATA_MODULE_SDK_ENABLE_TRI_RUNTIME_PARITY=1", timeout: 600_000 },
  async (t) => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const { compileModuleFromSource, cleanupCompilation } = await import("../src/compiler/compileModule.js");
    const { encodePluginInvokeRequest, decodePluginInvokeResponse } = await import("../src/invoke/index.js");
    const { runParityHarness, formatParityReport, loadParityFixture, loadWasmEdgePin } = await import("../src/testing/parityHarness.js");
    const { runNativeWasmEdgeLane } = await import("../src/testing/parityLanes.js");

    const identity = { schemaName: "CAT.fbs", fileIdentifier: "$CAT", rootTypeName: "CAT" };
    const response = { portId: "response", required: true, minStreams: 1, maxStreams: 1,
      acceptedTypeSets: [{ setId: "catalog", allowedTypes: [{ ...identity, wireFormat: "flatbuffer" }] }] };
    const method = (methodId) => ({ methodId, displayName: methodId, inputPorts: [], outputPorts: [response], maxBatch: 1, drainPolicy: "single-shot" });
    const compilation = await compileModuleFromSource({
      language: "c++", sourceCode: CONFIG_GUEST, allowUndefinedImports: true, threadModel: "single-thread",
      manifest: {
        pluginId: "com.digitalarsenal.test.parity-config", name: "Parity config", version: "0.1.0", pluginFamily: "analysis",
        runtimeTargets: ["browser", "wasmedge"], invokeSurfaces: ["direct", "command"],
        methods: [method("read_config"), method("read_clock"), method("no_call")],
      },
    });
    t.after(() => cleanupCompilation(compilation));
    const imports = WebAssembly.Module.imports(await WebAssembly.compile(compilation.wasmBytes));
    assert.ok(imports.some((entry) => entry.module === "space_data_module_host" && entry.name === "call"), "the fixture imports the bridge");
    assert.ok(!imports.some((entry) => entry.module === "wasi" && entry.name === "thread-spawn"), "the fixture is single-threaded");

    const dir = await mkdtemp(path.join(os.tmpdir(), "sdm-parity-config-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const wasmPath = path.join(dir, "module.wasm");
    await writeFile(wasmPath, compilation.wasmBytes);
    const request = (methodId) => Buffer.from(encodePluginInvokeRequest({ methodId, inputs: [] })).toString("base64");
    const fixturePath = path.join(dir, "parity.json");
    await writeFile(fixturePath, JSON.stringify({
      name: "hostcall-bridge", threadCounts: [1],
      config: { name: "gfs", enabled: true, lead: 72, tags: ["wind", "rain"], targets: [{ provider_id: "noaa", widths: [1, 2.5] }] },
      cases: [
        { id: "config", stdinBase64: request("read_config") },
        { id: "case-config", stdinBase64: request("read_config"), config: { targets: [{ provider_id: "ecmwf", widths: [0.25] }] } },
        { id: "unsupported", stdinBase64: request("read_clock") },
        { id: "no-call", stdinBase64: request("no_call") },
      ],
    }));
    const plan = await loadParityFixture(fixturePath);
    const text = (bytes) => new TextDecoder().decode(decodePluginInvokeResponse(bytes).outputs[0].payload);
    const expected = {
      config: "1 5 enabled=b:true;lead=n:72;name=s:gfs;tags=s[wind,rain,];targets=[{provider_id=s:noaa;widths=n[1,2.5,];}];|noaa|2",
      "case-config": "1 1 targets=[{provider_id=s:ecmwf;widths=n[0.25,];}];|ecmwf|1",
      unsupported: "0 unsupported the parity harness serves only plugin.getConfig",
      "no-call": "no hostcall",
    };

    // The native lane routes the bridged single-thread artifact through the SDK runner.
    const native = await runNativeWasmEdgeLane({ wasmPath, wasmBytes: compilation.wasmBytes, plan, pin: loadWasmEdgePin(), timeoutMs: 60_000 });
    for (const run of native) {
      assert.equal(run.exitClass, "ok", `${run.caseId}: ${run.exitDetail} ${new TextDecoder().decode(run.stderr ?? new Uint8Array())}`);
      assert.equal(text(run.stdout), expected[run.caseId], run.caseId);
    }

    for (const surface of [undefined, "direct"]) {
      const report = await runParityHarness({ wasmPath, fixturePath, surface, timeoutMs: 120_000, log: (line) => console.error(line) });
      assert.equal(report.ok, true, formatParityReport(report));
      assert.deepEqual(report.lanes.map((lane) => lane.lane).sort(), ["browser", "docker-wasmedge", "wasmedge"]);
      assert.equal(report.runs.length, 3 * plan.cases.length);
      for (const run of report.runs) {
        const nativeRun = native.find((n) => n.caseId === run.caseId);
        assert.equal(run.exitClass, "ok", `${surface ?? "command"} ${run.lane} ${run.caseId}: ${run.exitDetail}`);
        if (surface === undefined) assert.equal(run.stdoutLength, nativeRun.stdout.length, `${run.lane} ${run.caseId}`);
      }
    }
  },
);
