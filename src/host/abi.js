import { bytesToBase64 } from "../utils/encoding.js";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export const DEFAULT_HOSTCALL_IMPORT_MODULE = "sdn_host";
export const HOSTCALL_STATUS_OK = 0;
export const HOSTCALL_STATUS_ERROR = 1;

export const SyncHostcallOperations = Object.freeze([
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
export const NodeHostSyncHostcallOperations = SyncHostcallOperations;

function normalizeCapabilityOperation(operation) {
  const normalized = assertNonEmptyString(operation, "Host operation");
  const separator = normalized.indexOf(".");
  if (separator <= 0 || separator === normalized.length - 1) {
    return null;
  }
  return {
    capabilityId: normalized.slice(0, separator),
    methodId: normalized.slice(separator + 1),
  };
}

function getHostCapabilityAdapter(host, capabilityId) {
  if (!host || typeof host !== "object") {
    return null;
  }
  if (typeof host.getCapability === "function") {
    const adapter = host.getCapability(capabilityId);
    if (adapter) {
      return adapter;
    }
  }
  const capabilityRegistry = host.capabilities;
  if (capabilityRegistry instanceof Map) {
    const adapter = capabilityRegistry.get(capabilityId);
    if (adapter) {
      return adapter;
    }
  } else if (capabilityRegistry && typeof capabilityRegistry === "object") {
    const adapter = capabilityRegistry[capabilityId];
    if (adapter) {
      return adapter;
    }
  }

  const directAdapter = host[capabilityId];
  if (directAdapter && typeof directAdapter === "object") {
    return directAdapter;
  }

  const camelCapabilityId = capabilityId.replace(/_([a-z])/g, (_, letter) =>
    letter.toUpperCase(),
  );
  const camelAdapter = host[camelCapabilityId];
  if (camelAdapter && typeof camelAdapter === "object") {
    return camelAdapter;
  }

  return null;
}

async function dispatchHostCapabilityOperation(host, operation, params = null) {
  const normalized = normalizeCapabilityOperation(operation);
  if (!normalized) {
    return undefined;
  }

  const adapter = getHostCapabilityAdapter(host, normalized.capabilityId);
  if (!adapter || typeof adapter !== "object") {
    return undefined;
  }
  if (typeof adapter[normalized.methodId] === "function") {
    return adapter[normalized.methodId](params);
  }
  if (typeof adapter.invoke === "function") {
    return adapter.invoke(normalized.methodId, params);
  }
  throw new Error(
    `Host capability "${normalized.capabilityId}" does not implement "${normalized.methodId}" or invoke().`,
  );
}

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

function assertSyncHostcallResult(value, operation) {
  if (isPromiseLike(value)) {
    throw new Error(
      `Operation "${operation}" is not available in the synchronous hostcall ABI.`,
    );
  }
  return value;
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

export function dispatchHostSyncOperation(host, operation, params = null) {
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
    case "crypto.sha256":
      return assertSyncHostcallResult(
        host.crypto.sha256(params?.value ?? params?.bytes),
        normalized,
      );
    case "crypto.sha512":
      return assertSyncHostcallResult(
        host.crypto.sha512(params?.value ?? params?.bytes),
        normalized,
      );
    case "crypto.hkdf":
      return assertSyncHostcallResult(host.crypto.hkdf(params), normalized);
    case "crypto.aesGcmEncrypt":
      return assertSyncHostcallResult(
        host.crypto.aesGcmEncrypt(params),
        normalized,
      );
    case "crypto.aesGcmDecrypt":
      return assertSyncHostcallResult(
        host.crypto.aesGcmDecrypt(params),
        normalized,
      );
    case "crypto.x25519.generateKeypair":
      return assertSyncHostcallResult(
        host.crypto.generateX25519Keypair(),
        normalized,
      );
    case "crypto.x25519.publicKey":
      return assertSyncHostcallResult(
        host.crypto.x25519PublicKey(params?.privateKey),
        normalized,
      );
    case "crypto.x25519.sharedSecret":
      return assertSyncHostcallResult(
        host.crypto.x25519SharedSecret(
          params?.privateKey,
          params?.publicKey,
        ),
        normalized,
      );
    case "crypto.ed25519.publicKeyFromSeed":
      return assertSyncHostcallResult(
        host.crypto.ed25519.publicKeyFromSeed(params?.seed),
        normalized,
      );
    case "crypto.ed25519.sign":
      return assertSyncHostcallResult(
        host.crypto.ed25519.sign(params?.message, params?.seed),
        normalized,
      );
    case "crypto.ed25519.verify":
      return assertSyncHostcallResult(
        host.crypto.ed25519.verify(
          params?.message,
          params?.signature,
          params?.publicKey,
        ),
        normalized,
      );
    default:
      throw new Error(
        `Operation "${normalized}" is not available in the synchronous hostcall ABI.`,
      );
  }
}

export function dispatchNodeHostSyncOperation(host, operation, params = null) {
  return dispatchHostSyncOperation(host, operation, params);
}

export function createNodeHostSyncDispatcher(host) {
  if (!host || typeof host !== "object") {
    throw new TypeError("createNodeHostSyncDispatcher requires a host object.");
  }
  return (operation, params = null) =>
    dispatchHostSyncOperation(host, operation, params);
}

export function createHostSyncDispatcher(host) {
  return createNodeHostSyncDispatcher(host);
}

export async function dispatchHostOperation(host, operation, params = null) {
  if (!host || typeof host !== "object") {
    throw new TypeError("dispatchHostOperation requires a host object.");
  }
  const normalized = assertNonEmptyString(operation, "Host operation");
  if (typeof host.invoke === "function") {
    return host.invoke(normalized, params);
  }
  if (typeof host.invokeCapability === "function") {
    try {
      return host.invokeCapability(normalized, params);
    } catch (error) {
      if (SyncHostcallOperations.includes(normalized)) {
        return dispatchHostSyncOperation(host, normalized, params);
      }
      throw error;
    }
  }
  const genericResult = await dispatchHostCapabilityOperation(
    host,
    normalized,
    params,
  );
  if (genericResult !== undefined) {
    return genericResult;
  }
  return dispatchHostSyncOperation(host, normalized, params);
}

export function createAsyncHostDispatcher(host) {
  if (!host || typeof host !== "object") {
    throw new TypeError("createAsyncHostDispatcher requires a host object.");
  }
  return (operation, params = null) =>
    dispatchHostOperation(host, operation, params);
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
