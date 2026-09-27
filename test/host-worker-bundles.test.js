// The self-contained worker bundles of design A39 (src/host/hostWorkerBundles.js).
// Real-browser spawning from blob: URLs under the dashboard CSP is covered by
// opfs-io-worker.browser.test.js; here: the committed bundles equal a fresh
// build, and the I/O worker bundle runs standalone (as a plain script with no
// module graph) and passes the flatsql_io conformance script.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import { renderHostWorkerBundleSources, HOST_WORKER_BUNDLE_OUTPUT } from "../scripts/build-host-worker-bundles.mjs";
import { HOST_WORKER_BUNDLES, hostWorkerBundleSource } from "../src/host/hostWorkerBundles.js";
import { createFlatsqlIoWorker } from "../src/host/flatsqlIoWorkers.js";
import { FLATSQL_IO_CONFORMANCE_CASES } from "../src/host/flatsqlIoConformance.js";
import { readFile } from "node:fs/promises";

test("the committed worker bundles equal a fresh build of their sources", async () => {
  const committed = await readFile(HOST_WORKER_BUNDLE_OUTPUT, "utf8");
  assert.equal(committed, await renderHostWorkerBundleSources(), "run node scripts/build-host-worker-bundles.mjs");
  for (const bundle of Object.values(HOST_WORKER_BUNDLES)) {
    assert.equal(createHash("sha256").update(bundle.source).digest("hex"), bundle.sha256);
  }
});

test("the flatsql-io bundle runs as a standalone script and passes the conformance script", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sdm-bundle-"));
  try {
    const file = path.join(dir, "flatsql-io-worker.cjs");
    await writeFile(file, hostWorkerBundleSource("flatsql-io"));
    const ioWorker = await createFlatsqlIoWorker({ backend: "memory", workerUrl: pathToFileURL(file) });
    try {
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./support/flatsql-io/conformanceWorker.mjs", import.meta.url), {
          workerData: { buffer: ioWorker.buffer, prefix: "bundle" },
        });
        worker.once("message", (message) => {
          resolve(message);
          worker.terminate();
        });
        worker.once("error", reject);
      });
      assert.deepEqual(result.failed, []);
      assert.equal(result.passed.length, FLATSQL_IO_CONFORMANCE_CASES.length);
    } finally {
      await ioWorker.stop();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
