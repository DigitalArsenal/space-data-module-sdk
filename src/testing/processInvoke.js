import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { once } from "node:events";
import path from "node:path";
import process from "node:process";

import {
  decodePluginInvokeResponse,
  encodePluginInvokeRequest,
} from "../invoke/index.js";
import { toUint8Array } from "../runtime/bufferLike.js";

const WASMEDGE_HOST_MAGIC = Uint8Array.from([0x4f, 0x52, 0x50, 0x57]); // ORPW
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const HOST_CONTROL_OPCODE = Object.freeze({
  INSTALL_MODULE: 16,
  LIST_MODULES: 17,
  UNLOAD_MODULE: 18,
  INVOKE_MODULE: 19,
  APPEND_ROW: 20,
  LIST_ROWS: 21,
  RESOLVE_ROW: 22,
  ALLOCATE_REGION: 23,
  DESCRIBE_REGION: 24,
  RESOLVE_RECORD: 25,
});

function formatProcessFailure(message, stderrChunks = [], cause = null) {
  const stderrText = Buffer.concat(stderrChunks).toString("utf8").trim();
  const details = stderrText ? `${message}\n${stderrText}` : message;
  return cause ? new Error(details, { cause }) : new Error(details);
}

function createLengthPrefixedRequest(bytes) {
  const payload = Buffer.from(bytes);
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32LE(payload.length, 0);
  return Buffer.concat([prefix, payload]);
}

function normalizeLaunchPlan(options = {}) {
  if (options.launchPlan) {
    return {
      ...options.launchPlan,
      args: Array.isArray(options.launchPlan.args) ? options.launchPlan.args : [],
    };
  }
  return {
    command: options.command ?? null,
    args: Array.isArray(options.args) ? options.args : [],
    env: options.env ?? process.env,
    cwd: options.cwd ?? process.cwd(),
  };
}

export function buildWasmEdgeSpawnEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  delete env.DYLD_LIBRARY_PATH;
  delete env.DYLD_FALLBACK_LIBRARY_PATH;
  delete env.DYLD_FRAMEWORK_PATH;
  delete env.DYLD_FALLBACK_FRAMEWORK_PATH;
  delete env.LIBRARY_PATH;
  return env;
}

export function resolveWasmEdgePluginLaunchPlan(options = {}) {
  const hostProfile = String(options.hostProfile ?? "").trim().toLowerCase();
  if (hostProfile === "runtime-host") {
    if (
      typeof options.wasmEdgeRunnerBinary !== "string" ||
      options.wasmEdgeRunnerBinary.trim().length === 0
    ) {
      throw new Error(
        "resolveWasmEdgePluginLaunchPlan requires wasmEdgeRunnerBinary for runtime-host mode.",
      );
    }
    return {
      command: options.wasmEdgeRunnerBinary,
      args: ["--serve-runtime-host"],
      env: buildWasmEdgeSpawnEnv(options.env),
      wasmPath: null,
      hostProfile: "runtime-host",
    };
  }

  const wasmPath =
    typeof options.wasmPath === "string" && options.wasmPath.trim().length > 0
      ? path.resolve(options.wasmPath)
      : null;
  if (!wasmPath) {
    throw new Error("resolveWasmEdgePluginLaunchPlan requires a wasmPath.");
  }

  const invokeArgs =
    Array.isArray(options.invokeArgs) && options.invokeArgs.length > 0
      ? [...options.invokeArgs]
      : ["--serve-plugin-invoke"];

  if (options.wasmEdgeRunnerBinary) {
    return {
      command: options.wasmEdgeRunnerBinary,
      args: [wasmPath, ...invokeArgs],
      env: buildWasmEdgeSpawnEnv(options.env),
      wasmPath,
    };
  }

  return {
    command: options.wasmEdgeBinary ?? "wasmedge",
    args: [
      ...(options.enableThreads === false ? [] : ["--enable-threads"]),
      wasmPath,
      ...invokeArgs,
    ],
    env: buildWasmEdgeSpawnEnv(options.env),
    wasmPath,
  };
}

