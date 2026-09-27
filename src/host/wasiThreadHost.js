// Isomorphic wasi-threads spawn host.
//
// A wasm32-wasip1-threads (isomorphic-pthreads) artifact imports
// `wasi.thread-spawn` and exports `wasi_thread_start`. When the guest calls
// pthread_create it invokes `wasi.thread-spawn(startArg)`; the host must run a
// NEW OS thread that instantiates the SAME module over the SAME shared memory
// and calls `wasi_thread_start(tid, startArg)`. This module provides that host
// in BOTH environments:
//   - Node: a `node:worker_threads` Worker (src/host/wasiThreadWorker.mjs),
//     created lazily per spawn.
//   - Browser: a WARM POOL of classic Blob-URL Workers (inlined below), started
//     and confirmed ready during host creation, then dispatched to per spawn.
// Thread join/exit synchronization is done by the guest over shared-memory
// atomics (memory.atomic.wait/notify); the host only needs to start the thread.
//
// Why the browser needs a warm pool (correction of the earlier C6-era note):
//   - Nested Workers created under COOP/COEP DO share a single imported
//     WebAssembly.Memory by reference — a nested worker's atomic writes ARE
//     visible to the joining thread. Shared memory was never the problem.
//     (Proven headless + headed: nested-sab-microtest2/3/4.)
//   - The deadlock was STARTUP timing, not memory. The guest runs synchronous
//     WASM from pthread_create straight through pthread_join (memory.atomic.wait)
//     WITHOUT ever yielding this thread's event loop. A Worker created LAZILY at
//     pthread_create time needs the parent's event loop to run its startup, but
//     the parent is already blocked in the join — so the lazily-spawned worker
//     never starts and the join blocks forever.
//   - Fix: PRE-START the workers here (while this thread's event loop is still
//     free), confirm each is ready, and only postMessage work to an
//     already-running worker at spawn time. A message posted to a live worker is
//     delivered even while this thread is blocked in the synchronous join, so
//     the pooled worker runs the guest thread and notifies the join. (Proven.)
//
// See docs/isomorphic-pthreads.md and docs/browser-wasmedge-isomorphic.md.

import { NODE_BUILTIN_PREFIX } from "./nodeBuiltinSpecifier.js";

const IS_NODE =
  typeof process !== "undefined" &&
  !!process.release &&
  process.release.name === "node";

// ---------------------------------------------------------------------------
// Browser worker asset resolution (the BUNDLED-CONSUMER anchor).
//
// `import.meta.url` is only a correct anchor when this file is served in its
// package layout (unbundled Node/dev). Any bundler that inlines this source
// rewrites `import.meta.url` to the BUNDLE's URL, and the sibling
// `wasiThreadBrowserWorker.mjs` was never emitted next to the bundle -> the
// Worker 404s. That is a real defect that shipped: five OrbPro/sdn-js bundles
// re-emitted this literal and the published sandcastle bucket requested
// `Build/CesiumUnminified/wasiThreadBrowserWorker.mjs`.
//
// So the anchor is now an EXPLICIT, documented parameter:
//   - `createWasiThreadSpawn({ browserWorkerUrl })` — the worker file itself, or
//   - `createWasiThreadSpawn({ browserWorkerBaseUrl })` — the DIRECTORY that
//     holds the worker chain, or
//   - `setBrowserWasiThreadWorkerBase(baseUrl)` — a process-wide default a host
//     shim installs once (OrbPro points it at the served
//     `js/vendor/space-data-module-sdk/src/host/`).
// The default stays today's `import.meta.url` sibling, so unbundled behavior is
// byte-for-byte unchanged.
//
// IMPORTANT: the anchor names a DIRECTORY that must contain the WHOLE chain —
// `wasiThreadBrowserWorker.mjs` imports `./wasiThreadWorkerRuntime.js`. Staging
// only the single `.mjs` next to a bundle does NOT work.
//
// There is deliberately NO consumer-side `location` sniffing and NO
// fetch-and-retry probe: resolution must be deterministic (Node never fetches;
// browser thread count may not become a function of network timing), and an
// unreachable worker asset fails LOUD (see WasiThreadWorkerUnreachableError).
// ---------------------------------------------------------------------------

