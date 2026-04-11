import dgram from "node:dgram";
import net from "node:net";
import path from "node:path";
import { randomBytes as nodeRandomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import nodeTls from "node:tls";

import {
  decryptBytesFromEnvelope,
  encryptBytesForRecipient,
  generateX25519Keypair,
} from "../transport/pki.js";
import { RuntimeTarget } from "../runtime/constants.js";
import { sha256Bytes } from "../utils/crypto.js";
import { toUint8Array } from "../utils/encoding.js";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  ed25519PublicKey,
  ed25519Sign,
  ed25519Verify,
  hkdfBytes,
  secp256k1PublicKey,
  secp256k1SignDigest,
  secp256k1VerifyDigest,
  sha512Bytes,
  x25519PublicKey,
  x25519SharedSecret,
} from "../utils/wasmCrypto.js";
import {
  matchesCronExpression,
  nextCronOccurrence,
  parseCronExpression,
} from "./cron.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const NodeHostSupportedCapabilities = Object.freeze([
  "clock",
  "random",
  "timers",
  "schedule_cron",
  "http",
  "websocket",
  "mqtt",
  "network",
  "filesystem",
  "tcp",
  "udp",
  "tls",
  "ipfs",
  "protocol_handle",
  "protocol_dial",
  "context_read",
  "context_write",
  "crypto_hash",
  "crypto_sign",
  "crypto_verify",
  "crypto_encrypt",
  "crypto_decrypt",
  "crypto_key_agreement",
  "crypto_kdf",
  "process_exec",
]);

export const NodeHostSupportedOperations = Object.freeze([
  "clock.now",
  "clock.monotonicNow",
  "clock.nowIso",
  "random.bytes",
  "timers.delay",
  "schedule.parse",
  "schedule.matches",
  "schedule.next",
  "http.request",
  "websocket.exchange",
  "mqtt.publish",
  "mqtt.subscribeOnce",
  "network.request",
  "filesystem.resolvePath",
  "filesystem.readFile",
  "filesystem.writeFile",
  "filesystem.appendFile",
  "filesystem.deleteFile",
  "filesystem.mkdir",
  "filesystem.readdir",
  "filesystem.stat",
  "filesystem.rename",
  "tcp.request",
  "udp.request",
  "tls.request",
  "ipfs.invoke",
  "protocol_handle.register",
  "protocol_handle.unregister",
  "protocol_dial.dial",
  "exec.execFile",
  "context.get",
  "context.set",
  "context.delete",
  "context.listKeys",
  "context.listScopes",
  "crypto.sha256",
  "crypto.sha512",
  "crypto.hkdf",
  "crypto.aesGcmEncrypt",
  "crypto.aesGcmDecrypt",
  "crypto.x25519.generateKeypair",
  "crypto.x25519.publicKey",
  "crypto.x25519.sharedSecret",
  "crypto.sealedBox.encryptForRecipient",
  "crypto.sealedBox.decryptFromEnvelope",
  "crypto.secp256k1.publicKeyFromPrivate",
  "crypto.secp256k1.signDigest",
  "crypto.secp256k1.verifyDigest",
  "crypto.ed25519.publicKeyFromSeed",
  "crypto.ed25519.sign",
  "crypto.ed25519.verify",
]);

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function assertNonEmptyString(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }
  return normalized;
}

function assertNonNegativeInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return normalized;
}

function normalizeGrantedCapabilities(options) {
  const source =
    options.grantedCapabilities ??
    options.capabilities ??
    options.manifest?.capabilities ??
    NodeHostSupportedCapabilities;
  if (!Array.isArray(source)) {
    throw new TypeError(
      "Node host capabilities must be an array when provided.",
    );
  }

  const normalized = new Set();
  for (const capability of source) {
    const id = assertNonEmptyString(capability, "Capability id");
    normalized.add(id);
  }
  return normalized;
}

function normalizeAllowedOrigins(origins) {
  if (origins === undefined || origins === null) {
    return null;
  }
  if (!Array.isArray(origins)) {
    throw new TypeError("allowedHttpOrigins must be an array of origin strings.");
  }
  const normalized = new Set();
  for (const origin of origins) {
    normalized.add(new URL(assertNonEmptyString(origin, "HTTP origin")).origin);
  }
  return normalized;
}

function normalizeAllowedWebSocketOrigins(origins) {
  if (origins === undefined || origins === null) {
    return null;
  }
  if (!Array.isArray(origins)) {
    throw new TypeError(
      "allowedWebSocketOrigins must be an array of WebSocket origin strings.",
    );
  }
  const normalized = new Set();
  for (const origin of origins) {
    const url = new URL(assertNonEmptyString(origin, "WebSocket origin"));
    if (!["ws:", "wss:"].includes(url.protocol)) {
      throw new TypeError(
        `WebSocket origin "${origin}" must use ws: or wss:.`,
      );
    }
    normalized.add(url.origin);
  }
  return normalized;
}

function normalizeAllowedCommands(commands) {
  if (commands === undefined || commands === null) {
    return null;
  }
  if (!Array.isArray(commands)) {
    throw new TypeError("allowedCommands must be an array of executable paths.");
  }
  const normalized = new Set();
  for (const command of commands) {
    normalized.add(assertNonEmptyString(command, "Executable path"));
  }
  return normalized;
}

function normalizeAllowedHosts(hosts, label) {
  if (hosts === undefined || hosts === null) {
    return null;
  }
  if (!Array.isArray(hosts)) {
    throw new TypeError(`${label} must be an array of host strings.`);
  }
  const normalized = new Set();
  for (const host of hosts) {
    normalized.add(assertNonEmptyString(host, label).toLowerCase());
  }
  return normalized;
}

function normalizeAllowedPorts(ports, label, { allowZero = false } = {}) {
  if (ports === undefined || ports === null) {
    return null;
  }
  if (!Array.isArray(ports)) {
    throw new TypeError(`${label} must be an array of integer ports.`);
  }
  const normalized = new Set();
  for (const port of ports) {
    normalized.add(assertPort(port, label, { allowZero }));
  }
  return normalized;
}

function normalizeNetworkTransport(params = {}) {
  const explicit = String(
    params.transport ?? params.kind ?? params.request?.transport ?? "",
  )
    .trim()
    .toLowerCase();
  if (explicit) {
    return explicit;
  }
  const candidateUrl = params.url ?? params.request?.url ?? null;
  if (candidateUrl) {
    const protocol = new URL(candidateUrl).protocol.toLowerCase();
    if (protocol === "http:" || protocol === "https:") {
      return "http";
    }
    if (protocol === "ws:" || protocol === "wss:") {
      return "websocket";
    }
  }
  throw new Error(
    'network.request requires a transport value such as "http", "tcp", or "websocket".',
  );
}

async function invokeAdapterMethod(adapter, methodName, params, label) {
  if (!adapter || typeof adapter !== "object") {
    throw new Error(`${label} adapter is not configured for this host.`);
  }
  if (typeof adapter[methodName] === "function") {
    return adapter[methodName](params);
  }
  if (typeof adapter.invoke === "function") {
    return adapter.invoke(methodName, params);
  }
  throw new Error(
    `${label} adapter does not implement "${methodName}" or invoke().`,
  );
}

function normalizeFilesystemRoot(rootPath) {
  return path.resolve(String(rootPath ?? process.cwd()));
}

function headersToObject(headers) {
  return Object.fromEntries(headers.entries());
}

function normalizeResponseType(responseType) {
  const normalized = String(responseType ?? "bytes").trim().toLowerCase();
  if (!["bytes", "text", "json"].includes(normalized)) {
    throw new Error(
      `Unsupported HTTP responseType "${responseType}". Expected "bytes", "text", or "json".`,
    );
  }
  return normalized;
}

function normalizeWebSocketResponseType(responseType) {
  const normalized = String(responseType ?? "utf8").trim().toLowerCase();
  if (!["bytes", "utf8", "json"].includes(normalized)) {
    throw new Error(
      `Unsupported WebSocket responseType "${responseType}". Expected "bytes", "utf8", or "json".`,
    );
  }
  return normalized;
}

