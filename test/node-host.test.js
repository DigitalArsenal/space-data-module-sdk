import dgram from "node:dgram";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import nodeTls from "node:tls";

import {
  HostCapabilityError,
  HostFilesystemScopeError,
  createNodeHost,
} from "../src/index.js";
import { bytesToHex } from "../src/utils/encoding.js";

const TEST_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIDGjCCAgKgAwIBAgIUXyl+62iiajfhMAyHMjUfrmt8Q6MwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDMxNzE4NDQyMloXDTI3MDMx
NzE4NDQyMlowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA3UatX9+rXpEHFb0jbql8xBoB1Go+TvCThscnZRyyIbn0
fLSjMEy4SsacBVZ9AH3KO9WS/sJPunDQtNQg1dyvm7wqf+4OsnON8u7jX3Fy1kA5
m1bTlT3bTYima9GiOXxxTeG+6B/AI82zYGF/ykZapeR0eNaFfKdk/qQ6oPOKKjQy
9g0p2m9hKzCP8+fyvydTPC2sHR0o1kdjVuCp1h5Rn8X/Zg73RqWOjasvtaB5ZpNK
CibzMIjJw1YKTMgcumMke+8jZ2/KbIMay6Z1wcezwHOu13opiqyA4OEYKJww/AmK
kFCQhyj9YuF94mZlCoB1svo/4++ExJq9tZfKBpSgKQIDAQABo2QwYjAdBgNVHQ4E
FgQUyRZ5MTbg/ynQqCKvsucxrtwbupEwHwYDVR0jBBgwFoAUyRZ5MTbg/ynQqCKv
sucxrtwbupEwDwYDVR0TAQH/BAUwAwEB/zAPBgNVHREECDAGhwR/AAABMA0GCSqG
SIb3DQEBCwUAA4IBAQBtKoaqkt1qOu19WDUBXG5rAZuVSYYPtfCfVLGVXmt7T9h1
x+JQNw/oQm/KzSx9Ura3HznsHQcDIz1syzQWU13Hv7wYt8uaZC0O7NXfXAFl0VWJ
Yxi75EzCKoWnrPW5uTnowajU71qe+45hUw9XedoTG+Qld+xcw1d8/5wVEiruG2aO
kS8K6m83lA00XXb6VPPOZhkUme11J/m0NxmDPyItbIg0jQYKBIItSIdo3wGDUpTj
XYmGfpllNqW2esEM0IVmP97lCrUffDQuxxrNznLLn2jTYsyUAy8CsV3rkfa2REZV
rsu7CN8LPr/KPFKvo4K5P/10Dn+zcuV4NOHgPEc8
-----END CERTIFICATE-----`;

const TEST_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDdRq1f36tekQcV
vSNuqXzEGgHUaj5O8JOGxydlHLIhufR8tKMwTLhKxpwFVn0Afco71ZL+wk+6cNC0
1CDV3K+bvCp/7g6yc43y7uNfcXLWQDmbVtOVPdtNiKZr0aI5fHFN4b7oH8AjzbNg
YX/KRlql5HR41oV8p2T+pDqg84oqNDL2DSnab2ErMI/z5/K/J1M8LawdHSjWR2NW
4KnWHlGfxf9mDvdGpY6Nqy+1oHlmk0oKJvMwiMnDVgpMyBy6YyR77yNnb8psgxrL
pnXBx7PAc67XeimKrIDg4RgonDD8CYqQUJCHKP1i4X3iZmUKgHWy+j/j74TEmr21
l8oGlKApAgMBAAECggEARkg8qUcR12eZKH560pti1aatDhrwz4H6WcTH7oW+zpeR
4Eo/yweTQazzwX5HFfDeW0Lq/aAaUs2ifM0j4MnHvV924Etsv6GUZKUb8yTFpOeh
ZIWfjrenAGl28qgTLs8n7eTWDkSHctfTMbnGLSlLgYWeuQLqQz2oBnmDZbv1FpIG
ZriZPk9EXUKVcQrF1xvHsv7SogiY+8tHIk344+/+OcnCWaFMpWrzhhGijQNH3Mdo
mTX5jSu9hDFMI8qtBFtRUpaaV5lJJaulVEwaLbN71BGAKCKavI19ZzK0HaxOEunU
glr+PmXDEeB4axduJYrI6t8ab8Jmbz6jfjAByv42QQKBgQD8sBEoZvCe+SGHkyDk
fUQYgTgEZmXyA4G6PFQeLQKCckZGaI2MfkOe0IF80UC/o4Xa4al9lbvPoL/Oa2TB
01XdFqgp2NgpyujErKbzX+aCpaYmPK1uwnl9Lj0vnHdAytiLOS6nhWkCOXMWjXu/
zJC88oby37ya0TdUSN2KJgHN7wKBgQDgLTQWBvgiQ0oH8J1zxLiLa/lTF2Olv6IC
RWHnuev3l6hOGf4X2/dffiHrL3gQu/pH/jOi0tDH9Ypsa6KCRM852BguUF4pNCOM
O+fqWqC68uQcQwFt2sqaXgbxM2UjXMcK/y5/BzXUTcpdvpW5JzKknIoPozq1ZHg8
ZyzFWZaLZwKBgQDsGM5PQ697uic795p6IxjnFIV0hwCl2eTyT8AA2elIXOGQk8v+
A1PHJeZ260VmSbGdy8+Dic4Lt5S/l9RyzbWid7L0NqnykqZebTsoluhYFdJiU7tw
i8Db18JPpBBAt8cQfoM6/woYi/kej1+a29Y41RqF/8rHlMfvto1YsR5qfQKBgQDN
BWpqbstGgqXVJyDI/PQORpyKeoyezOj9DLlitW3yTZgWfb0d0wWlJvUcY5h6LYDT
kM9mrUlWZuDHEZVZcFbZPyG2UbgcFNwh57PNaD8xWux2UG2hK4U5sp7Ev01TDwnW
q9S5Rj3bwZ0/KQtDf27Yj3XQoWcS+CTikTWn86w0JwKBgQCS8bjIyX4tYs5qcUkT
6dqZ5EgmoKfmSCwhzZLvrhrlwORuRj71MZPn12BHgCVesbDDGjpBQqdK79BSr0s/
ZYvF1kFI5Hy9LnGCZd1YCQHSmoHzxsXoNgMEGLwzLBDErQRgVhEOQUyuRLCJeJS9
ivLPMsWjndv+HMImd1i4VXNWRQ==
-----END PRIVATE KEY-----`;

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

