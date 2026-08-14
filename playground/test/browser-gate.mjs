#!/usr/bin/env node
/**
 * The playground's REAL-BROWSER gate.
 *
 * Launches headless Chrome, serves playground/public, and drives the whole
 * loop — COMPILE (emception llvm-box in a Worker), VERIFY (the SDK's shipped
 * propagator conformance suite), RUN (propagate and compare against the SDK's
 * independent two-body reference) — then asserts computable outcomes.
 *
 * Why a real browser and not jsdom: jsdom has no WebAssembly compilation
 * pipeline worth the name, no Worker with module type, and no honest
 * performance timing. The one thing this task must prove is that a C++ source
 * compiles to a conformant wasm module IN A BROWSER; a simulated browser
 * cannot testify to that, and a green jsdom run would be the exact kind of
 * evidence the stack's admissibility rule refuses.
 *
 * Talks CDP over node's built-in WebSocket — no browser-automation dependency
 * is added to the SDK for a gate that runs a handful of evaluations.
 *
 * Run: node playground/test/browser-gate.mjs
 * Env: PLAYGROUND_CHROME overrides the Chrome binary path.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createServer } from "../server.mjs";

const CHROME_CANDIDATES = [
  process.env.PLAYGROUND_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

// Compile budgets. Generous on purpose: the point of the gate is that the loop
// WORKS in a browser, not that a laptop hits a stopwatch. A budget this loose
// still catches "the toolchain never came up".
const COLD_LOOP_BUDGET_MS = 300_000;

/** Max distance from the independent two-body reference we will accept. */
const POSITION_BAND_M = 1e-3;
const VELOCITY_BAND_M_S = 1e-6;

function findChrome() {
  return CHROME_CANDIDATES[0];
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method) {
        this.events.push(message.method);
        return;
      }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate an async function body in the page and return its JSON value. */
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: COLD_LOOP_BUDGET_MS,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `page threw: ${
          result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text
        }`,
      );
    }
    return result.result.value;
  }
}

async function waitForWebSocketUrl(port, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Chrome did not expose a CDP page target in time");
}