function normalizeSocketEncoding(encoding, label = "Socket encoding") {
  const normalized = String(encoding ?? "bytes").trim().toLowerCase();
  if (!["utf8", "bytes"].includes(normalized)) {
    throw new Error(
      `${label} "${encoding}" is unsupported. Expected "utf8" or "bytes".`,
    );
  }
  return normalized;
}

function normalizeSocketPayload(value, label, textEncoding = "utf8") {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return Buffer.from(value, textEncoding);
  }
  return Buffer.from(toUint8Array(value));
}

function assertPort(value, label, { allowZero = false } = {}) {
  const normalized = Number(value);
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(normalized) || normalized < min || normalized > 65535) {
    throw new TypeError(`${label} must be an integer in range ${min}..65535.`);
  }
  return normalized;
}

function assertNetworkTargetAllowed(
  kind,
  host,
  port,
  allowedHosts,
  allowedPorts,
) {
  const normalizedHost = assertNonEmptyString(host, `${kind} host`).toLowerCase();
  const normalizedPort = assertPort(port, `${kind} port`);
  if (allowedHosts && !allowedHosts.has(normalizedHost)) {
    throw new Error(`${kind} host "${host}" is not permitted by this host.`);
  }
  if (allowedPorts && !allowedPorts.has(normalizedPort)) {
    throw new Error(`${kind} port "${port}" is not permitted by this host.`);
  }
  return {
    host: normalizedHost,
    port: normalizedPort,
  };
}

function createTimeoutSignal(timeoutMs) {
  if (timeoutMs === undefined || timeoutMs === null) {
    return { signal: undefined, dispose() {} };
  }

  const duration = assertNonNegativeInteger(timeoutMs, "HTTP timeoutMs");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), duration);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
    },
  };
}

function resolveSignals(primary, secondary) {
  if (!primary) {
    return secondary ?? undefined;
  }
  if (!secondary) {
    return primary;
  }
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([primary, secondary]);
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  primary.addEventListener("abort", onAbort, { once: true });
  secondary.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

function normalizeRequestBody(body) {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body === "string") {
    return body;
  }
  return toUint8Array(body);
}

function normalizeWebSocketMessage(message) {
  if (message === undefined || message === null) {
    return undefined;
  }
  if (typeof message === "string") {
    return message;
  }
  return toUint8Array(message);
}

function normalizeWebSocketUrl(url) {
  const resolved = new URL(assertNonEmptyString(url, "WebSocket url"));
  if (!["ws:", "wss:"].includes(resolved.protocol)) {
    throw new Error(
      `Unsupported WebSocket protocol "${resolved.protocol}". Expected ws: or wss:.`,
    );
  }
  return resolved;
}

async function decodeWebSocketMessage(data, responseType) {
  if (typeof data === "string") {
    if (responseType === "json") {
      return JSON.parse(data);
    }
    if (responseType === "bytes") {
      return textEncoder.encode(data);
    }
    return data;
  }

  let bytes = null;
  if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (ArrayBuffer.isView(data)) {
    bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else if (typeof Blob !== "undefined" && data instanceof Blob) {
    bytes = new Uint8Array(await data.arrayBuffer());
  }

  if (!bytes) {
    throw new TypeError("Unsupported WebSocket message payload type.");
  }

  if (responseType === "json") {
    return JSON.parse(textDecoder.decode(bytes));
  }
  if (responseType === "utf8") {
    return textDecoder.decode(bytes);
  }
  return new Uint8Array(bytes);
}

async function runTcpRequest(options) {
  const responseEncoding = normalizeSocketEncoding(
    options.responseEncoding,
    "TCP responseEncoding",
  );
  const payload = normalizeSocketPayload(options.data, "TCP request data");

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: options.host,
      port: options.port,
    });
    const chunks = [];
    let settled = false;

    function cleanup() {
      socket.removeAllListeners();
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    }

    function finish() {
      if (settled) {
        return;
      }
      settled = true;
      const bodyBuffer = Buffer.concat(chunks);
      const result = {
        host: options.host,
        port: options.port,
        localAddress: socket.localAddress ?? null,
        localPort: socket.localPort ?? null,
        remoteAddress: socket.remoteAddress ?? options.host,
        remotePort: socket.remotePort ?? options.port,
        body:
          responseEncoding === "bytes"
            ? new Uint8Array(bodyBuffer)
            : bodyBuffer.toString("utf8"),
      };
      cleanup();
      socket.destroy();
      resolve(result);
    }

    socket.once("error", fail);
    socket.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    socket.once("end", finish);
    socket.once("close", (hadError) => {
      if (!hadError) {
        finish();
      }
    });

    if (options.timeoutMs !== undefined && options.timeoutMs !== null) {
      socket.setTimeout(
        assertNonNegativeInteger(options.timeoutMs, "TCP timeoutMs"),
        () => fail(new Error("TCP request timed out.")),
      );
    }

    socket.once("connect", () => {
      if (payload) {
        socket.write(payload);
      }
      socket.end();
    });
  });
}

async function runUdpRequest(options) {
  const responseEncoding = normalizeSocketEncoding(
    options.responseEncoding,
    "UDP responseEncoding",
  );
  const payload = normalizeSocketPayload(options.data, "UDP request data");
  if (!payload || payload.length === 0) {
    throw new TypeError("UDP request data is required.");
  }

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(options.type ?? "udp4");
    let settled = false;
    let timeout = null;

    function cleanup() {
      if (timeout) {
        clearTimeout(timeout);
      }
      socket.removeAllListeners();
      socket.close();
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    }

    function finish(messageBytes = Buffer.alloc(0), rinfo = null) {
      if (settled) {
        return;
      }
      settled = true;
      const local = socket.address();
      const responseBuffer = Buffer.from(messageBytes);
      const result = {
        host: options.host,
        port: options.port,
        localAddress: typeof local === "string" ? local : local.address,
        localPort: typeof local === "string" ? null : local.port,
        remoteAddress: rinfo?.address ?? options.host,
        remotePort: rinfo?.port ?? options.port,
        body:
          responseEncoding === "bytes"
            ? new Uint8Array(responseBuffer)
            : responseBuffer.toString("utf8"),
      };
      cleanup();
      resolve(result);
    }

    socket.once("error", fail);
    socket.once("message", (message, rinfo) => finish(message, rinfo));

    if (options.timeoutMs !== undefined && options.timeoutMs !== null) {
      timeout = setTimeout(
        () => fail(new Error("UDP request timed out.")),
        assertNonNegativeInteger(options.timeoutMs, "UDP timeoutMs"),
      );
    }

    socket.bind(
      options.bindPort ?? 0,
      options.bindAddress,
      () => {
        socket.send(payload, options.port, options.host, (error) => {
          if (error) {
            fail(error);
            return;
          }
          if (options.expectResponse === false) {
            finish();
          }
        });
      },
    );
  });
}

async function runTlsRequest(options) {
  const responseEncoding = normalizeSocketEncoding(
    options.responseEncoding,
    "TLS responseEncoding",
  );
  const payload = normalizeSocketPayload(options.data, "TLS request data");

  return new Promise((resolve, reject) => {
    const socket = nodeTls.connect({
      host: options.host,
      port: options.port,
      ca: options.ca,
      cert: options.cert,
      key: options.key,
      rejectUnauthorized: options.rejectUnauthorized ?? true,
      servername:
        options.servername ??
        (net.isIP(options.host) ? undefined : options.host),
    });
    const chunks = [];
    let settled = false;

    function cleanup() {
      socket.removeAllListeners();
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    }

    function finish() {
      if (settled) {
        return;
      }
      settled = true;
      const bodyBuffer = Buffer.concat(chunks);
      const result = {
        host: options.host,
        port: options.port,
        localAddress: socket.localAddress ?? null,
        localPort: socket.localPort ?? null,
        remoteAddress: socket.remoteAddress ?? options.host,
        remotePort: socket.remotePort ?? options.port,
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ?? null,
        body:
          responseEncoding === "bytes"
            ? new Uint8Array(bodyBuffer)
            : bodyBuffer.toString("utf8"),
      };
      cleanup();
      socket.destroy();
      resolve(result);
    }

    socket.once("error", fail);
    socket.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    socket.once("end", finish);
    socket.once("close", (hadError) => {
      if (!hadError) {
        finish();
      }
    });

    if (options.timeoutMs !== undefined && options.timeoutMs !== null) {
      socket.setTimeout(
        assertNonNegativeInteger(options.timeoutMs, "TLS timeoutMs"),
        () => fail(new Error("TLS request timed out.")),
      );
    }

    socket.once("secureConnect", () => {
      if (payload) {
        socket.write(payload);
      }
      socket.end();
    });
  });
}