const BROWSER_WORKER_FILENAME = "wasiThreadBrowserWorker.mjs";

/**
 * Default anchor: the sibling asset in this file's own package layout, or null
 * when this source was bundled into a context without a hierarchical module
 * URL (an IIFE bundle has no `import.meta.url`; a blob: module worker's URL
 * cannot anchor a relative path). Evaluating the module must never throw
 * there: such hosts pass `browserWorkerUrl` (e.g. the blob bundle of A39).
 */
export const DEFAULT_BROWSER_WORKER_URL = (() => {
  try {
    return new URL(`./${BROWSER_WORKER_FILENAME}`, import.meta.url);
  } catch {
    return null;
  }
})();

let browserWorkerBaseOverride = null;

/**
 * Install the process-wide browser worker base URL. Intended for a host shim
 * (e.g. an engine bundle) that knows where its build published the SDK host
 * directory. Pass `null` to restore the packaged default.
 *
 * @param {string|URL|null} baseUrl directory URL containing
 *   `wasiThreadBrowserWorker.mjs` AND `wasiThreadWorkerRuntime.js`. A trailing
 *   slash is added when missing.
 */
export function setBrowserWasiThreadWorkerBase(baseUrl) {
  browserWorkerBaseOverride = baseUrl == null ? null : normalizeBase(baseUrl);
}

/** Current process-wide base override, or null when unset. */
export function getBrowserWasiThreadWorkerBase() {
  return browserWorkerBaseOverride;
}

function normalizeBase(baseUrl) {
  const asString = String(baseUrl);
  return asString.endsWith("/") ? asString : `${asString}/`;
}

/**
 * Resolve the browser worker URL for one host. Precedence (highest first):
 *   1. `browserWorkerUrl` option (the worker file itself)
 *   2. `browserWorkerBaseUrl` option (directory)
 *   3. `setBrowserWasiThreadWorkerBase()` process-wide base
 *   4. packaged `import.meta.url` sibling (default)
 */
export function resolveBrowserWorkerUrl({
  browserWorkerUrl,
  browserWorkerBaseUrl,
} = {}) {
  if (browserWorkerUrl) {
    return String(browserWorkerUrl);
  }
  const base = browserWorkerBaseUrl
    ? normalizeBase(browserWorkerBaseUrl)
    : browserWorkerBaseOverride;
  if (base) {
    // Resolve relative bases (e.g. "js/vendor/space-data-module-sdk/src/host/")
    // against the document when one exists; absolute URLs pass through.
    const documentBase =
      typeof globalThis !== "undefined" &&
      globalThis.location &&
      typeof globalThis.location.href === "string"
        ? globalThis.location.href
        : undefined;
    return documentBase
      ? new URL(`${base}${BROWSER_WORKER_FILENAME}`, documentBase).href
      : `${base}${BROWSER_WORKER_FILENAME}`;
  }
  if (!DEFAULT_BROWSER_WORKER_URL) {
    throw new WasiThreadWorkerUnreachableError(
      "(no packaged anchor: this host source was bundled without import.meta.url)",
    );
  }
  return String(DEFAULT_BROWSER_WORKER_URL);
}

/**
 * Thrown when the pooled browser path was REQUESTED (threads enabled,
 * cross-origin isolated, shared memory) but the worker asset at the resolved
 * anchor could not be loaded at all. This is the fail-loud replacement for the
 * old silent sequential fallback: a 404'd worker is a deployment defect, not a
 * capability negotiation, and it must never degrade quietly to one thread.
 */
