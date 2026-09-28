// Isomorphic wasi-threads spawn host.
//
// A wasm32-wasip1-threads (isomorphic-pthreads) artifact imports
// `wasi.thread-spawn` and exports `wasi_thread_start`. When the guest calls
// pthread_create it invokes `wasi.thread-spawn(startArg)`; the host must run a
// NEW OS thread that instantiates the SAME module over the SAME shared memory
// and calls `wasi_thread_start(tid, startArg)`. This module provides that host
// in BOTH environments, over one pool protocol (wasiThreadPool.js):
//   - Node: a pool of `node:worker_threads` Workers
//     (src/host/wasiThreadWorker.mjs), grown when a spawn finds every worker
//     busy, by whichever thread spawns.
//   - Browser: a WARM POOL of Workers (src/host/wasiThreadBrowserWorker.mjs),
//     started and confirmed ready during host creation.
// A pool worker blocks on its slot of a SharedArrayBuffer between threads; any
// guest thread assigns it a thread through that buffer and it frees the slot
// when the thread returns. No step needs an event loop, so one invoke can
// start any number of threads, at most the pool's size at a time, and a guest
// thread can start threads of its own (since 0.8.25).
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
//     free), confirm each is ready, and only hand work to an already-running
//     worker at spawn time. (Proven.) Since 0.8.25 that hand-off is a store and
//     a notify on the worker's pool slot, not a message.
//
// See docs/isomorphic-pthreads.md and docs/browser-wasmedge-isomorphic.md.

import { NODE_BUILTIN_PREFIX } from "./nodeBuiltinSpecifier.js";
import {
  DEFAULT_WASI_THREAD_SPAWN_WAIT_MS,
  WASI_THREAD_POOL_PROTOCOL,
  WASI_THREAD_POOL_SLOT,
  armWasiThreadPoolSlot,
  createWasiThreadPool,
  createWasiThreadPoolSpawn,
  openWasiThreadPoolSlots,
  readWasiThreadPoolReport,
  releaseWasiThreadPoolSlotIfRunning,
  resolveSpawnWaitMs,
  retireWasiThreadPoolSlot,
  wasiThreadPoolLastTid,
  wasiThreadPoolRunningTid,
  wasiThreadPoolSlotState,
} from "./wasiThreadPool.js";

