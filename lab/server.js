import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const app = express();
const port = Number(process.env.PORT ?? 4318);

app.use(express.json({ limit: "20mb" }));

// Cross-origin isolation headers for SharedArrayBuffer (needed by pthread builds)
app.use((_req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// Serve WASM plugin artifacts from the plugins directory
const pluginsDir = path.resolve(__dirname, "..", "..", "space-data-network-plugins", "packages");
app.use("/plugins", express.static(pluginsDir, {
  setHeaders(res) {
    res.setHeader("Content-Type", "application/wasm");
  },
}));

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
      targetUrl: request.body.targetUrl ?? null,
      capabilities: request.body.capabilities ?? [],
    });
    response.json({ ok: true, result });
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
    const wasmAbsPath = path.resolve(pluginsDir, wasmRelPath);
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

app.listen(port, () => {
  console.log(`module lab listening on http://localhost:${port}`);
});
