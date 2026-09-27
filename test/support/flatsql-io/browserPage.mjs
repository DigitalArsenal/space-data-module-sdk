// Page script of the real-browser T9 suite. It runs under the shipped
// dashboard's CSP (script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'
// blob:) with COOP/COEP, spawns the engine driver from a blob: URL, and exposes
// window.__t9 to the Playwright test.
/* global __ENGINE_SOURCE__ */
import { probeBrowserCapabilities } from "../../../src/host/browserCapabilityProbe.js";

const engineUrl = URL.createObjectURL(new Blob([__ENGINE_SOURCE__], { type: "text/javascript" }));
const engine = new Worker(engineUrl);
const pending = new Map();
let nextId = 1;
const ready = new Promise((resolve) => {
  engine.onmessage = (event) => {
    const message = event.data ?? {};
    if (message.ready) {
      resolve(message);
      return;
    }
    const settle = pending.get(message.id);
    pending.delete(message.id);
    settle?.(message);
  };
  engine.onerror = (event) => {
    window.__t9EngineError = String(event?.message ?? event);
    resolve({ ready: false, error: window.__t9EngineError });
  };
});

window.__t9 = {
  ready,
  run(scenario, options) {
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      engine.postMessage({ id, scenario, options });
    });
  },
  probe: () => probeBrowserCapabilities(),
};
