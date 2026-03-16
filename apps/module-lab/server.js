import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileModuleFromSource,
  createRecipientKeypairHex,
  loadStandardsCatalog,
  protectModuleArtifact,
  validateArtifactWithStandards,
  validateManifestWithStandards,
} from "@digitalarsenal/module-sdk";

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
app.use(express.static(path.join(__dirname, "public")));

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

app.listen(port, () => {
  console.log(`module lab listening on http://localhost:${port}`);
});
