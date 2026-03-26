import { bytesToBase64 } from "../utils/encoding.js";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export const DEFAULT_HOSTCALL_IMPORT_MODULE = "sdn_host";
export const HOSTCALL_STATUS_OK = 0;
export const HOSTCALL_STATUS_ERROR = 1;

export const NodeHostSyncHostcallOperations = Object.freeze([
  "host.runtimeTarget",
  "host.listCapabilities",
  "host.listSupportedCapabilities",
  "host.listOperations",
  "host.hasCapability",
  "clock.now",
  "clock.monotonicNow",
  "clock.nowIso",
  "random.bytes",
  "schedule.parse",
  "schedule.matches",
  "schedule.next",
  "filesystem.resolvePath",
]);

function assertNonEmptyString(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }
  return normalized;
}

function getMemoryBuffer(getMemory) {
  if (typeof getMemory !== "function") {
    throw new TypeError("getMemory must be a function returning WebAssembly.Memory.");
  }
  const memory = getMemory();
  if (!memory || typeof memory !== "object" || !("buffer" in memory)) {
    throw new TypeError("getMemory must return a WebAssembly.Memory-like object.");
  }
  const buffer = memory.buffer;
  if (!(buffer instanceof ArrayBuffer || buffer instanceof SharedArrayBuffer)) {
    throw new TypeError("Hostcall memory buffer must be an ArrayBuffer or SharedArrayBuffer.");
  }
  return buffer;
}

function readMemoryBytes(getMemory, ptr, len, label) {
  if (!Number.isInteger(ptr) || ptr < 0) {
    throw new RangeError(`${label} pointer must be a non-negative integer.`);
  }
  if (!Number.isInteger(len) || len < 0) {
    throw new RangeError(`${label} length must be a non-negative integer.`);
  }

  const buffer = getMemoryBuffer(getMemory);
  if (ptr + len > buffer.byteLength) {
    throw new RangeError(`${label} range exceeds guest memory bounds.`);
  }
  return new Uint8Array(buffer, ptr, len);
}

function writeMemoryBytes(getMemory, ptr, bytes, maxLen) {
  if (!Number.isInteger(ptr) || ptr < 0) {
    throw new RangeError("Response pointer must be a non-negative integer.");
  }
  if (!Number.isInteger(maxLen) || maxLen < 0) {
    throw new RangeError("Response max length must be a non-negative integer.");
  }

  const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const buffer = getMemoryBuffer(getMemory);
  const bytesToCopy = Math.min(payload.length, maxLen);
  if (ptr + bytesToCopy > buffer.byteLength) {
    throw new RangeError("Response range exceeds guest memory bounds.");
  }
  new Uint8Array(buffer, ptr, bytesToCopy).set(payload.subarray(0, bytesToCopy));
  return bytesToCopy;
}

function parseJsonPayload(bytes) {
  if (bytes.length === 0) {
    return null;
  }
  const text = textDecoder.decode(bytes);
  if (!text.trim()) {
    return null;
  }
  return JSON.parse(text);
}

function serializeHostcallError(error, operation = null) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    code: error?.code ?? null,
    operation: error?.operation ?? operation,
    capability: error?.capability ?? null,
  };
}

function isPromiseLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.then === "function"
  );
}

function encodeHostcallValue(value) {
  if (value === undefined) {
    return undefined;
  }
  if (
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  ) {
    const bytes =
      value instanceof Uint8Array
        ? value
        : new Uint8Array(
            value.buffer ?? value,
            value.byteOffset ?? 0,
            value.byteLength ?? value.byteLength,
          );
    return {
      __type: "bytes",
      base64: bytesToBase64(bytes),
    };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => encodeHostcallValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, encodeHostcallValue(entry)]),
    );
  }
  return value;
}

export function dispatchNodeHostSyncOperation(host, operation, params = null) {
  const normalized = assertNonEmptyString(operation, "Hostcall operation");
  switch (normalized) {
    case "host.runtimeTarget":
      return host.runtimeTarget;
    case "host.listCapabilities":
      return host.listCapabilities();
    case "host.listSupportedCapabilities":
      return host.listSupportedCapabilities();
    case "host.listOperations":
      return host.listOperations();
    case "host.hasCapability":
      return host.hasCapability(params?.capability);
    case "clock.now":
      return host.clock.now();
    case "clock.monotonicNow":
      return host.clock.monotonicNow();
    case "clock.nowIso":
      return host.clock.nowIso();
    case "random.bytes":
      return host.random.bytes(params?.length);
    case "schedule.parse":
      return host.schedule.parse(params?.expression);
    case "schedule.matches":
      return host.schedule.matches(params?.expression, params?.date);
    case "schedule.next":
      return host.schedule.next(params?.expression, params?.from);
    case "filesystem.resolvePath":
      return host.filesystem.resolvePath(params?.path);
    default:
      throw new Error(
        `Operation "${normalized}" is not available in the synchronous hostcall ABI.`,
      );
  }
}

