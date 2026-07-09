/**
 * Browser host adapter for the SDN host contract.
 *
 * Mirrors the NodeHost public interface using browser-native Web APIs.
 * Plugs into createHostcallBridge() exactly like NodeHost does.
 */

import { RuntimeTarget } from "../runtime/constants.js";
import {
  base64ToBytes,
  bytesToBase64,
  hexToBytes,
  toUint8Array,
} from "../utils/encoding.js";
import { derSignatureToRaw, rawSignatureToDer } from "../utils/ecdsaDer.js";
import {
  parseCronExpression,
  matchesCronExpression,
  nextCronOccurrence,
} from "./cron.js";
import { createBrowserEdgeShims } from "./browserEdgeShims.js";

export const BrowserHostSupportedCapabilities = Object.freeze([
  "clock",
  "random",
  "timers",
  "schedule_cron",
  "http",
  "websocket",
  "network",
  "filesystem",
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
  "wallet_sign",
  "pubsub",
  "storage_query",
  "storage_write",
  "logging",
]);

export const BrowserHostSupportedOperations = Object.freeze([
  "host.runtimeTarget",
  "host.listCapabilities",
  "host.listSupportedCapabilities",
  "host.listOperations",
  "host.hasCapability",
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
  "ipfs.invoke",
  "ipfs.add",
  "ipfs.cat",
  "protocol_handle.register",
  "protocol_handle.unregister",
  "protocol_dial.dial",
  "protocol.request",
  "keyslot.sign",
  "keyslot.unwrap",
  "storage.write",
  "storage.query",
  "storage.delete",
  "pubsub.publish",
  "pubsub.subscribe",
  "pubsub.unsubscribe",
  "pubsub.list_topics",
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
  "crypto.secp256k1.publicKeyFromPrivate",
  "crypto.secp256k1.sign",
  "crypto.secp256k1.verify",
  "crypto.ed25519.publicKeyFromSeed",
  "crypto.ed25519.sign",
  "crypto.ed25519.verify",
]);

export class BrowserHostCapabilityError extends Error {
  constructor(capability, operation, message) {
    super(message ?? `Capability "${capability}" is not available in this host.`);
    this.name = "BrowserHostCapabilityError";
    this.capability = capability;
    this.operation = operation;
  }
}

function normalizeBrowserNetworkTransport(params = {}) {
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
    const protocol = new URL(candidateUrl, "https://browser-host.invalid")
      .protocol.toLowerCase();
    if (protocol === "http:" || protocol === "https:") {
      return "http";
    }
    if (protocol === "ws:" || protocol === "wss:") {
      return "websocket";
    }
  }
  throw new Error(
    'network.request requires a transport value such as "http" or "websocket".',
  );
}

function resolveCapabilityAdapters(options = {}) {
  const adapters =
    options.capabilityAdapters && typeof options.capabilityAdapters === "object"
      ? options.capabilityAdapters
      : {};
  return {
    filesystem: options.filesystem ?? adapters.filesystem ?? null,
    network: options.network ?? adapters.network ?? null,
    ipfs: options.ipfs ?? adapters.ipfs ?? null,
    walletSign:
      options.walletSign ??
      adapters.walletSign ??
      adapters.wallet_sign ??
      adapters.keyslot ??
      null,
    protocolHandle:
      options.protocolHandle ??
      adapters.protocolHandle ??
      adapters.protocol_handle ??
      null,
    protocolDial:
      options.protocolDial ??
      adapters.protocolDial ??
      adapters.protocol_dial ??
      null,
    storage:
      options.storage ??
      adapters.storage ??
      adapters.storage_write ??
      adapters.storage_query ??
      null,
    pubsub: options.pubsub ?? adapters.pubsub ?? null,
  };
}