export class WasiThreadWorkerUnreachableError extends Error {
  constructor(workerUrl, cause) {
    super(
      `[wasi-thread] pooled browser worker asset is unreachable at ${workerUrl}. ` +
        `The anchor must name a directory that serves BOTH ${BROWSER_WORKER_FILENAME} ` +
        `and wasiThreadWorkerRuntime.js. When this host source is bundled, pass ` +
        `browserWorkerBaseUrl / browserWorkerUrl to createWasiThreadSpawn (or call ` +
        `setBrowserWasiThreadWorkerBase) — import.meta.url anchors to the bundle, not ` +
        `to the package layout.`,
    );
    this.name = "WasiThreadWorkerUnreachableError";
    this.workerUrl = String(workerUrl);
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Does the compiled module require the wasi-threads host (i.e. does it import
 * `wasi.thread-spawn`)? Single-thread artifacts do not, so the host is only
 * wired up for genuinely-threaded modules.
 */
export function isWasiThreadsModule(wasmModule) {
  return WebAssembly.Module.imports(wasmModule).some(
    (entry) => entry.module === "wasi" && entry.name === "thread-spawn",
  );
}

// How long to wait for a pooled worker to confirm readiness before giving up and
// disabling browser threading entirely. Warm-pool startup is a handful of
// postMessage round-trips + one instantiation each; on a genuinely cross-origin
// isolated context that completes in well under a second. This deadline is kept
// SHORT on purpose: when arming is contended or a worker never confirms, the
// guest must commit to its proven sequential path FAST (threadSpawn -> -1) rather
// than leave the caller's compute watchdog to absorb a multi-second stall. Arming
// also short-circuits the instant ANY worker reports not-ready (see armBrowserPool),
// so the honest bound on a failed arming decision is one worker's first turn, not
// this whole window.
const BROWSER_POOL_PROBE_TIMEOUT_MS = 1500;

// Arm the browser warm pool: probe every created worker and resolve a single
// decision, as `{ ok, unreachable, error, readyWorkers, failed }`.
//   ok:true                      -> every worker confirmed {t:"ready", ok:true}
//                                   (partial mode: at least one did)
//   ok:false                     -> a worker reported not-ready or missed the
//                                   probe deadline: a committed, fast SEQUENTIAL
//                                   fallback (capability negotiation).
//   ok:false, unreachable:true   -> a worker raised a worker-level `onerror`
//                                   without ever speaking the pool protocol,
//                                   i.e. the worker ASSET did not load (404 /
//                                   wrong anchor / broken import chain). That is
//                                   a deployment defect, not a capability, and
//                                   the caller must fail LOUD.
// All-or-nothing mode resolves the instant any worker loses. Partial mode (an
// explicit poolSize, T9) waits for every worker to settle and keeps the ones
// that armed: the engine tolerates partial spawns and runs fewer threads.
// The per-worker onmessage handler installed here is PERSISTENT: after arming it
// keeps dispatching {t:"exit"} (idle return) and {t:"error"} (guest fault
// surfacing) for the life of the pool.
function armBrowserPool(
  created,
  {
    wasmModule,
    memory,
    hostcallChannel,
    processState,
    extraImports,
    timeoutMs,
    partial,
    onExit,
    onGuestError,
    onWorkerError,
  },
) {
  return new Promise((resolve) => {
    let remaining = created.length;
    let settled = false;
    const timers = [];
    const spoke = new WeakSet();
    const readyWorkers = new Set();
    const failed = new Set();
    const finish = (ok, extra = {}) => {
      if (settled) {
        return;
      }
      settled = true;
      for (const timer of timers) {
        clearTimeout(timer);
      }
      resolve({
        ok,
        unreachable: false,
        error: null,
        readyWorkers: created.filter((worker) => readyWorkers.has(worker)),
        failed: created.filter((worker) => failed.has(worker)),
        ...extra,
      });
    };
    const settleOne = (worker, ready) => {
      if (readyWorkers.has(worker) || failed.has(worker)) {
        return;
      }
      (ready ? readyWorkers : failed).add(worker);
      remaining -= 1;
      if (!partial) {
        if (!ready) {
          // One worker that cannot instantiate the module over the shared
          // memory disables the whole pool — decide NOW, do not wait out the
          // rest of the probes.
          finish(false);
        } else if (remaining === 0) {
          finish(true);
        }
      } else if (remaining === 0) {
        finish(readyWorkers.size > 0);
      }
    };
    created.forEach((worker, workerIndex) => {
      const timer = setTimeout(() => settleOne(worker, false), timeoutMs);
      timers.push(timer);
      worker.onmessage = (event) => {
        const message = event.data || {};
        // Any protocol message proves the worker script LOADED; a later onerror
        // is then a guest fault, not an unreachable asset.
        spoke.add(worker);
        if (message.t === "ready") {
          clearTimeout(timer);
          if (message.ok !== true && message.error) {
            // eslint-disable-next-line no-console
            console.error("[wasi-thread] pooled worker not ready:", message.error);
          }
          settleOne(worker, message.ok === true);
        } else if (message.t === "exit") {
          onExit(worker, message.tid);
        } else if (message.t === "error") {
          // eslint-disable-next-line no-console
          console.error(
            "[wasi-thread] pooled worker guest error:",
            message.error,
          );
          onGuestError?.(message.tid ?? null, message.error);
        }
      };
      worker.onerror = (error) => {
        clearTimeout(timer);
        // eslint-disable-next-line no-console
        console.error(
          "[wasi-thread] pooled worker error:",
          error?.message ?? error,
        );
        if (settled) {
          // A worker-level fault after arming: the pool lost a thread.
          onWorkerError?.(worker, error);
          return;
        }
        // A worker that errored without ever answering the pool protocol never
        // ran our script: the asset at the resolved anchor is unreachable.
        if (!spoke.has(worker)) {
          finish(false, { unreachable: true, error });
          return;
        }
        settleOne(worker, false);
      };
      worker.postMessage({
        t: "probe",
        wasmModule,
        memory,
        hostcallChannel: hostcallChannel ?? null,
        processState,
        extraImports: extraImports ?? [],
        workerIndex,
      });
    });
  });
}

function isSharedMemoryBacked(memory) {
  return (
    typeof SharedArrayBuffer === "function" &&
    !!memory &&
    memory.buffer instanceof SharedArrayBuffer
  );
}

function detectHardwareConcurrency() {
  if (
    typeof navigator !== "undefined" &&
    Number.isFinite(navigator.hardwareConcurrency)
  ) {
    return navigator.hardwareConcurrency;
  }
  if (
    typeof self !== "undefined" &&
    self.navigator &&
    Number.isFinite(self.navigator.hardwareConcurrency)
  ) {
    return self.navigator.hardwareConcurrency;
  }
  return 1;
}

function assertCloneableExtraImports(extraImports) {
  for (const entry of extraImports ?? []) {
    if (typeof entry === "function") {
      throw new TypeError(
        "createWasiThreadSpawn extraImports must be structured-cloneable descriptors " +
          "(e.g. { provider: \"flatsql-io\", instanceId, channels }) or { moduleUrl } " +
          "entries: a function cannot cross into a worker thread.",
      );
    }
  }
}

function createSpawnLedger({ poolSize, onSpawnDeclined }) {
  const ledger = {
    poolSize,
    armed: 0,
    failedToArm: 0,
    spawned: 0,
    declined: 0,
    declinedByReason: {},
    lastDeclineReason: null,
  };
  return {
    ledger,
    decline(reason) {
      ledger.declined += 1;
      ledger.declinedByReason[reason] = (ledger.declinedByReason[reason] ?? 0) + 1;
      ledger.lastDeclineReason = reason;
      if (typeof onSpawnDeclined === "function") {
        try {
          onSpawnDeclined({ reason, poolSize, declined: ledger.declined });
        } catch {
          // a reporting hook never changes the spawn outcome
        }
      }
      return -1;
    },
  };
}

function reportGuestError(onGuestError, instanceId, tid, error) {
  if (typeof onGuestError !== "function") return;
  try {
    onGuestError(instanceId ?? null, tid ?? null, error);
  } catch {
    // supervision hooks never throw into the pool
  }
}

/**
 * Create the `wasi.thread-spawn` host for a wasi-threads module. Returns the
 * import function plus liveness/cleanup helpers.
 *
 * @param {Object} options
 * @param {WebAssembly.Module} options.wasmModule compiled module the workers re-instantiate.
 * @param {WebAssembly.Memory} options.memory shared imported memory.
 * @param {number} [options.requestedThreads] upper bound on how many guest
 *   threads the module will ask for (browser warm-pool sizing). Defaults to the
 *   host's hardware concurrency. Ignored when `poolSize` is given.
 * @param {number} [options.poolSize] EXPLICIT pool size (T9, design §5.5): the
 *   browser pre-starts exactly this many workers, independent of
 *   `hardwareConcurrency - 1` (writers + lanes: pools are sized for isolation,
 *   not only for cores). In Node it caps the live guest threads. Arming is
 *   partial: workers that fail to start are dropped and reported, the rest
 *   serve. Spawns beyond the pool return -1 and are reported.
 * @param {Array<object>} [options.extraImports] per-worker import objects, as
 *   structured-cloneable descriptors: `{ provider: "flatsql-io", instanceId,
 *   channels, mirror?, trace? }` (SAB I/O channel), `{ provider:
 *   "flatsql-io-node", root, table, instanceId }` (Node sync fs), or
 *   `{ moduleUrl, exportName?, config? }` (a factory module; module workers
 *   and Node only). See wasiThreadWorkerRuntime.js.
 * @param {number} [options.instanceId] the owning instance, echoed to
 *   `onGuestError` so a supervisor knows which instance to poison (A36).
 * @param {(instanceId: number|null, tid: number|null, error: any) => void} [options.onGuestError]
 *   called when a guest thread traps or its worker dies (A36).
 * @param {(event: { reason: string, poolSize: number, declined: number }) => void} [options.onSpawnDeclined]
 *   called for every spawn that returns -1.
 * @param {number} [options.probeTimeoutMs] browser warm-pool probe deadline.
 * @param {object} [options.hostcallChannel] request-isolated channel owned by
 *   the controlling host. Required when pthread workers import the generic
 *   module-host ABI.
 * @param {boolean} [options.requiresHostcalls] whether worker instances import
 *   the generic module-host ABI.
 * @param {boolean} [options.enableBrowserThreads] explicit successful host
 *   capability negotiation for an owning cross-origin-isolated worker harness.
 * @param {string|URL} [options.browserWorkerBaseUrl] BROWSER ANCHOR — the
 *   directory URL under which this build serves the SDK host worker chain
 *   (`wasiThreadBrowserWorker.mjs` + `wasiThreadWorkerRuntime.js`). REQUIRED
 *   whenever this host source is BUNDLED: `import.meta.url` then resolves to the
 *   bundle, not to the package layout, and the sibling asset 404s. Defaults to
 *   the process-wide `setBrowserWasiThreadWorkerBase()` value, then to the
 *   packaged sibling.
 * @param {string|URL} [options.browserWorkerUrl] the worker file itself; wins
 *   over `browserWorkerBaseUrl`. Use only when the file is not named
 *   `wasiThreadBrowserWorker.mjs` in its served directory, or to pass the
 *   self-contained blob bundle (hostWorkerBundles.js, A39) together with
 *   `browserWorkerType: "classic"`.
 * @param {"module"|"classic"} [options.browserWorkerType="module"]
 * @returns {Promise<{ threadSpawn: Function, activeThreadCount: () => number, spawnCount: () => number, distinctOsThreadCount: () => number, spawnReport: () => object, terminateAll: () => Promise<void> }>}
 * @throws {WasiThreadWorkerUnreachableError} in the browser, when the pooled
 *   path was requested but the worker asset at the resolved anchor never loaded.
 *   Deliberately fatal: a silent drop to one thread is the defect this replaces.
 */
export async function createWasiThreadSpawn({
  wasmModule,
  memory,
  requestedThreads,
  poolSize: explicitPoolSize,
  extraImports,
  instanceId,
  onGuestError,
  onSpawnDeclined,
  probeTimeoutMs,
  hostcallChannel,
  processState,
  requiresHostcalls = false,
  enableBrowserThreads,
  browserWorkerBaseUrl,
  browserWorkerUrl,
  browserWorkerType = "module",
} = {}) {
  let nextTid = 0;
  let spawnCount = 0;
  const hasExplicitPool = Number.isFinite(explicitPoolSize);
  if (hasExplicitPool && (explicitPoolSize < 0 || Math.floor(explicitPoolSize) !== explicitPoolSize)) {
    throw new RangeError("poolSize must be a non-negative integer.");
  }
  assertCloneableExtraImports(extraImports);
  if (requiresHostcalls && !hostcallChannel) {
    const { ledger, decline } = createSpawnLedger({
      poolSize: hasExplicitPool ? explicitPoolSize : 0,
      onSpawnDeclined,
    });
    return {
      threadSpawn: () => decline("hostcall-channel-missing"),
      activeThreadCount: () => 0,
      spawnCount: () => 0,
      distinctOsThreadCount: () => 0,
      spawnReport: () => ({ ...ledger, active: 0 }),
      async terminateAll() {},
    };
  }

  if (IS_NODE) {
    // NODE: lazy per-spawn worker_threads. Node workers start on their own OS
    // thread independently of the parent's event loop, so lazy creation at
    // pthread_create time is fine here — there is no startup-vs-join deadlock.
    const workers = new Set();
    const osThreadIds = new Set();
    const { ledger, decline } = createSpawnLedger({
      poolSize: hasExplicitPool ? explicitPoolSize : null,
      onSpawnDeclined,
    });
    // The specifier is assembled at runtime on purpose. This branch is dead in
    // a browser, but a LITERAL `import("node:worker_threads")` is still
    // statically resolved by esbuild/vite/rollup under a browser target, and
    // the whole bundle fails to build. Keeping it opaque is what lets one host
    // shim serve both runtimes; the browser branch below is the SAB+Worker one.
    const nodeWorkerThreadsSpecifier = NODE_BUILTIN_PREFIX + "worker_threads";
    const workerThreads = await import(
      /* @vite-ignore */ /* webpackIgnore: true */ nodeWorkerThreadsSpecifier
    );
    const NodeWorker = workerThreads.Worker;
    const nodeWorkerUrl = new URL("./wasiThreadWorker.mjs", import.meta.url);
    // An --input-type parent runs eval/stdin, but this worker loads a file.
    // Inheriting that flag makes the worker fail while the guest is blocked
    // synchronously in pthread_join and cannot receive the error event.
    const parentArgs = globalThis.process.execArgv;
    const sourceFlags = ["--input-type", "--eval", "-e", "--print", "-p"];
    const execArgv = parentArgs.some((arg) => arg.startsWith("--input-type"))
      ? parentArgs.filter((arg, index, args) =>
        !sourceFlags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)) &&
        !(index > 0 && sourceFlags.includes(args[index - 1])))
      : undefined;

    const threadSpawn = (startArg) => {
      if (hasExplicitPool && workers.size >= explicitPoolSize) {
        // The explicit pool is fully busy: decline, so the guest runs the work
        // inline (pthread_create -> EAGAIN) and the engine runs fewer threads.
        return decline("pool-exhausted");
      }
      const tid = (nextTid += 1);
      try {
        const worker = new NodeWorker(nodeWorkerUrl, {
          execArgv,
          workerData: {
            wasmModule,
            memory,
            tid,
            startArg,
            hostcallChannel: hostcallChannel ?? null,
            processState,
            extraImports: extraImports ?? [],
            workerIndex: tid - 1,
          },
        });
        // Node exposes the OS-thread id per Worker — distinct ids are direct
        // evidence that pthread_create ran real concurrent threads.
        if (typeof worker.threadId === "number") {
          osThreadIds.add(worker.threadId);
        }
        worker.on("error", (error) => {
          // A worker crash cannot be surfaced to the guest synchronously. The
          // worker itself writes the fault to stderr first, because this
          // handler never runs while this thread is blocked in pthread_join.
          // eslint-disable-next-line no-console
          console.error("[wasi-thread] worker error:", error);
          reportGuestError(onGuestError, instanceId, tid, error);
        });
        worker.once("exit", () => workers.delete(worker));
        workers.add(worker);
        spawnCount += 1;
        ledger.spawned += 1;
        return tid;
      } catch {
        // Signal spawn failure to the guest: wasi.thread-spawn returns a
        // negative value, pthread_create returns EAGAIN, and the module's
        // sequential fallback runs the stripe inline. Never abort.
        return decline("worker-create-failed");
      }
    };

    return {
      threadSpawn,
      activeThreadCount: () => workers.size,
      spawnCount: () => spawnCount,
      distinctOsThreadCount: () => osThreadIds.size,
      spawnReport: () => ({ ...ledger, active: workers.size }),
      async terminateAll() {
        for (const worker of workers) {
          try {
            await worker.terminate?.();
          } catch {
            // best effort
          }
        }
        workers.clear();
      },
    };
  }

