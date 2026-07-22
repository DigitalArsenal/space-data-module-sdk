import { createHostcallBridge, DEFAULT_HOSTCALL_IMPORT_MODULE } from "./abi.js";
import {
  createSabHostcallBuffer,
  createSabHostcallClientDispatch,
} from "./sabHostcallChannel.js";
import { createBrowserWasiShim } from "./wasiShim.js";

const THREAD_HOSTCALL_MESSAGE = "sdm.thread-hostcall";

function requiresHostcallBridge(wasmModule) {
  return WebAssembly.Module.imports(wasmModule).some(
    (entry) => entry.module === DEFAULT_HOSTCALL_IMPORT_MODULE,
  );
}

function createThreadHostcallDispatch(options) {
  if (!options || typeof options !== "object") {
    throw new Error(
      "A threaded guest that imports space_data_module_host requires an owning hostcall channel.",
    );
  }
  const channelName = String(options.channelName ?? "").trim();
  const token = String(options.token ?? "").trim();
  if (!channelName || !token) {
    throw new Error("The owning thread-hostcall channel name and token are required.");
  }
  if (typeof BroadcastChannel !== "function") {
    throw new Error("BroadcastChannel is required for nested pthread hostcalls.");
  }

  const buffer = createSabHostcallBuffer({
    maxResponseBytes: options.maxResponseBytes,
  });
  const channel = new BroadcastChannel(channelName);
  let nextRequestId = 1;
  const dispatch = createSabHostcallClientDispatch({
    buffer,
    timeoutMs: options.timeoutMs,
    postRequest(request) {
      channel.postMessage({
        type: THREAD_HOSTCALL_MESSAGE,
        token,
        requestId: nextRequestId++,
        buffer,
        ...request,
      });
    },
  });
  return {
    dispatch,
    close() {
      channel.close();
    },
  };
}

export function createWasiThreadWorkerRuntime({
  wasmModule,
  memory,
  hostcallChannel,
} = {}) {
  const wasi = createBrowserWasiShim({});
  wasi.setMemory(memory);
  let instance = null;
  let hostcalls = null;
  const imports = {
    ...wasi.imports,
    env: { memory },
    wasi: { "thread-spawn": () => -1 },
  };

  if (requiresHostcallBridge(wasmModule)) {
    hostcalls = createThreadHostcallDispatch(hostcallChannel);
    const bridge = createHostcallBridge({
      dispatch: hostcalls.dispatch,
      getMemory: () => instance?.exports?.memory ?? memory,
    });
    Object.assign(imports, bridge.imports);
  }

  return {
    instantiate() {
      instance = new WebAssembly.Instance(wasmModule, imports);
      wasi.setMemory(instance.exports.memory ?? memory);
      return instance;
    },
    close() {
      hostcalls?.close();
    },
  };
}

export const WASI_THREAD_HOSTCALL_MESSAGE = THREAD_HOSTCALL_MESSAGE;