function normalizeCryptoBytes(value) {
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  return toUint8Array(value);
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

// keyslotUnwrapHKDFInfo domain-separates the HKDF step of keyslot.unwrap from
// every other HKDF use in this host (e.g. crypto.hkdf). Must match the Go
// reference implementation's keyslotUnwrapHKDFInfo constant
// (sdn-server/internal/modulert/caps/keyslot.go) exactly, or wrapped
// payloads produced against one host will fail to unwrap on the other.
const KEYSLOT_UNWRAP_HKDF_INFO = "sdn-server/keyslot.unwrap/v1";
const keyslotTextEncoder = new TextEncoder();

// normalizeKeySlotMaterial accepts the raw key-slot secret returned by a
// host-supplied walletSign adapter's internal "get" resolver and coerces it
// to a Uint8Array. This resolver is never exposed to the guest directly
// (there is no "keyslot.get" hostcall) — it only feeds the host-side
// keyslot.sign / keyslot.unwrap crypto oracle below, mirroring Go's
// resolveKeySlot() in keyslot.go. Callers MUST NOT return the result of this
// function, or any encoding of it, to the guest.
function normalizeKeySlotMaterial(raw) {
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw);
  }
  if (ArrayBuffer.isView(raw)) {
    return toUint8Array(raw);
  }
  if (typeof raw === "string") {
    return base64ToBytes(raw);
  }
  if (raw && typeof raw === "object") {
    if (raw.base64 !== undefined) {
      return base64ToBytes(raw.base64);
    }
    if (raw.hex !== undefined) {
      return hexToBytes(raw.hex);
    }
    if (raw.value !== undefined) {
      return normalizeKeySlotMaterial(raw.value);
    }
    if (raw.bytes !== undefined) {
      return normalizeKeySlotMaterial(raw.bytes);
    }
  }
  throw new Error(
    "wallet_sign adapter returned an unrecognized key-slot material shape.",
  );
}

async function resolveKeySlotMaterial(walletSignAdapter, slotId) {
  const normalizedSlotId = String(slotId ?? "").trim();
  if (!normalizedSlotId) {
    throw new Error("slotId is required.");
  }
  const record = await invokeAdapterMethod(
    walletSignAdapter,
    "get",
    { slotId: normalizedSlotId },
    "wallet_sign",
  );
  const material = normalizeKeySlotMaterial(record);
  if (material.length === 0) {
    throw new Error(`keyslot "${normalizedSlotId}" not found`);
  }
  return material;
}

// keyslotSign performs a host-side signature over a guest-supplied payload
// using the named slot's private key. Request:
//   {slotId, payload: base64, algorithm?: "ed25519" | "secp256k1"}
// algorithm defaults to "ed25519". Response: {signature: base64, algorithm}.
// The slot's key material never appears in the response. Mirrors
// handleKeyslotSign() in keyslot.go.
async function keyslotSign(walletSignAdapter, wasmWallet, params = {}) {
  const slotId = String(params.slotId ?? "").trim();
  if (!slotId) {
    throw new Error("slotId is required.");
  }
  const keyMaterial = await resolveKeySlotMaterial(walletSignAdapter, slotId);
  const payload =
    params.payload === undefined || params.payload === null
      ? new Uint8Array()
      : base64ToBytes(String(params.payload));
  const algorithm = String(params.algorithm ?? "").trim() || "ed25519";

  if (algorithm === "ed25519") {
    if (!wasmWallet?.curves?.ed25519?.sign) {
      throw new Error(
        "Browser host keyslot.sign requires a preloaded wasmWallet.",
      );
    }
    if (keyMaterial.length !== 32) {
      throw new Error(`keyslot "${slotId}" is not a 32-byte ed25519 seed`);
    }
    const signature = new Uint8Array(
      wasmWallet.curves.ed25519.sign(payload, keyMaterial),
    );
    return { signature: bytesToBase64(signature), algorithm: "ed25519" };
  }

  if (algorithm === "secp256k1") {
    if (!wasmWallet?.utils?.sha256 || !wasmWallet?.curves?.secp256k1?.sign) {
      throw new Error(
        "Browser host keyslot.sign requires a preloaded wasmWallet.",
      );
    }
    if (keyMaterial.length !== 32) {
      throw new Error(
        `keyslot "${slotId}" is not a 32-byte secp256k1 private key`,
      );
    }
    const digest = new Uint8Array(wasmWallet.utils.sha256(payload));
    const rawSignature = new Uint8Array(
      wasmWallet.curves.secp256k1.sign(digest, keyMaterial),
    );
    return {
      signature: bytesToBase64(rawSignatureToDer(rawSignature)),
      algorithm: "secp256k1",
    };
  }

  throw new Error(`unsupported keyslot.sign algorithm: ${algorithm}`);
}

