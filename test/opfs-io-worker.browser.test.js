// Real-browser acceptance for T9 (FlatSQL partition store, design §18 T9 #1-#4,
// A7, A36, A38, A39): headless Chromium, Firefox and WebKit through Playwright.
//
// Every browser loads one page under the shipped dashboard's CSP (`worker-src
// 'self' blob:`) with COOP/COEP. The page spawns the engine driver
// (test/support/flatsql-io/browserEngine.mjs) from a blob: URL; it spawns the
// wasi-threads pool and the FlatSQL I/O workers from the SDK's self-contained
// blob bundles, and runs a hand-assembled wasi-threads guest whose threads call
// the seven `env.flatsql_io_*` imports.
//
// Env-gated like the repo's other external-runtime suites:
//   SPACE_DATA_MODULE_SDK_ENABLE_BROWSER_IO=1 node --test test/opfs-io-worker.browser.test.js
// Browsers come from Playwright's cache (npx playwright-core install chromium
// firefox webkit). SPACE_DATA_MODULE_SDK_BROWSERS=chromium,webkit narrows the
// set. When the suite is enabled, a browser that cannot launch FAILS; it never
// skips.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { startBrowserSuiteServer } from "./support/flatsql-io/browserServer.mjs";

const ENABLED = process.env.SPACE_DATA_MODULE_SDK_ENABLE_BROWSER_IO === "1";
const BROWSERS = (process.env.SPACE_DATA_MODULE_SDK_BROWSERS ?? "chromium,firefox,webkit")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const A7_CYCLES = Number(process.env.SPACE_DATA_MODULE_SDK_A7_CYCLES ?? 100);

const FLATSQL_IO_ERR_IO = -4;
const FLATSQL_IO_ERR_ACCESS = -3;
const FLATSQL_IO_ERR_NOENT = -2;

function report(browser, name, value) {
  console.log(`[t9-browser] ${browser} ${name} ${JSON.stringify(value)}`);
}

