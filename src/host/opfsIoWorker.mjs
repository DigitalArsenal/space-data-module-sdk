// The FlatSQL I/O worker entry (docs/architecture/flatsql-partition-store.md
// §5.5, A7, A36, A38, A39).
//
// One dedicated worker that holds every file handle for the guest threads that
// talk to it over a SAB request ring (sabIoChannel.js). It never blocks: sync
// reads and writes run directly on OPFS sync access handles, into the guests'
// shared memory; opens, unlinks and probes are awaited on the event loop while
// the requesting guest thread waits on its own slot.
//
// Roles (A7): a WRITER I/O worker per writer holds that writer's active files
// and splits writes into chunks of 256 KiB or less; READER I/O workers (1, or 2
// sharded by path hash when hardwareConcurrency >= 8) hold sealed and immutable
// files. The role only sets defaults; the protocol is the same.
//
// Backends: "opfs" (the local store) or "memory" (the dashboard window store:
// nothing reaches OPFS, and `reset` drops it on a UI-state change).
//
// Runs as a browser Worker (module, or classic from the self-contained blob
// bundle, A39) and as a Node worker_threads worker (tests, memory backend).
//
// Controller messages (see flatsqlIoWorkers.js):
//   {t:"init", buffer, backend, role, chunkBytes, doorbell, mirror, rootDirectory,
//    handleMode, memoryMaxBytes, openDelay, lock, busyRetry}
//                                                    -> {t:"ready", ok, info|error}
//   {t:"attach", instanceId, memory}                 -> {t:"attached", instanceId, ok}
//   {t:"detach", instanceId}
//   {t:"preopen", id, paths, flags}                  -> {t:"preopened", id, statuses}
//   {t:"release-preopen", paths}
//   {t:"stats", id}                                  -> {t:"stats", id, stats, inventory}
//   {t:"reset", id}                                  -> {t:"reset", id}
//   {t:"clear", id}                                  -> {t:"cleared", id}
//   {t:"stop", id}                                   -> {t:"stopped", id}

import { createFlatsqlIoServer, DEFAULT_FLATSQL_IO_CHUNK_BYTES } from "./flatsqlIoServer.js";
import { createFlatsqlIoMemoryBackend } from "./flatsqlIoMemoryBackend.js";
import { createOpfsIoBackend } from "./opfsIoBackend.js";
import { createSabIoMirrorMatcher } from "./sabIoMirror.js";
import { NODE_BUILTIN_PREFIX } from "./nodeBuiltinSpecifier.js";

const IS_NODE =
  typeof process !== "undefined" && !!process.release && process.release.name === "node";

let server = null;
let backend = null;
let releaseLock = null;

// A37: the store's Web Lock is taken inside the writer I/O worker, so it lives
// exactly as long as the handles; `stop` closes the handles first, then
// releases it. Resolves true when held, false when `ifAvailable` found it taken.
function acquireLock({ name, ifAvailable = false }) {
  if (typeof navigator === "undefined" || !navigator.locks) {
    return Promise.reject(new Error("Web Locks are unavailable in this context"));
  }
  return new Promise((resolve, reject) => {
    navigator.locks
      .request(name, { mode: "exclusive", ifAvailable }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        return new Promise((release) => {
          releaseLock = release;
        });
      })
      .catch(reject);
  });
}

function describeError(error) {
  return `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`;
}

function buildOpenDelay(openDelay) {
  if (!openDelay || !openDelay.pattern || !(openDelay.ms > 0)) return undefined;
  const pattern = new RegExp(openDelay.pattern);
  return (path) => (pattern.test(path) ? openDelay.ms : 0);
}