// keyslotUnwrap decrypts a payload that was sealed to a slot's X25519 public
// key, returning only the decrypted plaintext (e.g. a licensing content key)
// — never the slot's private key. Wrap scheme is ephemeral-sender ECIES:
// X25519(slotPrivateKey, ephemeralPublicKey) -> HKDF-SHA256 -> AES-256-GCM.
// Request:
//   {slotId, ephemeralPublicKey: base64, nonce: base64, ciphertext: base64}
// Response: {plaintext: base64}. Mirrors handleKeyslotUnwrap() in
// keyslot.go, including the wire format where `ciphertext` is
// (ciphertext || 16-byte GCM tag), per Go's crypto/cipher.GCM convention.
async function keyslotUnwrap(walletSignAdapter, wasmWallet, params = {}) {
  const slotId = String(params.slotId ?? "").trim();
  if (!slotId) {
    throw new Error("slotId is required.");
  }
  if (
    !wasmWallet?.curves?.x25519?.ecdh ||
    !wasmWallet?.utils?.hkdf ||
    !wasmWallet?.utils?.aesGcm?.decrypt
  ) {
    throw new Error(
      "Browser host keyslot.unwrap requires a preloaded wasmWallet.",
    );
  }
  const keyMaterial = await resolveKeySlotMaterial(walletSignAdapter, slotId);
  if (keyMaterial.length !== 32) {
    throw new Error(
      `keyslot "${slotId}" is not a 32-byte x25519 private key`,
    );
  }

  const ephemeralPublicKey = base64ToBytes(
    String(params.ephemeralPublicKey ?? ""),
  );
  const nonce = base64ToBytes(String(params.nonce ?? ""));
  const wireCiphertext = base64ToBytes(String(params.ciphertext ?? ""));
  if (ephemeralPublicKey.length === 0 || wireCiphertext.length === 0) {
    throw new Error(
      "keyslot.unwrap requires ephemeralPublicKey and ciphertext",
    );
  }
  if (wireCiphertext.length < 16) {
    throw new Error(
      "keyslot.unwrap ciphertext is too short to contain a GCM tag",
    );
  }
  const tagStart = wireCiphertext.length - 16;
  const ciphertext = wireCiphertext.subarray(0, tagStart);
  const tag = wireCiphertext.subarray(tagStart);

  const sharedSecret = new Uint8Array(
    wasmWallet.curves.x25519.ecdh(keyMaterial, ephemeralPublicKey),
  );
  const aesKey = new Uint8Array(
    wasmWallet.utils.hkdf(
      sharedSecret,
      new Uint8Array(),
      keyslotTextEncoder.encode(KEYSLOT_UNWRAP_HKDF_INFO),
      32,
    ),
  );
  const plaintext = new Uint8Array(
    wasmWallet.utils.aesGcm.decrypt(aesKey, ciphertext, tag, nonce),
  );
  return { plaintext: bytesToBase64(plaintext) };
}