  // BROWSER: warm pool. A guest thread needs a Worker that shares the SAME
  // SharedArrayBuffer-backed memory; nested workers DO share it by reference.
  // The only hazard is lazy startup during the guest's synchronous, no-yield
  // pthread_create->pthread_join window, so we pre-start the pool here and only
  // ever dispatch to an already-running worker.
  const idleWorkers = [];
  const busyByTid = new Map();
  const poolWorkers = [];
  // Threading stays disabled (threadSpawn returns -1 -> guest runs inline) unless
  // the pool comes up green (all of it, or with an explicit poolSize, any of it).
  let poolDisabled = true;

  const browserThreadsEnabled =
    enableBrowserThreads ??
    (globalThis.__SDM_ENABLE_BROWSER_WASI_THREADS__ === true);
  const armed =
    browserThreadsEnabled === true &&
    globalThis.crossOriginIsolated === true &&
    isSharedMemoryBacked(memory);

  const hardwareConcurrency = detectHardwareConcurrency();
  const requested = Number.isFinite(requestedThreads)
    ? Math.floor(requestedThreads)
    : hardwareConcurrency;
  // Explicit: exactly poolSize workers. Implicit: N = min(hardwareConcurrency
  // - 1, requested) — the main compute thread is one core and the pool
  // provides the rest, clamped at >= 0 (a 1-core host gets no pool and runs the
  // proven sequential path).
  const poolSize = armed
    ? hasExplicitPool
      ? explicitPoolSize
      : Math.max(0, Math.min(Math.floor(hardwareConcurrency) - 1, requested))
    : 0;
  const { ledger, decline } = createSpawnLedger({
    poolSize: hasExplicitPool ? explicitPoolSize : poolSize,
    onSpawnDeclined,
  });
  let disabledReason = armed ? null : "threads-unavailable";

