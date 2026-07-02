import test from "node:test";
import assert from "node:assert/strict";

import { createBrowserHost } from "../src/host/browserHost.js";
import { createAsyncHostDispatcher } from "../src/host/abi.js";

// WS6.2 — storage + pubsub capabilities on the browser host, mirroring the Go
// node's module capability contract (sdn-server internal/modulert/caps):
//   storage.write {schema, data:base64} -> {cid}
//   storage.query {schema, ...} -> records
//   storage.delete {schema, cid} -> true
//   pubsub.publish {topic, data} -> true
//   pubsub.list_topics {} -> {topics}
// Adapters are pluggable via hostOptions.capabilityAdapters.{storage,pubsub}.

function createRecordingAdapters() {
  const calls = [];
  const storage = {
    write: async (params) => {
      calls.push(["storage.write", params]);
      return { cid: "cid-1" };
    },
    query: async (params) => {
      calls.push(["storage.query", params]);
      return [{ cid: "cid-1", schema: params.schema }];
    },
    delete: async (params) => {
      calls.push(["storage.delete", params]);
      return true;
    },
  };
  const pubsub = {
    publish: async (params) => {
      calls.push(["pubsub.publish", params]);
      return true;
    },
    subscribe: async (params) => {
      calls.push(["pubsub.subscribe", params]);
      return true;
    },
    unsubscribe: async (params) => {
      calls.push(["pubsub.unsubscribe", params]);
      return true;
    },
    list_topics: async () => {
      calls.push(["pubsub.list_topics", {}]);
      return { topics: ["sdn/data-source/spacex-starlink"] };
    },
  };
  return { calls, storage, pubsub };
}

test("browser host routes storage.* and pubsub.* to capability adapters", async () => {
  const { calls, storage, pubsub } = createRecordingAdapters();
  const host = createBrowserHost({
    capabilityAdapters: { storage, pubsub },
  });
  // Guest hostcalls travel through the async dispatcher (host.invoke first).
  const dispatch = createAsyncHostDispatcher(host);

  assert.deepEqual(
    await dispatch("storage.write", { schema: "OMM", data: "AAECAw==" }),
    { cid: "cid-1" },
  );
  assert.deepEqual(
    await dispatch("storage.query", { schema: "OMM", limit: 10 }),
    [{ cid: "cid-1", schema: "OMM" }],
  );
  assert.equal(await dispatch("storage.delete", { schema: "OMM", cid: "cid-1" }), true);
  assert.equal(
    await dispatch("pubsub.publish", { topic: "sdn/t", data: "hello" }),
    true,
  );
  assert.deepEqual(await dispatch("pubsub.list_topics", {}), {
    topics: ["sdn/data-source/spacex-starlink"],
  });

  assert.deepEqual(
    calls.map(([op]) => op),
    [
      "storage.write",
      "storage.query",
      "storage.delete",
      "pubsub.publish",
      "pubsub.list_topics",
    ],
  );
  // Params pass through untouched (Go-contract field names).
  assert.deepEqual(calls[0][1], { schema: "OMM", data: "AAECAw==" });
  assert.deepEqual(calls[3][1], { topic: "sdn/t", data: "hello" });
});

test("storage/pubsub report as supported capabilities and operations", () => {
  const { storage, pubsub } = createRecordingAdapters();
  const host = createBrowserHost({ capabilityAdapters: { storage, pubsub } });
  for (const cap of ["storage_query", "storage_write", "pubsub"]) {
    assert.ok(host.hasCapability(cap), `capability ${cap} granted by default`);
  }
  const ops = host.listOperations();
  for (const op of [
    "storage.write",
    "storage.query",
    "storage.delete",
    "pubsub.publish",
    "pubsub.subscribe",
    "pubsub.unsubscribe",
    "pubsub.list_topics",
  ]) {
    assert.ok(ops.includes(op), `operation ${op} listed`);
  }
});

test("storage/pubsub are capability-gated and adapter-gated", async () => {
  const { storage, pubsub } = createRecordingAdapters();
  const gated = createBrowserHost({
    capabilities: ["clock"],
    capabilityAdapters: { storage, pubsub },
  });
  await assert.rejects(
    gated.invoke("storage.write", { schema: "OMM", data: "AA==" }),
    /storage_write/,
  );
  await assert.rejects(gated.invoke("pubsub.publish", { topic: "t" }), /pubsub/);

  const unconfigured = createBrowserHost({});
  await assert.rejects(
    unconfigured.invoke("storage.write", { schema: "OMM", data: "AA==" }),
    /storage adapter is not configured/,
  );
  await assert.rejects(
    unconfigured.invoke("pubsub.publish", { topic: "t" }),
    /pubsub adapter is not configured/,
  );
});