for (const browserName of BROWSERS) {
  test(`T9 browser suite: ${browserName}`, { skip: !ENABLED && "set SPACE_DATA_MODULE_SDK_ENABLE_BROWSER_IO=1", timeout: 900_000 }, async (t) => {
    const { chromium, firefox, webkit } = await import("playwright-core");
    const launcher = { chromium, firefox, webkit }[browserName];
    assert.ok(launcher, `unknown browser ${browserName}`);
    const server = await startBrowserSuiteServer();
    // A persistent profile: WebKit refuses OPFS in an ephemeral context
    // (UnknownError, measured on WebKit 26.6).
    const profile = await mkdtemp(path.join(os.tmpdir(), `sdm-t9-${browserName}-`));
    const context = await launcher.launchPersistentContext(profile, { headless: true });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      page.on("console", (message) => {
        if (message.type() === "error") console.log(`[${browserName} console] ${message.text()}`);
      });
      await page.goto(server.url);
      const ready = await page.evaluate(() => window.__t9.ready);
      assert.equal(ready.ready, true, `engine worker started: ${JSON.stringify(ready)}`);
      assert.equal(ready.crossOriginIsolated, true, "the engine worker is cross-origin isolated");
      const version = context.browser()?.version() ?? "persistent";
      report(browserName, "version", { version, userAgent: await page.evaluate(() => navigator.userAgent) });

      const run = async (scenario, options) => {
        const reply = await page.evaluate(([name, opts]) => window.__t9.run(name, opts), [scenario, options ?? {}]);
        assert.equal(reply.ok, true, `${scenario}: ${reply.error}`);
        report(browserName, scenario + (options ? JSON.stringify(options) : ""), reply.result);
        return reply.result;
      };

      await t.test("capability matrix (#4): OPFS sync handles, SAB views, shared modes, doorbell", async () => {
        const matrix = await page.evaluate(() => window.__t9.probe());
        report(browserName, "matrix", matrix);
        const timer = await run("timer");
        assert.equal(matrix.page.crossOriginIsolated, true);
        assert.equal(matrix.page.sharedWasmMemory, true);
        assert.equal(matrix.worker.syncAccessHandle, true, "OPFS sync access handles in a worker");
        assert.equal(typeof matrix.worker.sharedViewRead, "boolean");
        assert.equal(typeof matrix.worker.sharedViewWrite, "boolean");
        assert.equal(typeof matrix.worker.sharedHandleModes, "boolean");
        assert.equal(matrix.worker.nestedBlobWorker, true, "blob workers spawn blob workers");
        assert.equal(
          matrix.localStore.supported,
          matrix.worker.sharedHandleModes === true,
          "the local-store gate follows the shared-mode ruling (§22.4-6)",
        );
        assert.ok(timer.resolutionMicros > 0);
      });

      await t.test("#1/#4: 8 guest threads, mixed I/O, 200 async opens + 50 unlinks through 1 I/O worker", async () => {
        for (const doorbell of ["auto", "message"]) {
          const result = await run("mixed", { doorbell });
          if (doorbell === "message") assert.equal(result.doorbell, "message");
          assert.equal(result.guestErrors, 0, "0 errors");
          assert.deepEqual(result.namespaceErrors, []);
          assert.equal(result.lostWrites, 0, "0 lost writes on read-back");
          assert.equal(result.survivors, 150, "every opened file that was not unlinked exists");
          assert.equal(result.unlinkedPresent, 0, "every unlinked file is gone");
          assert.equal(result.read4k.n, 8 * 4 * 32);
        }
      });

      await t.test("A7 (replaces #1): lane 4 KiB read p99 <= 1 ms during 100 x 4 MiB write+flush cycles", async () => {
        const result = await run("a7", { cycles: A7_CYCLES });
        assert.equal(result.writerErrors, 0);
        assert.equal(result.laneErrors, 0);
        assert.ok(result.samePartition.n > 0 && result.otherPartition.n > 0, "lanes ran during the writer");
        assert.ok(result.samePartition.p99 <= 1000, `same partition p99 ${result.samePartition.p99} us`);
        assert.ok(result.otherPartition.p99 <= 1000, `other partition p99 ${result.otherPartition.p99} us`);
      });

      await t.test("#2 and A38: a 500 ms open blocks only its caller; OPEN_DEFERRED returns at once", async () => {
        const { runs, baselineP99, plainP99, deferredP99 } = await run("slowOpen");
        for (const r of [...runs.baseline, ...runs.plain, ...runs.deferred]) {
          assert.equal(r.errors, 0);
          assert.equal(r.fastReads.n, 7 * 300);
        }
        for (const plain of runs.plain) {
          assert.equal(plain.slowStillBlocked, true, "the fast threads finished while the open was pending");
          assert.ok(plain.maxOpenMicros >= 500_000, "the slow open waited for its getFileHandle");
          assert.ok(plain.fastReads.max < 250_000, `no fast read waited for the open (max ${plain.fastReads.max} us)`);
        }
        for (const deferred of runs.deferred) {
          assert.ok(deferred.maxOpenMicros < 100_000, `a deferred open returned in ${deferred.maxOpenMicros} us`);
          assert.ok(deferred.slowWriteMicros >= 400_000, "its first write waited for the open");
          assert.ok(deferred.fastReads.max < 250_000);
        }
        // Median p99 over three alternating runs of each condition.
        const allowed = Math.max(2 * baselineP99, 1000);
        assert.ok(plainP99 <= allowed, `read p99 during a 500 ms open ${plainP99} us vs baseline ${baselineP99} us`);
        assert.ok(deferredP99 <= allowed, `read p99 during a deferred open ${deferredP99} us vs baseline ${baselineP99} us`);
      });

      await t.test("#3: poolSize=6 on hardwareConcurrency=2 spawns 6 workers; the 7th spawn is -1 and reported", async () => {
        const result = await run("poolSize");
        assert.equal(result.hardwareConcurrency, 2);
        assert.equal(result.workers, 6);
        assert.ok(result.tids.every((tid) => tid > 0));
        assert.equal(result.seventh, -1);
        assert.equal(result.declined.length, 1);
        assert.equal(result.declined[0].reason, "pool-exhausted");
        assert.equal(result.report.armed, 6);
        assert.equal(result.report.declined, 1);
        assert.equal(result.errors, 0);
      });

      await t.test("the flatsql_io conformance script passes on OPFS and on the memory backend", async () => {
        const result = await run("conformance");
        assert.deepEqual(result.opfs.failed, []);
        assert.deepEqual(result.memory.failed, []);
        assert.equal(result.opfs.passed.length, result.memory.passed.length);
      });

      await t.test("A36: guest traps and a dead I/O worker are supervised; nothing throws into a guest", async () => {
        const result = await run("supervision");
        assert.ok(result.trapTid > 0);
        assert.equal(result.guestErrors[0]?.instanceId, 9);
        assert.equal(result.guestErrors[0]?.tid, result.trapTid);
        assert.equal(result.blockedBeforeKill, true);
        assert.equal(result.pendingResult, FLATSQL_IO_ERR_IO, "the pending open completed with IO");
        assert.ok(result.nextResult < 0, "a stale handle is refused after the restart");
        assert.equal(result.ioErrors.length, 1);
        assert.ok(result.ioErrors[0].failedRequests >= 1);
        assert.equal(result.restarts, 1);
        assert.ok(result.reopened >= 0, "the replacement I/O worker serves");
      });

      await t.test("A36: revocation stops an instance mid-stream; 0 bytes written after revoke", async () => {
        const result = await run("revoke");
        assert.equal(result.sizeAfter, result.sizeAtRevoke, "0 bytes after revoke resolved");
        assert.ok(result.errors > 0 && result.errors < result.blocks, "the revoke landed mid-stream");
        assert.equal(result.lastResult, FLATSQL_IO_ERR_ACCESS);
      });

      await t.test("A37 building block: the store Web Lock lives in the writer I/O worker", async () => {
        const result = await run("lock");
        assert.equal(result.refused, true, "a second context with ifAvailable is refused");
        assert.equal(result.waitedWhileHeld, true, "a waiting context does not start while the lock is held");
        assert.ok(result.reopened >= 0, "the successor reopens the leader's files");
        assert.equal(result.sameBytes, true);
      });

      await t.test("§5.5 window store: the memory backend creates no OPFS entry and reset drops it", async () => {
        const result = await run("windowStore");
        assert.equal(result.errors, 0);
        assert.equal(result.probeBefore, 0);
        assert.equal(result.probeAfter, FLATSQL_IO_ERR_NOENT);
        assert.deepEqual(result.opfsAfter, result.opfsBefore, "0 OPFS entries created");
      });
    } finally {
      await context.close();
      await server.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
