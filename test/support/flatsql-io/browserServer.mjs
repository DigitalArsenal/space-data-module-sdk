// Serves the real-browser T9 suite: one page under the shipped dashboard's CSP
// and COOP/COEP headers (sdn-js/dashboard/build-dashboard.mjs,
// sdn-server/cmd/spacedatanetwork/conjunction_ui.go), whose script spawns every
// worker from blob: URLs (design A39).
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const DASHBOARD_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
].join("; ");

async function bundle(entry, define = {}) {
  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    entryPoints: [path.join(here, entry)],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    logLevel: "error",
    define,
  });
  return result.outputFiles[0].text;
}

export async function startBrowserSuiteServer({ isolate = true } = {}) {
  const engine = await bundle("browserEngine.mjs");
  const page = await bundle("browserPage.mjs", { __ENGINE_SOURCE__: JSON.stringify(engine) });
  const html = '<!doctype html><meta charset="utf-8"><title>T9</title><script src="/page.js"></script>';
  const isolation = isolate
    ? {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Resource-Policy": "same-origin",
      }
    : {};
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": DASHBOARD_CSP,
        "Cache-Control": "no-store",
        ...isolation,
      });
      response.end(html);
      return;
    }
    if (url.pathname === "/page.js") {
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        ...isolation,
      });
      response.end(page);
      return;
    }
    response.writeHead(404, isolation);
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
