import { createHostcallBridge, DEFAULT_HOSTCALL_IMPORT_MODULE } from "./abi.js";
import { mergeImportFragments, resolveExtraImports } from "./flatsqlIoImports.js";
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

/**
 * The per-worker half of the wasi-threads host: the import object one guest
 * thread instantiates the shared module with.
 *
 * Every pool thread gets WASI, the shared `env.memory`, a `wasi.thread-spawn`
 * stub, the hostcall bridge when the module imports it, and the `extraImports`
 * entries (T9): per-worker import objects such as FlatSQL's `env.flatsql_io_*`.
 * Each entry is a factory `(ctx) => importObject` (or `{ imports, close }`), or
 * a built-in descriptor such as `{ provider: "flatsql-io", instanceId, channels }`
 * (flatsqlIoImports.js). Factories run once per worker, so each worker owns its
 * own resources (for flatsql-io: its own request-ring slot). `ctx` is
 * `{ memory, getMemory, tid, workerIndex }`.
 *
 * `threadSpawn` is this thread's `wasi.thread-spawn`: the pool's spawn
 * (wasiThreadPool.js), so a guest thread can start threads of its own. Without
 * one, a spawn from this thread returns -1.
 */
export function createWasiThreadWorkerRuntime({
  wasmModule,
  memory,
  hostcallChannel,
  processState,
  extraImports,
  workerIndex,
  tid,
  threadSpawn,
} = {}) {
  const wasi = createBrowserWasiShim({ processState });
  wasi.setMemory(memory);
  let instance = null;
  let hostcalls = null;
  const imports = {
    ...wasi.imports,
    env: { memory },
    wasi: { "thread-spawn": typeof threadSpawn === "function" ? threadSpawn : () => -1 },
  };

  if (requiresHostcallBridge(wasmModule)) {
    hostcalls = createThreadHostcallDispatch(hostcallChannel);
    const bridge = createHostcallBridge({
      dispatch: hostcalls.dispatch,
      getMemory: () => instance?.exports?.memory ?? memory,
    });
    Object.assign(imports, bridge.imports);
  }

  const extras = resolveExtraImports(extraImports, {
    memory,
    getMemory: () => instance?.exports?.memory ?? memory,
    workerIndex: workerIndex ?? null,
    tid: tid ?? null,
  });
  mergeImportFragments(imports, extras.fragments);
  // The shared memory is the one contract every import object must agree on.
  imports.env.memory = memory;

  return {
    imports,
    instantiate() {
      instance = new WebAssembly.Instance(wasmModule, imports);
      wasi.setMemory(instance.exports.memory ?? memory);
      return instance;
    },
    close() {
      hostcalls?.close();
      extras.close();
    },
  };
}

/**
 * Resolve `{ moduleUrl, exportName?, config? }` entries by importing their
 * factory module (module workers and Node; a classic blob worker cannot). The
 * resolved entries are factories that receive `{ ...ctx, config }`. Other
 * entries pass through unchanged.
 */
export async function resolveModuleExtraImports(extraImports) {
  const out = [];
  for (const entry of extraImports ?? []) {
    if (entry && typeof entry.moduleUrl === "string") {
      const mod = await import(/* @vite-ignore */ /* webpackIgnore: true */ entry.moduleUrl);
      const factory = mod[entry.exportName ?? "default"];
      if (typeof factory !== "function") {
        throw new TypeError(
          `extraImports module ${entry.moduleUrl} exports no factory "${entry.exportName ?? "default"}".`,
        );
      }
      out.push({ factory, config: entry.config ?? null });
    } else {
      out.push(entry);
    }
  }
  return out;
}

export const WASI_THREAD_HOSTCALL_MESSAGE = THREAD_HOSTCALL_MESSAGE;
