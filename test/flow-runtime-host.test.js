import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createFlowRuntimeHost, FLOW_INVALID_INDEX } from "../src/flow/flowRuntimeHost.js";

// WS3.2 — the JS flow host runs the SAME compiled flow artifact the Go host
// runs (starlink-flow runtime.wasm): linked-direct starlink-parser ->
// validator inside the artifact's linear memory, host-model sink handled by
// the JS handler map. Gated on SDN_STARLINK_FLOW_WASM (the built artifact).
const wasmPath = process.env.SDN_STARLINK_FLOW_WASM ?? "";

const MEME_FIXTURE = [
  "created: 2026-07-02T00:00:00Z",
  "ephemeris_start: 2026-07-02T00:00:00Z ephemeris_stop: 2026-07-03T00:00:00Z step_size: 60",
  "ephemeris_source: blend",
  "UVW",
  "2026185000000.000 6800.0 0.0 0.0 0.0 7.5 0.0",
  "2026185000060.000 6800.0 450.0 0.0 0.0 7.5 0.0",
  "2026185000120.000 6800.0 900.0 0.0 0.0 7.5 0.0",
  "",
].join("\n");

test(
  "JS flow host drains the linked-direct starlink chain",
  { skip: wasmPath === "" ? "set SDN_STARLINK_FLOW_WASM to the built runtime.wasm" : false },
  async () => {
    const host = await createFlowRuntimeHost({
      wasmSource: new Uint8Array(fs.readFileSync(wasmPath)),
    });

    assert.equal(host.nodeCount, 3);
    assert.equal(host.edgeCount, 2);
    assert.equal(host.triggerCount, 1);
    assert.equal(host.dependencyCount, 2);

    const parseDD = host.getNodeDispatchDescriptor(0);
    assert.equal(parseDD.nodeId, "parse");
    assert.equal(parseDD.pluginId, "org.digitalarsenal.ephem.starlink-parser");
    assert.equal(parseDD.dispatchModel, "linked-direct");
    assert.equal(host.getNodeDispatchDescriptor(2).dispatchModel, "host");
    assert.equal(
      host.getDependencyDescriptor(1).pluginId,
      "org.digitalarsenal.ephem.validator",
    );

    host.enqueueTriggerFrame(0, {
      portId: "raw",
      bytes: new TextEncoder().encode(MEME_FIXTURE),
    });
    assert.equal(host.getIngressState(0).totalReceived, 1n);

    const sinkFrames = [];
    const result = await host.drain(
      {
        "test.sink:collect": ({ frames }) => {
          sinkFrames.push(...frames);
          return { statusCode: 0 };
        },
      },
      { maxIterations: 50 },
    );
    assert.ok(result.nodesInvoked >= 3, `nodesInvoked = ${result.nodesInvoked}`);

    // Linked-direct nodes executed inside the artifact.
    assert.equal(host.getNodeState(0).invocationCount, 1n);
    assert.equal(host.getNodeState(1).invocationCount, 1n);

    assert.equal(sinkFrames.length, 1);
    assert.equal(sinkFrames[0].portId, "result");
    const verdict = JSON.parse(new TextDecoder().decode(sinkFrames[0].bytes));
    assert.equal(verdict.ok, true);
    assert.equal(verdict.stateCount, 3);

    // reset_state clears queues and states; no ready nodes remain.
    host.resetState();
    assert.equal(host.getNodeState(0).invocationCount, 0n);
    const idle = await host.drain({}, { maxIterations: 5 });
    assert.equal(idle.iterations, 0);
    assert.equal(FLOW_INVALID_INDEX, 0xffffffff);
  },
);
