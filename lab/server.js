import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  compileModuleFromSource,
  createPublicationProtectionDemoSummary,
  createRecipientKeypairHex,
  loadStandardsCatalog,
  protectModuleArtifact,
  validateArtifactWithStandards,
  validateManifestWithStandards,
} from "../src/index.js";

function base64ToBytes(value) {
  return new Uint8Array(Buffer.from(String(value ?? ""), "base64"));
}

function bytesToBase64(value) {
  return Buffer.from(value).toString("base64");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAB_TOKEN_COOKIE = "sdm_lab_token";

function resolvePluginsDir() {
  const configuredRoot = process.env.SPACE_DATA_NETWORK_PLUGINS_ROOT
    ? path.resolve(process.env.SPACE_DATA_NETWORK_PLUGINS_ROOT)
    : path.resolve(__dirname, "..", "..", "space-data-network-plugins");
  return path.basename(configuredRoot) === "packages"
    ? configuredRoot
    : path.join(configuredRoot, "packages");
}

export function resolveContainedWasmPath(rootDir, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) return null;
  if (path.isAbsolute(relativePath) || relativePath.includes("\0")) return null;
  if (!relativePath.endsWith(".wasm")) return null;
  let root;
  let resolved;
  try {
    root = fs.realpathSync(rootDir);
    resolved = fs.realpathSync(path.resolve(root, relativePath));
  } catch {
    return null;
  }
  if (!resolved.startsWith(root + path.sep)) return null;
  // the file actually opened must itself be a .wasm regular file, not a
  // .wasm-named link to something else inside the directory
  if (!resolved.endsWith(".wasm")) return null;
  try {
    if (!fs.statSync(resolved).isFile()) return null;
  } catch {
    return null;
  }
  return resolved;
}