async function runWebSocketExchange(options) {
  const responseType = normalizeWebSocketResponseType(options.responseType);
  const WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
  if (typeof WebSocketImpl !== "function") {
    throw new TypeError("A WebSocket implementation is required.");
  }

  return new Promise((resolve, reject) => {
    const websocket = new WebSocketImpl(
      options.url,
      options.protocols,
    );
    let settled = false;
    let timeout = null;

    function cleanup() {
      if (timeout) {
        clearTimeout(timeout);
      }
      websocket.removeEventListener("open", onOpen);
      websocket.removeEventListener("message", onMessage);
      websocket.removeEventListener("error", onError);
      websocket.removeEventListener("close", onClose);
    }

    function finish(result) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      try {
        if (websocket.readyState === WebSocketImpl.OPEN) {
          websocket.close(1000, "completed");
        }
      } catch {}
      resolve(result);
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      try {
        websocket.close(1011, "error");
      } catch {}
      reject(error);
    }

    async function onMessage(event) {
      try {
        const body = await decodeWebSocketMessage(event.data, responseType);
        finish({
          url: websocket.url ?? options.url,
          protocol: websocket.protocol ?? "",
          extensions: websocket.extensions ?? "",
          closeCode: null,
          closeReason: "",
          body,
        });
      } catch (error) {
        fail(error);
      }
    }

    function onOpen() {
      try {
        const message = normalizeWebSocketMessage(options.message);
        if (message !== undefined) {
          websocket.send(message);
        }
        if (options.expectResponse === false) {
          finish({
            url: websocket.url ?? options.url,
            protocol: websocket.protocol ?? "",
            extensions: websocket.extensions ?? "",
            closeCode: null,
            closeReason: "",
            body: null,
          });
        }
      } catch (error) {
        fail(error);
      }
    }

    function onError() {
      fail(new Error("WebSocket exchange failed."));
    }

    function onClose(event) {
      if (settled) {
        return;
      }
      if (options.expectResponse === false) {
        finish({
          url: websocket.url ?? options.url,
          protocol: websocket.protocol ?? "",
          extensions: websocket.extensions ?? "",
          closeCode: event.code ?? null,
          closeReason: event.reason ?? "",
          body: null,
        });
        return;
      }
      fail(
        new Error(
          `WebSocket closed before response (code ${event.code ?? "unknown"}).`,
        ),
      );
    }

    websocket.addEventListener("open", onOpen);
    websocket.addEventListener("message", onMessage);
    websocket.addEventListener("error", onError);
    websocket.addEventListener("close", onClose);

    if (options.timeoutMs !== undefined && options.timeoutMs !== null) {
      timeout = setTimeout(
        () => fail(new Error("WebSocket exchange timed out.")),
        assertNonNegativeInteger(options.timeoutMs, "WebSocket timeoutMs"),
      );
    }
  });
}

function encodeMqttRemainingLength(length) {
  const bytes = [];
  let value = assertNonNegativeInteger(length, "MQTT remaining length");
  do {
    let encoded = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) {
      encoded |= 0x80;
    }
    bytes.push(encoded);
  } while (value > 0);
  return Buffer.from(bytes);
}

function encodeMqttString(value) {
  const bytes = Buffer.from(assertNonEmptyString(value, "MQTT string"), "utf8");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

function decodeMqttString(buffer, offset = 0) {
  const length = buffer.readUInt16BE(offset);
  const start = offset + 2;
  const end = start + length;
  return {
    value: buffer.subarray(start, end).toString("utf8"),
    nextOffset: end,
  };
}

function encodeMqttPacket(headerByte, ...parts) {
  const body = Buffer.concat(parts.filter(Boolean));
  return Buffer.concat([
    Buffer.from([headerByte]),
    encodeMqttRemainingLength(body.length),
    body,
  ]);
}

function createMqttConnectPacket(options = {}) {
  const flags =
    0x02 |
    (options.username ? 0x80 : 0) |
    (options.password ? 0x40 : 0);
  const keepAlive = Buffer.alloc(2);
  keepAlive.writeUInt16BE(
    assertNonNegativeInteger(options.keepAliveSeconds ?? 30, "MQTT keepAliveSeconds"),
    0,
  );

  const payload = [
    encodeMqttString(options.clientId ?? "space-data-module-sdk"),
  ];
  if (options.username) {
    payload.push(encodeMqttString(options.username));
  }
  if (options.password) {
    payload.push(encodeMqttString(options.password));
  }

  return encodeMqttPacket(
    0x10,
    encodeMqttString("MQTT"),
    Buffer.from([0x04, flags]),
    keepAlive,
    ...payload,
  );
}

function createMqttPublishPacket(options = {}) {
  const payload =
    typeof options.payload === "string"
      ? Buffer.from(options.payload, "utf8")
      : Buffer.from(toUint8Array(options.payload ?? new Uint8Array()));
  return encodeMqttPacket(0x30, encodeMqttString(options.topic), payload);
}

function createMqttSubscribePacket(options = {}) {
  const packetId = Buffer.alloc(2);
  packetId.writeUInt16BE(assertPort(options.packetId ?? 1, "MQTT packetId", {
    allowZero: false,
  }), 0);
  return encodeMqttPacket(
    0x82,
    packetId,
    encodeMqttString(options.topic),
    Buffer.from([options.qos ?? 0]),
  );
}

function createMqttDisconnectPacket() {
  return Buffer.from([0xe0, 0x00]);
}

function parseMqttPackets(buffer) {
  const packets = [];
  let offset = 0;

  while (offset < buffer.length) {
    const packetStart = offset;
    if (offset + 2 > buffer.length) {
      break;
    }
    const header = buffer[offset++];
    let multiplier = 1;
    let remainingLength = 0;
    let encodedBytes = 0;
    let encodedByte = 0;

    do {
      if (offset >= buffer.length) {
        return {
          packets,
          remaining: buffer.subarray(packetStart),
        };
      }
      encodedByte = buffer[offset++];
      remainingLength += (encodedByte & 0x7f) * multiplier;
      multiplier *= 128;
      encodedBytes += 1;
    } while ((encodedByte & 0x80) !== 0 && encodedBytes < 4);

    if (offset + remainingLength > buffer.length) {
      return {
        packets,
        remaining: buffer.subarray(packetStart),
      };
    }

    const body = buffer.subarray(offset, offset + remainingLength);
    packets.push({
      header,
      type: header >> 4,
      flags: header & 0x0f,
      body,
    });
    offset += remainingLength;
  }

  return {
    packets,
    remaining: buffer.subarray(offset),
  };
}

function parseMqttPublishPacket(packet) {
  const topic = decodeMqttString(packet.body, 0);
  return {
    topic: topic.value,
    payload: packet.body.subarray(topic.nextOffset),
  };
}

async function runMqttPublish(options) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: options.host,
      port: options.port,
    });
    let buffer = Buffer.alloc(0);
    let settled = false;

    function cleanup() {
      socket.removeAllListeners();
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    }

    function finish(result) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      socket.end();
      resolve(result);
    }

    socket.once("connect", () => {
      socket.write(
        createMqttConnectPacket({
          clientId: options.clientId,
          username: options.username,
          password: options.password,
          keepAliveSeconds: options.keepAliveSeconds,
        }),
      );
    });

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      const parsed = parseMqttPackets(buffer);
      buffer = parsed.remaining;
      for (const packet of parsed.packets) {
        if (packet.type === 2) {
          if (packet.body.length < 2 || packet.body[1] !== 0) {
            fail(new Error(`MQTT CONNACK rejected with code ${packet.body[1] ?? "unknown"}.`));
            return;
          }
          socket.write(
            createMqttPublishPacket({
              topic: options.topic,
              payload: options.payload,
            }),
          );
          socket.write(createMqttDisconnectPacket());
          finish({
            host: options.host,
            port: options.port,
            clientId: options.clientId,
            topic: options.topic,
            payloadBytes:
              typeof options.payload === "string"
                ? Buffer.byteLength(options.payload)
                : toUint8Array(options.payload).length,
          });
          return;
        }
      }
    });

    socket.once("error", fail);
    socket.once("close", (hadError) => {
      if (!settled && !hadError) {
        fail(new Error("MQTT connection closed before publish completed."));
      }
    });

    if (options.timeoutMs !== undefined && options.timeoutMs !== null) {
      socket.setTimeout(
        assertNonNegativeInteger(options.timeoutMs, "MQTT timeoutMs"),
        () => fail(new Error("MQTT publish timed out.")),
      );
    }
  });
}