async function openSocket(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return socket;
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    // PROVISION-BLOCKED, not a failure of the code under test.
    process.stderr.write(
      "browser-gate: no Chrome/Chromium binary found — set PLAYGROUND_CHROME.\n",
    );
    process.exit(2);
  }

  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}/`;

  const profile = await mkdtemp(path.join(os.tmpdir(), "playground-gate-"));
  const debugPort = 9333 + (process.pid % 500);
  const browser = spawn(
    chrome,
    [
      "--headless=new",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      origin,
    ],
    { stdio: "ignore" },
  );

  let cdp;
  try {
    const wsUrl = await waitForWebSocketUrl(debugPort);
    cdp = new Cdp(await openSocket(wsUrl));
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    // Drive the navigation ourselves rather than trusting the command-line
    // URL: the target we attached to may still be the startup about:blank,
    // and CDP answers "Cannot find default execution context" until the page
    // it is attached to actually has a document.
    await cdp.send("Page.navigate", { url: origin });
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try {
        if ((await cdp.evaluate("location.href")) === origin) break;
      } catch (error) {
        if (!String(error.message).includes("execution context")) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const report = await cdp.evaluate(`(async () => {
      for (let i = 0; i < 600 && !globalThis.__playgroundReady; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!globalThis.__playgroundReady) throw new Error("playground never booted");
      const out = { origin: location.origin, external: [], cases: {} };

      // Zero external-origin bytes: every resource this page loaded must be
      // same-origin. A CDN slipping into the page is a law breach, not a
      // performance note.
      out.external = performance.getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => !name.startsWith(location.origin));

      const drive = async (exampleId) => {
        globalThis.__playground.selectExample(exampleId);
        const t0 = performance.now();
        await globalThis.__playground.doCompile();
        const compile = globalThis.__playgroundCompile;
        if (compile.error) return { compile };
        await globalThis.__playground.doVerify();
        const verify = globalThis.__playgroundVerify;
        await globalThis.__playground.doRun();
        return {
          loopMs: performance.now() - t0,
          compile,
          verify: {
            verdict: verify.verdict,
            corpusCases: verify.corpus?.cases ?? null,
            checks: (verify.checks || []).map((c) => ({ id: c.id, status: c.status, detail: c.detail })),
            gaps: (verify.gaps || []).map((g) => g.id),
          },
          run: globalThis.__playgroundRun,
        };
      };

      out.cases["two-body"] = await drive("two-body");
      out.cases.scaffold = await drive("scaffold");
      return out;
    })()`);

    // ---- Gate 1: the node-UI law -------------------------------------------
    assert.deepEqual(
      report.external,
      [],
      `page loaded external-origin bytes: ${report.external.join(", ")}`,
    );

    // ---- Gate 2: the worked example compiles IN A BROWSER -------------------
    const worked = report.cases["two-body"];
    assert.ok(
      !worked.compile.error,
      `two-body example failed to compile in-browser: ${worked.compile.error}`,
    );
    assert.ok(
      worked.compile.byteLength > 1024,
      `two-body module.wasm is implausibly small (${worked.compile.byteLength} bytes)`,
    );

    // ---- Gate 3: it is CONFORMANT, judged by the SDK's own suite ------------
    assert.equal(
      worked.verify.verdict,
      "PASS-WITH-GAPS",
      `two-body verdict was ${worked.verify.verdict}; failing checks: ` +
        worked.verify.checks
          .filter((check) => check.status === "fail")
          .map((check) => `${check.id} (${check.detail})`)
          .join("; "),
    );
    const anchors = worked.verify.checks.find((check) => check.id === "tierB/anchors");
    assert.equal(anchors?.status, "pass", "Tier-B numeric anchors did not pass");
    assert.ok(
      worked.verify.corpusCases >= 15,
      `Tier-B corpus was ${worked.verify.corpusCases} cases — too few to adjudicate`,
    );
    // The ONLY tolerated non-pass is the parity gate, which one runtime cannot
    // decide. A new gap appearing silently is a regression in honesty.
    const gapIds = worked.verify.checks
      .filter((check) => check.status === "gap")
      .map((check) => check.id);
    assert.deepEqual(gapIds, ["tier0/parity-gate"], `unexpected gaps: ${gapIds}`);

    // ---- Gate 4: the RUN output matches the independent reference -----------
    assert.ok(
      worked.run.maxPositionErrorM < POSITION_BAND_M,
      `max |Δposition| ${worked.run.maxPositionErrorM} m exceeds ${POSITION_BAND_M} m`,
    );
    assert.ok(
      worked.run.maxVelocityErrorMs < VELOCITY_BAND_M_S,
      `max |Δvelocity| ${worked.run.maxVelocityErrorMs} m/s exceeds ${VELOCITY_BAND_M_S} m/s`,
    );

    // ---- Gate 5: the gate has been SEEN TO FAIL ----------------------------
    // The unfilled scaffold compiles fine and does not move. If it also passed
    // Tier B, the verify stage would be decoration.
    const scaffold = report.cases.scaffold;
    assert.ok(
      !scaffold.compile.error,
      `scaffold example failed to compile: ${scaffold.compile.error}`,
    );
    assert.equal(
      scaffold.verify.verdict,
      "FAIL",
      "the unfilled scaffold passed conformance — the Tier-B check cannot fail, so it proves nothing",
    );
    assert.equal(
      scaffold.verify.checks.find((check) => check.id === "tierB/anchors")?.status,
      "fail",
      "the scaffold's motionless output was not caught by Tier-B anchors",
    );

    process.stdout.write(
      [
        "browser-gate PASS",
        `  origin              ${report.origin} (0 external-origin resources)`,
        `  two-body compile    ${worked.compile.byteLength.toLocaleString()} bytes, ` +
          `compiler ${worked.compile.timings.totalMs.toFixed(0)} ms, ` +
          `cold loop ${worked.loopMs.toFixed(0)} ms`,
        `  two-body verify     ${worked.verify.verdict} over ${worked.verify.corpusCases} Tier-B cases ` +
          `(gaps: ${gapIds.join(", ")})`,
        `  two-body run        max |Δr| ${worked.run.maxPositionErrorM.toExponential(3)} m, ` +
          `max |Δv| ${worked.run.maxVelocityErrorMs.toExponential(3)} m/s`,
        `  scaffold verify     ${scaffold.verify.verdict} (negative control: the gate can fail)`,
        "",
      ].join("\n"),
    );
  } finally {
    try {
      cdp?.socket.close();
    } catch {
      // already gone
    }
    browser.kill();
    server.close();
    // Chrome flushes its cache on the way out; deleting the profile from under
    // it races. Cleanup failure must never masquerade as a gate verdict.
    await new Promise((resolve) => browser.once("exit", resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  }
}

await main();