  const returnWorkerToIdle = (worker, tid) => {
    if (tid !== undefined && tid !== null) {
      busyByTid.delete(tid);
    }
    if (
      !poolDisabled &&
      poolWorkers.includes(worker) &&
      !idleWorkers.includes(worker)
    ) {
      idleWorkers.push(worker);
    }
  };

  const retireWorker = (worker, error) => {
    // A pooled worker died after arming (A36): report it against the thread it
    // was running, and never dispatch to it again.
    let tid = null;
    for (const [candidateTid, candidate] of busyByTid) {
      if (candidate === worker) {
        tid = candidateTid;
        busyByTid.delete(candidateTid);
      }
    }
    const poolIndex = poolWorkers.indexOf(worker);
    if (poolIndex >= 0) poolWorkers.splice(poolIndex, 1);
    const idleIndex = idleWorkers.indexOf(worker);
    if (idleIndex >= 0) idleWorkers.splice(idleIndex, 1);
    reportGuestError(onGuestError, instanceId, tid, error);
  };

  if (poolSize > 0) {
    const workerUrl = resolveBrowserWorkerUrl({
      browserWorkerUrl,
      browserWorkerBaseUrl,
    });
    const created = [];
    try {
      for (let i = 0; i < poolSize; i += 1) {
        created.push(
          browserWorkerType === "classic"
            ? new Worker(workerUrl)
            : new Worker(workerUrl, { type: "module" }),
        );
      }
    } catch (error) {
      // Constructing a module Worker throws synchronously for a malformed or
      // cross-origin-forbidden URL. Same class of defect as a 404: fail LOUD.
      for (const worker of created) {
        try {
          worker.terminate();
        } catch {
          // best effort
        }
      }
      throw new WasiThreadWorkerUnreachableError(workerUrl, error);
    }
    const armResult = await armBrowserPool(created, {
      wasmModule,
      memory,
      hostcallChannel,
      processState,
      extraImports,
      timeoutMs: Number.isFinite(probeTimeoutMs) && probeTimeoutMs > 0
        ? probeTimeoutMs
        : BROWSER_POOL_PROBE_TIMEOUT_MS,
      partial: hasExplicitPool,
      onExit: returnWorkerToIdle,
      onGuestError: (tid, error) => reportGuestError(onGuestError, instanceId, tid, error),
      onWorkerError: retireWorker,
    });
    if (armResult.unreachable) {
      for (const worker of created) {
        try {
          worker.terminate();
        } catch {
          // best effort
        }
      }
      throw new WasiThreadWorkerUnreachableError(workerUrl, armResult.error);
    }
    if (armResult.ok) {
      poolDisabled = false;
      const keep = hasExplicitPool ? armResult.readyWorkers : created;
      for (const worker of keep) {
        poolWorkers.push(worker);
        idleWorkers.push(worker);
      }
      for (const worker of created) {
        if (!keep.includes(worker)) {
          try {
            worker.terminate();
          } catch {
            // best effort
          }
        }
      }
      ledger.armed = keep.length;
      ledger.failedToArm = created.length - keep.length;
    } else {
      // Any failure disables browser threading entirely: threadSpawn returns -1,
      // the guest's pthread_create returns EAGAIN, and the module runs its whole
      // grid inline (correct, deterministic, non-hanging). Every created worker
      // is torn down — including ones that DID confirm ready — so no orphaned
      // nested worker lingers to contend with the sequential retry's pool.
      for (const worker of created) {
        try {
          worker.terminate();
        } catch {
          // best effort
        }
      }
      ledger.failedToArm = created.length;
      disabledReason = "pool-not-armed";
    }
  } else if (armed) {
    disabledReason = "pool-empty";
  }