async function handleInit(message, post) {
  const role = message.role === "reader" ? "reader" : "writer";
  if (message.lock?.name) {
    const held = await acquireLock(message.lock);
    if (!held) {
      const error = new Error(`the store lock ${message.lock.name} is held by another context`);
      error.name = "LockUnavailableError";
      throw error;
    }
  }
  if (message.backend === "memory") {
    backend = createFlatsqlIoMemoryBackend({ maxBytes: message.memoryMaxBytes });
  } else {
    backend = createOpfsIoBackend({
      rootDirectory: message.rootDirectory,
      handleMode: message.handleMode ?? "auto",
      openDelayMs: buildOpenDelay(message.openDelay),
      busyRetry: message.busyRetry ?? undefined,
    });
  }
  const info = { backend: backend.kind, role, lock: message.lock?.name ?? null };
  if (backend.init) {
    Object.assign(info, await backend.init());
  }
  const mirror = message.mirror?.buffer
    ? {
        buffer: message.mirror.buffer,
        match: createSabIoMirrorMatcher(message.mirror.suffixes ?? ["/h.fsh"]),
        write: message.mirror.write ?? role === "writer",
      }
    : null;
  server = createFlatsqlIoServer({
    buffer: message.buffer,
    backend,
    chunkBytes: message.chunkBytes ?? DEFAULT_FLATSQL_IO_CHUNK_BYTES,
    doorbell: message.doorbell ?? "auto",
    mirror,
    onEvent(event) {
      if (event.type === "loop-error" || event.type === "step-error") {
        post({ t: "event", event: { type: event.type, error: describeError(event.error) } });
      }
    },
  });
  info.doorbellMode = server.doorbellMode === 1 ? "message" : "atomics";
  // The loop runs until stop; a crash of the loop itself is a worker error the
  // supervisor sees (A36).
  server.start().catch((error) => {
    setTimeout(() => {
      throw error;
    }, 0);
  });
  return info;
}

async function dispatch(message, post) {
  switch (message?.t) {
    case "init":
      try {
        const info = await handleInit(message, post);
        post({ t: "ready", ok: true, info });
      } catch (error) {
        releaseLock?.();
        releaseLock = null;
        post({
          t: "ready",
          ok: false,
          error: describeError(error),
          lockUnavailable: error?.name === "LockUnavailableError",
        });
      }
      return;
    case "attach":
      post({
        t: "attached",
        instanceId: message.instanceId,
        ok: !!server?.attachMemory(message.instanceId, message.memory),
      });
      return;
    case "detach":
      server?.detachMemory(message.instanceId);
      return;
    case "preopen": {
      const statuses = server ? await server.preopen(message.paths ?? [], message.flags) : [];
      post({ t: "preopened", id: message.id, statuses });
      return;
    }
    case "release-preopen":
      server?.releasePreopen(message.paths ?? []);
      return;
    case "stats":
      post({
        t: "stats",
        id: message.id,
        stats: server ? { ...server.stats } : null,
        inventory: server ? server.inventory() : null,
        usage: backend?.usage ? backend.usage() : null,
      });
      return;
    case "reset":
      backend?.reset?.();
      post({ t: "reset", id: message.id });
      return;
    case "clear":
      try {
        await backend?.clear?.();
        post({ t: "cleared", id: message.id, ok: true });
      } catch (error) {
        post({ t: "cleared", id: message.id, ok: false, error: describeError(error) });
      }
      return;
    case "stop":
      await server?.stop();
      server = null;
      // Handles are closed; only now may another context take the store.
      releaseLock?.();
      releaseLock = null;
      post({ t: "stopped", id: message.id });
      return;
    default:
  }
}

function startBrowser() {
  const post = (value) => self.postMessage(value);
  self.onmessage = (event) => {
    dispatch(event.data, post);
  };
}

async function startNode() {
  const specifier = NODE_BUILTIN_PREFIX + "worker_threads";
  const { parentPort } = await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier);
  if (!parentPort) return;
  const post = (value) => parentPort.postMessage(value);
  parentPort.on("message", (message) => {
    dispatch(message, post);
  });
}

if (IS_NODE) {
  startNode();
} else if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof window === "undefined") {
  startBrowser();
}
