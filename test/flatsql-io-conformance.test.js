// One flatsql_io conformance script on every SDK host (design 22.3a-6). The
// browser run of the same script (OPFS through the I/O worker) is in
// opfs-io-worker.browser.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";

import {
  FLATSQL_IO_CONFORMANCE_CASES,
  conformanceAdapterForAsyncClient,
  runFlatsqlIoConformance,
} from "../src/host/flatsqlIoConformance.js";
import { createNodeSyncFsIo, createNodeSyncFsIoTable } from "../src/host/nodeSyncFsIo.js";
import { createFlatsqlIoWorker } from "../src/host/flatsqlIoWorkers.js";
import { createSabIoAsyncClient } from "../src/host/sabIoChannel.js";

const CONFORMANCE_WORKER = new URL("./support/flatsql-io/conformanceWorker.mjs", import.meta.url);

function assertAllPassed(result, host) {
  assert.deepEqual(result.failed, [], `${host}: failed cases`);
  assert.equal(result.passed.length, FLATSQL_IO_CONFORMANCE_CASES.length, `${host}: every case ran`);
}

function runInWorker(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(CONFORMANCE_WORKER, { workerData });
    worker.once("message", (message) => {
      resolve(message);
      worker.terminate();
    });
    worker.once("error", reject);
  });
}

test("Node sync-fs provider passes the flatsql_io conformance script", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sdm-fsio-conf-"));
  try {
    const io = createNodeSyncFsIo({ root, table: createNodeSyncFsIoTable() });
    assertAllPassed(await runFlatsqlIoConformance(io), "node-sync-fs");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const doorbell of ["atomics", "message"]) {
  test(`SAB channel + memory I/O worker passes the script (blocking client, ${doorbell} doorbell)`, async () => {
    const ioWorker = await createFlatsqlIoWorker({ backend: "memory", doorbell });
    try {
      assert.equal(ioWorker.info.doorbellMode, doorbell);
      const result = await runInWorker({ buffer: ioWorker.buffer, prefix: "blocking" });
      assertAllPassed(result, `memory/${doorbell}/blocking`);
    } finally {
      await ioWorker.stop();
    }
  });

  test(`SAB channel + memory I/O worker passes the script (async client, ${doorbell} doorbell)`, async () => {
    const ioWorker = await createFlatsqlIoWorker({ backend: "memory", doorbell });
    const client = createSabIoAsyncClient({
      buffer: ioWorker.buffer,
      forceMessages: doorbell === "message",
    });
    try {
      const result = await runFlatsqlIoConformance(conformanceAdapterForAsyncClient(client), {
        prefix: "async",
      });
      assertAllPassed(result, `memory/${doorbell}/async`);
    } finally {
      client.close$();
      await ioWorker.stop();
    }
  });
}
