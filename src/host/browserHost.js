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

export const BrowserHostSupportedCapabilities = Object.freeze([
  "clock",
  "random",
  "timers",
  "schedule_cron",
  "http",
  "websocket",
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
  "schedule.parse",
  "schedule.matches",
  "schedule.next",
  "http.request",
  "websocket.exchange",
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

export class HostCapabilityError extends Error {
  constructor(capability, operation, message) {
    super(message ?? `Capability "${capability}" is not available in this host.`);
    this.name = "HostCapabilityError";
    this.capability = capability;
    this.operation = operation;
  }
}

export class BrowserHost {
  constructor(options = {}) {
    this.runtimeTarget = RuntimeTarget.BROWSER;

    const granted = options.capabilities
      ? new Set(options.capabilities)
      : new Set(BrowserHostSupportedCapabilities);
    this._grantedCapabilities = granted;
    this._contextStore = new Map();

    // --- Capability objects (frozen, browser-native) ---

    this.clock = Object.freeze({
      now: () => {
        this.#assertCapability("clock", "clock.now");
        return Date.now();
      },
      monotonicNow: () => {
        this.#assertCapability("clock", "clock.monotonicNow");
        return performance.now();
      },
      nowIso: () => {
        this.#assertCapability("clock", "clock.nowIso");
        return new Date().toISOString();
      },
    });

    this.random = Object.freeze({
      bytes: (length) => {
        this.#assertCapability("random", "random.bytes");
        const len = Number(length) || 32;
        const buf = new Uint8Array(len);
        crypto.getRandomValues(buf);
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
        const controller = new AbortController();
        const timeout = params.timeoutMs
          ? setTimeout(() => controller.abort(), params.timeoutMs)
          : null;
        try {
          const response = await fetch(params.url, {
            method: params.method ?? "GET",
            headers: params.headers ?? undefined,
            body: params.body ?? undefined,
            signal: controller.signal,
          });
          const responseType = params.responseType ?? "text";
          let body;
          if (responseType === "json") body = await response.json();
          else if (responseType === "bytes") body = new Uint8Array(await response.arrayBuffer());
          else body = await response.text();
          return {
            status: response.status,
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
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(params.url, params.protocols ?? undefined);
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
              resolve({ sent: true });
            }
          };
          ws.onmessage = (event) => {
            if (timeout) clearTimeout(timeout);
            ws.close();
            resolve({ sent: true, response: event.data });
          };
          ws.onerror = (event) => {
            if (timeout) clearTimeout(timeout);
            reject(new Error(`WebSocket error: ${event.type}`));
          };
        });
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
        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
        return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      },
      sha512: async (data) => {
        this.#assertCapability("crypto_hash", "crypto.sha512");
        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
        return new Uint8Array(await crypto.subtle.digest("SHA-512", bytes));
      },
      aesGcmEncrypt: async (params) => {
        this.#assertCapability("crypto_encrypt", "crypto.aesGcmEncrypt");
        const key = await crypto.subtle.importKey(
          "raw",
          params.key,
          { name: "AES-GCM" },
          false,
          ["encrypt"],
        );
        const iv = params.iv ?? crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = new Uint8Array(
          await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, params.plaintext),
        );
        return { ciphertext, iv };
      },
      aesGcmDecrypt: async (params) => {
        this.#assertCapability("crypto_decrypt", "crypto.aesGcmDecrypt");
        const key = await crypto.subtle.importKey(
          "raw",
          params.key,
          { name: "AES-GCM" },
          false,
          ["decrypt"],
        );
        return new Uint8Array(
          await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: params.iv },
            key,
            params.ciphertext,
          ),
        );
      },
    });

    // filesystem stub — browser cannot resolve paths, but the sync ABI lists it
    this.filesystem = Object.freeze({
      resolvePath: () => {
        throw new HostCapabilityError(
          "filesystem",
          "filesystem.resolvePath",
          "Filesystem is not available in the browser host.",
        );
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
    return this._grantedCapabilities.has(capability);
  }

  assertCapability(capability, operation) {
    this.#assertCapability(capability, operation);
  }

  // --- Private ---

  #assertCapability(capability, operation) {
    if (!this._grantedCapabilities.has(capability)) {
      throw new HostCapabilityError(capability, operation);
    }
  }
}

export function createBrowserHost(options = {}) {
  return new BrowserHost(options);
}