async function createLengthPrefixedProcessClient(options = {}) {
  const launchPlan = normalizeLaunchPlan(options);
  if (
    typeof launchPlan.command !== "string" ||
    launchPlan.command.trim().length === 0
  ) {
    throw new Error("createPluginInvokeProcessClient requires a command.");
  }

  const child = spawn(launchPlan.command, launchPlan.args, {
    cwd: launchPlan.cwd ?? process.cwd(),
    env: launchPlan.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdoutBuffer = Buffer.alloc(0);
  const stderrChunks = [];
  const pending = [];
  let closed = false;
  let closeError = null;
  let expectedShutdown = false;

  function rejectPending(error) {
    while (pending.length > 0) {
      pending.shift().reject(error);
    }
  }

  function drainResponses() {
    while (pending.length > 0 && stdoutBuffer.length >= 4) {
      const responseLength = stdoutBuffer.readUInt32LE(0);
      if (stdoutBuffer.length < 4 + responseLength) {
        return;
      }
      const responseBytes = stdoutBuffer.subarray(4, 4 + responseLength);
      stdoutBuffer = stdoutBuffer.subarray(4 + responseLength);
      pending.shift().resolve(new Uint8Array(responseBytes));
    }
  }

  child.stdout.on("data", (chunk) => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, Buffer.from(chunk)]);
    drainResponses();
  });
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(Buffer.from(chunk));
  });
  child.on("error", (error) => {
    closeError = formatProcessFailure(
      "Failed to launch plugin invoke process.",
      stderrChunks,
      error,
    );
    rejectPending(closeError);
  });

  const closePromise = once(child, "close").then(([code, signal]) => {
    closed = true;
    if (!expectedShutdown && (code !== 0 || signal !== null)) {
      closeError = formatProcessFailure(
        `Plugin invoke process exited unexpectedly with ${
          signal ? `signal ${signal}` : `code ${code}`
        }.`,
        stderrChunks,
      );
      rejectPending(closeError);
      throw closeError;
    }
    if (!expectedShutdown && code !== 0) {
      closeError = formatProcessFailure(
        `Plugin invoke process exited with code ${code}.`,
        stderrChunks,
      );
      rejectPending(closeError);
      throw closeError;
    }
  });

  async function invokeRaw(requestBytes) {
    if (closeError) {
      throw closeError;
    }
    if (closed) {
      throw formatProcessFailure(
        "Plugin invoke process is already closed.",
        stderrChunks,
      );
    }

    const normalizedRequest = toUint8Array(requestBytes);
    if (!normalizedRequest) {
      throw new TypeError(
        "Expected Uint8Array, ArrayBufferView, or ArrayBuffer request bytes.",
      );
    }

    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
      child.stdin.write(createLengthPrefixedRequest(normalizedRequest), (error) => {
        if (!error) {
          return;
        }
        const pendingIndex = pending.findIndex((entry) => entry.resolve === resolve);
        if (pendingIndex >= 0) {
          pending.splice(pendingIndex, 1);
        }
        reject(
          formatProcessFailure(
            "Failed to send PluginInvokeRequest to child process.",
            stderrChunks,
            error,
          ),
        );
      });
    });
  }

  return {
    launchPlan,
    invokeRaw,
    async destroy() {
      expectedShutdown = true;
      if (!closed) {
        child.kill();
      }
      try {
        await closePromise;
      } catch {
        // Best-effort shutdown: callers only need pending requests cleared.
      }
    },
  };
}

function encodeHostControl(opcode, payload = new Uint8Array()) {
  const message = new Uint8Array(5 + payload.length);
  message.set(WASMEDGE_HOST_MAGIC, 0);
  message[4] = opcode;
  message.set(payload, 5);
  return message;
}

function encodeJsonPayload(value) {
  return textEncoder.encode(JSON.stringify(value));
}

function decodeJsonPayload(bytes) {
  if (!bytes || bytes.length === 0) {
    return null;
  }
  return JSON.parse(textDecoder.decode(bytes));
}

function encodeU32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function decodeU32(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    0,
    true,
  );
}

function encodeModuleInvokePayload(moduleId, requestBytes) {
  if (typeof moduleId !== "string" || moduleId.trim().length === 0) {
    throw new TypeError("moduleId must be a non-empty string");
  }
  const moduleIdBytes = textEncoder.encode(moduleId.trim());
  const requestPayload = toUint8Array(requestBytes);
  if (!requestPayload) {
    throw new TypeError("module invoke request bytes are required");
  }
  const payload = new Uint8Array(4 + moduleIdBytes.length + requestPayload.length);
  payload.set(encodeU32(moduleIdBytes.length), 0);
  payload.set(moduleIdBytes, 4);
  payload.set(requestPayload, 4 + moduleIdBytes.length);
  return payload;
}

function serializeRegionOptions(options = {}) {
  return {
    ...options,
    initialRecords: Array.isArray(options.initialRecords)
      ? options.initialRecords.map((record) =>
          record === null || record === undefined
            ? null
            : Array.from(
                toUint8Array(record) ??
                  (() => {
                    throw new TypeError(
                      "runtime region initialRecords must be byte-oriented",
                    );
                  })(),
              ),
        )
      : [],
  };
}