async function withTempDir(callback) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "space-data-module-sdk-host-"));
  try {
    return await callback(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function createWebSocketAcceptValue(key) {
  return createHash("sha1")
    .update(`${key}${WEBSOCKET_GUID}`)
    .digest("base64");
}

function decodeWebSocketFrame(buffer) {
  let offset = 0;
  const firstByte = buffer[offset++];
  const secondByte = buffer[offset++];
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;

  if (payloadLength === 126) {
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    payloadLength = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  let maskingKey = null;
  if (masked) {
    maskingKey = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  const payload = Buffer.from(buffer.subarray(offset, offset + payloadLength));
  if (masked && maskingKey) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= maskingKey[index % 4];
    }
  }

  return {
    opcode,
    payload,
  };
}

function encodeWebSocketFrame(payload, opcode = 1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header = null;

  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }

  return Buffer.concat([header, body]);
}

function encodeMqttRemainingLength(length) {
  const bytes = [];
  let value = length;
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
  const bytes = Buffer.from(value, "utf8");
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

function parseMqttPackets(buffer) {
  const packets = [];
  let offset = 0;

  while (offset < buffer.length) {
    const start = offset;
    if (offset + 2 > buffer.length) {
      break;
    }
    const header = buffer[offset++];
    let multiplier = 1;
    let remainingLength = 0;
    let encodedByte = 0;
    let encodedBytes = 0;

    do {
      if (offset >= buffer.length) {
        return {
          packets,
          remaining: buffer.subarray(start),
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
        remaining: buffer.subarray(start),
      };
    }

    packets.push({
      header,
      type: header >> 4,
      body: buffer.subarray(offset, offset + remainingLength),
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

function parseMqttSubscribePacket(packet) {
  const packetId = packet.body.readUInt16BE(0);
  const topic = decodeMqttString(packet.body, 2);
  return {
    packetId,
    topic: topic.value,
    qos: packet.body[topic.nextOffset],
  };
}

function createMqttConnackPacket(returnCode = 0) {
  return encodeMqttPacket(0x20, Buffer.from([0x00, returnCode]));
}

function createMqttSubackPacket(packetId, qos = 0) {
  const id = Buffer.alloc(2);
  id.writeUInt16BE(packetId, 0);
  return encodeMqttPacket(0x90, id, Buffer.from([qos]));
}

function createMqttPublishPacket(topic, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  return encodeMqttPacket(0x30, encodeMqttString(topic), body);
}

async function withWebSocketServer(messageHandler, callback) {
  const server = http.createServer();
  server.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }

    const accept = createWebSocketAcceptValue(String(key));
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );

    socket.once("data", (chunk) => {
      const frame = decodeWebSocketFrame(chunk);
      messageHandler(socket, frame);
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await callback({
      origin: `ws://127.0.0.1:${address.port}`,
      url: `ws://127.0.0.1:${address.port}/socket`,
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function withMqttBroker(packetHandler, callback) {
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      const parsed = parseMqttPackets(buffer);
      buffer = parsed.remaining;
      for (const packet of parsed.packets) {
        packetHandler(socket, packet);
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await callback({
      host: "127.0.0.1",
      port: address.port,
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function withTcpServer(connectionHandler, callback) {
  const server = net.createServer(connectionHandler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await callback({
      host: "127.0.0.1",
      port: address.port,
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function withUdpServer(messageHandler, callback) {
  const socket = dgram.createSocket("udp4");
  socket.on("message", (message, rinfo) => {
    messageHandler(socket, message, rinfo);
  });
  await new Promise((resolve) => socket.bind(0, "127.0.0.1", resolve));
  const address = socket.address();
  try {
    return await callback({
      host: "127.0.0.1",
      port: address.port,
    });
  } finally {
    await new Promise((resolve) => socket.close(resolve));
  }
}

async function withTlsServer(connectionHandler, callback) {
  const server = nodeTls.createServer(
    {
      key: TEST_TLS_KEY,
      cert: TEST_TLS_CERT,
    },
    connectionHandler,
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await callback({
      host: "127.0.0.1",
      port: address.port,
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("node host enforces granted capabilities", async () => {
  const host = createNodeHost({
    capabilities: ["clock"],
  });

  assert.equal(host.clock.now() > 0, true);
  assert.equal(host.hasCapability("filesystem"), false);

  await assert.rejects(
    () => host.http.request({ url: "http://example.com" }),
    (error) =>
      error instanceof HostCapabilityError &&
      error.code === "host-capability-denied" &&
      error.capability === "http",
  );
});

test("node host filesystem stays scoped to the configured root", async () => {
  await withTempDir(async (tempDir) => {
    const host = createNodeHost({
      capabilities: ["filesystem"],
      filesystemRoot: tempDir,
    });

    await host.filesystem.writeFile("data/example.txt", "alpha");
    await host.filesystem.appendFile("data/example.txt", "-beta");
    const fileText = await host.filesystem.readFile("data/example.txt", {
      encoding: "utf8",
    });
    const stat = await host.filesystem.stat("data/example.txt");
    const listing = await host.filesystem.readdir("data");
    const renamed = await host.filesystem.rename(
      "data/example.txt",
      "data/example-renamed.txt",
    );

    assert.equal(fileText, "alpha-beta");
    assert.equal(stat.isFile, true);
    assert.equal(listing.some((entry) => entry.name === "example.txt"), true);
    assert.equal(renamed.to.endsWith("example-renamed.txt"), true);

    await assert.rejects(
      () => host.filesystem.readFile("../escape.txt"),
      (error) => error instanceof HostFilesystemScopeError,
    );
  });
});

test("node host context store persists across instances", async () => {
  await withTempDir(async (tempDir) => {
    const contextFilePath = path.join(tempDir, "context", "state.json");
    const writerHost = createNodeHost({
      capabilities: ["context_read", "context_write"],
      contextFilePath,
    });

    await writerHost.context.set("global", "counter", { value: 3 });
    assert.deepEqual(await writerHost.context.listScopes(), ["global"]);
    assert.deepEqual(await writerHost.context.listKeys("global"), ["counter"]);

    const readerHost = createNodeHost({
      capabilities: ["context_read"],
      contextFilePath,
    });
    assert.deepEqual(await readerHost.context.get("global", "counter"), {
      value: 3,
    });
    await assert.rejects(
      () => readerHost.context.set("global", "counter", { value: 4 }),
      (error) =>
        error instanceof HostCapabilityError &&
        error.capability === "context_write",
    );
  });
});

test("node host cron helpers parse, match, and compute next occurrence", () => {
  const host = createNodeHost({
    capabilities: ["schedule_cron"],
  });
  const schedule = host.schedule.parse("*/15 9-17 * * MON-FRI");
  const mondayMorning = new Date(2026, 2, 16, 9, 15, 0, 0);
  const mondayOffMinute = new Date(2026, 2, 16, 9, 14, 0, 0);
  const next = host.schedule.next("*/15 9-17 * * MON-FRI", mondayOffMinute);

  assert.deepEqual(schedule.minute.values, [0, 15, 30, 45]);
  assert.equal(host.schedule.matches(schedule, mondayMorning), true);
  assert.equal(host.schedule.matches(schedule, mondayOffMinute), false);
  assert.equal(next.getHours(), 9);
  assert.equal(next.getMinutes(), 15);
  assert.equal(next.getDay(), 1);
});

test("node host http client enforces origin allowlists", async () => {
  await withServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        method: request.method,
        url: request.url,
      }),
    );
  }, async (baseUrl) => {
    const host = createNodeHost({
      capabilities: ["http"],
      allowedHttpOrigins: [baseUrl],
    });

    const response = await host.http.request({
      url: `${baseUrl}/status`,
      responseType: "json",
    });

    assert.equal(response.ok, true);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      method: "GET",
      url: "/status",
    });

    await assert.rejects(
      () =>
        host.http.request({
          url: "https://example.com/blocked",
          responseType: "text",
        }),
      /not permitted by this host/,
    );
  });
});

test("node host exposes random, timer, crypto, and invoke helpers", async () => {
  const host = createNodeHost({
    capabilities: ["clock", "random", "timers", "crypto_hash"],
  });

  const before = host.clock.monotonicNow();
  await host.timers.delay(20);
  const after = host.clock.monotonicNow();
  const random = host.random.bytes(16);
  const digest = await host.invoke("crypto.sha256", {
    bytes: new TextEncoder().encode("abc"),
  });

  assert.equal(random instanceof Uint8Array, true);
  assert.equal(random.length, 16);
  assert.equal(after >= before, true);
  assert.equal(bytesToHex(digest), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.deepEqual(host.listOperations().includes("filesystem.readFile"), true);
});

test("node host exec service runs allowlisted commands", async () => {
  const host = createNodeHost({
    capabilities: ["process_exec"],
    allowedCommands: [process.execPath],
  });

  const result = await host.exec.execFile({
    file: process.execPath,
    args: [
      "-e",
      "process.stdout.write('ok'); process.stderr.write('warn');",
    ],
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "ok");
  assert.equal(result.stderr, "warn");

  await assert.rejects(
    () =>
      host.invoke("exec.execFile", {
        file: "/bin/echo",
        args: ["blocked"],
      }),
    /not permitted by this host/,
  );
});

test("node host tcp and udp request helpers honor network allowlists", async () => {
  await withTcpServer((socket) => {
    socket.on("data", (chunk) => {
      socket.end(Buffer.from(`tcp:${chunk.toString("utf8")}`));
    });
  }, async (tcpAddress) => {
    await withUdpServer((socket, message, rinfo) => {
      const response = Buffer.from(`udp:${message.toString("utf8")}`);
      socket.send(response, rinfo.port, rinfo.address);
    }, async (udpAddress) => {
      const tcpHost = createNodeHost({
        capabilities: ["tcp"],
        allowedTcpHosts: [tcpAddress.host],
        allowedTcpPorts: [tcpAddress.port],
      });
      const udpHost = createNodeHost({
        capabilities: ["udp"],
        allowedUdpHosts: [udpAddress.host],
        allowedUdpPorts: [udpAddress.port],
      });

      const tcpResponse = await tcpHost.tcp.request({
        host: tcpAddress.host,
        port: tcpAddress.port,
        data: "ping",
        responseEncoding: "utf8",
      });
      const udpResponse = await udpHost.udp.request({
        host: udpAddress.host,
        port: udpAddress.port,
        data: "pong",
        responseEncoding: "utf8",
      });

      assert.equal(tcpResponse.body, "tcp:ping");
      assert.equal(udpResponse.body, "udp:pong");

      await assert.rejects(
        () =>
          tcpHost.tcp.request({
            host: tcpAddress.host,
            port: tcpAddress.port + 1,
            data: "blocked",
          }),
        /not permitted by this host/,
      );
      await assert.rejects(
        () =>
          udpHost.invoke("udp.request", {
            host: "localhost",
            port: udpAddress.port,
            data: "blocked",
          }),
        /not permitted by this host/,
      );
    });
  });
});

test("node host crypto helpers cover hash, KDF, sealing, and signatures", async () => {
  const host = createNodeHost({
    capabilities: [
      "crypto_hash",
      "crypto_sign",
      "crypto_verify",
      "crypto_encrypt",
      "crypto_decrypt",
      "crypto_key_agreement",
      "crypto_kdf",
    ],
  });

  const encoder = new TextEncoder();
  const digest256 = await host.crypto.sha256(encoder.encode("abc"));
  const digest512 = await host.crypto.sha512(encoder.encode("abc"));
  const hkdf = await host.crypto.hkdf({
    ikm: Uint8Array.from([1, 2, 3, 4]),
    salt: new Uint8Array(32),
    info: encoder.encode("ctx"),
    length: 32,
  });
  const iv = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  const encrypted = await host.crypto.aesGcmEncrypt({
    key: hkdf,
    plaintext: encoder.encode("sealed"),
    iv,
  });
  const decrypted = await host.crypto.aesGcmDecrypt({
    key: hkdf,
    ciphertext: encrypted.ciphertext,
    tag: encrypted.tag,
    iv,
  });
  const x25519 = await host.crypto.generateX25519Keypair();
  const envelope = await host.crypto.encryptForRecipient({
    plaintext: encoder.encode("secret"),
    recipientPublicKey: x25519.publicKey,
  });
  const opened = await host.crypto.decryptFromEnvelope({
    envelope,
    recipientPrivateKey: x25519.privateKey,
  });

  const secpPrivateKey = new Uint8Array(32);
  secpPrivateKey[31] = 1;
  const secpPublicKey =
    await host.crypto.secp256k1.publicKeyFromPrivate(secpPrivateKey);
  const secpSignature = await host.crypto.secp256k1.signDigest(
    digest256,
    secpPrivateKey,
  );
  const secpVerified = await host.crypto.secp256k1.verifyDigest(
    digest256,
    secpSignature,
    secpPublicKey,
  );

  const edSeed = new Uint8Array(32);
  edSeed[0] = 7;
  const edPublicKey = await host.crypto.ed25519.publicKeyFromSeed(edSeed);
  const edSignature = await host.crypto.ed25519.sign(
    encoder.encode("ed25519"),
    edSeed,
  );
  const edVerified = await host.crypto.ed25519.verify(
    encoder.encode("ed25519"),
    edSignature,
    edPublicKey,
  );

  assert.equal(
    bytesToHex(digest256),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    bytesToHex(digest512),
    "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a"
      + "2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
  );
  assert.equal(bytesToHex(decrypted), bytesToHex(encoder.encode("sealed")));
  assert.equal(bytesToHex(opened), bytesToHex(encoder.encode("secret")));
  assert.equal(secpVerified, true);
  assert.equal(edVerified, true);
  assert.equal(hkdf.length, 32);
});

test("node host tls request helper validates certificates and allowlists", async () => {
  await withTlsServer((socket) => {
    socket.on("data", (chunk) => {
      socket.end(Buffer.from(`tls:${chunk.toString("utf8")}`));
    });
  }, async (tlsAddress) => {
    const host = createNodeHost({
      capabilities: ["tls"],
      allowedTlsHosts: [tlsAddress.host],
      allowedTlsPorts: [tlsAddress.port],
    });

    const response = await host.tls.request({
      host: tlsAddress.host,
      port: tlsAddress.port,
      data: "hello",
      responseEncoding: "utf8",
      ca: TEST_TLS_CERT,
    });

    assert.equal(response.authorized, true);
    assert.equal(response.authorizationError, null);
    assert.equal(response.body, "tls:hello");

    await assert.rejects(
      () =>
        host.tls.request({
          host: tlsAddress.host,
          port: tlsAddress.port + 1,
          data: "blocked",
        }),
      /not permitted by this host/,
    );
  });
});

test(
  "node host websocket exchange helper honors origin allowlists",
  {
    skip:
      typeof globalThis.WebSocket !== "function"
        ? "WebSocket is not available in this Node runtime."
        : false,
  },
  async () => {
    await withWebSocketServer((socket, frame) => {
      assert.equal(frame.opcode, 1);
      socket.write(
        encodeWebSocketFrame(Buffer.from(`ws:${frame.payload.toString("utf8")}`)),
      );
      socket.end(encodeWebSocketFrame(Buffer.alloc(0), 8));
    }, async (websocketAddress) => {
      const host = createNodeHost({
        capabilities: ["websocket"],
        allowedWebSocketOrigins: [websocketAddress.origin],
      });

      const response = await host.websocket.exchange({
        url: websocketAddress.url,
        message: "hello",
        responseType: "utf8",
        timeoutMs: 500,
      });

      assert.equal(response.url, websocketAddress.url);
      assert.equal(response.body, "ws:hello");

      await assert.rejects(
        () =>
          host.invoke("websocket.exchange", {
            url: "ws://127.0.0.1:9/blocked",
            message: "blocked",
          }),
        /not permitted by this host/,
      );
    });
  },
);

test("node host mqtt helpers honor broker allowlists", async () => {
  let published = null;
  let resolvePublished = null;
  const publishedPromise = new Promise((resolve) => {
    resolvePublished = resolve;
  });

  await withMqttBroker((socket, packet) => {
    if (packet.type === 1) {
      socket.write(createMqttConnackPacket());
      return;
    }
    if (packet.type === 3) {
      published = parseMqttPublishPacket(packet);
      resolvePublished();
      return;
    }
    if (packet.type === 8) {
      const subscription = parseMqttSubscribePacket(packet);
      socket.write(createMqttSubackPacket(subscription.packetId));
      socket.write(
        createMqttPublishPacket(subscription.topic, Buffer.from("mqtt:reply")),
      );
      return;
    }
    if (packet.type === 14) {
      socket.end();
    }
  }, async (mqttAddress) => {
    const host = createNodeHost({
      capabilities: ["mqtt"],
      allowedMqttHosts: [mqttAddress.host],
      allowedMqttPorts: [mqttAddress.port],
    });

    const publishResult = await host.mqtt.publish({
      host: mqttAddress.host,
      port: mqttAddress.port,
      topic: "demo/out",
      payload: "hello",
      timeoutMs: 500,
    });
    await publishedPromise;

    const subscribeResult = await host.mqtt.subscribeOnce({
      host: mqttAddress.host,
      port: mqttAddress.port,
      topic: "demo/in",
      responseType: "utf8",
      timeoutMs: 500,
    });

    assert.equal(publishResult.payloadBytes, 5);
    assert.equal(published.topic, "demo/out");
    assert.equal(published.payload.toString("utf8"), "hello");
    assert.equal(subscribeResult.topic, "demo/in");
    assert.equal(subscribeResult.body, "mqtt:reply");

    await assert.rejects(
      () =>
        host.invoke("mqtt.publish", {
          host: mqttAddress.host,
          port: mqttAddress.port + 1,
          topic: "blocked/out",
        }),
      /not permitted by this host/,
    );
  });
});