async function runMqttSubscribeOnce(options) {
  const responseType = normalizeWebSocketResponseType(options.responseType);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: options.host,
      port: options.port,
    });
    let buffer = Buffer.alloc(0);
    let settled = false;
    const packetId = options.packetId ?? 1;

    function cleanup() {
      socket.removeAllListeners();
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    }

    function finish(result) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      socket.end(createMqttDisconnectPacket());
      resolve(result);
    }

    socket.once("connect", () => {
      socket.write(
        createMqttConnectPacket({
          clientId: options.clientId,
          username: options.username,
          password: options.password,
          keepAliveSeconds: options.keepAliveSeconds,
        }),
      );
    });

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      const parsed = parseMqttPackets(buffer);
      buffer = parsed.remaining;
      for (const packet of parsed.packets) {
        if (packet.type === 2) {
          if (packet.body.length < 2 || packet.body[1] !== 0) {
            fail(new Error(`MQTT CONNACK rejected with code ${packet.body[1] ?? "unknown"}.`));
            return;
          }
          socket.write(
            createMqttSubscribePacket({
              packetId,
              topic: options.topic,
              qos: 0,
            }),
          );
          continue;
        }

        if (packet.type === 9) {
          continue;
        }

        if (packet.type === 3) {
          const published = parseMqttPublishPacket(packet);
          let body = null;
          if (responseType === "json") {
            body = JSON.parse(textDecoder.decode(published.payload));
          } else if (responseType === "utf8") {
            body = textDecoder.decode(published.payload);
          } else {
            body = new Uint8Array(published.payload);
          }
          finish({
            host: options.host,
            port: options.port,
            clientId: options.clientId,
            topic: published.topic,
            body,
          });
          return;
        }
      }
    });

    socket.once("error", fail);
    socket.once("close", (hadError) => {
      if (!settled && !hadError) {
        fail(new Error("MQTT connection closed before subscribe completed."));
      }
    });

    if (options.timeoutMs !== undefined && options.timeoutMs !== null) {
      socket.setTimeout(
        assertNonNegativeInteger(options.timeoutMs, "MQTT timeoutMs"),
        () => fail(new Error("MQTT subscribe timed out.")),
      );
    }
  });
}

function normalizeExecEncoding(encoding) {
  const normalized = String(encoding ?? "utf8").trim().toLowerCase();
  if (!["utf8", "bytes"].includes(normalized)) {
    throw new Error(
      `Unsupported exec encoding "${encoding}". Expected "utf8" or "bytes".`,
    );
  }
  return normalized;
}

function normalizeExecArgs(args) {
  if (args === undefined || args === null) {
    return [];
  }
  if (!Array.isArray(args)) {
    throw new TypeError("Executable args must be an array of strings.");
  }
  return args.map((arg) => String(arg));
}

async function runExecFile(options) {
  const encoding = normalizeExecEncoding(options.encoding);
  const stdoutChunks = [];
  const stderrChunks = [];
  const spawnOptions = {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  };

  return new Promise((resolve, reject) => {
    const child = spawn(options.file, options.args, spawnOptions);
    let timeout = null;

    child.once("error", reject);

    if (options.timeoutMs !== undefined && options.timeoutMs !== null) {
      const duration = assertNonNegativeInteger(options.timeoutMs, "Exec timeoutMs");
      timeout = setTimeout(() => {
        child.kill("SIGTERM");
      }, duration);
    }

    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.once("close", (exitCode, signal) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const stderrBuffer = Buffer.concat(stderrChunks);
      resolve({
        exitCode,
        signal,
        stdout:
          encoding === "bytes"
            ? new Uint8Array(stdoutBuffer)
            : stdoutBuffer.toString("utf8"),
        stderr:
          encoding === "bytes"
            ? new Uint8Array(stderrBuffer)
            : stderrBuffer.toString("utf8"),
      });
    });

    if (options.input !== undefined && options.input !== null) {
      if (typeof options.input === "string") {
        child.stdin.end(options.input);
      } else {
        child.stdin.end(Buffer.from(toUint8Array(options.input)));
      }
    } else {
      child.stdin.end();
    }
  });
}

function createInMemoryContextStore() {
  const scopes = new Map();

  function getScope(scopeId) {
    if (!scopes.has(scopeId)) {
      scopes.set(scopeId, new Map());
    }
    return scopes.get(scopeId);
  }

  return {
    async get(scope, key) {
      return cloneValue(getScope(scope).get(key));
    },
    async set(scope, key, value) {
      getScope(scope).set(key, cloneValue(value));
    },
    async delete(scope, key) {
      return getScope(scope).delete(key);
    },
    async listKeys(scope) {
      return Array.from(getScope(scope).keys()).sort();
    },
    async listScopes() {
      return Array.from(scopes.keys()).sort();
    },
  };
}

function assertContextStore(store) {
  if (!store || typeof store !== "object") {
    throw new TypeError("contextStore must be an object when provided.");
  }

  const requiredMethods = ["get", "set", "delete", "listKeys", "listScopes"];
  for (const methodName of requiredMethods) {
    if (typeof store[methodName] !== "function") {
      throw new TypeError(
        `contextStore must implement an async ${methodName}() method.`,
      );
    }
  }

  return store;
}

function createFileContextStore(filePath) {
  const resolvedFilePath = path.resolve(String(filePath));
  let cache = null;
  let writeChain = Promise.resolve();

  async function loadState() {
    if (cache !== null) {
      return cache;
    }

    try {
      const file = await readFile(resolvedFilePath, "utf8");
      const parsed = JSON.parse(file);
      cache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      if (error?.code === "ENOENT") {
        cache = {};
      } else {
        throw error;
      }
    }

    return cache;
  }

  async function flushState(state) {
    const payload = JSON.stringify(state, null, 2) + "\n";
    await mkdir(path.dirname(resolvedFilePath), { recursive: true });
    await writeFile(resolvedFilePath, payload, "utf8");
  }

  function getScope(state, scopeId) {
    if (!state[scopeId] || typeof state[scopeId] !== "object") {
      state[scopeId] = {};
    }
    return state[scopeId];
  }

  return {
    async get(scope, key) {
      const state = await loadState();
      return cloneValue(getScope(state, scope)[key]);
    },
    async set(scope, key, value) {
      writeChain = writeChain.then(async () => {
        const state = await loadState();
        getScope(state, scope)[key] = cloneValue(value);
        await flushState(state);
      });
      return writeChain;
    },
    async delete(scope, key) {
      let deleted = false;
      writeChain = writeChain.then(async () => {
        const state = await loadState();
        const scopeState = getScope(state, scope);
        deleted = delete scopeState[key];
        await flushState(state);
      });
      await writeChain;
      return deleted;
    },
    async listKeys(scope) {
      const state = await loadState();
      return Object.keys(getScope(state, scope)).sort();
    },
    async listScopes() {
      const state = await loadState();
      return Object.keys(state).sort();
    },
  };
}