function tokenMatches(expected, candidate) {
  if (typeof candidate !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(candidate);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieToken(request) {
  for (const part of String(request.headers.cookie ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === LAB_TOKEN_COOKIE) return rest.join("=");
  }
  return null;
}

/**
 * The module lab app (security audit 2026-10-15, SEC-059). A local developer
 * tool: it compiles code, runs WasmEdge and signs artifacts for whoever can
 * reach it, so it
 *  - answers only requests whose Host is the loopback address it serves;
 *  - requires the per-run token (header x-lab-token, or the SameSite=Strict
 *    cookie set by opening the printed /?token=... URL) on /api and /plugins;
 *  - runs only .wasm files inside the plugins directory.
 */
export function createLabApp(options = {}) {
  const token = options.token ?? randomBytes(24).toString("hex");
  const app = express();
  // "/API/protect" must not be a different path from "/api/protect" to one
  // check and the same route to the router (SEC-059 round 2).
  app.set("case sensitive routing", true);
  app.set("strict routing", true);
  app.disable("x-powered-by");

  app.use((request, response, next) => {
    const host = String(request.headers.host ?? "").toLowerCase();
    const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
    if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) {
      return response.status(421).json({ ok: false, error: "The module lab answers only on loopback." });
    }
    if (request.method === "GET" && request.path === "/" && typeof request.query.token === "string") {
      if (!tokenMatches(token, request.query.token)) {
        return response.status(401).json({ ok: false, error: "Wrong lab token." });
      }
      response.setHeader(
        "Set-Cookie",
        `${LAB_TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
      );
      return response.redirect(302, "/");
    }
    next();
  });

  // Cross-origin isolation headers for SharedArrayBuffer (needed by pthread builds)
  app.use((_req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    next();
  });

  // The lab UI's own static files are the ONLY thing served without the
  // token (GET/HEAD, files that exist under lab/public, no dotfiles).
  // Everything after this line requires it, whatever the path's case,
  // spelling or encoding: the gate is default-deny, not a prefix list.
  app.use(express.static(path.join(__dirname, "public"), {
    dotfiles: "deny",
    fallthrough: true,
    redirect: false,
  }));
  app.use((request, response, next) => {
    const presented = request.headers["x-lab-token"] ?? cookieToken(request);
    if (!tokenMatches(token, presented)) {
      return response.status(401).json({ ok: false, error: "Missing or wrong lab token." });
    }
    next();
  });

  app.use(express.json({ limit: "20mb" }));

  // Serve WASM plugin artifacts from the plugins directory: .wasm files whose
  // REAL path is inside it (no symlink out, no "..", no case games).
  const pluginsDir = options.pluginsDir ?? resolvePluginsDir();
  if (!fs.existsSync(pluginsDir)) {
    console.warn(
      `[module-lab] Plugin artifact directory not found: ${pluginsDir}. ` +
        "Set SPACE_DATA_NETWORK_PLUGINS_ROOT to a space-data-network-plugins checkout to enable /plugins and /api/plugins.",
    );
  }
  app.get(/^\/plugins\/(.+)$/, (request, response) => {
    let relativePath;
    try {
      relativePath = decodeURIComponent(request.params[0]);
    } catch {
      return response.status(400).json({ ok: false, error: "Malformed plugin path." });
    }
    const resolved = resolveContainedWasmPath(pluginsDir, relativePath);
    if (!resolved) {
      return response.status(404).json({ ok: false, error: "No such plugin artifact." });
    }
    response.setHeader("Content-Type", "application/wasm");
    response.setHeader("X-Content-Type-Options", "nosniff");
    return response.sendFile(resolved, { dotfiles: "deny" });
  });

  function parseManifest(input) {
    if (typeof input === "string") {
      return JSON.parse(input);
    }
    return input ?? {};
  }

  app.get("/api/standards", async (_request, response) => {
    response.json({
      standards: await loadStandardsCatalog(),
    });
  });

  app.post("/api/verify", async (request, response) => {
    try {
      const manifest = parseManifest(request.body.manifest ?? request.body.manifestText);
      const wasmBase64 = request.body.wasmBase64 ?? null;
      const report = wasmBase64
        ? await validateArtifactWithStandards({
            manifest,
            sourceName: "browser-upload",
            exportNames: WebAssembly.Module.exports(
              new WebAssembly.Module(base64ToBytes(wasmBase64)),
            ).map((entry) => entry.name),
          })
        : await validateManifestWithStandards(manifest, {
            sourceName: "browser-upload",
          });
      response.json({ ok: true, report });
    } catch (error) {
      response.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/compile", async (request, response) => {
    try {
      const manifest = parseManifest(request.body.manifest ?? request.body.manifestText);
      const result = await compileModuleFromSource({
        manifest,
        sourceCode: request.body.sourceCode,
        language: request.body.language ?? "c",
      });
      response.json({
        ok: true,
        wasmBase64: bytesToBase64(result.wasmBytes),
        report: result.report,
        manifestWarnings: result.manifestWarnings,
      });
    } catch (error) {
      response.status(400).json({
        ok: false,
        error: error.message,
        report: error.report ?? null,
      });
    }
  });

  app.post("/api/keys/x25519", async (_request, response) => {
    try {
      response.json({
        ok: true,
        keypair: await createRecipientKeypairHex(),
      });
    } catch (error) {
      response.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/protect", async (request, response) => {
    try {
      const manifest = parseManifest(request.body.manifest ?? request.body.manifestText);
      const result = await protectModuleArtifact({
        manifest,
        wasmBase64: request.body.wasmBase64,
        recipientPublicKeyHex: request.body.recipientPublicKeyHex ?? null,
        mnemonic: request.body.mnemonic ?? null,
        ephemeralIdentity: !request.body.mnemonic,
        targetUrl: request.body.targetUrl ?? null,
        capabilities: request.body.capabilities ?? [],
      });
      // the result carries no mnemonic (SEC-035); send only what the UI shows
      response.json({
        ok: true,
        result: {
          signingPublicKeyHex: result.signingPublicKeyHex,
          signingPath: result.signingPath,
          encrypted: result.encrypted,
          payload: { artifactId: result.payload.artifactId, programId: result.payload.programId },
          protectedArtifactBase64: result.protectedArtifactBase64,
        },
      });
    } catch (error) {
      response.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/demo/publication-protection", async (_request, response) => {
    try {
      const summary = await createPublicationProtectionDemoSummary();
      response.json({ ok: true, summary });
    } catch (error) {
      response.status(400).json({ ok: false, error: error.message });
    }
  });

  // WasmEdge invoke endpoint — same artifact, server-side runtime
  app.post("/api/wasmedge-invoke", async (request, response) => {
    try {
      const { spawnSync } = await import("node:child_process");
      const wasmRelPath = request.body.wasmPath;
      if (!wasmRelPath || typeof wasmRelPath !== "string") {
        return response.status(400).json({ ok: false, error: "wasmPath is required." });
      }
      // Contained in the plugins directory: no absolute paths, no "..", no
      // symlink out of it (SEC-059).
      const wasmAbsPath = resolveContainedWasmPath(pluginsDir, wasmRelPath);
      if (!wasmAbsPath) {
        return response.status(400).json({ ok: false, error: "wasmPath must name a .wasm file inside the plugins directory." });
      }
      const stdinBase64 = request.body.stdinBase64 ?? "";
      const stdinBytes = Buffer.from(stdinBase64, "base64");

      const result = spawnSync("wasmedge", [wasmAbsPath], {
        input: stdinBytes,
        encoding: null,
        maxBuffer: 16 * 1024 * 1024,
      });

      if (result.error) {
        return response.status(500).json({ ok: false, error: result.error.message });
      }

      response.json({
        ok: true,
        exitCode: result.status,
        stdoutBase64: result.stdout ? Buffer.from(result.stdout).toString("base64") : "",
        stderrText: result.stderr ? result.stderr.toString("utf8") : "",
      });
    } catch (error) {
      response.status(500).json({ ok: false, error: error.message });
    }
  });

  // List available plugin artifacts
  app.get("/api/plugins", async (_request, response) => {
    try {
      const { readdirSync, existsSync } = await import("node:fs");
      const plugins = [];
      if (existsSync(pluginsDir)) {
        for (const dir of readdirSync(pluginsDir)) {
          const distDir = path.join(pluginsDir, dir, "dist");
          if (existsSync(distDir)) {
            const wasmFiles = readdirSync(distDir).filter((f) => f.endsWith(".wasm"));
            if (wasmFiles.length > 0) {
              plugins.push({
                name: dir,
                artifacts: wasmFiles.map((f) => `${dir}/dist/${f}`),
              });
            }
          }
        }
      }
      response.json({ ok: true, plugins });
    } catch (error) {
      response.status(500).json({ ok: false, error: error.message });
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ ok: false, error: "Not found." });
  });

  return { app, token };
}

export function startLabServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 4318);
  const host = "127.0.0.1";
  const { app, token } = createLabApp(options);
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const address = server.address();
      resolve({ server, token, host: address.address, port: address.port });
    });
    server.once("error", reject);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { port, token } = await startLabServer();
  console.log(`module lab listening on http://127.0.0.1:${port}/?token=${token}`);
}
