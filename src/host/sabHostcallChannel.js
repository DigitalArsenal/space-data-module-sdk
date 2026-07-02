/**
 * SharedArrayBuffer hostcall channel — the async in-WASM host bridge.
 *
 * Guest WASM modules issue synchronous `space_data_module_host.call`
 * invocations, but browser host capabilities (http/ipfs/storage/pubsub/...)
 * are async. This channel lets a guest running inside a Worker block while
 * the async host operation resolves on the controlling thread:
 *
 *   worker (guest thread)                     controlling thread (host)
 *   ─────────────────────                     ─────────────────────────
 *   dispatch(op, params):
 *     state ← PENDING
 *     postRequest({operation, params}) ────▶  onmessage:
 *     Atomics.wait(state == PENDING)            value = await dispatch(op, params)
 *                                               write value envelope into SAB
 *                                               state ← DONE; Atomics.notify
 *     read + decode value envelope  ◀────────┘
 *     return value (or throw on error status)
 *
 * The worker-side dispatch is synchronous, so it plugs directly into
 * `createHostcallBridge({ dispatch })` (src/host/abi.js) — the existing
 * envelope/error machinery is reused unchanged. `Atomics.wait` is illegal on
 * the main thread, so the guest MUST run in a Worker (see
 * src/testing/workerModuleHarness.js).
 *
 * Payloads cross the channel as hostcall value envelopes (hostcallWire.js),
 * so binary leaves (Uint8Array) survive without base64/JSON round-trips.
 */

import {
  decodeHostcallValueEnvelope,
  encodeHostcallValueEnvelope,
} from "./hostcallWire.js";

// Int32 header slots at the front of the SharedArrayBuffer.
const SLOT_STATE = 0;
const SLOT_STATUS = 1;
const SLOT_LENGTH = 2;
const HEADER_INT32S = 4; // one reserved slot keeps the data region 16-byte aligned

const STATE_IDLE = 0;
const STATE_PENDING = 1;
const STATE_DONE = 2;

export const SAB_HOSTCALL_STATUS_OK = 0;
export const SAB_HOSTCALL_STATUS_ERROR = 1;
export const SAB_HOSTCALL_DATA_OFFSET = HEADER_INT32S * 4;
export const DEFAULT_SAB_HOSTCALL_RESPONSE_BYTES = 4 * 1024 * 1024;

function assertSharedArrayBuffer(buffer) {
  if (
    typeof SharedArrayBuffer !== "function" ||
    !(buffer instanceof SharedArrayBuffer)
  ) {
    throw new TypeError(
      "SAB hostcall channel requires a SharedArrayBuffer (cross-origin isolation in browsers).",
    );
  }
}

function serializeChannelError(error, operation) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    code: error?.code ?? null,
    operation: error?.operation ?? operation ?? null,
    capability: error?.capability ?? null,
  };
}

/**
 * Allocate the shared buffer backing one hostcall channel.
 */
export function createSabHostcallBuffer(options = {}) {
  if (typeof SharedArrayBuffer !== "function") {
    throw new Error(
      "SharedArrayBuffer is unavailable; the async hostcall bridge requires it " +
        "(browsers additionally require cross-origin isolation: COOP+COEP).",
    );
  }
  const maxResponseBytes = Number.isInteger(options.maxResponseBytes)
    ? options.maxResponseBytes
    : DEFAULT_SAB_HOSTCALL_RESPONSE_BYTES;
  if (maxResponseBytes <= 0) {
    throw new RangeError("maxResponseBytes must be a positive integer.");
  }
  return new SharedArrayBuffer(SAB_HOSTCALL_DATA_OFFSET + maxResponseBytes);
}

/**
 * Worker-side half: a synchronous dispatch(operation, params) that blocks on
 * Atomics.wait until the controlling thread services the request.
 *
 * options.postRequest({ operation, params }) must deliver the request to the
 * controlling thread (postMessage). params/results are structured values with
 * Uint8Array leaves.
 */