  const threadSpawn = (startArg) => {
    if (poolDisabled) {
      return decline(disabledReason ?? "pool-disabled");
    }
    const worker = idleWorkers.pop();
    if (!worker) {
      // Pool exhausted (guest asked for more concurrent threads than the pool
      // holds): decline this one so the guest runs the stripe inline. Correct
      // and non-hanging; the already-dispatched threads still run in parallel.
      return decline("pool-exhausted");
    }
    const tid = (nextTid += 1);
    busyByTid.set(tid, worker);
    try {
      // Dispatch to a PRE-STARTED worker: its event loop is already live on its
      // own thread, so this postMessage is delivered even while THIS thread then
      // blocks in the guest's synchronous pthread_join (memory.atomic.wait).
      worker.postMessage({ t: "run", tid, startArg });
    } catch {
      busyByTid.delete(tid);
      idleWorkers.push(worker);
      return decline("dispatch-failed");
    }
    spawnCount += 1;
    ledger.spawned += 1;
    return tid;
  };

  return {
    threadSpawn,
    activeThreadCount: () => busyByTid.size,
    spawnCount: () => spawnCount,
    // No OS-thread ids in the browser; the count of distinct pooled Worker
    // threads is the honest analogue.
    distinctOsThreadCount: () => poolWorkers.length,
    spawnReport: () => ({ ...ledger, active: busyByTid.size, idle: idleWorkers.length }),
    async terminateAll() {
      poolDisabled = true;
      disabledReason = "terminated";
      for (const worker of poolWorkers) {
        try {
          worker.terminate();
        } catch {
          // best effort
        }
      }
      poolWorkers.length = 0;
      idleWorkers.length = 0;
      busyByTid.clear();
    },
  };
}
