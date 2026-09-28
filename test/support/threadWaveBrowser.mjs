// Serves the headless-browser thread-wave test: a COOP/COEP page whose module
// worker (threadWaveOwner.mjs) owns the wasi-threads pool, the SDK's pooled
// thread worker built from src/host/wasiThreadBrowserWorker.mjs, and the guest.
// `runWaves(page, options)` runs one harness in that owner worker.
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

async function bundle(entry) {
  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    // The harness's Node-only branches are dynamic imports a browser never runs.
    external: ["node:*", "hd-wallet-wasm"],
    logLevel: "error",
  });
  return result.outputFiles[0].text;
}

const PAGE_SCRIPT = `
const owner = new Worker("/owner.js", { type: "module" });
const pending = new Map();
let nextId = 1;
owner.onmessage = (event) => {
  const resolve = pending.get(event.data.id);
  pending.delete(event.data.id);
  resolve?.(event.data);
};
owner.onerror = (event) => {
  for (const resolve of pending.values()) resolve({ ok: false, error: "owner worker error: " + (event.message ?? event) });
  pending.clear();
};
window.__runWaves = (options) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  owner.postMessage({ ...options, id });
});
`;

export async function startThreadWaveServer({ wasmBytes }) {
  const [owner, threadWorker] = await Promise.all([
    bundle(path.join(here, "threadWaveOwner.mjs")),
    bundle(path.join(here, "..", "..", "src", "host", "wasiThreadBrowserWorker.mjs")),
  ]);
  const isolation = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-store",
  };
  const routes = {
    "/": ["text/html; charset=utf-8", '<!doctype html><meta charset="utf-8"><title>waves</title><script type="module" src="/page.js"></script>'],
    "/page.js": ["text/javascript; charset=utf-8", PAGE_SCRIPT],
    "/owner.js": ["text/javascript; charset=utf-8", owner],
    "/wasi-thread-worker.js": ["text/javascript; charset=utf-8", threadWorker],
    "/module.wasm": ["application/wasm", Buffer.from(wasmBytes)],
  };
  const server = http.createServer((request, response) => {
    const route = routes[new URL(request.url, "http://localhost").pathname];
    if (!route) {
      response.writeHead(404, isolation);
      response.end("not found");
      return;
    }
    response.writeHead(200, { ...isolation, "Content-Type": route[0] });
    response.end(route[1]);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Run the guest in the page's owner worker; resolves with its report. */
export async function runWaves(page, { lanes, env, surface = "direct", invokes = 1, spawnWaitMs, request }) {
  await page.waitForFunction(() => typeof window.__runWaves === "function");
  return page.evaluate(
    (options) => window.__runWaves(options),
    {
      lanes,
      env,
      surface,
      invokes,
      spawnWaitMs,
      request: {
        methodId: request.methodId,
        inputs: request.inputs.map((input) => ({ ...input, payload: Array.from(input.payload) })),
      },
    },
  );
}
