/**
 * What a non-zero command exit means. A command-surface guest writes its PIV
 * response to stdout whether or not the request succeeded and exits non-zero
 * when validation or dispatch failed (compiler/invokeGlue.js `main`), so a
 * well-formed response on a non-zero exit is the guest's own explanation.
 * The browser and WasmEdge harnesses and every parity lane read it here.
 */
import { decodePluginInvokeResponse } from "./codec.js";
import { toUint8Array } from "../runtime/bufferLike.js";

export class PluginInvokeError extends Error {
  constructor({ exitCode, response }) {
    const detail = [response.errorCode, response.errorMessage].filter(Boolean).join(": ");
    super(`${detail || "module returned an error response"} (status ${response.statusCode})`);
    this.name = "PluginInvokeError";
    this.exitCode = exitCode;
    this.statusCode = response.statusCode;
    this.errorCode = response.errorCode ?? null;
    this.errorMessage = response.errorMessage ?? null;
    this.response = response;
  }

  toJSON() {
    const { name, message, exitCode, statusCode, errorCode, errorMessage } = this;
    return { name, message, exitCode, statusCode, errorCode, errorMessage };
  }
}

export function invokeErrorFromCommandRun(exitCode, stdout) {
  if (!Number.isInteger(exitCode) || exitCode === 0) return null;
  try {
    const bytes = toUint8Array(stdout);
    if (!bytes || bytes.byteLength < 8) return null;
    return new PluginInvokeError({ exitCode, response: decodePluginInvokeResponse(bytes) });
  } catch {
    return null;
  }
}
