import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlatcRunner } from "flatc-wasm";
import { toLoadableWasmBytes } from "../../src/bundle/artifactBytes.js";
import { loadModule } from "../../src/host/isomorphicLoader.js";
import { WasiExitError } from "../../src/host/wasiShim.js";
import { encodePluginInvokeRequest, PluginInvokeError } from "../../src/invoke/index.js";
import { normalizeParityFixture, runParityHarness } from "../../src/testing/parityHarness.js";
import { defaultParityLaneRunners } from "../../src/testing/parityLanes.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
let stage = "setup";

function defaultWasmPath() {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: root, encoding: "utf8" }).trim();
  const suffix = path.join(".git", "modules", "repos", "space-data-module-sdk");
  assert(common.endsWith(suffix), "Cannot derive the stack checkout; pass --wasm or SDM_E2E_MODULE_WASM.");
  return path.join(common.slice(0, -suffix.length),
    "repos/main-packages/space-data-network-modules/analysis/conjunction-assessment/dist/isomorphic/module.wasm");
}

async function headlessShell(explicit) {
  let candidate = explicit ?? process.env.GAUNTLET_HEADLESS_SHELL;
  if (!candidate) {
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.homedir(), "Library/Caches/ms-playwright");
    const revisions = (await readdir(cache)).filter((name) => /^chromium_headless_shell-\d+$/.test(name))
      .sort((a, b) => Number(b.split("-").at(-1)) - Number(a.split("-").at(-1)));
    for (const revision of revisions) {
      const directory = path.join(cache, revision);
      for (const name of await readdir(directory)) {
        if (!name.startsWith("chrome-headless-shell-")) continue;
        const binary = path.join(directory, name, "chrome-headless-shell");
        try { await access(binary, constants.X_OK); candidate = binary; break; } catch {}
      }
      if (candidate) break;
    }
  }
  assert(candidate, "No cached Chromium headless shell; pass --chrome or GAUNTLET_HEADLESS_SHELL.");
  const binary = await realpath(candidate);
  assert.equal(path.basename(binary), "chrome-headless-shell", "Only Chromium headless shell is permitted.");
  await access(binary, constants.X_OK);
  return binary;
}

async function pivSchema() {
  const schemaRoot = path.join(path.dirname(createRequire(import.meta.url).resolve("spacedatastandards.org/package.json")), "schema");
  const files = {};
  async function include(relative) {
    const name = path.posix.normalize(relative);
    const key = `/sds/${name}`;
    if (files[key]) return;
    const source = await readFile(path.join(schemaRoot, name), "utf8");
    files[key] = source;
    for (const match of source.matchAll(/include\s+"([^"]+)"/g)) {
      await include(path.posix.join(path.posix.dirname(name), match[1]));
    }
  }
  await include("PIV/main.fbs");
  return { entry: "/sds/PIV/main.fbs", files };
}

