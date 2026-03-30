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

export async function createPluginInvokeProcessClient(options = {}) {
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

    async invoke(request = {}) {
      const requestBytes = encodePluginInvokeRequest(request);
      const responseBytes = await invokeRaw(requestBytes);
      return decodePluginInvokeResponse(responseBytes);
    },

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
