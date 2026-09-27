// Controller for one FlatSQL I/O worker (opfsIoWorker.mjs): spawn, init,
// attach instance memories, pre-open, revoke, and supervise
// (docs/architecture/flatsql-partition-store.md §5.5, A7, A36, A38, A39).
//
// The engine worker owns these controllers: one writer I/O worker per writer,
// and 1-2 reader I/O workers (A7). Supervision (A36): when the I/O worker
// errors or exits, the controller completes every pending request with an
// error status (no guest thread stays blocked, and nothing throws in a guest),
// reports `onError`, and, with `restart: true`, starts a replacement over the
// same channel and re-attaches the live instance memories. Handles do not
// survive: the engine reopens from heads.
//
// Worker source: `workerUrl` when given (a module worker, or with
// `workerType: "classic"` the self-contained bundle from hostWorkerBundles.js
// spawned from a blob: URL; A39: the dashboard's single-file CSP allows only
// blob: workers), otherwise the packaged sibling `opfsIoWorker.mjs` (unbundled
// layouts and Node).

import {
  SAB_IO_INSTANCE_REVOKED,
  createSabIoChannelBuffer,
  describeSabIoChannel,
  failPendingSabIoRequests,
  resetSabIoInstance,
  revokeSabIoInstance,
} from "./sabIoChannel.js";
import { FLATSQL_IO_ERR_IO } from "./flatsqlIoContract.js";
import { NODE_BUILTIN_PREFIX } from "./nodeBuiltinSpecifier.js";

const IS_NODE =
  typeof process !== "undefined" && !!process.release && process.release.name === "node";

export const FLATSQL_IO_WORKER_FILENAME = "opfsIoWorker.mjs";

/** Thrown when the I/O worker cannot start (asset missing, OPFS refused, ...). */
export class FlatsqlIoWorkerStartError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "FlatsqlIoWorkerStartError";
    if (cause !== undefined) this.cause = cause;
  }
}

async function spawnWorker({ workerUrl, workerType }) {
  if (IS_NODE) {
    const specifier = NODE_BUILTIN_PREFIX + "worker_threads";
    const { Worker } = await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier);
    const url = workerUrl ?? new URL(`./${FLATSQL_IO_WORKER_FILENAME}`, import.meta.url);
    const worker = new Worker(url);
    return {
      raw: worker,
      post: (message, transfer) => worker.postMessage(message, transfer),
      onMessage: (fn) => worker.on("message", fn),
      onError: (fn) => {
        worker.on("error", fn);
        worker.on("exit", (code) => fn(new Error(`I/O worker exited with code ${code}`), true));
      },
      terminate: () => worker.terminate(),
    };
  }
  let worker;
  if (workerUrl) {
    worker =
      workerType === "classic"
        ? new Worker(workerUrl)
        : new Worker(workerUrl, { type: "module" });
  } else {
    let packaged;
    try {
      packaged = new URL(`./${FLATSQL_IO_WORKER_FILENAME}`, import.meta.url);
    } catch (error) {
      throw new FlatsqlIoWorkerStartError(
        "No packaged I/O worker anchor (this source was bundled without import.meta.url): " +
          'pass workerUrl, e.g. hostWorkerBundleUrl("flatsql-io") with workerType "classic".',
        error,
      );
    }
    worker = new Worker(packaged, { type: "module" });
  }
  return {
    raw: worker,
    post: (message, transfer) => worker.postMessage(message, transfer ?? []),
    onMessage: (fn) => {
      worker.onmessage = (event) => fn(event.data);
    },
    onError: (fn) => {
      worker.onerror = (event) => {
        event?.preventDefault?.();
        fn(new Error(event?.message ?? "I/O worker error"), false);
      };
      worker.onmessageerror = () => fn(new Error("I/O worker message error"), false);
    },
    terminate: () => worker.terminate(),
  };
}

/**
 * Start an I/O worker over a channel.
 *
 * @param {object} [options]
 * @param {SharedArrayBuffer} [options.buffer] the channel; created when absent.
 * @param {object} [options.channel] createSabIoChannelBuffer options when creating.
 * @param {"opfs"|"memory"} [options.backend="opfs"]
 * @param {"writer"|"reader"} [options.role="writer"]
 * @param {number} [options.chunkBytes] write/read step (default 256 KiB).
 * @param {"auto"|"atomics"|"message"} [options.doorbell="auto"]
 * @param {{ buffer: SharedArrayBuffer, suffixes?: string[], write?: boolean }} [options.mirror]
 * @param {string} [options.rootDirectory] OPFS directory every path is confined to.
 * @param {"auto"|"shared"|"exclusive"} [options.handleMode="auto"]
 * @param {number} [options.memoryMaxBytes] memory backend budget.
 * @param {{ pattern: string, ms: number }} [options.openDelay] test hook.
 * @param {{ name: string, ifAvailable?: boolean }} [options.lock] take this Web
 *   Lock inside the I/O worker before any handle opens (A37: the store lock
 *   `sdn-flatsql-store/<format>/<artifact-sha256>` lives exactly as long as the
 *   handles). With `ifAvailable`, start fails with `lockUnavailable: true` when
 *   another context holds it; otherwise start waits for it. `stop()` closes the
 *   handles, then releases the lock.
 * @param {{ attempts: number, baseMs?: number }} [options.busyRetry] OPFS: retry
 *   a sync-handle creation refused by a previous holder, with backoff (A37).
 * @param {string|URL} [options.workerUrl]
 * @param {"module"|"classic"} [options.workerType="module"]
 * @param {(error: Error, info: { restarted: boolean, failedRequests: number }) => void} [options.onError]
 * @param {boolean} [options.restart=false] recreate a dead worker.
 */
