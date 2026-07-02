import test from "node:test";
import assert from "node:assert/strict";

import { createModuleTimerDriver } from "../src/host/timerDriver.js";
import { encodePlgManifest, legacyManifestToPlg } from "../src/manifest/index.js";

// WS6.3 — browser cron/timer driver: manifest TIMERS -> interval ->
// plugin_invoke_stream (via the harness invoke surface). Fake timers keep the
// scheduling deterministic; the real-module path is exercised by the
// in-browser E2E (worker harness + spacex-starlink-source).

function createFakeClock() {
  const intervals = new Map();
  let nextHandle = 1;
  return {
    setIntervalImpl: (fn, ms) => {
      const handle = nextHandle++;
      intervals.set(handle, { fn, ms });
      return handle;
    },
    clearIntervalImpl: (handle) => {
      intervals.delete(handle);
    },
    async tickAll() {
      for (const { fn } of [...intervals.values()]) {
        fn();
      }
      // let queued run promises settle
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    intervals,
  };
}

const TIMERS = [
  {
    timerId: "starlink-pull",
    methodId: "pull",
    defaultIntervalMs: 3_600_000n, // BigInt, as decodePluginManifest yields
    description: "hourly pull",
  },
  { timerId: "disabled-timer", methodId: "noop", defaultIntervalMs: 5_000 },
];

test("schedules enabled timers with overrides and invokes plugin methods", async () => {
  const clock = createFakeClock();
  const invocations = [];
  const driver = createModuleTimerDriver({
    invoke: async (request) => {
      invocations.push(request);
      return { ok: true };
    },
    timers: TIMERS,
    schedules: {
      "starlink-pull": { intervalMs: 1_000 },
      "disabled-timer": { enabled: false },
    },
    setIntervalImpl: clock.setIntervalImpl,
    clearIntervalImpl: clock.clearIntervalImpl,
  });

  const listed = driver.start();
  assert.deepEqual(
    listed.map((t) => [t.timerId, t.intervalMs, t.enabled, t.scheduled]),
    [
      ["starlink-pull", 1_000, true, true],
      ["disabled-timer", 5_000, false, false],
    ],
  );
  assert.equal(clock.intervals.size, 1, "only the enabled timer is scheduled");

  await clock.tickAll();
  await clock.tickAll();
  assert.equal(invocations.length, 2);
  assert.deepEqual(invocations[0], { methodId: "pull", inputs: [] });

  const history = driver.runHistory("starlink-pull");
  assert.equal(history.length, 2);
  assert.ok(history.every((run) => run.status === "ok" && run.trigger === "scheduled"));

  driver.stop();
  assert.equal(clock.intervals.size, 0);
  await clock.tickAll();
  assert.equal(invocations.length, 2, "no invocations after stop");
});

test("clamps below-minimum intervals and reads timers from an encoded manifest", () => {
  const manifestBytes = encodePlgManifest(
    legacyManifestToPlg({
      pluginId: "com.example.timers",
      name: "Timers",
      version: "1.0.0",
      pluginFamily: "data_source",
      capabilities: ["http"],
      invokeSurfaces: ["command"],
      methods: [{ methodId: "pull", inputPorts: [], outputPorts: [] }],
      timers: [
        { timerId: "fast", methodId: "pull", defaultIntervalMs: 10 },
      ],
    }),
  );
  const driver = createModuleTimerDriver({
    invoke: async () => null,
    manifestBytes,
  });
  const [timer] = driver.listTimers();
  assert.equal(timer.timerId, "fast");
  assert.equal(timer.methodId, "pull");
  assert.equal(timer.intervalMs, 1_000, "clamped to minIntervalMs");
});

test("serializes in-flight runs and records errors", async () => {
  const clock = createFakeClock();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const driver = createModuleTimerDriver({
    invoke: async () => {
      calls += 1;
      if (calls === 1) await gate;
      if (calls === 2) throw new Error("boom");
      return null;
    },
    timers: [{ timerId: "t", methodId: "m", defaultIntervalMs: 1_000 }],
    setIntervalImpl: clock.setIntervalImpl,
    clearIntervalImpl: clock.clearIntervalImpl,
  });
  driver.start();

  await clock.tickAll(); // starts run 1 (blocked on gate)
  await clock.tickAll(); // lands while run 1 in flight -> skipped
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await clock.tickAll(); // run 2 -> throws

  const history = driver.runHistory("t");
  assert.deepEqual(
    history.map((run) => run.status),
    ["skipped", "ok", "error"],
  );
  assert.match(history[2].message, /boom/);
  driver.stop();
});

test("runNow triggers a manual run for a known timer and rejects unknown ids", async () => {
  const invocations = [];
  const driver = createModuleTimerDriver({
    invoke: async (request) => {
      invocations.push(request.methodId);
      return "out";
    },
    timers: [{ timerId: "t", methodId: "m", defaultIntervalMs: 1_000 }],
  });
  assert.equal(await driver.runNow("t"), "out");
  assert.deepEqual(invocations, ["m"]);
  assert.equal(driver.runHistory("t")[0].trigger, "manual");
  await assert.rejects(driver.runNow("nope"), /Unknown timer/);
});
