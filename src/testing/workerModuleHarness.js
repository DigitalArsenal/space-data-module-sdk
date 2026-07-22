/**
 * Worker module harness — the async in-WASM host bridge (WS6.1).
 *
 * Runs a guest WASM module inside a Worker so its synchronous
 * `space_data_module_host.call` hostcalls can block (Atomics.wait on a
 * SharedArrayBuffer channel) while async host capabilities — http, ipfs,
 * storage, pubsub, timers, filesystem — resolve on this (controlling)
 * thread. The plain browser harness runs guests on the main thread, where
 * blocking is impossible, so async operations throw
 * `... is not available in the synchronous hostcall ABI`.
 *
 *   const harness = await createWorkerModuleHarness({ wasmSource, host });
 *   await harness.callExport("guest_fn");     // guest may hostcall http.request
 *   await harness.invoke({ methodId, ... });  // full invoke surface, proxied
 *   await harness.destroy();
 *
 * Requirements: SharedArrayBuffer + Worker. In browsers the page must be
 * cross-origin isolated (COOP+COEP). In Node, worker_threads is used.
 */

import { createBrowserHost } from "../host/browserHost.js";
import { createAsyncHostDispatcher } from "../host/abi.js";
import {
  createSabHostcallBuffer,
  createSabHostcallServer,
  DEFAULT_SAB_HOSTCALL_RESPONSE_BYTES,
} from "../host/sabHostcallChannel.js";
import { WASI_THREAD_HOSTCALL_MESSAGE } from "../host/wasiThreadWorkerRuntime.js";

const WORKER_URL = new URL("./workerModuleHarnessWorker.js", import.meta.url);