export class HostCapabilityError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "HostCapabilityError";
    this.code = options.code ?? "host-capability-error";
    this.capability = options.capability ?? null;
    this.operation = options.operation ?? null;
  }
}

export class HostFilesystemScopeError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "HostFilesystemScopeError";
    this.code = options.code ?? "filesystem-scope-violation";
    this.requestedPath = options.requestedPath ?? null;
    this.filesystemRoot = options.filesystemRoot ?? null;
  }
}

export class NodeHost {
  constructor(options = {}) {
    this.runtimeTarget = RuntimeTarget.NODE;
    this.filesystemRoot = normalizeFilesystemRoot(
      options.filesystemRoot ?? options.fsRoot,
    );
    this.allowedHttpOrigins = normalizeAllowedOrigins(options.allowedHttpOrigins);
    this.allowedWebSocketOrigins = normalizeAllowedWebSocketOrigins(
      options.allowedWebSocketOrigins,
    );
    this.allowedCommands = normalizeAllowedCommands(options.allowedCommands);
    this.allowedMqttHosts = normalizeAllowedHosts(
      options.allowedMqttHosts,
      "allowedMqttHosts",
    );
    this.allowedMqttPorts = normalizeAllowedPorts(
      options.allowedMqttPorts,
      "allowedMqttPorts",
    );
    this.allowedTcpHosts = normalizeAllowedHosts(
      options.allowedTcpHosts,
      "allowedTcpHosts",
    );
    this.allowedTcpPorts = normalizeAllowedPorts(
      options.allowedTcpPorts,
      "allowedTcpPorts",
    );
    this.allowedUdpHosts = normalizeAllowedHosts(
      options.allowedUdpHosts,
      "allowedUdpHosts",
    );
    this.allowedUdpPorts = normalizeAllowedPorts(
      options.allowedUdpPorts,
      "allowedUdpPorts",
    );
    this.allowedTlsHosts = normalizeAllowedHosts(
      options.allowedTlsHosts,
      "allowedTlsHosts",
    );
    this.allowedTlsPorts = normalizeAllowedPorts(
      options.allowedTlsPorts,
      "allowedTlsPorts",
    );
    this.fetch = options.fetch ?? globalThis.fetch;
    this.WebSocket = options.WebSocket ?? globalThis.WebSocket;
    this._networkAdapter = options.network ?? null;
    this._ipfsAdapter = options.ipfs ?? null;
    this._protocolHandleAdapter = options.protocolHandle ?? null;
    this._protocolDialAdapter = options.protocolDial ?? null;
    if (typeof this.fetch !== "function") {
      throw new TypeError(
        "A fetch implementation is required to create a Node host.",
      );
    }

    this._supportedCapabilities = new Set(NodeHostSupportedCapabilities);
    this._grantedCapabilities = normalizeGrantedCapabilities(options);
    this._contextStore = options.contextStore
      ? assertContextStore(options.contextStore)
      : options.contextFilePath
        ? createFileContextStore(options.contextFilePath)
        : createInMemoryContextStore();

    this.clock = Object.freeze({
      now: () => this.#withCapability("clock", "clock.now", () => Date.now()),
      monotonicNow: () =>
        this.#withCapability("clock", "clock.monotonicNow", () => performance.now()),
      nowIso: () =>
        this.#withCapability("clock", "clock.nowIso", () =>
          new Date(Date.now()).toISOString(),
        ),
    });

