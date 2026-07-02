/**
 * Worker entry for the async-hostcall module harness.
 *
 * Runs the guest WASM inside this worker via createBrowserModuleHarness with
 * a SAB-channel hostcall dispatch: guest `space_data_module_host.call`
 * invocations block this thread on Atomics.wait while the controlling thread
 * services the async host operation (http/ipfs/storage/pubsub/...).
 *
 * Runs under both browser module Workers and Node worker_threads.
 */

import { createBrowserModuleHarness } from "./browserModuleHarness.js";
import { createSabHostcallClientDispatch } from "../host/sabHostcallChannel.js";

async function resolvePort() {
  if (
    typeof self !== "undefined" &&
    typeof self.postMessage === "function" &&
    typeof window === "undefined" &&
    !(typeof process !== "undefined" && process?.versions?.node)
  ) {
    return {
      post: (message) => self.postMessage(message),
      on: (handler) => {
        self.onmessage = (event) => handler(event.data);
      },
    };
  }
  const { parentPort } = await import("node:worker_threads");
  if (!parentPort) {
    throw new Error("workerModuleHarnessWorker must run inside a Worker.");
  }
  return {
    post: (message) => parentPort.postMessage(message),
    on: (handler) => parentPort.on("message", handler),
  };
}

function serializeWorkerError(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
    code: error?.code ?? null,
  };
}

const port = await resolvePort();
let harness = null;

async function handleInit(message) {
  const dispatch = createSabHostcallClientDispatch({
    buffer: message.buffer,
    timeoutMs: message.hostcallTimeoutMs,
    postRequest: (request) => port.post({ type: "hostcall", ...request }),
  });
  const harnessOptions = {
    ...(message.harnessOptions ?? {}),
    wasmSource:
      message.wasmBytes instanceof Uint8Array
        ? message.wasmBytes
        : new Uint8Array(message.wasmBytes),
    hostcallDispatch: dispatch,
  };
  harness = await createBrowserModuleHarness(harnessOptions);
  const exportNames = Object.keys(harness.instance.exports);
  port.post({
    type: "ready",
    exports: exportNames,
    runtime: harness.runtime,
  });
}

async function handleCommand(message) {
  if (!harness) {
    throw new Error("Worker harness is not initialized.");
  }
  switch (message.type) {
    case "callExport": {
      const fn = harness.instance.exports[message.name];
      if (typeof fn !== "function") {
        throw new Error(`Guest export "${message.name}" is not a function.`);
      }
      return fn(...(message.args ?? []));
    }
    case "invoke":
      return harness.invoke(message.request);
    case "invokeRaw":
      return harness.invokeRaw(
        message.requestBytes instanceof Uint8Array
          ? message.requestBytes
          : new Uint8Array(message.requestBytes),
      );
    case "readMemory": {
      const memory = harness.memory ?? harness.instance.exports.memory;
      if (!memory) {
        throw new Error("Guest module exposes no memory.");
      }
      return new Uint8Array(memory.buffer, message.ptr, message.length).slice();
    }
    case "readManifest":
      return harness.readManifest();
    default:
      throw new Error(`Unknown worker harness command: ${message.type}`);
  }
}

port.on(async (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "init") {
    try {
      await handleInit(message);
    } catch (error) {
      port.post({ type: "init-error", error: serializeWorkerError(error) });
    }
    return;
  }
  if (message.type === "destroy") {
    try {
      harness?.destroy();
    } finally {
      port.post({ type: "destroyed" });
    }
    return;
  }
  if (typeof message.id !== "number") return;
  try {
    const value = await handleCommand(message);
    port.post({ type: "result", id: message.id, ok: true, value });
  } catch (error) {
    port.post({
      type: "result",
      id: message.id,
      ok: false,
      error: serializeWorkerError(error),
    });
  }
});

port.post({ type: "worker-online" });