export function createNodeHostSyncDispatcher(host) {
  if (!host || typeof host !== "object") {
    throw new TypeError("createNodeHostSyncDispatcher requires a host object.");
  }
  return (operation, params = null) =>
    dispatchNodeHostSyncOperation(host, operation, params);
}

export function createJsonHostcallBridge(options = {}) {
  const dispatch = options.dispatch;
  if (typeof dispatch !== "function") {
    throw new TypeError("createJsonHostcallBridge requires a dispatch function.");
  }

  const getMemory = options.getMemory;
  const moduleName = assertNonEmptyString(
    options.moduleName ?? DEFAULT_HOSTCALL_IMPORT_MODULE,
    "Hostcall import module name",
  );
  const maxRequestBytes = Number.isInteger(options.maxRequestBytes)
    ? options.maxRequestBytes
    : 64 * 1024;
  const maxResponseBytes = Number.isInteger(options.maxResponseBytes)
    ? options.maxResponseBytes
    : 1024 * 1024;

  let lastStatusCode = HOSTCALL_STATUS_OK;
  let lastEnvelope = { ok: true, result: null };
  let lastResponseBytes = textEncoder.encode(JSON.stringify(lastEnvelope));

  function setEnvelope(statusCode, envelope) {
    const encoded = textEncoder.encode(JSON.stringify(envelope));
    if (encoded.length > maxResponseBytes) {
      throw new Error(
        `Hostcall response exceeds ${maxResponseBytes} byte limit.`,
      );
    }
    lastStatusCode = statusCode;
    lastEnvelope = envelope;
    lastResponseBytes = encoded;
  }

  function callJson(operationPtr, operationLen, payloadPtr, payloadLen) {
    try {
      if (payloadLen > maxRequestBytes) {
        throw new Error(
          `Hostcall request exceeds ${maxRequestBytes} byte limit.`,
        );
      }
      const operation = textDecoder.decode(
        readMemoryBytes(getMemory, operationPtr, operationLen, "Operation"),
      );
      const params = parseJsonPayload(
        readMemoryBytes(getMemory, payloadPtr, payloadLen, "Payload"),
      );
      const result = dispatch(operation, params);
      if (isPromiseLike(result)) {
        throw new Error(
          `Operation "${operation}" returned a Promise. The synchronous hostcall ABI only supports synchronous operations.`,
        );
      }
      setEnvelope(HOSTCALL_STATUS_OK, {
        ok: true,
        result: encodeHostcallValue(result),
      });
      return HOSTCALL_STATUS_OK;
    } catch (error) {
      try {
        setEnvelope(HOSTCALL_STATUS_ERROR, {
          ok: false,
          error: serializeHostcallError(error),
        });
      } catch (serializationError) {
        setEnvelope(HOSTCALL_STATUS_ERROR, {
          ok: false,
          error: serializeHostcallError(serializationError),
        });
      }
      return HOSTCALL_STATUS_ERROR;
    }
  }

  function responseLen() {
    return lastResponseBytes.length;
  }

  function readResponse(dstPtr, dstLen) {
    return writeMemoryBytes(getMemory, dstPtr, lastResponseBytes, dstLen);
  }

  function clearResponse() {
    setEnvelope(HOSTCALL_STATUS_OK, {
      ok: true,
      result: null,
    });
    return HOSTCALL_STATUS_OK;
  }

  function lastStatus() {
    return lastStatusCode;
  }

  return {
    moduleName,
    imports: {
      [moduleName]: {
        call_json: callJson,
        response_len: responseLen,
        read_response: readResponse,
        clear_response: clearResponse,
        last_status_code: lastStatus,
      },
    },
    getLastEnvelope() {
      return structuredClone(lastEnvelope);
    },
    getLastResponseBytes() {
      return new Uint8Array(lastResponseBytes);
    },
    getLastResponseText() {
      return textDecoder.decode(lastResponseBytes);
    },
    getLastResponseJson() {
      return JSON.parse(this.getLastResponseText());
    },
  };
}

export function createNodeHostSyncHostcallBridge(options = {}) {
  const host = options.host;
  if (!host || typeof host !== "object") {
    throw new TypeError(
      "createNodeHostSyncHostcallBridge requires a host instance.",
    );
  }

  return createJsonHostcallBridge({
    ...options,
    dispatch: createNodeHostSyncDispatcher(host),
  });
}