export async function createFlatsqlIoWorker(options = {}) {
  const buffer = options.buffer ?? createSabIoChannelBuffer(options.channel ?? {});
  const layout = describeSabIoChannel(buffer);
  const attached = new Map();
  const pending = new Map();
  let nextRequestId = 1;
  let worker = null;
  let info = null;
  let dead = false;
  let stopping = false;
  let restarts = 0;

  const initMessage = {
    t: "init",
    buffer,
    backend: options.backend ?? "opfs",
    role: options.role ?? "writer",
    chunkBytes: options.chunkBytes,
    doorbell: options.doorbell ?? "auto",
    mirror: options.mirror ?? null,
    rootDirectory: options.rootDirectory,
    handleMode: options.handleMode,
    memoryMaxBytes: options.memoryMaxBytes,
    openDelay: options.openDelay ?? null,
    lock: options.lock ?? null,
    busyRetry: options.busyRetry ?? null,
  };

  function request(message) {
    const id = nextRequestId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      worker.post({ ...message, id });
    });
  }

  async function start() {
    const spawned = await spawnWorker(options);
    worker = spawned;
    dead = false;
    let resolveReady;
    const ready = new Promise((resolve) => {
      resolveReady = resolve;
    });
    spawned.onMessage((message) => {
      if (!message || worker !== spawned) return;
      if (message.t === "ready") {
        resolveReady(message);
        return;
      }
      if (message.t === "attached") {
        const resolve = pending.get(`attach:${message.instanceId}`);
        pending.delete(`attach:${message.instanceId}`);
        resolve?.(message.ok);
        return;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        const resolve = pending.get(message.id);
        pending.delete(message.id);
        resolve(message);
      }
    });
    spawned.onError((error, exited) => {
      if (stopping || worker !== spawned) return;
      if (!info) {
        resolveReady({ ok: false, error: String(error?.message ?? error) });
        return;
      }
      handleDeath(error, exited);
    });
    spawned.post(initMessage);
    const result = await ready;
    if (!result.ok) {
      try {
        spawned.terminate();
      } catch {
        // ignore
      }
      const error = new FlatsqlIoWorkerStartError(`I/O worker failed to start: ${result.error}`);
      error.lockUnavailable = result.lockUnavailable === true;
      throw error;
    }
    info = result.info;
    for (const [instanceId, memory] of attached) {
      await attachInternal(instanceId, memory);
    }
    return info;
  }

  function attachInternal(instanceId, memory) {
    return new Promise((resolve) => {
      pending.set(`attach:${instanceId}`, resolve);
      worker.post({ t: "attach", instanceId, memory });
    });
  }

  function handleDeath(error) {
    if (dead) return;
    dead = true;
    try {
      worker.terminate();
    } catch {
      // already gone
    }
    const failedRequests = failPendingSabIoRequests(buffer, FLATSQL_IO_ERR_IO);
    for (const resolve of pending.values()) resolve({ ok: false, dead: true });
    pending.clear();
    const restart = options.restart === true;
    try {
      options.onError?.(error, { restarted: restart, failedRequests });
    } catch {
      // the hook never breaks supervision
    }
    if (restart) {
      restarts += 1;
      info = null;
      start().catch((startError) => {
        try {
          options.onError?.(startError, { restarted: false, failedRequests: 0 });
        } catch {
          // ignore
        }
      });
    }
  }

  await start();

  return {
    buffer,
    get info() {
      return info;
    },
    get dead() {
      return dead;
    },
    get restarts() {
      return restarts;
    },
    get worker() {
      return worker?.raw ?? null;
    },
    /** Attach an instance's shared memory for direct transfers. */
    async attachMemory(instanceId, memory) {
      if (Atomics.load(layout.instances, instanceId) === SAB_IO_INSTANCE_REVOKED) {
        resetSabIoInstance(buffer, instanceId);
      }
      attached.set(instanceId, memory);
      return attachInternal(instanceId, memory);
    },
    detachMemory(instanceId) {
      attached.delete(instanceId);
      worker.post({ t: "detach", instanceId });
    },
    /**
     * Revoke an instance (A36 step 2): resolves once the I/O worker has closed
     * its handles; later requests from it complete with ACCESS.
     */
    async revoke(instanceId) {
      attached.delete(instanceId);
      await revokeSabIoInstance(buffer, instanceId);
    },
    /** Pre-open paths (A38, §5.5). Resolves to one status per path. */
    async preopen(paths, flags) {
      const reply = await request({ t: "preopen", paths, flags });
      return reply.statuses ?? paths.map(() => FLATSQL_IO_ERR_IO);
    },
    releasePreopen(paths) {
      worker.post({ t: "release-preopen", paths });
    },
    async stats() {
      return request({ t: "stats" });
    },
    /** Drop the memory backend's contents (window store UI-state change). */
    async reset() {
      await request({ t: "reset" });
    },
    /** Remove every file below the OPFS root (tests, store wipe). */
    async clear() {
      return request({ t: "clear" });
    },
    /** Stop the loop and the worker. */
    async stop() {
      stopping = true;
      if (!dead) {
        await request({ t: "stop" });
      }
      try {
        await worker.terminate();
      } catch {
        // ignore
      }
    },
    /** Kill the worker without a clean stop (fault injection, A36 tests). */
    kill() {
      handleDeath(new Error("I/O worker killed"), true);
    },
  };
}
