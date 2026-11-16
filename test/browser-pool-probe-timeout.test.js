import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { cleanupCompilation } from "../src/compiler/compileModule.js";
import { resolveHeadlessShell } from "../src/testing/headlessShell.js";
import { compileThreadWaveGuest, threadWaveEnv, threadWaveRequest } from "./support/threadWaveGuest.mjs";
import { startThreadWaveServer } from "./support/threadWaveBrowser.mjs";

test("Chromium: browser pool deadline, arming report, cleanup, and result parity", { timeout: 240000 }, async () => {
  const compilation = await compileThreadWaveGuest();
  let server, browser;
  try {
    server = await startThreadWaveServer({
      wasmBytes: compilation.wasmBytes,
      ownerEntry: fileURLToPath(new URL("./support/browserPoolProbeOwner.mjs", import.meta.url)),
    });
    browser = await chromium.launch({ executablePath: await resolveHeadlessShell(), headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    const failedRequests = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("requestfailed", request => failedRequests.push(request.url()));
    await page.goto(server.url);
    await page.waitForFunction(() => typeof window.__runWaves === "function");
    const run = (options) => page.evaluate(options => window.__runWaves(options), {
      request: threadWaveRequest(), ...options,
    });
    for (const surface of ["direct", "command"]) {
      const baseline = await run({ surface, poolSize: 0, env: threadWaveEnv(1) });
      assert.equal(baseline.error, undefined);
      assert.equal(baseline.statusCode, 0);
      assert.deepEqual(baseline.report, { requested: 0, armed: 0 });
      // Existing fixture regression value; byte equivalence is host validation,
      // not an independent reference for a physical computation.
      assert.equal(Buffer.from(baseline.outputs[0]).toString("hex"), "ecbe247c0e7e1dec");
      for (const probeTimeoutMs of [30000, 1]) {
        const result = await run({ surface, poolSize: 4, probeTimeoutMs, env: threadWaveEnv(4, { mode: "inline" }) });
        assert.equal(result.error, undefined);
        assert.equal(result.statusCode, 0, result.errorMessage);
        assert.deepEqual(result.outputs, baseline.outputs);
        assert.equal(result.initial.requested, 4);
        assert.equal(result.report.requested, 4);
        assert.equal(result.frozen, true);
        assert.equal(result.readOnly, true);
        assert.equal(result.liveAfterArming, result.initial.armed, "unarmed workers are terminated before the harness returns");
        assert.equal(result.liveAfterInvoke, surface === "direct" ? result.report.armed : result.initial.armed);
        assert.equal(result.liveAfterDestroy, 0);
        assert.equal(result.created, surface === "direct" ? 4 : 8);
        assert.equal(result.spawnReport.failedToArm, 4 - result.report.armed);
        if (probeTimeoutMs === 30000) {
          assert.equal(result.initial.armed, 4);
          assert.equal(result.report.armed, 4);
          assert.equal(result.spawnReport.spawned, 9);
          assert.equal(result.spawnReport.declined, 0);
        } else {
          assert.ok(result.initial.armed < 4);
          assert.ok(result.report.armed < 4);
          if (result.report.armed === 0) assert.equal(result.spawnReport.declined, 9);
        }
        console.log(`${surface}: timeout=${probeTimeoutMs}, requested=${result.report.requested}, armed=${result.report.armed}, spawned=${result.spawnReport.spawned}, declined=${result.spawnReport.declined}, liveAfterDestroy=${result.liveAfterDestroy}, identical=true`);
      }
    }
    for (const probeTimeoutMs of [0, -1, NaN, Infinity, -Infinity, "1500", null]) {
      const result = await run({ surface: "direct", poolSize: 4, probeTimeoutMs });
      assert.equal(result.error, "wasiThreadProbeTimeoutMs must be a positive finite number.");
      assert.equal(result.created, 0);
      assert.equal(result.liveAfterDestroy, 0);
    }
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(failedRequests, []);
  } finally {
    await browser?.close();
    await server?.close();
    await cleanupCompilation(compilation);
  }
});