export { DEFAULT_WASI_THREAD_SPAWN_WAIT_MS };

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
// `wasiThreadBrowserWorker.mjs` imports `./wasiThreadWorkerRuntime.js` and
// `./wasiThreadPool.js`, and those import their own siblings. Staging only the
// single `.mjs` next to a bundle does NOT work.
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
 *   `wasiThreadBrowserWorker.mjs` AND the modules it imports
 *   (`wasiThreadWorkerRuntime.js`, `wasiThreadPool.js`, ...). A trailing slash
 *   is added when missing.
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
        `The anchor must name a directory that serves ${BROWSER_WORKER_FILENAME} ` +
        `and the modules it imports (wasiThreadWorkerRuntime.js, wasiThreadPool.js). ` +
        `When this host source is bundled, pass ` +
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
// keeps dispatching {t:"exit"} (the idle return of a worker script from before
// 0.8.25, which the pool dispatches to by message) and {t:"error"} (guest fault
// surfacing) for the life of the pool. `protocols` records the pool protocol
// each ready worker speaks (wasiThreadPool.js; 1 = message dispatch only).
function armBrowserPool(
  created,
  {
    wasmModule,
    memory,
    hostcallChannel,
    processState,
    extraImports,
    pool,
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
    const protocols = new Map();
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
        protocols,
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
          protocols.set(worker, Number.isInteger(message.protocol) ? message.protocol : 1);
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
        pool: pool ?? null,
        slot: workerIndex,
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


// How many workers a Node pool with no explicit poolSize may grow to. Workers
// are reused, so this bounds guest threads alive at once, not threads started.
const NODE_POOL_CAPACITY = 1024;

// Reasons the pool itself counts (any thread); the ledger counts the rest.
const POOL_DECLINE_REASON = "pool-exhausted";

function createSpawnLedger({ poolSize, onSpawnDeclined, getPool = () => null }) {
  const ledger = {
    poolSize,
    armed: 0,
    failedToArm: 0,
    declinedByReason: {},
    lastDeclineReason: null,
  };
  const report = () => {
    const pool = getPool();
    const counts = pool ? readWasiThreadPoolReport(pool) : null;
    const declinedByReason = { ...ledger.declinedByReason };
    if (counts?.declined) declinedByReason[POOL_DECLINE_REASON] = counts.declined;
    return {
      ...ledger,
      spawned: counts?.spawned ?? 0,
      waited: counts?.waited ?? 0,
      declined: Object.values(declinedByReason).reduce((sum, count) => sum + count, 0),
      declinedByReason,
      counts,
    };
  };
  return {
    ledger,
    report,
    decline(reason) {
      // A pool counts its own exhaustion, including spawns from guest threads
      // this ledger never sees.
      if (reason !== POOL_DECLINE_REASON || !getPool()) {
        ledger.declinedByReason[reason] = (ledger.declinedByReason[reason] ?? 0) + 1;
      }
      ledger.lastDeclineReason = reason;
      if (typeof onSpawnDeclined === "function") {
        try {
          onSpawnDeclined({ reason, poolSize, declined: report().declined });
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
 * Guest threads run on pooled workers (wasiThreadPool.js). A worker that
 * finishes a thread takes the next one at once, through shared memory, so one
 * invoke can start any number of threads, at most the pool's size at a time;
 * every guest thread's own `wasi.thread-spawn` is the pool's, so a guest
 * thread can start threads too.
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
 *   not only for cores). In Node it caps the pool (live guest threads); workers
 *   start when a spawn needs one. Arming is partial: workers that fail to start
 *   are dropped and reported, the rest serve. Spawns beyond the pool return -1
 *   and are reported. Without it, Node grows its pool to at most 1024 workers.
 * @param {Array<object>} [options.extraImports] per-worker import objects, as
 *   structured-cloneable descriptors: `{ provider: "flatsql-io", instanceId,
 *   channels, mirror?, trace? }` (SAB I/O channel), `{ provider:
 *   "flatsql-io-node", root, table, instanceId }` (Node sync fs), or
 *   `{ moduleUrl, exportName?, config? }` (a factory module; module workers
 *   and Node only). See wasiThreadWorkerRuntime.js.
 * @param {number} [options.instanceId] the owning instance, echoed to
 *   `onGuestError` so a supervisor knows which instance to poison (A36).
 * @param {(instanceId: number|null, tid: number|null, error: any) => void} [options.onGuestError]
 *   called when a guest thread traps or its worker dies (A36). Node reports
 *   workers this thread started; a worker a guest thread started reports on
 *   stderr only.
 * @param {(event: { reason: string, poolSize: number, declined: number }) => void} [options.onSpawnDeclined]
 *   called for every spawn from this thread that returns -1 (spawns from guest
 *   threads are counted in spawnReport()).
 * @param {number} [options.spawnWaitMs=250] how long a spawn that finds every
 *   pool thread busy waits for one to finish before it is declined. The wait
 *   covers a thread that the guest has joined but whose worker has not yet
 *   returned; after one wait runs out, that thread's spawns are declined at
 *   once until a thread finishes. 0 never waits. A Node pool with room to grow
 *   waits at most 2 ms before it starts another worker.
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
 *   (`wasiThreadBrowserWorker.mjs`, `wasiThreadWorkerRuntime.js`,
 *   `wasiThreadPool.js` and their imports). REQUIRED whenever this host source is BUNDLED: `import.meta.url`
 *   then resolves to the bundle, not to the package layout, and the sibling
 *   asset 404s. Defaults to the process-wide `setBrowserWasiThreadWorkerBase()`
 *   value, then to the packaged sibling.
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
  spawnWaitMs: requestedSpawnWaitMs,
} = {}) {
  const hasExplicitPool = Number.isFinite(explicitPoolSize);
  if (hasExplicitPool && (explicitPoolSize < 0 || Math.floor(explicitPoolSize) !== explicitPoolSize)) {
    throw new RangeError("poolSize must be a non-negative integer.");
  }
  const spawnWaitMs = resolveSpawnWaitMs(requestedSpawnWaitMs);
  assertCloneableExtraImports(extraImports);
  if (requiresHostcalls && !hostcallChannel) {
    const { report, decline } = createSpawnLedger({
      poolSize: hasExplicitPool ? explicitPoolSize : 0,
      onSpawnDeclined,
    });
    return {
      threadSpawn: () => decline("hostcall-channel-missing"),
      activeThreadCount: () => 0,
      spawnCount: () => 0,
      distinctOsThreadCount: () => 0,
      spawnReport: () => {
        const { counts: _none, ...rest } = report();
        return { ...rest, active: 0 };
      },
      async terminateAll() {},
    };
  }

  if (IS_NODE) {
    // NODE: a pool that grows on demand. A Node worker starts on its own OS
    // thread without its parent's event loop, so a spawn may start one while
    // every event loop of the process is blocked in the guest.
    const pool = createWasiThreadPool({
      capacity: hasExplicitPool ? explicitPoolSize : NODE_POOL_CAPACITY,
      spawnWaitMs,
    });
    const { report, decline } = createSpawnLedger({
      poolSize: hasExplicitPool ? explicitPoolSize : null,
      onSpawnDeclined,
      getPool: () => pool,
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

    // Workers this thread started, by slot. Idle pool workers must not keep
    // the process alive: they are unref'd, ref'd while this thread's spawn
    // runs on them, and unref'd again once idle.
    const workers = new Map();
    let settleTimer = null;
    const settleRefs = () => {
      let busy = 0;
      for (const [slot, worker] of workers) {
        if (wasiThreadPoolRunningTid(pool, slot) !== null) {
          busy += 1;
          worker.ref();
        } else {
          worker.unref();
        }
      }
      if (busy === 0 && settleTimer) {
        clearInterval(settleTimer);
        settleTimer = null;
      }
    };

    const startWorker = (slot) => {
      const worker = new NodeWorker(nodeWorkerUrl, {
        execArgv,
        workerData: {
          wasmModule,
          memory,
          hostcallChannel: hostcallChannel ?? null,
          processState,
          extraImports: extraImports ?? [],
          pool,
          slot,
          execArgv,
        },
      });
      worker.unref();
      worker.on("error", (error) => {
        // A worker crash cannot be surfaced to the guest synchronously. The
        // worker itself writes the fault to stderr first, because this
        // handler never runs while this thread is blocked in pthread_join.
        // eslint-disable-next-line no-console
        console.error("[wasi-thread] worker error:", error);
        reportGuestError(onGuestError, instanceId, wasiThreadPoolLastTid(pool, slot) || null, error);
      });
      worker.once("exit", () => {
        workers.delete(slot);
        if (wasiThreadPoolSlotState(pool, slot) !== WASI_THREAD_POOL_SLOT.RETIRED) {
          retireWasiThreadPoolSlot(pool, slot);
        }
      });
      workers.set(slot, worker);
    };

    const spawn = createWasiThreadPoolSpawn(pool, { owner: true, grow: startWorker });
    const threadSpawn = (startArg) => {
      const result = spawn(startArg);
      if (result.tid < 0) {
        // No worker came free: pthread_create returns EAGAIN, and the guest
        // runs the work inline or fails the way it handles EAGAIN.
        return decline(result.reason ?? POOL_DECLINE_REASON);
      }
      const worker = workers.get(result.slot);
      if (worker) {
        worker.ref();
        settleTimer ??= setInterval(settleRefs, 20);
        settleTimer.unref?.();
      }
      return result.tid;
    };

    const counts = () => readWasiThreadPoolReport(pool);
    return {
      threadSpawn,
      activeThreadCount: () => counts().active,
      spawnCount: () => counts().spawned,
      // Each pool worker is its own OS thread; distinct workers are direct
      // evidence that pthread_create ran real concurrent threads.
      distinctOsThreadCount: () => counts().workers,
      spawnReport: () => {
        const { counts: pooled, ...rest } = report();
        return { ...rest, active: pooled.active, idle: pooled.idle, workers: pooled.workers };
      },
      async terminateAll() {
        if (settleTimer) clearInterval(settleTimer);
        settleTimer = null;
        const slots = counts().slots;
        for (let slot = 0; slot < slots; slot += 1) retireWasiThreadPoolSlot(pool, slot);
        await Promise.all(
          [...workers.values()].map(async (worker) => {
            try {
              await worker.terminate?.();
            } catch {
              // best effort
            }
          }),
        );
        workers.clear();
      },
    };
  }

  // BROWSER: warm pool. A guest thread needs a Worker that shares the SAME
  // SharedArrayBuffer-backed memory; nested workers DO share it by reference.
  // The only hazard is lazy startup during the guest's synchronous, no-yield
  // pthread_create->pthread_join window, so we pre-start the pool here and only
  // ever hand work to an already-running worker. Each created worker owns the
  // pool slot at its creation index.
  const poolWorkers = [];
  const slotWorkers = [];
  let pool = null;
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
  const { ledger, report, decline } = createSpawnLedger({
    poolSize: hasExplicitPool ? explicitPoolSize : poolSize,
    onSpawnDeclined,
    getPool: () => pool,
  });
  let disabledReason = armed ? null : "threads-unavailable";

  // {t:"exit"} from a worker script before 0.8.25 (message dispatch). No-op
  // once the slot runs another thread.
  const returnWorkerToIdle = (worker, tid) => {
    const slot = slotWorkers.indexOf(worker);
    if (pool && slot >= 0 && tid !== undefined && tid !== null) {
      releaseWasiThreadPoolSlotIfRunning(pool, slot, tid);
    }
  };

  const retireWorker = (worker, error) => {
    // A pooled worker died after arming (A36): report it against the thread it
    // was running, and never dispatch to it again.
    const slot = slotWorkers.indexOf(worker);
    let tid = null;
    if (pool && slot >= 0) {
      tid = wasiThreadPoolRunningTid(pool, slot);
      retireWasiThreadPoolSlot(pool, slot);
    }
    const poolIndex = poolWorkers.indexOf(worker);
    if (poolIndex >= 0) poolWorkers.splice(poolIndex, 1);
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
    pool = createWasiThreadPool({ capacity: created.length, spawnWaitMs });
    openWasiThreadPoolSlots(pool, created.length);
    slotWorkers.push(...created);
    const armResult = await armBrowserPool(created, {
      wasmModule,
      memory,
      hostcallChannel,
      processState,
      extraImports,
      pool,
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
      created.forEach((worker, slot) => {
        if (keep.includes(worker)) {
          poolWorkers.push(worker);
          armWasiThreadPoolSlot(pool, slot, {
            messageDispatch: armResult.protocols.get(worker) !== WASI_THREAD_POOL_PROTOCOL,
          });
        } else {
          retireWasiThreadPoolSlot(pool, slot);
          try {
            worker.terminate();
          } catch {
            // best effort
          }
        }
      });
      ledger.armed = keep.length;
      ledger.failedToArm = created.length - keep.length;
    } else {
      // Any failure disables browser threading entirely: threadSpawn returns -1,
      // the guest's pthread_create returns EAGAIN, and the module runs its whole
      // grid inline (correct, deterministic, non-hanging). Every created worker
      // is torn down — including ones that DID confirm ready — so no orphaned
      // nested worker lingers to contend with the sequential retry's pool.
      for (let slot = 0; slot < created.length; slot += 1) {
        retireWasiThreadPoolSlot(pool, slot);
      }
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

  const spawn = pool
    ? createWasiThreadPoolSpawn(pool, {
      owner: true,
      // A worker script from before 0.8.25 only runs a thread it is sent.
      dispatchMessage: (slot, tid, startArg) => {
        slotWorkers[slot].postMessage({ t: "run", tid, startArg });
      },
    })
    : null;

  const threadSpawn = (startArg) => {
    if (poolDisabled) {
      return decline(disabledReason ?? "pool-disabled");
    }
    // Workers take their threads from shared memory and free their slots
    // there, so this sees every thread that finished during this invoke even
    // though this thread has not yielded its event loop since the invoke began.
    const result = spawn(startArg);
    if (result.tid < 0) {
      // Every worker stayed busy (the guest asked for more CONCURRENT threads
      // than the pool holds): decline this one so the guest runs the stripe
      // inline. Correct and non-hanging; the dispatched threads still run.
      return decline(result.reason ?? POOL_DECLINE_REASON);
    }
    return result.tid;
  };

  const counts = () => (pool ? readWasiThreadPoolReport(pool) : null);
  const inService = (worker) =>
    wasiThreadPoolSlotState(pool, slotWorkers.indexOf(worker)) !== WASI_THREAD_POOL_SLOT.RETIRED;
  return {
    threadSpawn,
    activeThreadCount: () => counts()?.active ?? 0,
    spawnCount: () => counts()?.spawned ?? 0,
    // No OS-thread ids in the browser; the count of distinct pooled Worker
    // threads still in service is the honest analogue.
    distinctOsThreadCount: () => poolWorkers.filter(inService).length,
    spawnReport: () => {
      const { counts: pooled, ...rest } = report();
      return {
        ...rest,
        active: pooled?.active ?? 0,
        idle: pooled && !poolDisabled ? pooled.idle : 0,
      };
    },
    async terminateAll() {
      poolDisabled = true;
      disabledReason = "terminated";
      if (pool) {
        for (let slot = 0; slot < slotWorkers.length; slot += 1) retireWasiThreadPoolSlot(pool, slot);
      }
      for (const worker of poolWorkers) {
        try {
          worker.terminate();
        } catch {
          // best effort
        }
      }
      poolWorkers.length = 0;
    },
  };
}