export class BrowserHost {
  constructor(options = {}) {
    this.runtimeTarget = RuntimeTarget.BROWSER;
    const capabilityAdapters = resolveCapabilityAdapters(options);

    const granted = options.capabilities
      ? new Set(options.capabilities)
      : new Set(BrowserHostSupportedCapabilities);
    const edgeShims = createBrowserEdgeShims({
      ...options.edgeShims,
      fetch: options.fetch ?? options.edgeShims?.fetch,
      WebSocket: options.WebSocket ?? options.edgeShims?.WebSocket,
      crypto: options.crypto ?? options.edgeShims?.crypto,
      performance: options.performance ?? options.edgeShims?.performance,
      capabilityAdapters,
      network: capabilityAdapters.network ?? options.edgeShims?.network,
      ipfs: capabilityAdapters.ipfs ?? options.edgeShims?.ipfs,
      protocolHandle:
        capabilityAdapters.protocolHandle ?? options.edgeShims?.protocolHandle,
      protocolDial:
        capabilityAdapters.protocolDial ?? options.edgeShims?.protocolDial,
      filesystem:
        capabilityAdapters.filesystem ?? options.edgeShims?.filesystem,
      filesystemRoot: options.filesystemRoot ?? options.edgeShims?.filesystemRoot,
    });
    const performanceApi = edgeShims.performance ?? {
      now: () => Date.now(),
      timeOrigin: 0,
    };
    const cryptoApi = edgeShims.crypto;
    const wasmWallet = options.wasmWallet ?? null;
    const fetchImpl = edgeShims.fetch;
    const WebSocketImpl = edgeShims.WebSocket;
    const filesystem = edgeShims.filesystem;
    const networkAdapter = edgeShims.network;
    const ipfsAdapter = edgeShims.ipfs;
    const walletSignAdapter = capabilityAdapters.walletSign;
    const protocolHandleAdapter = edgeShims.protocolHandle;
    const protocolDialAdapter = edgeShims.protocolDial;
    const storageAdapter = capabilityAdapters.storage;
    const pubsubAdapter = capabilityAdapters.pubsub;

    this._grantedCapabilities = granted;
    this._contextStore = options.contextStore ?? new Map();
    this.filesystemRoot = filesystem?.filesystemRoot ?? "/";

    // --- Capability objects (frozen, browser-native) ---

    this.clock = Object.freeze({
      now: () => {
        this.#assertCapability("clock", "clock.now");
        return Date.now();
      },
      monotonicNow: () => {
        this.#assertCapability("clock", "clock.monotonicNow");
        return performanceApi.now();
      },
      nowIso: () => {
        this.#assertCapability("clock", "clock.nowIso");
        return new Date().toISOString();
      },
    });

    this.random = Object.freeze({
      bytes: (length) => {
        this.#assertCapability("random", "random.bytes");
        if (!cryptoApi?.getRandomValues) {
          throw new Error("No crypto.getRandomValues implementation is available.");
        }
        const len = Number(length) || 32;
        const buf = new Uint8Array(len);
        cryptoApi.getRandomValues(buf);
        return buf;
      },
    });

    this.timers = Object.freeze({
      delay: (ms) => {
        this.#assertCapability("timers", "timers.delay");
        return new Promise((resolve) => setTimeout(resolve, ms));
      },
    });

    this.schedule = Object.freeze({
      parse: (expression) => {
        this.#assertCapability("schedule_cron", "schedule.parse");
        return parseCronExpression(expression);
      },
      matches: (expression, date) => {
        this.#assertCapability("schedule_cron", "schedule.matches");
        return matchesCronExpression(expression, date ? new Date(date) : new Date());
      },
      next: (expression, from) => {
        this.#assertCapability("schedule_cron", "schedule.next");
        return nextCronOccurrence(expression, from ? new Date(from) : new Date());
      },
    });

    this.http = Object.freeze({
      request: async (params) => {
        this.#assertCapability("http", "http.request");
        if (typeof fetchImpl !== "function") {
          throw new Error("No fetch implementation is available for the browser host.");
        }
        const controller = new AbortController();
        const timeout = params.timeoutMs
          ? setTimeout(() => controller.abort(), params.timeoutMs)
          : null;
        try {
          const response = await fetchImpl(params.url, {
            method: params.method ?? "GET",
            headers: params.headers ?? undefined,
            body: params.body ?? undefined,
            signal: controller.signal,
          });
          const responseType = params.responseType ?? "utf8";
          let body;
          if (responseType === "json") body = await response.json();
          else if (responseType === "bytes") body = new Uint8Array(await response.arrayBuffer());
          else body = await response.text();
          return {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            headers: Object.fromEntries(response.headers.entries()),
            body,
          };
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      },
    });

    this.websocket = Object.freeze({
      exchange: async (params) => {
        this.#assertCapability("websocket", "websocket.exchange");
        if (!WebSocketImpl) {
          throw new Error("No WebSocket implementation is available for the browser host.");
        }
        return new Promise((resolve, reject) => {
          const ws = new WebSocketImpl(params.url, params.protocols ?? undefined);
          const timeout = params.timeoutMs
            ? setTimeout(() => {
                ws.close();
                reject(new Error("WebSocket exchange timed out."));
              }, params.timeoutMs)
            : null;

          ws.onopen = () => {
            if (params.message != null) ws.send(params.message);
            if (!params.expectResponse) {
              if (timeout) clearTimeout(timeout);
              ws.close();
              resolve({
                url: params.url,
                protocol: ws.protocol ?? "",
                extensions: ws.extensions ?? "",
                closeCode: null,
                closeReason: "",
                body: null,
              });
            }
          };
          ws.onmessage = (event) => {
            if (timeout) clearTimeout(timeout);
            ws.close();
            resolve({
              url: params.url,
              protocol: ws.protocol ?? "",
              extensions: ws.extensions ?? "",
              closeCode: null,
              closeReason: "",
              body: event.data,
            });
          };
          ws.onerror = (event) => {
            if (timeout) clearTimeout(timeout);
            reject(new Error(`WebSocket error: ${event.type}`));
          };
        });
      },
    });

    this.network = Object.freeze({
      request: async (params = {}) => {
        this.#assertCapability("network", "network.request");
        const transport = normalizeBrowserNetworkTransport(params);
        const request = params.request ?? params;
        if (networkAdapter) {
          return invokeAdapterMethod(networkAdapter, "request", {
            ...request,
            transport,
          }, "network");
        }
        if (transport === "http") {
          return this.http.request(request);
        }
        if (transport === "websocket") {
          return this.websocket.exchange(request);
        }
        throw new Error(
          `Browser host does not support network transport "${transport}".`,
        );
      },
    });

    this.ipfs = Object.freeze({
      invoke: async (params = {}) => {
        this.#assertCapability("ipfs", "ipfs.invoke");
        const operation = String(params.operation ?? "invoke").trim();
        if (!operation) {
          throw new Error("ipfs.invoke requires a non-empty operation.");
        }
        return invokeAdapterMethod(ipfsAdapter, operation, params, "ipfs");
      },
      add: async (params = {}) => {
        this.#assertCapability("ipfs", "ipfs.add");
        return invokeAdapterMethod(ipfsAdapter, "add", params, "ipfs");
      },
      cat: async (params = {}) => {
        this.#assertCapability("ipfs", "ipfs.cat");
        return invokeAdapterMethod(ipfsAdapter, "cat", params, "ipfs");
      },
    });

    this.protocolHandle = Object.freeze({
      register: async (params = {}) => {
        this.#assertCapability("protocol_handle", "protocol_handle.register");
        return invokeAdapterMethod(
          protocolHandleAdapter,
          "register",
          params,
          "protocol_handle",
        );
      },
      unregister: async (params = {}) => {
        this.#assertCapability("protocol_handle", "protocol_handle.unregister");
        return invokeAdapterMethod(
          protocolHandleAdapter,
          "unregister",
          params,
          "protocol_handle",
        );
      },
    });

    this.protocolDial = Object.freeze({
      dial: async (params = {}) => {
        this.#assertCapability("protocol_dial", "protocol_dial.dial");
        return invokeAdapterMethod(
          protocolDialAdapter,
          "dial",
          params,
          "protocol_dial",
        );
      },
      request: async (params = {}) => {
        this.#assertCapability("protocol_dial", "protocol.request");
        return invokeAdapterMethod(
          protocolDialAdapter,
          "request",
          params,
          "protocol_dial",
        );
      },
    });

    // keyslot is a host-side crypto oracle (parity with the Go node's
    // internal/modulert/caps/keyslot.go): it never returns a slot's private
    // key material to the guest. Guests get the *outputs* of private-key
    // operations (a signature, or the plaintext that was wrapped to a
    // slot's public key) — never the key itself. There is no "keyslot.get"
    // raw-export operation; unknown keyslot operations fail closed via the
    // default branch of invoke()'s switch below.
    this.keyslot = Object.freeze({
      sign: async (params = {}) => {
        this.#assertCapability("wallet_sign", "keyslot.sign");
        return keyslotSign(walletSignAdapter, wasmWallet, params);
      },
      unwrap: async (params = {}) => {
        this.#assertCapability("wallet_sign", "keyslot.unwrap");
        return keyslotUnwrap(walletSignAdapter, wasmWallet, params);
      },
    });

    // Storage + pubsub mirror the Go node's module capability contract
    // (sdn-server internal/modulert/caps): storage.write {schema, data:base64}
    // -> {cid}; storage.query {schema, day, entity_id, norad_cat_id, limit};
    // storage.delete {schema, cid}; pubsub.publish {topic, data:utf8};
    // pubsub.subscribe/unsubscribe {topic}; pubsub.list_topics {} -> {topics}.
    this.storage = Object.freeze({
      write: async (params = {}) => {
        this.#assertCapability("storage_write", "storage.write");
        return invokeAdapterMethod(storageAdapter, "write", params, "storage");
      },
      query: async (params = {}) => {
        this.#assertCapability("storage_query", "storage.query");
        return invokeAdapterMethod(storageAdapter, "query", params, "storage");
      },
      delete: async (params = {}) => {
        this.#assertCapability("storage_write", "storage.delete");
        return invokeAdapterMethod(storageAdapter, "delete", params, "storage");
      },
    });

    this.pubsub = Object.freeze({
      publish: async (params = {}) => {
        this.#assertCapability("pubsub", "pubsub.publish");
        return invokeAdapterMethod(pubsubAdapter, "publish", params, "pubsub");
      },
      subscribe: async (params = {}) => {
        this.#assertCapability("pubsub", "pubsub.subscribe");
        return invokeAdapterMethod(pubsubAdapter, "subscribe", params, "pubsub");
      },
      unsubscribe: async (params = {}) => {
        this.#assertCapability("pubsub", "pubsub.unsubscribe");
        return invokeAdapterMethod(pubsubAdapter, "unsubscribe", params, "pubsub");
      },
      listTopics: async (params = {}) => {
        this.#assertCapability("pubsub", "pubsub.list_topics");
        return invokeAdapterMethod(pubsubAdapter, "list_topics", params, "pubsub");
      },
    });

    this.context = Object.freeze({
      get: (scope, key) => {
        this.#assertCapability("context_read", "context.get");
        const scopeMap = this._contextStore.get(scope);
        return scopeMap ? (scopeMap.get(key) ?? null) : null;
      },
      set: (scope, key, value) => {
        this.#assertCapability("context_write", "context.set");
        if (!this._contextStore.has(scope)) this._contextStore.set(scope, new Map());
        this._contextStore.get(scope).set(key, value);
      },
      delete: (scope, key) => {
        this.#assertCapability("context_write", "context.delete");
        const scopeMap = this._contextStore.get(scope);
        if (scopeMap) scopeMap.delete(key);
      },
      listKeys: (scope) => {
        this.#assertCapability("context_read", "context.listKeys");
        const scopeMap = this._contextStore.get(scope);
        return scopeMap ? [...scopeMap.keys()] : [];
      },
      listScopes: () => {
        this.#assertCapability("context_read", "context.listScopes");
        return [...this._contextStore.keys()];
      },
    });

    this.crypto = Object.freeze({
      sha256: (data) => {
        this.#assertCapability("crypto_hash", "crypto.sha256");
        if (!wasmWallet?.utils?.sha256) {
          throw new Error("Browser host crypto.sha256 requires a preloaded wasmWallet.");
        }
        return new Uint8Array(wasmWallet.utils.sha256(normalizeCryptoBytes(data)));
      },
      sha512: (data) => {
        this.#assertCapability("crypto_hash", "crypto.sha512");
        if (!wasmWallet?.utils?.sha512) {
          throw new Error("Browser host crypto.sha512 requires a preloaded wasmWallet.");
        }
        return new Uint8Array(wasmWallet.utils.sha512(normalizeCryptoBytes(data)));
      },
      hkdf: (params = {}) => {
        this.#assertCapability("crypto_kdf", "crypto.hkdf");
        if (!wasmWallet?.utils?.hkdf) {
          throw new Error("Browser host crypto.hkdf requires a preloaded wasmWallet.");
        }
        return new Uint8Array(
          wasmWallet.utils.hkdf(
            toUint8Array(params.ikm),
            toUint8Array(params.salt),
            params.info === undefined || params.info === null
              ? new Uint8Array()
              : toUint8Array(params.info),
            Number(params.length ?? 0),
          ),
        );
      },
      aesGcmEncrypt: (params = {}) => {
        this.#assertCapability("crypto_encrypt", "crypto.aesGcmEncrypt");
        if (!wasmWallet?.utils?.aesGcm?.encrypt) {
          throw new Error(
            "Browser host crypto.aesGcmEncrypt requires a preloaded wasmWallet.",
          );
        }
        const iv =
          params.iv === undefined || params.iv === null
            ? new Uint8Array(wasmWallet.utils.getRandomBytes(12))
            : toUint8Array(params.iv);
        const result = wasmWallet.utils.aesGcm.encrypt(
          toUint8Array(params.key),
          toUint8Array(params.plaintext),
          iv,
          params.aad === undefined || params.aad === null
            ? undefined
            : toUint8Array(params.aad),
        );
        return {
          ciphertext: new Uint8Array(result.ciphertext),
          tag: new Uint8Array(result.tag),
          iv,
        };
      },
      aesGcmDecrypt: (params = {}) => {
        this.#assertCapability("crypto_decrypt", "crypto.aesGcmDecrypt");
        if (!wasmWallet?.utils?.aesGcm?.decrypt) {
          throw new Error(
            "Browser host crypto.aesGcmDecrypt requires a preloaded wasmWallet.",
          );
        }
        return new Uint8Array(
          wasmWallet.utils.aesGcm.decrypt(
            toUint8Array(params.key),
            toUint8Array(params.ciphertext),
            toUint8Array(params.tag),
            toUint8Array(params.iv),
            params.aad === undefined || params.aad === null
              ? undefined
              : toUint8Array(params.aad),
          ),
        );
      },
      generateX25519Keypair: () => {
        this.#assertCapability(
          "crypto_key_agreement",
          "crypto.x25519.generateKeypair",
        );
        if (!wasmWallet?.curves?.x25519 || !wasmWallet?.utils?.getRandomBytes) {
          throw new Error(
            "Browser host crypto.x25519.generateKeypair requires a preloaded wasmWallet.",
          );
        }
        const privateKey = new Uint8Array(wasmWallet.utils.getRandomBytes(32));
        const publicKey = new Uint8Array(
          wasmWallet.curves.x25519.publicKey(privateKey),
        );
        return { privateKey, publicKey };
      },
      x25519PublicKey: (privateKey) => {
        this.#assertCapability("crypto_key_agreement", "crypto.x25519.publicKey");
        if (!wasmWallet?.curves?.x25519?.publicKey) {
          throw new Error(
            "Browser host crypto.x25519.publicKey requires a preloaded wasmWallet.",
          );
        }
        return new Uint8Array(
          wasmWallet.curves.x25519.publicKey(toUint8Array(privateKey)),
        );
      },
      x25519SharedSecret: (privateKey, publicKey) => {
        this.#assertCapability("crypto_key_agreement", "crypto.x25519.sharedSecret");
        if (!wasmWallet?.curves?.x25519?.ecdh) {
          throw new Error(
            "Browser host crypto.x25519.sharedSecret requires a preloaded wasmWallet.",
          );
        }
        return new Uint8Array(
          wasmWallet.curves.x25519.ecdh(
            toUint8Array(privateKey),
            toUint8Array(publicKey),
          ),
        );
      },
      secp256k1: Object.freeze({
        publicKeyFromPrivate: (privateKey) => {
          this.#assertCapability(
            "crypto_sign",
            "crypto.secp256k1.publicKeyFromPrivate",
          );
          if (!wasmWallet?.curves?.publicKeyFromPrivate) {
            throw new Error(
              "Browser host crypto.secp256k1.publicKeyFromPrivate requires a preloaded wasmWallet.",
            );
          }
          return new Uint8Array(
            wasmWallet.curves.publicKeyFromPrivate(toUint8Array(privateKey)),
          );
        },
        sign: (message, privateKey) => {
          this.#assertCapability("crypto_sign", "crypto.secp256k1.sign");
          if (
            !wasmWallet?.utils?.sha256 ||
            !wasmWallet?.curves?.secp256k1?.sign
          ) {
            throw new Error(
              "Browser host crypto.secp256k1.sign requires a preloaded wasmWallet.",
            );
          }
          const digest = new Uint8Array(
            wasmWallet.utils.sha256(toUint8Array(message)),
          );
          const rawSignature = new Uint8Array(
            wasmWallet.curves.secp256k1.sign(digest, toUint8Array(privateKey)),
          );
          return rawSignatureToDer(rawSignature);
        },
        verify: (message, signature, publicKey) => {
          this.#assertCapability("crypto_verify", "crypto.secp256k1.verify");
          if (
            !wasmWallet?.utils?.sha256 ||
            !wasmWallet?.curves?.secp256k1?.verify
          ) {
            throw new Error(
              "Browser host crypto.secp256k1.verify requires a preloaded wasmWallet.",
            );
          }
          const digest = new Uint8Array(
            wasmWallet.utils.sha256(toUint8Array(message)),
          );
          const result = wasmWallet.curves.secp256k1.verify(
            digest,
            derSignatureToRaw(signature),
            toUint8Array(publicKey),
          );
          return { result: Boolean(result) };
        },
      }),
      ed25519: Object.freeze({
        publicKeyFromSeed: (seed) => {
          this.#assertCapability("crypto_sign", "crypto.ed25519.publicKeyFromSeed");
          if (!wasmWallet?.curves?.ed25519?.publicKeyFromSeed) {
            throw new Error(
              "Browser host crypto.ed25519.publicKeyFromSeed requires a preloaded wasmWallet.",
            );
          }
          return new Uint8Array(
            wasmWallet.curves.ed25519.publicKeyFromSeed(toUint8Array(seed)),
          );
        },
        sign: (message, seed) => {
          this.#assertCapability("crypto_sign", "crypto.ed25519.sign");
          if (!wasmWallet?.curves?.ed25519?.sign) {
            throw new Error(
              "Browser host crypto.ed25519.sign requires a preloaded wasmWallet.",
            );
          }
          return new Uint8Array(
            wasmWallet.curves.ed25519.sign(
              toUint8Array(message),
              toUint8Array(seed),
            ),
          );
        },
        verify: (message, signature, publicKey) => {
          this.#assertCapability("crypto_verify", "crypto.ed25519.verify");
          if (!wasmWallet?.curves?.ed25519?.verify) {
            throw new Error(
              "Browser host crypto.ed25519.verify requires a preloaded wasmWallet.",
            );
          }
          return wasmWallet.curves.ed25519.verify(
            toUint8Array(message),
            toUint8Array(signature),
            toUint8Array(publicKey),
          );
        },
      }),
    });

