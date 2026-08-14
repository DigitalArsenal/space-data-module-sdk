#!/usr/bin/env node
/**
 * Static server for the playground.
 *
 * Serves playground/public ONLY, from one origin, with cross-origin isolation
 * headers (COOP/COEP). Emception's own build can use SharedArrayBuffer, and a
 * page that is not cross-origin-isolated silently loses it — so the headers are
 * set here rather than discovered as a mystery failure later.
 *
 * This is a LOCAL dev/serve surface. Publishing the playground is the docs-site
 * task's job; this file deliberately has no deploy path.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "public",
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".pack": "application/octet-stream",
  ".br": "application/octet-stream",
  ".map": "application/json; charset=utf-8",
};

export function createServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    let relative = decodeURIComponent(url.pathname);
    if (relative.endsWith("/")) relative += "index.html";

    const resolved = path.resolve(PUBLIC_DIR, `.${relative}`);
    // Path containment: a served tree is a served tree, not a filesystem.
    if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
      response.writeHead(403).end("forbidden");
      return;
    }

    let info;
    try {
      info = await stat(resolved);
    } catch {
      response.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    if (info.isDirectory()) {
      response.writeHead(302, { location: `${relative}/` }).end();
      return;
    }

    response.writeHead(200, {
      "content-type": MIME[path.extname(resolved)] ?? "application/octet-stream",
      "content-length": info.size,
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "require-corp",
      "cross-origin-resource-policy": "same-origin",
      "cache-control": "no-cache",
    });
    createReadStream(resolved).pipe(response);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8099);
  createServer().listen(port, () => {
    process.stdout.write(`playground: http://localhost:${port}/\n`);
  });
}
