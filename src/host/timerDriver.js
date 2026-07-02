/**
 * Browser cron/timer driver (WS6.3).
 *
 * The node runtime re-invokes a module's manifest TIMERS through
 * plugin_invoke_stream on a schedule (Go plugins.Manager.scheduleCronMethods).
 * This is the browser-side counterpart: it reads the module's TIMERS
 * (decoded PLG manifest), schedules an interval per enabled timer, and
 * invokes the timer's method through the harness invoke surface
 * (createBrowserModuleHarness / createWorkerModuleHarness `invoke`, i.e.
 * plugin_invoke_stream).
 *
 *   const driver = createModuleTimerDriver({
 *     harness,                     // or invoke: (request) => Promise
 *     manifestBytes,               // or timers: [...] / manifest: {...}
 *     schedules: { "starlink-pull": { intervalMs: 1000 } },
 *   });
 *   driver.start();
 *   ...
 *   driver.stop();
 *
 * Semantics mirror the Go manager: one schedule per timer, runs are recorded
 * ({trigger:"scheduled"|"manual", status:"ok"|"error"}), and runs of the same
 * timer are serialized — a tick that lands while the previous invocation is
 * still in flight is skipped (recorded as "skipped"). Unlike the Go manager,
 * explicit schedule overrides are trusted (clamped only by minIntervalMs,
 * default 1s) so tests and UIs can shorten long default cadences.
 */

// Import the codec leaf, not manifest/index.js — the index pulls
// embeddedManifest.js (node:fs) and would break browser bundles.
import { decodePluginManifest } from "../manifest/codec.js";

const DEFAULT_MIN_INTERVAL_MS = 1_000;
const DEFAULT_MAX_RUN_HISTORY = 50;

function toIntervalMs(value) {
  if (typeof value === "bigint") return Number(value);
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTimer(timer) {
  const timerId = String(timer?.timerId ?? timer?.timer_id ?? "").trim();
  const methodId = String(timer?.methodId ?? timer?.method_id ?? "").trim();
  if (!timerId || !methodId) return null;
  return {
    timerId,
    methodId,
    defaultIntervalMs: toIntervalMs(
      timer.defaultIntervalMs ?? timer.default_interval_ms ?? 0,
    ),
    description: timer.description ?? "",
  };
}

function resolveTimers(options) {
  if (Array.isArray(options.timers)) {
    return options.timers.map(normalizeTimer).filter(Boolean);
  }
  const manifest =
    options.manifest ??
    (options.manifestBytes ? decodePluginManifest(options.manifestBytes) : null);
  const timers = Array.isArray(manifest?.timers) ? manifest.timers : [];
  return timers.map(normalizeTimer).filter(Boolean);
}

export function createModuleTimerDriver(options = {}) {
  const invoke =
    typeof options.invoke === "function"
      ? options.invoke
      : typeof options.harness?.invoke === "function"
        ? (request) => options.harness.invoke(request)
        : null;
  if (!invoke) {
    throw new TypeError(
      "createModuleTimerDriver requires an invoke function or a harness with invoke().",
    );
  }
  const timers = resolveTimers(options);
  const schedules =
    options.schedules && typeof options.schedules === "object"
      ? options.schedules
      : {};
  const minIntervalMs = Number.isFinite(options.minIntervalMs)
    ? Math.max(1, options.minIntervalMs)
    : DEFAULT_MIN_INTERVAL_MS;
  const maxRunHistory = Number.isInteger(options.maxRunHistory)
    ? options.maxRunHistory
    : DEFAULT_MAX_RUN_HISTORY;
  const setIntervalImpl = options.setIntervalImpl ?? globalThis.setInterval.bind(globalThis);
  const clearIntervalImpl =
    options.clearIntervalImpl ?? globalThis.clearInterval.bind(globalThis);
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const onRun = typeof options.onRun === "function" ? options.onRun : null;

  const state = new Map(); // timerId -> { timer, intervalMs, enabled, handle, inFlight, runs }
  for (const timer of timers) {
    const override = schedules[timer.timerId] ?? {};
    const enabled = override.enabled !== false;
    const requested = toIntervalMs(override.intervalMs ?? timer.defaultIntervalMs);
    const intervalMs = Math.max(minIntervalMs, requested);
    state.set(timer.timerId, {
      timer,
      intervalMs,
      enabled,
      handle: null,
      inFlight: false,
      runs: [],
    });
  }

  function record(entry, run) {
    entry.runs.push(run);
    if (entry.runs.length > maxRunHistory) {
      entry.runs.splice(0, entry.runs.length - maxRunHistory);
    }
    if (onRun) onRun(run);
  }

  async function fire(entry, trigger) {
    if (entry.inFlight) {
      record(entry, {
        timerId: entry.timer.timerId,
        methodId: entry.timer.methodId,
        trigger,
        status: "skipped",
        startedAt: now(),
        finishedAt: now(),
        message: "previous run still in flight",
      });
      return null;
    }
    entry.inFlight = true;
    const run = {
      timerId: entry.timer.timerId,
      methodId: entry.timer.methodId,
      trigger,
      status: "running",
      startedAt: now(),
    };
    try {
      const response = await invoke({ methodId: entry.timer.methodId, inputs: [] });
      run.status = "ok";
      run.finishedAt = now();
      return response;
    } catch (error) {
      run.status = "error";
      run.message = error?.message ?? String(error);
      run.finishedAt = now();
      return null;
    } finally {
      entry.inFlight = false;
      record(entry, run);
    }
  }

  let started = false;

  return {
    listTimers() {
      return [...state.values()].map((entry) => ({
        timerId: entry.timer.timerId,
        methodId: entry.timer.methodId,
        description: entry.timer.description,
        defaultIntervalMs: entry.timer.defaultIntervalMs,
        intervalMs: entry.intervalMs,
        enabled: entry.enabled,
        scheduled: entry.handle !== null,
      }));
    },
    runHistory(timerId) {
      const entry = state.get(String(timerId ?? "").trim());
      return entry ? entry.runs.map((run) => ({ ...run })) : [];
    },
    start() {
      if (started) return this.listTimers();
      started = true;
      for (const entry of state.values()) {
        if (!entry.enabled) continue;
        entry.handle = setIntervalImpl(() => {
          void fire(entry, "scheduled");
        }, entry.intervalMs);
      }
      return this.listTimers();
    },
    async runNow(timerId) {
      const entry = state.get(String(timerId ?? "").trim());
      if (!entry) {
        throw new Error(`Unknown timer: ${timerId}`);
      }
      return fire(entry, "manual");
    },
    stop() {
      for (const entry of state.values()) {
        if (entry.handle !== null) {
          clearIntervalImpl(entry.handle);
          entry.handle = null;
        }
      }
      started = false;
    },
  };
}