function randomChannelToken() {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function isNodeRuntime() {
  return (
    typeof process !== "undefined" &&
    typeof process.versions?.node === "string" &&
    typeof window === "undefined"
  );
}

async function spawnWorker(workerUrl) {
  if (isNodeRuntime()) {
    const { Worker: NodeWorker } = await import("node:worker_threads");
    const worker = new NodeWorker(workerUrl);
    return {
      post: (message) => worker.postMessage(message),
      on: (handler) => worker.on("message", handler),
      terminate: () => worker.terminate(),
      // Keep the process free to exit if the caller forgets destroy().
      unref: () => worker.unref?.(),
    };
  }
  if (typeof Worker !== "function") {
    throw new Error("Worker is unavailable; the worker module harness requires it.");
  }
  const worker = new Worker(workerUrl, { type: "module" });
  return {
    post: (message) => worker.postMessage(message),
    on: (handler) => {
      worker.onmessage = (event) => handler(event.data);
    },
    terminate: () => worker.terminate(),
    unref: () => {},
  };
}

function toBytes(source, label) {
  if (source instanceof Uint8Array) return new Uint8Array(source);
  if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
  throw new TypeError(
    `${label} must be a Uint8Array or ArrayBuffer (the worker harness ships bytes to the worker).`,
  );
}

/**
 * @param {object} options
 * @param {Uint8Array|ArrayBuffer} options.wasmSource module bytes
 * @param {object} [options.host] host servicing guest hostcalls (default createBrowserHost(hostOptions))
 * @param {object} [options.hostOptions] options for the default host
 * @param {(operation: string, params: any) => Promise<any>} [options.dispatchHost] dispatch override
 * @param {number} [options.maxHostcallResponseBytes] SAB channel capacity (default 4 MiB)
 * @param {number} [options.hostcallTimeoutMs] worker-side Atomics.wait timeout (default 120s)
 * @param {URL|string} [options.workerUrl] worker entry override (bundlers / served pages)
 * @param {object} [options.harnessOptions] structured-clonable options forwarded to the in-worker
 *   createBrowserModuleHarness (surface, args, env, allowRawInvoke, logOutput, ...)
 */
export async function createWorkerModuleHarness(options = {}) {
  const wasmBytes = toBytes(options.wasmSource, "wasmSource");
  const host = options.host ?? createBrowserHost(options.hostOptions);
  const dispatch = options.dispatchHost ?? createAsyncHostDispatcher(host);
  const buffer = createSabHostcallBuffer({
    maxResponseBytes: options.maxHostcallResponseBytes,
  });
  const server = createSabHostcallServer({ buffer, dispatch });
  if (typeof BroadcastChannel !== "function") {
    throw new Error(
      "BroadcastChannel is unavailable; nested pthread hostcalls require it.",
    );
  }
  const threadHostcallToken = randomChannelToken();
  const threadHostcallChannelName =
    `sdm.thread-hostcall.${threadHostcallToken}.${randomChannelToken()}`;
  const threadHostcallChannel = new BroadcastChannel(threadHostcallChannelName);
  const threadHostcallServers = new WeakMap();
  threadHostcallChannel.onmessage = (event) => {
    const message = event.data ?? {};
    if (
      message.type !== WASI_THREAD_HOSTCALL_MESSAGE ||
      message.token !== threadHostcallToken ||
      !(message.buffer instanceof SharedArrayBuffer)
    ) {
      return;
    }
    let nestedServer = threadHostcallServers.get(message.buffer);
    if (!nestedServer) {
      nestedServer = createSabHostcallServer({
        buffer: message.buffer,
        dispatch,
      });
      threadHostcallServers.set(message.buffer, nestedServer);
    }
    void nestedServer.handleRequest(message);
  };
  const port = await spawnWorker(options.workerUrl ?? WORKER_URL);

  let nextId = 1;
  const pending = new Map();
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  let destroyed = false;

  port.on((message) => {
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "worker-online":
        port.post({
          type: "init",
          wasmBytes,
          buffer,
          hostcallTimeoutMs: options.hostcallTimeoutMs,
          harnessOptions: {
            ...(options.harnessOptions ?? {}),
            enableBrowserWasiThreads:
              options.harnessOptions?.enableBrowserWasiThreads !== false,
            threadHostcallChannel: {
              channelName: threadHostcallChannelName,
              token: threadHostcallToken,
              maxResponseBytes: Number.isInteger(
                options.maxHostcallResponseBytes,
              )
                ? options.maxHostcallResponseBytes
                : DEFAULT_SAB_HOSTCALL_RESPONSE_BYTES,
              timeoutMs: options.hostcallTimeoutMs,
            },
          },
        });
        return;
      case "ready":
        readyResolve({ exports: message.exports, runtime: message.runtime });
        return;
      case "init-error": {
        const error = new Error(message.error?.message ?? "Worker init failed");
        error.name = message.error?.name ?? "Error";
        readyReject(error);
        return;
      }
      case "hostcall":
        // Serviced asynchronously; the worker blocks on the SAB until done.
        server.handleRequest(message);
        return;
      case "result": {
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        if (message.ok) {
          entry.resolve(message.value);
        } else {
          const error = new Error(message.error?.message ?? "Worker command failed");
          error.name = message.error?.name ?? "Error";
          error.code = message.error?.code ?? null;
          entry.reject(error);
        }
        return;
      }
      default:
    }
  });

  function send(command) {
    if (destroyed) {
      return Promise.reject(new Error("Worker harness is destroyed."));
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      port.post({ ...command, id });
    });
  }

  const { exports, runtime } = await ready;

  return {
    runtime: { kind: "worker", inner: runtime },
    host,
    buffer,
    exports,
    callExport: (name, ...args) => send({ type: "callExport", name, args }),
    invoke: (request) => send({ type: "invoke", request }),
    invokeRaw: (requestBytes) => send({ type: "invokeRaw", requestBytes }),
    readMemory: (ptr, length) => send({ type: "readMemory", ptr, length }),
    readManifest: () => send({ type: "readManifest" }),
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const entry of pending.values()) {
        entry.reject(new Error("Worker harness destroyed."));
      }
      pending.clear();
      try {
        await port.terminate();
      } catch {
        // termination is best-effort
      }
      threadHostcallChannel.close();
    },
  };
}