    this.random = Object.freeze({
      bytes: (length) =>
        this.#withCapability("random", "random.bytes", () => {
          const size = assertNonNegativeInteger(length, "Random byte length");
          return nodeRandomBytes(size);
        }),
    });

    this.timers = Object.freeze({
      delay: async (ms, options = {}) =>
        this.#withCapability("timers", "timers.delay", async () => {
          const duration = assertNonNegativeInteger(ms, "Timer duration");
          return new Promise((resolve, reject) => {
            const onAbort = () => {
              clearTimeout(timer);
              reject(new Error("Timer delay aborted."));
            };
            const signal = options.signal ?? null;
            if (signal?.aborted) {
              reject(new Error("Timer delay aborted."));
              return;
            }
            const timer = setTimeout(() => {
              signal?.removeEventListener("abort", onAbort);
              resolve();
            }, duration);
            signal?.addEventListener("abort", onAbort, { once: true });
          });
        }),
      setTimeout: (callback, ms, ...args) =>
        this.#withCapability("timers", "timers.setTimeout", () => {
          const duration = assertNonNegativeInteger(ms, "Timeout duration");
          return setTimeout(callback, duration, ...args);
        }),
      clearTimeout: (handle) => clearTimeout(handle),
      setInterval: (callback, ms, ...args) =>
        this.#withCapability("timers", "timers.setInterval", () => {
          const duration = assertNonNegativeInteger(ms, "Interval duration");
          return setInterval(callback, duration, ...args);
        }),
      clearInterval: (handle) => clearInterval(handle),
    });

    this.schedule = Object.freeze({
      parse: (expression) =>
        this.#withCapability("schedule_cron", "schedule.parse", () =>
          parseCronExpression(expression),
        ),
      matches: (expression, date = Date.now()) =>
        this.#withCapability("schedule_cron", "schedule.matches", () =>
          matchesCronExpression(expression, date),
        ),
      next: (expression, from = Date.now()) =>
        this.#withCapability("schedule_cron", "schedule.next", () =>
          nextCronOccurrence(expression, from),
        ),
    });

    this.http = Object.freeze({
      request: async (requestOptions = {}) =>
        this.#withCapability("http", "http.request", async () => {
          const url = new URL(assertNonEmptyString(requestOptions.url, "HTTP url"));
          if (!["http:", "https:"].includes(url.protocol)) {
            throw new Error(
              `Unsupported HTTP protocol "${url.protocol}". Expected http: or https:.`,
            );
          }
          if (
            this.allowedHttpOrigins &&
            !this.allowedHttpOrigins.has(url.origin)
          ) {
            throw new Error(`HTTP origin "${url.origin}" is not permitted by this host.`);
          }

          const timeout = createTimeoutSignal(requestOptions.timeoutMs);
          try {
            const response = await this.fetch(url, {
              method: requestOptions.method ?? "GET",
              headers: requestOptions.headers,
              body: normalizeRequestBody(requestOptions.body),
              signal: resolveSignals(requestOptions.signal, timeout.signal),
            });
            const responseType = normalizeResponseType(requestOptions.responseType);
            let body;
            if (responseType === "json") {
              body = await response.json();
            } else if (responseType === "text") {
              body = await response.text();
            } else {
              body = new Uint8Array(await response.arrayBuffer());
            }
            return {
              url: response.url || url.toString(),
              status: response.status,
              statusText: response.statusText,
              ok: response.ok,
              headers: headersToObject(response.headers),
              body,
            };
          } finally {
            timeout.dispose();
          }
        }),
    });

    this.websocket = Object.freeze({
      exchange: async (websocketOptions = {}) =>
        this.#withCapability("websocket", "websocket.exchange", async () => {
          const url = normalizeWebSocketUrl(websocketOptions.url);
          if (
            this.allowedWebSocketOrigins &&
            !this.allowedWebSocketOrigins.has(url.origin)
          ) {
            throw new Error(
              `WebSocket origin "${url.origin}" is not permitted by this host.`,
            );
          }
          return runWebSocketExchange({
            url: url.toString(),
            protocols: websocketOptions.protocols,
            message: websocketOptions.message,
            responseType: websocketOptions.responseType,
            timeoutMs: websocketOptions.timeoutMs,
            expectResponse: websocketOptions.expectResponse,
            WebSocketImpl: websocketOptions.WebSocketImpl ?? this.WebSocket,
          });
        }),
    });

    this.network = Object.freeze({
      request: async (params = {}) =>
        this.#withCapability("network", "network.request", async () => {
          const transport = normalizeNetworkTransport(params);
          const request = params.request ?? params;
          switch (transport) {
            case "http":
              return this.http.request(request);
            case "websocket":
              return this.websocket.exchange(request);
            case "mqtt":
              return request.subscribe === true
                ? this.mqtt.subscribeOnce(request)
                : this.mqtt.publish(request);
            case "tcp":
              return this.tcp.request(request);
            case "udp":
              return this.udp.request(request);
            case "tls":
              return this.tls.request(request);
            default:
              if (this._networkAdapter) {
                return invokeAdapterMethod(this._networkAdapter, "request", {
                  ...request,
                  transport,
                }, "network");
              }
              throw new Error(
                `Node host does not support network transport "${transport}".`,
              );
          }
        }),
    });

    this.mqtt = Object.freeze({
      publish: async (mqttOptions = {}) =>
        this.#withCapability("mqtt", "mqtt.publish", async () => {
          const { host, port } = assertNetworkTargetAllowed(
            "MQTT",
            mqttOptions.host,
            mqttOptions.port,
            this.allowedMqttHosts,
            this.allowedMqttPorts,
          );
          return runMqttPublish({
            host,
            port,
            clientId:
              mqttOptions.clientId ?? `space-data-module-sdk-${Date.now()}`,
            topic: assertNonEmptyString(mqttOptions.topic, "MQTT topic"),
            payload: mqttOptions.payload ?? "",
            username: mqttOptions.username,
            password: mqttOptions.password,
            keepAliveSeconds: mqttOptions.keepAliveSeconds,
            timeoutMs: mqttOptions.timeoutMs,
          });
        }),
      subscribeOnce: async (mqttOptions = {}) =>
        this.#withCapability("mqtt", "mqtt.subscribeOnce", async () => {
          const { host, port } = assertNetworkTargetAllowed(
            "MQTT",
            mqttOptions.host,
            mqttOptions.port,
            this.allowedMqttHosts,
            this.allowedMqttPorts,
          );
          return runMqttSubscribeOnce({
            host,
            port,
            clientId:
              mqttOptions.clientId ?? `space-data-module-sdk-${Date.now()}`,
            topic: assertNonEmptyString(mqttOptions.topic, "MQTT topic"),
            username: mqttOptions.username,
            password: mqttOptions.password,
            keepAliveSeconds: mqttOptions.keepAliveSeconds,
            timeoutMs: mqttOptions.timeoutMs,
            responseType: mqttOptions.responseType,
            packetId: mqttOptions.packetId,
          });
        }),
    });

    this.filesystem = Object.freeze({
      resolvePath: (targetPath) =>
        this.#withCapability("filesystem", "filesystem.resolvePath", () =>
          this.#resolveFilesystemPath(targetPath),
        ),
      readFile: async (targetPath, options = {}) =>
        this.#withCapability("filesystem", "filesystem.readFile", async () => {
          const resolvedPath = this.#resolveFilesystemPath(targetPath);
          const file = await readFile(resolvedPath);
          if (options.encoding) {
            return file.toString(options.encoding);
          }
          return new Uint8Array(file);
        }),
      writeFile: async (targetPath, value, options = {}) =>
        this.#withCapability("filesystem", "filesystem.writeFile", async () => {
          const resolvedPath = this.#resolveFilesystemPath(targetPath);
          await mkdir(path.dirname(resolvedPath), { recursive: true });
          await writeFile(
            resolvedPath,
            typeof value === "string" ? value : Buffer.from(toUint8Array(value)),
            options.encoding && typeof value === "string" ? options.encoding : undefined,
          );
          return { path: resolvedPath };
        }),
      appendFile: async (targetPath, value, options = {}) =>
        this.#withCapability("filesystem", "filesystem.appendFile", async () => {
          const resolvedPath = this.#resolveFilesystemPath(targetPath);
          await mkdir(path.dirname(resolvedPath), { recursive: true });
          const existing = await readFile(resolvedPath).catch((error) => {
            if (error?.code === "ENOENT") {
              return Buffer.alloc(0);
            }
            throw error;
          });
          const nextChunk =
            typeof value === "string"
              ? Buffer.from(value, options.encoding ?? "utf8")
              : Buffer.from(toUint8Array(value));
          await writeFile(resolvedPath, Buffer.concat([existing, nextChunk]));
          return { path: resolvedPath };
        }),
      deleteFile: async (targetPath) =>
        this.#withCapability("filesystem", "filesystem.deleteFile", async () => {
          const resolvedPath = this.#resolveFilesystemPath(targetPath);
          await rm(resolvedPath, { force: true });
          return { path: resolvedPath };
        }),
      mkdir: async (targetPath, options = {}) =>
        this.#withCapability("filesystem", "filesystem.mkdir", async () => {
          const resolvedPath = this.#resolveFilesystemPath(targetPath);
          await mkdir(resolvedPath, {
            recursive: options.recursive ?? true,
          });
          return { path: resolvedPath };
        }),
      readdir: async (targetPath = ".") =>
        this.#withCapability("filesystem", "filesystem.readdir", async () => {
          const resolvedPath = this.#resolveFilesystemPath(targetPath);
          const entries = await readdir(resolvedPath, { withFileTypes: true });
          return entries
            .map((entry) => ({
              name: entry.name,
              isFile: entry.isFile(),
              isDirectory: entry.isDirectory(),
            }))
            .sort((left, right) => left.name.localeCompare(right.name));
        }),
      stat: async (targetPath) =>
        this.#withCapability("filesystem", "filesystem.stat", async () => {
          const resolvedPath = this.#resolveFilesystemPath(targetPath);
          const metadata = await stat(resolvedPath);
          return {
            path: resolvedPath,
            size: metadata.size,
            isFile: metadata.isFile(),
            isDirectory: metadata.isDirectory(),
            ctimeMs: metadata.ctimeMs,
            mtimeMs: metadata.mtimeMs,
          };
        }),
      rename: async (fromPath, toPath) =>
        this.#withCapability("filesystem", "filesystem.rename", async () => {
          const resolvedFrom = this.#resolveFilesystemPath(fromPath);
          const resolvedTo = this.#resolveFilesystemPath(toPath);
          await mkdir(path.dirname(resolvedTo), { recursive: true });
          await rename(resolvedFrom, resolvedTo);
          return { from: resolvedFrom, to: resolvedTo };
        }),
    });

    this.tcp = Object.freeze({
      request: async (tcpOptions = {}) =>
        this.#withCapability("tcp", "tcp.request", async () => {
          const { host, port } = assertNetworkTargetAllowed(
            "TCP",
            tcpOptions.host,
            tcpOptions.port,
            this.allowedTcpHosts,
            this.allowedTcpPorts,
          );
          return runTcpRequest({
            host,
            port,
            data: tcpOptions.data,
            timeoutMs: tcpOptions.timeoutMs,
            responseEncoding: tcpOptions.responseEncoding,
          });
        }),
    });

    this.udp = Object.freeze({
      request: async (udpOptions = {}) =>
        this.#withCapability("udp", "udp.request", async () => {
          const { host, port } = assertNetworkTargetAllowed(
            "UDP",
            udpOptions.host,
            udpOptions.port,
            this.allowedUdpHosts,
            this.allowedUdpPorts,
          );
          return runUdpRequest({
            host,
            port,
            data: udpOptions.data,
            timeoutMs: udpOptions.timeoutMs,
            responseEncoding: udpOptions.responseEncoding,
            bindAddress: udpOptions.bindAddress,
            bindPort:
              udpOptions.bindPort === undefined
                ? undefined
                : assertPort(udpOptions.bindPort, "UDP bindPort", {
                    allowZero: true,
                  }),
            type: udpOptions.type,
            expectResponse: udpOptions.expectResponse,
          });
        }),
    });

    this.tls = Object.freeze({
      request: async (tlsOptions = {}) =>
        this.#withCapability("tls", "tls.request", async () => {
          const { host, port } = assertNetworkTargetAllowed(
            "TLS",
            tlsOptions.host,
            tlsOptions.port,
            this.allowedTlsHosts,
            this.allowedTlsPorts,
          );
          return runTlsRequest({
            host,
            port,
            data: tlsOptions.data,
            timeoutMs: tlsOptions.timeoutMs,
            responseEncoding: tlsOptions.responseEncoding,
            ca: tlsOptions.ca,
            cert: tlsOptions.cert,
            key: tlsOptions.key,
            rejectUnauthorized: tlsOptions.rejectUnauthorized,
            servername: tlsOptions.servername,
          });
        }),
    });

    this.exec = Object.freeze({
      execFile: async (execOptions = {}) =>
        this.#withCapability("process_exec", "exec.execFile", async () => {
          const file = assertNonEmptyString(execOptions.file, "Executable path");
          if (
            this.allowedCommands &&
            !this.allowedCommands.has(file)
          ) {
            throw new Error(
              `Executable "${file}" is not permitted by this host.`,
            );
          }

          return runExecFile({
            file,
            args: normalizeExecArgs(execOptions.args),
            cwd: execOptions.cwd ?? this.filesystemRoot,
            env:
              execOptions.env && typeof execOptions.env === "object"
                ? { ...process.env, ...execOptions.env }
                : process.env,
            input: execOptions.input,
            timeoutMs: execOptions.timeoutMs,
            encoding: execOptions.encoding,
          });
        }),
    });

    this.context = Object.freeze({
      get: async (scope, key) =>
        this.#withCapability("context_read", "context.get", async () =>
          this._contextStore.get(
            assertNonEmptyString(scope ?? "global", "Context scope"),
            assertNonEmptyString(key, "Context key"),
          ),
        ),
      set: async (scope, key, value) =>
        this.#withCapability("context_write", "context.set", async () =>
          this._contextStore.set(
            assertNonEmptyString(scope ?? "global", "Context scope"),
            assertNonEmptyString(key, "Context key"),
            value,
          ),
        ),
      delete: async (scope, key) =>
        this.#withCapability("context_write", "context.delete", async () =>
          this._contextStore.delete(
            assertNonEmptyString(scope ?? "global", "Context scope"),
            assertNonEmptyString(key, "Context key"),
          ),
        ),
      listKeys: async (scope = "global") =>
        this.#withCapability("context_read", "context.listKeys", async () =>
          this._contextStore.listKeys(
            assertNonEmptyString(scope, "Context scope"),
          ),
        ),
      listScopes: async () =>
        this.#withCapability("context_read", "context.listScopes", async () =>
          this._contextStore.listScopes(),
        ),
    });

    this.ipfs = Object.freeze({
      invoke: async (params = {}) =>
        this.#withCapability("ipfs", "ipfs.invoke", async () => {
          const operation = String(params.operation ?? "invoke").trim();
          if (!operation) {
            throw new Error("ipfs.invoke requires a non-empty operation.");
          }
          return invokeAdapterMethod(this._ipfsAdapter, operation, params, "ipfs");
        }),
    });

    this.protocolHandle = Object.freeze({
      register: async (params = {}) =>
        this.#withCapability(
          "protocol_handle",
          "protocol_handle.register",
          async () =>
            invokeAdapterMethod(
              this._protocolHandleAdapter,
              "register",
              params,
              "protocol_handle",
            ),
        ),
      unregister: async (params = {}) =>
        this.#withCapability(
          "protocol_handle",
          "protocol_handle.unregister",
          async () =>
            invokeAdapterMethod(
              this._protocolHandleAdapter,
              "unregister",
              params,
              "protocol_handle",
            ),
        ),
    });

    this.protocolDial = Object.freeze({
      dial: async (params = {}) =>
        this.#withCapability("protocol_dial", "protocol_dial.dial", async () =>
          invokeAdapterMethod(
            this._protocolDialAdapter,
            "dial",
            params,
            "protocol_dial",
          ),
        ),
    });
  }

  listCapabilities() {
    return Array.from(this._grantedCapabilities).sort();
  }

  listSupportedCapabilities() {
    return Array.from(this._supportedCapabilities).sort();
  }

  listOperations() {
    return [...NodeHostSupportedOperations];
  }

  hasCapability(capability) {
    const normalized = String(capability ?? "").trim();
    return (
      this._grantedCapabilities.has(normalized) ||
      (this._grantedCapabilities.has("network") &&
        ["http", "websocket", "mqtt", "tcp", "udp", "tls"].includes(
          normalized,
        ))
    );
  }

  assertCapability(capability, operation = null) {
    const normalized = assertNonEmptyString(capability, "Capability id");
    const networkBackedCapabilities = new Set([
      "http",
      "websocket",
      "mqtt",
      "tcp",
      "udp",
      "tls",
    ]);
    if (!this._supportedCapabilities.has(normalized)) {
      throw new HostCapabilityError(
        `Capability "${normalized}" is not supported by the reference Node host.`,
        {
          code: "host-capability-unsupported",
          capability: normalized,
          operation,
        },
      );
    }
    if (
      !this._grantedCapabilities.has(normalized) &&
      !(
        this._grantedCapabilities.has("network") &&
        networkBackedCapabilities.has(normalized)
      )
    ) {
      throw new HostCapabilityError(
        `Capability "${normalized}" is not granted for this Node host.`,
        {
          code: "host-capability-denied",
          capability: normalized,
          operation,
        },
      );
    }
    return normalized;
  }

  async invoke(operation, params = {}) {
    const normalized = assertNonEmptyString(operation, "Host operation");
    switch (normalized) {
      case "host.runtimeTarget":
        return this.runtimeTarget;
      case "host.listCapabilities":
        return this.listCapabilities();
      case "host.listSupportedCapabilities":
        return this.listSupportedCapabilities();
      case "host.listOperations":
        return this.listOperations();
      case "host.hasCapability":
        return this.hasCapability(params.capability);
      case "clock.now":
        return this.clock.now();
      case "clock.monotonicNow":
        return this.clock.monotonicNow();
      case "clock.nowIso":
        return this.clock.nowIso();
      case "random.bytes":
        return this.random.bytes(params.length);
      case "timers.delay":
        return this.timers.delay(params.ms ?? params.delayMs, {
          signal: params.signal,
        });
      case "schedule.parse":
        return this.schedule.parse(params.expression);
      case "schedule.matches":
        return this.schedule.matches(params.expression, params.date);
      case "schedule.next":
        return this.schedule.next(params.expression, params.from);
      case "http.request":
        return this.http.request(params);
      case "websocket.exchange":
        return this.websocket.exchange(params);
      case "mqtt.publish":
        return this.mqtt.publish(params);
      case "mqtt.subscribeOnce":
        return this.mqtt.subscribeOnce(params);
      case "network.request":
        return this.network.request(params);
      case "filesystem.resolvePath":
        return this.filesystem.resolvePath(params.path);
      case "filesystem.readFile":
        return this.filesystem.readFile(params.path, {
          encoding: params.encoding,
        });
      case "filesystem.writeFile":
        return this.filesystem.writeFile(params.path, params.value, {
          encoding: params.encoding,
        });
      case "filesystem.appendFile":
        return this.filesystem.appendFile(params.path, params.value, {
          encoding: params.encoding,
        });
      case "filesystem.deleteFile":
        return this.filesystem.deleteFile(params.path);
      case "filesystem.mkdir":
        return this.filesystem.mkdir(params.path, {
          recursive: params.recursive,
        });
      case "filesystem.readdir":
        return this.filesystem.readdir(params.path);
      case "filesystem.stat":
        return this.filesystem.stat(params.path);
      case "filesystem.rename":
        return this.filesystem.rename(params.fromPath, params.toPath);
      case "tcp.request":
        return this.tcp.request(params);
      case "udp.request":
        return this.udp.request(params);
      case "tls.request":
        return this.tls.request(params);
      case "ipfs.invoke":
        return this.ipfs.invoke(params);
      case "protocol_handle.register":
        return this.protocolHandle.register(params);
      case "protocol_handle.unregister":
        return this.protocolHandle.unregister(params);
      case "protocol_dial.dial":
        return this.protocolDial.dial(params);
      case "exec.execFile":
        return this.exec.execFile(params);
      case "context.get":
        return this.context.get(params.scope, params.key);
      case "context.set":
        return this.context.set(params.scope, params.key, params.value);
      case "context.delete":
        return this.context.delete(params.scope, params.key);
      case "context.listKeys":
        return this.context.listKeys(params.scope);
      case "context.listScopes":
        return this.context.listScopes();
      case "crypto.sha256":
        return this.crypto.sha256(params.value ?? params.bytes);
      case "crypto.sha512":
        return this.crypto.sha512(params.value ?? params.bytes);
      case "crypto.hkdf":
        return this.crypto.hkdf(params);
      case "crypto.aesGcmEncrypt":
        return this.crypto.aesGcmEncrypt(params);
      case "crypto.aesGcmDecrypt":
        return this.crypto.aesGcmDecrypt(params);
      case "crypto.x25519.generateKeypair":
        return this.crypto.generateX25519Keypair();
      case "crypto.x25519.publicKey":
        return this.crypto.x25519PublicKey(params.privateKey);
      case "crypto.x25519.sharedSecret":
        return this.crypto.x25519SharedSecret(
          params.privateKey,
          params.publicKey,
        );
      case "crypto.sealedBox.encryptForRecipient":
        return this.crypto.encryptForRecipient(params);
      case "crypto.sealedBox.decryptFromEnvelope":
        return this.crypto.decryptFromEnvelope(params);
      case "crypto.secp256k1.publicKeyFromPrivate":
        return this.crypto.secp256k1.publicKeyFromPrivate(params.privateKey);
      case "crypto.secp256k1.signDigest":
        return this.crypto.secp256k1.signDigest(
          params.digest,
          params.privateKey,
        );
      case "crypto.secp256k1.verifyDigest":
        return this.crypto.secp256k1.verifyDigest(
          params.digest,
          params.signature,
          params.publicKey,
        );
      case "crypto.ed25519.publicKeyFromSeed":
        return this.crypto.ed25519.publicKeyFromSeed(params.seed);
      case "crypto.ed25519.sign":
        return this.crypto.ed25519.sign(params.message, params.seed);
      case "crypto.ed25519.verify":
        return this.crypto.ed25519.verify(
          params.message,
          params.signature,
          params.publicKey,
        );
      default:
        throw new Error(`Unknown Node host operation "${normalized}".`);
    }
  }

  crypto = Object.freeze({
    sha256: async (value) =>
      this.#withCapability("crypto_hash", "crypto.sha256", async () =>
        sha256Bytes(toUint8Array(value)),
      ),
    sha512: async (value) =>
      this.#withCapability("crypto_hash", "crypto.sha512", async () =>
        sha512Bytes(toUint8Array(value)),
      ),
    hkdf: async (options = {}) =>
      this.#withCapability("crypto_kdf", "crypto.hkdf", async () =>
        hkdfBytes(
          toUint8Array(options.ikm),
          toUint8Array(options.salt),
          toUint8Array(options.info ?? new Uint8Array()),
          assertNonNegativeInteger(options.length, "HKDF length"),
        ),
      ),
    aesGcmEncrypt: async (options = {}) =>
      this.#withCapability("crypto_encrypt", "crypto.aesGcmEncrypt", async () =>
        aesGcmEncrypt(
          toUint8Array(options.key),
          toUint8Array(options.plaintext),
          toUint8Array(options.iv),
          options.aad === undefined || options.aad === null
            ? null
            : toUint8Array(options.aad),
        ),
      ),
    aesGcmDecrypt: async (options = {}) =>
      this.#withCapability("crypto_decrypt", "crypto.aesGcmDecrypt", async () =>
        aesGcmDecrypt(
          toUint8Array(options.key),
          toUint8Array(options.ciphertext),
          toUint8Array(options.tag),
          toUint8Array(options.iv),
          options.aad === undefined || options.aad === null
            ? null
            : toUint8Array(options.aad),
        ),
      ),
    generateX25519Keypair: async () =>
      this.#withCapability(
        "crypto_key_agreement",
        "crypto.x25519.generateKeypair",
        async () => generateX25519Keypair(),
      ),
    x25519PublicKey: async (privateKey) =>
      this.#withCapability(
        "crypto_key_agreement",
        "crypto.x25519.publicKey",
        async () => x25519PublicKey(toUint8Array(privateKey)),
      ),
    x25519SharedSecret: async (privateKey, publicKey) =>
      this.#withCapability(
        "crypto_key_agreement",
        "crypto.x25519.sharedSecret",
        async () =>
          x25519SharedSecret(
            toUint8Array(privateKey),
            toUint8Array(publicKey),
          ),
      ),
    encryptForRecipient: async (options = {}) =>
      this.#withCapability(
        "crypto_encrypt",
        "crypto.sealedBox.encryptForRecipient",
        async () =>
          encryptBytesForRecipient({
            plaintext: toUint8Array(options.plaintext),
            recipientPublicKey: toUint8Array(options.recipientPublicKey),
            context: options.context,
            senderKeyPair: options.senderKeyPair,
          }),
      ),
    decryptFromEnvelope: async (options = {}) =>
      this.#withCapability(
        "crypto_decrypt",
        "crypto.sealedBox.decryptFromEnvelope",
        async () =>
          decryptBytesFromEnvelope({
            envelope: options.envelope,
            recipientPrivateKey: toUint8Array(options.recipientPrivateKey),
          }),
      ),
    secp256k1: Object.freeze({
      publicKeyFromPrivate: async (privateKey) =>
        this.#withCapability(
          "crypto_sign",
          "crypto.secp256k1.publicKeyFromPrivate",
          async () => secp256k1PublicKey(toUint8Array(privateKey)),
        ),
      signDigest: async (digest, privateKey) =>
        this.#withCapability(
          "crypto_sign",
          "crypto.secp256k1.signDigest",
          async () =>
            secp256k1SignDigest(
              toUint8Array(digest),
              toUint8Array(privateKey),
            ),
        ),
      verifyDigest: async (digest, signature, publicKey) =>
        this.#withCapability(
          "crypto_verify",
          "crypto.secp256k1.verifyDigest",
          async () =>
            secp256k1VerifyDigest(
              toUint8Array(digest),
              toUint8Array(signature),
              toUint8Array(publicKey),
            ),
        ),
    }),
    ed25519: Object.freeze({
      publicKeyFromSeed: async (seed) =>
        this.#withCapability(
          "crypto_sign",
          "crypto.ed25519.publicKeyFromSeed",
          async () => ed25519PublicKey(toUint8Array(seed)),
        ),
      sign: async (message, seed) =>
        this.#withCapability(
          "crypto_sign",
          "crypto.ed25519.sign",
          async () => ed25519Sign(toUint8Array(message), toUint8Array(seed)),
        ),
      verify: async (message, signature, publicKey) =>
        this.#withCapability(
          "crypto_verify",
          "crypto.ed25519.verify",
          async () =>
            ed25519Verify(
              toUint8Array(message),
              toUint8Array(signature),
              toUint8Array(publicKey),
            ),
        ),
    }),
  });

  #resolveFilesystemPath(targetPath) {
    const requestedPath = assertNonEmptyString(targetPath, "Filesystem path");
    const resolvedPath = path.resolve(this.filesystemRoot, requestedPath);
    const rootWithSeparator = this.filesystemRoot.endsWith(path.sep)
      ? this.filesystemRoot
      : `${this.filesystemRoot}${path.sep}`;
    if (
      resolvedPath !== this.filesystemRoot &&
      !resolvedPath.startsWith(rootWithSeparator)
    ) {
      throw new HostFilesystemScopeError(
        `Path "${requestedPath}" escapes the configured filesystem root.`,
        {
          requestedPath,
          filesystemRoot: this.filesystemRoot,
        },
      );
    }
    return resolvedPath;
  }

  #withCapability(capability, operation, callback) {
    this.assertCapability(capability, operation);
    return callback();
  }
}

export function createNodeHost(options = {}) {
  return new NodeHost(options);
}