function normalizeRecordResponse(record) {
  if (!record) {
    return null;
  }
  return {
    ...record,
    bytes: Uint8Array.from(record.bytes ?? []),
  };
}

async function invokeJsonHostControl(rawClient, opcode, payload) {
  const responseBytes = await rawClient.invokeRaw(
    encodeHostControl(opcode, encodeJsonPayload(payload)),
  );
  return decodeJsonPayload(responseBytes);
}

function attachRuntimeHostControls(client, rawClient, options = {}) {
  const encodeRequest = options.encodeRequest ?? ((request) => request);
  const decodeResponse = options.decodeResponse ?? ((response) => response);

  return Object.assign(client, {
    installModule(definition = {}) {
      return invokeJsonHostControl(
        rawClient,
        HOST_CONTROL_OPCODE.INSTALL_MODULE,
        definition,
      );
    },
    listModules() {
      return invokeJsonHostControl(rawClient, HOST_CONTROL_OPCODE.LIST_MODULES, {});
    },
    unloadModule(moduleId) {
      return invokeJsonHostControl(rawClient, HOST_CONTROL_OPCODE.UNLOAD_MODULE, {
        moduleId,
      });
    },
    async invokeModule(moduleId, request = {}) {
      const responseBytes = await rawClient.invokeRaw(
        encodeHostControl(
          HOST_CONTROL_OPCODE.INVOKE_MODULE,
          encodeModuleInvokePayload(moduleId, encodeRequest(request)),
        ),
      );
      return decodeResponse(responseBytes);
    },
    appendRow(options = {}) {
      return invokeJsonHostControl(rawClient, HOST_CONTROL_OPCODE.APPEND_ROW, options);
    },
    listRows(schemaFileId = null) {
      return invokeJsonHostControl(rawClient, HOST_CONTROL_OPCODE.LIST_ROWS, {
        schemaFileId,
      });
    },
    resolveRow(handle) {
      return invokeJsonHostControl(rawClient, HOST_CONTROL_OPCODE.RESOLVE_ROW, handle);
    },
    allocateRegion(options = {}) {
      return invokeJsonHostControl(
        rawClient,
        HOST_CONTROL_OPCODE.ALLOCATE_REGION,
        serializeRegionOptions(options),
      );
    },
    describeRegion(regionId) {
      return invokeJsonHostControl(rawClient, HOST_CONTROL_OPCODE.DESCRIBE_REGION, {
        regionId,
      });
    },
    async resolveRecord(query = {}) {
      const record = await invokeJsonHostControl(
        rawClient,
        HOST_CONTROL_OPCODE.RESOLVE_RECORD,
        query,
      );
      return normalizeRecordResponse(record);
    },
  });
}

export async function createWasmEdgeStreamProcessClient(options = {}) {
  const rawClient = await createLengthPrefixedProcessClient(options);

  const client = {
    launchPlan: rawClient.launchPlan,

    invokeRaw(requestBytes) {
      return rawClient.invokeRaw(requestBytes);
    },

    async invoke(request = {}) {
      const requestBytes = encodePluginInvokeRequest(request);
      const responseBytes = await rawClient.invokeRaw(requestBytes);
      return decodePluginInvokeResponse(responseBytes);
    },

    destroy() {
      return rawClient.destroy();
    },
  };

  return attachRuntimeHostControls(client, rawClient, {
    encodeRequest(request) {
      return encodePluginInvokeRequest(request);
    },
    decodeResponse(responseBytes) {
      return decodePluginInvokeResponse(responseBytes);
    },
  });
}

export async function createPluginInvokeProcessClient(options = {}) {
  const rawClient = await createLengthPrefixedProcessClient(options);

  const client = {
    launchPlan: rawClient.launchPlan,

    async invoke(request = {}) {
      const requestBytes = encodePluginInvokeRequest(request);
      const responseBytes = await rawClient.invokeRaw(requestBytes);
      return decodePluginInvokeResponse(responseBytes);
    },

    invokeRaw: rawClient.invokeRaw,

    destroy() {
      return rawClient.destroy();
    },
  };

  return attachRuntimeHostControls(client, rawClient, {
    encodeRequest(request) {
      return encodePluginInvokeRequest(request);
    },
    decodeResponse(responseBytes) {
      return decodePluginInvokeResponse(responseBytes);
    },
  });
}