export function createSabHostcallClientDispatch(options = {}) {
  assertSharedArrayBuffer(options.buffer);
  const postRequest = options.postRequest;
  if (typeof postRequest !== "function") {
    throw new TypeError(
      "createSabHostcallClientDispatch requires a postRequest function.",
    );
  }
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : 120_000;
  const header = new Int32Array(options.buffer, 0, HEADER_INT32S);
  const capacity = options.buffer.byteLength - SAB_HOSTCALL_DATA_OFFSET;

  return function sabHostcallDispatch(operation, params = null) {
    Atomics.store(header, SLOT_STATE, STATE_PENDING);
    postRequest({ operation, params });
    const outcome = Atomics.wait(header, SLOT_STATE, STATE_PENDING, timeoutMs);
    if (outcome === "timed-out") {
      Atomics.store(header, SLOT_STATE, STATE_IDLE);
      throw new Error(
        `Hostcall "${operation}" timed out after ${timeoutMs}ms waiting for the controlling thread.`,
      );
    }
    const status = Atomics.load(header, SLOT_STATUS);
    const length = Atomics.load(header, SLOT_LENGTH);
    if (length < 0 || length > capacity) {
      Atomics.store(header, SLOT_STATE, STATE_IDLE);
      throw new RangeError(
        `Hostcall "${operation}" response length ${length} exceeds channel capacity ${capacity}.`,
      );
    }
    // Copy out of the SAB before decoding — decode keeps subarray views.
    const bytes = new Uint8Array(length);
    bytes.set(new Uint8Array(options.buffer, SAB_HOSTCALL_DATA_OFFSET, length));
    Atomics.store(header, SLOT_STATE, STATE_IDLE);
    const value = decodeHostcallValueEnvelope(bytes);
    if (status !== SAB_HOSTCALL_STATUS_OK) {
      const error = new Error(
        value?.message ?? `Hostcall "${operation}" failed on the host thread.`,
      );
      error.name = value?.name ?? "Error";
      error.code = value?.code ?? null;
      error.operation = value?.operation ?? operation;
      error.capability = value?.capability ?? null;
      throw error;
    }
    return value;
  };
}

/**
 * Controlling-thread half: services one request at a time against an async
 * dispatch (e.g. createAsyncHostDispatcher(host)) and wakes the worker.
 */
export function createSabHostcallServer(options = {}) {
  assertSharedArrayBuffer(options.buffer);
  const dispatch = options.dispatch;
  if (typeof dispatch !== "function") {
    throw new TypeError("createSabHostcallServer requires a dispatch function.");
  }
  const header = new Int32Array(options.buffer, 0, HEADER_INT32S);
  const capacity = options.buffer.byteLength - SAB_HOSTCALL_DATA_OFFSET;
  const data = new Uint8Array(options.buffer, SAB_HOSTCALL_DATA_OFFSET, capacity);

  function complete(status, bytes) {
    data.set(bytes, 0);
    Atomics.store(header, SLOT_STATUS, status);
    Atomics.store(header, SLOT_LENGTH, bytes.length);
    Atomics.store(header, SLOT_STATE, STATE_DONE);
    Atomics.notify(header, SLOT_STATE);
  }

  async function handleRequest(request = {}) {
    const operation = request.operation;
    let status = SAB_HOSTCALL_STATUS_OK;
    let value;
    try {
      value = await dispatch(operation, request.params ?? null);
      if (value === undefined) value = null;
    } catch (error) {
      status = SAB_HOSTCALL_STATUS_ERROR;
      value = serializeChannelError(error, operation);
    }
    let bytes;
    try {
      bytes = encodeHostcallValueEnvelope(value);
    } catch (error) {
      status = SAB_HOSTCALL_STATUS_ERROR;
      bytes = encodeHostcallValueEnvelope(serializeChannelError(error, operation));
    }
    if (bytes.length > capacity) {
      status = SAB_HOSTCALL_STATUS_ERROR;
      bytes = encodeHostcallValueEnvelope(
        serializeChannelError(
          new RangeError(
            `Hostcall response (${bytes.length} bytes) exceeds the channel capacity (${capacity} bytes); ` +
              "raise maxHostcallResponseBytes on the worker harness.",
          ),
          operation,
        ),
      );
    }
    complete(status, bytes);
  }

  return { handleRequest };
}