async function main() {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const flag = process.argv[index];
    assert(["--wasm", "--chrome"].includes(flag) && process.argv[index + 1],
      "Usage: node scripts/e2e/command-error-response.mjs [--wasm <path>] [--chrome <path>]");
    options[flag.slice(2)] = process.argv[index + 1];
  }
  const wasmPath = path.resolve(options.wasm ?? process.env.SDM_E2E_MODULE_WASM ?? defaultWasmPath());
  const chromeBinary = await headlessShell(options.chrome);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "sdm-command-error-"));
  const harnesses = [];
  let evidence;
  try {
    const request = {
      methodId: "screen_catalog",
      inputs: [{ portId: "request", typeRef: {
        schemaName: "OMM.fbs", fileIdentifier: "$OMM", rootTypeName: "OMM", wireFormat: "flatbuffer",
      }, payload: new Uint8Array([8, 0, 0, 0, 0x24, 0x4f, 0x4d, 0x4d]) }],
    };
    const requestBytes = encodePluginInvokeRequest(request);
    const expected = {
      name: "PluginInvokeError",
      message: "unsupported-input-type: Input frame type is not accepted by port: request (status 400)",
      exitCode: 1, statusCode: 400, errorCode: "unsupported-input-type",
      errorMessage: "Input frame type is not accepted by port: request",
    };
    const plan = await normalizeParityFixture({ name: "command-error-response", cases: [
      { id: "invalid-input-type", stdinBase64: Buffer.from(requestBytes).toString("base64"), expect: "guest-error" },
      { id: "unknown-argument", stdinBase64: "", args: ["--bogus"], expect: "guest-error" },
    ] });
    const raw = {};
    const laneRunners = Object.fromEntries(Object.entries(defaultParityLaneRunners).map(([lane, run]) =>
      [lane, async (context) => (raw[lane] = await run(context))]));
    stage = "tri-runtime parity";
    const lanes = ["browser", "wasmedge", "docker-wasmedge"];
    const report = await runParityHarness({ wasmPath, plan, lanes, chromeBinary, laneRunners, timeoutMs: 240_000 });
    assert(report.ok, JSON.stringify(report.failures[0]));
    for (const summary of report.runs) {
      stage = `${summary.lane}: ${summary.caseId} report summary`;
      const run = raw[summary.lane].find((entry) => entry.caseId === summary.caseId && entry.threadCount === summary.threadCount);
      assert.equal(summary.exitCode, run.exitCode);
      assert.deepEqual(summary.commandError, run.commandError);
    }
    let stdout;
    for (const lane of lanes) {
      stage = `${lane}: invalid-input-type`;
      const invalid = raw[lane].find((run) => run.caseId === "invalid-input-type");
      assert.equal(invalid.exitCode, 1);
      assert.deepEqual(invalid.commandError, expected);
      assert.equal(invalid.stdout.length, 164);
      if (stdout) assert.deepEqual(invalid.stdout, stdout, "Error response stdout differs across lanes.");
      stdout = invalid.stdout;
      stage = `${lane}: unknown-argument`;
      const unknown = raw[lane].find((run) => run.caseId === "unknown-argument");
      assert.equal(unknown.exitCode, 64);
      assert.equal(unknown.commandError, null);
      assert.equal(unknown.stdout.length, 0);
    }
    stage = "independent flatc-wasm decoding";
    const flatc = await FlatcRunner.init();
    const decoded = JSON.parse(flatc.generateJSON(await pivSchema(), { path: "/piv.bin", data: stdout }, { defaultsJson: true })).RESPONSE;
    const independent = { statusCode: decoded.STATUS_CODE, errorCode: decoded.ERROR_CODE, errorMessage: decoded.ERROR_MESSAGE };
    assert.deepEqual(independent, { statusCode: 400, errorCode: "unsupported-input-type",
      errorMessage: "Input frame type is not accepted by port: request" });
    for (const lane of lanes) {
      const surfaced = raw[lane].find((run) => run.caseId === "invalid-input-type").commandError;
      for (const [field, value] of Object.entries(independent)) assert.equal(surfaced[field], value, `${lane}: ${field}`);
    }
    const loadablePath = path.join(tempDir, "module.wasm");
    await writeFile(loadablePath, toLoadableWasmBytes(new Uint8Array(await readFile(wasmPath))));
    const harnessOptions = { wasmSource: loadablePath, runtimeKind: "wasmedge", surface: "command",
      enableThreads: true, cwd: root };
    stage = "production WasmEdge harness";
    const harness = await loadModule(harnessOptions);
    harnesses.push(harness);
    const laneError = raw.wasmedge.find((run) => run.caseId === "invalid-input-type").commandError;
    for (const [name, invoke] of [["invoke", () => harness.invoke(request)], ["invokeRaw", () => harness.invokeRaw(requestBytes)]]) {
      stage = `production WasmEdge ${name}`;
      await assert.rejects(invoke, (error) => {
        assert(error instanceof PluginInvokeError);
        assert.deepEqual(error.toJSON(), laneError);
        return true;
      });
    }
    stage = "production WasmEdge unknown-argument";
    const unknownHarness = await loadModule({ ...harnessOptions, args: ["--bogus"] });
    harnesses.push(unknownHarness);
    await assert.rejects(() => unknownHarness.invokeRaw(new Uint8Array()), (error) => {
      assert(error instanceof WasiExitError);
      assert.equal(error.code, 64);
      assert.match(error.stderr, /Unknown argument/);
      return true;
    });
    evidence = { moduleSha256: report.moduleSha256, stdoutBytes: stdout.length,
      stdoutSha256: createHash("sha256").update(stdout).digest("hex"), commandError: expected, flatc: independent,
      runs: report.runs.map(({ lane, caseId, exitCode }) => ({ lane, caseId, exitCode })),
      productionHarness: ["invoke", "invokeRaw", "unknown-argument"] };
  } finally {
    try {
      await Promise.all(harnesses.map((harness) => harness.destroy()));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
  console.log("E2E PASS");
  console.log(JSON.stringify(evidence));
}

main().catch((error) => {
  console.error(`E2E FAIL (${stage}): ${error.message}`);
  process.exitCode = 1;
});
