/**
 * Browser host adapter for the SDN host contract.
 *
 * Mirrors the NodeHost public interface using browser-native Web APIs.
 * Plugs into createJsonHostcallBridge() exactly like NodeHost does.
 */

import { RuntimeTarget } from "../runtime/constants.js";
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
  "crypto_encrypt",
  "crypto_decrypt",
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
  "protocol_handle.register",
  "protocol_handle.unregister",
  "protocol_dial.dial",
  "context.get",
  "context.set",
  "context.delete",
  "context.listKeys",
  "context.listScopes",
  "crypto.sha256",
  "crypto.sha512",
  "crypto.aesGcmEncrypt",
  "crypto.aesGcmDecrypt",
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
  };
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
    const fetchImpl = edgeShims.fetch;
    const WebSocketImpl = edgeShims.WebSocket;
    const filesystem = edgeShims.filesystem;
    const networkAdapter = edgeShims.network;
    const ipfsAdapter = edgeShims.ipfs;
    const protocolHandleAdapter = edgeShims.protocolHandle;
    const protocolDialAdapter = edgeShims.protocolDial;

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
      sha256: async (data) => {
        this.#assertCapability("crypto_hash", "crypto.sha256");
        if (!cryptoApi?.subtle) {
          throw new Error("No Web Crypto subtle implementation is available.");
        }
        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
        return new Uint8Array(await cryptoApi.subtle.digest("SHA-256", bytes));
      },
      sha512: async (data) => {
        this.#assertCapability("crypto_hash", "crypto.sha512");
        if (!cryptoApi?.subtle) {
          throw new Error("No Web Crypto subtle implementation is available.");
        }
        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
        return new Uint8Array(await cryptoApi.subtle.digest("SHA-512", bytes));
      },
      aesGcmEncrypt: async (params) => {
        this.#assertCapability("crypto_encrypt", "crypto.aesGcmEncrypt");
        if (!cryptoApi?.subtle || !cryptoApi?.getRandomValues) {
          throw new Error("No Web Crypto implementation is available.");
        }
        const key = await cryptoApi.subtle.importKey(
          "raw",
          params.key,
          { name: "AES-GCM" },
          false,
          ["encrypt"],
        );
        const iv = params.iv ?? cryptoApi.getRandomValues(new Uint8Array(12));
        const ciphertext = new Uint8Array(
          await cryptoApi.subtle.encrypt({ name: "AES-GCM", iv }, key, params.plaintext),
        );
        return { ciphertext, iv };
      },
      aesGcmDecrypt: async (params) => {
        this.#assertCapability("crypto_decrypt", "crypto.aesGcmDecrypt");
        if (!cryptoApi?.subtle) {
          throw new Error("No Web Crypto subtle implementation is available.");
        }
        const key = await cryptoApi.subtle.importKey(
          "raw",
          params.key,
          { name: "AES-GCM" },
          false,
          ["decrypt"],
        );
        return new Uint8Array(
          await cryptoApi.subtle.decrypt(
            { name: "AES-GCM", iv: params.iv },
            key,
            params.ciphertext,
          ),
        );
      },
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
      case "protocol_handle.register":
        return this.protocolHandle.register(params);
      case "protocol_handle.unregister":
        return this.protocolHandle.unregister(params);
      case "protocol_dial.dial":
        return this.protocolDial.dial(params);
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
      case "crypto.aesGcmEncrypt":
        return this.crypto.aesGcmEncrypt(params);
      case "crypto.aesGcmDecrypt":
        return this.crypto.aesGcmDecrypt(params);
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