    this.filesystem = Object.freeze({
      resolvePath: (path) => {
        this.#assertCapability("filesystem", "filesystem.resolvePath");
        return filesystem.resolvePath(path);
      },
      readFile: async (path, options) => {
        this.#assertCapability("filesystem", "filesystem.readFile");
        return filesystem.readFile(path, options);
      },
      writeFile: async (path, value, options) => {
        this.#assertCapability("filesystem", "filesystem.writeFile");
        return filesystem.writeFile(path, value, options);
      },
      appendFile: async (path, value, options) => {
        this.#assertCapability("filesystem", "filesystem.appendFile");
        return filesystem.appendFile(path, value, options);
      },
      deleteFile: async (path) => {
        this.#assertCapability("filesystem", "filesystem.deleteFile");
        return filesystem.deleteFile(path);
      },
      mkdir: async (path, options) => {
        this.#assertCapability("filesystem", "filesystem.mkdir");
        return filesystem.mkdir(path, options);
      },
      readdir: async (path = ".") => {
        this.#assertCapability("filesystem", "filesystem.readdir");
        return filesystem.readdir(path);
      },
      stat: async (path) => {
        this.#assertCapability("filesystem", "filesystem.stat");
        return filesystem.stat(path);
      },
      rename: async (fromPath, toPath) => {
        this.#assertCapability("filesystem", "filesystem.rename");
        return filesystem.rename(fromPath, toPath);
      },
    });
  }

  // --- Public interface (mirrors NodeHost) ---

  listCapabilities() {
    return [...this._grantedCapabilities];
  }

  listSupportedCapabilities() {
    return [...BrowserHostSupportedCapabilities];
  }

  listOperations() {
    return [...BrowserHostSupportedOperations];
  }

  hasCapability(capability) {
    const normalized = String(capability ?? "").trim();
    return (
      this._grantedCapabilities.has(normalized) ||
      (this._grantedCapabilities.has("network") &&
        ["http", "websocket"].includes(normalized))
    );
  }

  assertCapability(capability, operation) {
    this.#assertCapability(capability, operation);
  }

  async invoke(operation, params = {}) {
    const normalized = String(operation ?? "").trim();
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
        return this.timers.delay(params.ms ?? params.delayMs ?? 0);
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
      case "ipfs.invoke":
        return this.ipfs.invoke(params);
      case "ipfs.add":
        return this.ipfs.add(params);
      case "ipfs.cat":
        return this.ipfs.cat(params);
      case "protocol_handle.register":
        return this.protocolHandle.register(params);
      case "protocol_handle.unregister":
        return this.protocolHandle.unregister(params);
      case "protocol_dial.dial":
        return this.protocolDial.dial(params);
      case "protocol.request":
        return this.protocolDial.request(params);
      case "keyslot.sign":
        return this.keyslot.sign(params);
      case "keyslot.unwrap":
        return this.keyslot.unwrap(params);
      case "storage.write":
        return this.storage.write(params);
      case "storage.query":
        return this.storage.query(params);
      case "storage.delete":
        return this.storage.delete(params);
      case "pubsub.publish":
        return this.pubsub.publish(params);
      case "pubsub.subscribe":
        return this.pubsub.subscribe(params);
      case "pubsub.unsubscribe":
        return this.pubsub.unsubscribe(params);
      case "pubsub.list_topics":
        return this.pubsub.listTopics(params);
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
      case "crypto.secp256k1.publicKeyFromPrivate":
        return this.crypto.secp256k1.publicKeyFromPrivate(params.privateKey);
      case "crypto.secp256k1.sign":
        return this.crypto.secp256k1.sign(params.message, params.privateKey);
      case "crypto.secp256k1.verify":
        return this.crypto.secp256k1.verify(
          params.message,
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
        throw new Error(`Unknown browser host operation "${normalized}".`);
    }
  }

  // --- Private ---

  #assertCapability(capability, operation) {
    const normalized = String(capability ?? "").trim();
    const networkBackedCapabilities = new Set([
      "http",
      "websocket",
    ]);
    if (
      !this._grantedCapabilities.has(normalized) &&
      !(
        this._grantedCapabilities.has("network") &&
        networkBackedCapabilities.has(normalized)
      )
    ) {
      throw new BrowserHostCapabilityError(capability, operation);
    }
  }
}

export function createBrowserHost(options = {}) {
  return new BrowserHost(options);
}
