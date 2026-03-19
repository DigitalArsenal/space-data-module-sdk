import os from "node:os";
import path from "node:path";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  createDeploymentAuthorization,
  createHdWalletSigner,
  signAuthorization,
} from "../auth/index.js";
import { validateArtifactWithStandards } from "../compliance/index.js";
import { generateEmbeddedManifestSource } from "../embeddedManifest.js";
import {
  generateInvokeSupportHeader,
  generateInvokeSupportSource,
  resolveInvokeSurfaces,
} from "./invokeGlue.js";
import { encodePluginManifest, toEmbeddedPluginManifest } from "../manifest/index.js";
import { DefaultInvokeExports, InvokeSurface } from "../runtime/constants.js";
import {
  encryptJsonForRecipient,
  generateX25519Keypair,
} from "../transport/index.js";
import { createSingleFileBundle } from "../bundle/index.js";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
} from "../utils/encoding.js";
import { sha256Bytes } from "../utils/crypto.js";
import { getWasmWallet } from "../utils/wasmCrypto.js";

const execFile = promisify(execFileCallback);
const C_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA_DIR = path.join(SDK_ROOT, "schemas");

function selectCompiler(language) {
  const normalized = String(language ?? "c").trim().toLowerCase();
  if (normalized === "c++" || normalized === "cpp" || normalized === "cxx") {
    return { command: "em++", extension: "cpp", language: "c++" };
  }
  return { command: "emcc", extension: "c", language: "c" };
}

function ensureExportableMethodIds(manifest) {
  const invalidMethod = (Array.isArray(manifest?.methods) ? manifest.methods : []).find(
    (method) => !C_IDENTIFIER.test(String(method?.methodId ?? "")),
  );
  if (invalidMethod) {
    throw new Error(
      `Method id "${invalidMethod.methodId}" is not a valid C export name. ` +
        "Source compilation requires methodId values to be valid C identifiers.",
    );
  }
}

function buildCompilerArgs(exportedSymbols, options = {}) {
  const linkerExports = exportedSymbols.map(
    (symbol) => "-Wl,--export=" + symbol,
  );
  const extraArgs = [];
  if (options.allowUndefinedImports === true) {
    extraArgs.push("-s", "ERROR_ON_UNDEFINED_SYMBOLS=0", "-Wl,--allow-undefined");
  }
  const args = ["-O2", "-s", "STANDALONE_WASM=1", ...extraArgs, ...linkerExports];
  if (options.noEntry === true) {
    args.splice(1, 0, "--no-entry");
  }
  return args;
}

async function pathExists(candidatePath) {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveFlatbuffersIncludeDir() {
  const envPath = process.env.FLATBUFFERS_INCLUDE_DIR;
  const candidates = [];
  if (envPath) {
    candidates.push(envPath);
  }

  try {
    const { stdout } = await execFile("brew", ["--prefix", "flatbuffers"], {
      timeout: 15_000,
    });
    candidates.push(path.join(stdout.trim(), "include"));
  } catch {
    // brew not available; fall through to common prefixes
  }

  candidates.push(
    "/opt/homebrew/include",
    "/usr/local/include",
    "/usr/include",
  );

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (await pathExists(path.join(candidate, "flatbuffers", "flatbuffers.h"))) {
      return candidate;
    }
  }

  throw new Error(
    "Unable to locate FlatBuffers C++ headers. Set FLATBUFFERS_INCLUDE_DIR or install the flatbuffers headers locally.",
  );
}

async function generateInvokeCppHeaders(outputDir) {
  const schemaPaths = [
    path.join(SCHEMA_DIR, "TypedArenaBuffer.fbs"),
    path.join(SCHEMA_DIR, "PluginInvokeRequest.fbs"),
    path.join(SCHEMA_DIR, "PluginInvokeResponse.fbs"),
  ];
  try {
    await execFile(
      "flatc",
      ["--cpp", "--gen-object-api", "-o", outputDir, ...schemaPaths],
      { timeout: 120_000, cwd: SDK_ROOT },
    );
  } catch (error) {
    error.message =
      "Failed to generate C++ invoke bindings with flatc: " +
      (error.stderr || error.message);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Emception — in-process WASM-based Emscripten (preferred)
// ---------------------------------------------------------------------------

let emceptionInstance = null;
let emceptionLoadAttempted = false;

async function loadEmception() {
  if (emceptionLoadAttempted) return emceptionInstance;
  emceptionLoadAttempted = true;
  try {
    const { default: Emception } = await import(
      "sdn-emception"
    );
    emceptionInstance = new Emception();
    await emceptionInstance.init();
    return emceptionInstance;
  } catch {
    // emception not available or init failed — fall back to system emcc
  }
  return null;
}

async function compileWithEmception(
  emception,
  compiler,
  sourceCode,
  manifestSource,
  exportedSymbols,
  compileOptions,
) {
  const ext = compiler.extension;
  const inputPath = `/working/module.${ext}`;
  const manifestPath = `/working/plugin-manifest-exports.${ext}`;
  const outputPath = "/working/module.wasm";

  emception.writeFile(inputPath, sourceCode);
  emception.writeFile(manifestPath, manifestSource);

  const args = buildCompilerArgs(exportedSymbols, compileOptions);
  const cmd = [
    compiler.command,
    inputPath,
    manifestPath,
    ...args,
    "-o",
    outputPath,
  ].join(" ");

  const result = emception.run(cmd);
  if (result.returncode !== 0) {
    throw new Error(
      `Compilation failed with ${compiler.command} (emception): ${result.stderr || result.stdout}`,
    );
  }

  const wasmBytes = emception.readFile(outputPath);
  return new Uint8Array(wasmBytes);
}

// ---------------------------------------------------------------------------
// System Emscripten — fallback to emcc/em++ on PATH
// ---------------------------------------------------------------------------

async function compileWithSystemToolchain(options = {}) {
  const {
    compilerCommand,
    sourceCompilerCommand,
    sourceExtension,
    sourceCode,
    manifestSource,
    invokeHeaderSource,
    invokeSource,
    exportedSymbols,
    outputPath,
    compileOptions,
  } = options;
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "space-data-module-sdk-compile-"),
  );
  const sourcePath = path.join(tempDir, `module.${sourceExtension}`);
  const manifestSourcePath = path.join(tempDir, "plugin-manifest-exports.cpp");
  const invokeHeaderPath = path.join(tempDir, "space_data_module_invoke.h");
  const invokeSourcePath = path.join(tempDir, "plugin-invoke-bridge.cpp");
  const sourceObjectPath = path.join(tempDir, "module.o");
  const manifestObjectPath = path.join(tempDir, "plugin-manifest-exports.o");
  const invokeObjectPath = path.join(tempDir, "plugin-invoke-bridge.o");
  const resolvedOutputPath = path.resolve(
    outputPath ?? path.join(tempDir, "module.wasm"),
  );

  await writeFile(sourcePath, sourceCode, "utf8");
  await writeFile(manifestSourcePath, manifestSource, "utf8");
  await writeFile(invokeHeaderPath, invokeHeaderSource, "utf8");
  await writeFile(invokeSourcePath, invokeSource, "utf8");
  await generateInvokeCppHeaders(tempDir);

  const flatbuffersIncludeDir = await resolveFlatbuffersIncludeDir();

  const args = buildCompilerArgs(exportedSymbols, compileOptions);

  try {
    await execFile(sourceCompilerCommand, [
      "-c",
      sourcePath,
      `-I${tempDir}`,
      "-o",
      sourceObjectPath,
    ], { timeout: 120_000 });

    await execFile(compilerCommand, [
      "-c",
      manifestSourcePath,
      "-std=c++17",
      `-I${tempDir}`,
      `-I${flatbuffersIncludeDir}`,
      "-o",
      manifestObjectPath,
    ], { timeout: 120_000 });

    await execFile(compilerCommand, [
      "-c",
      invokeSourcePath,
      "-std=c++17",
      `-I${tempDir}`,
      `-I${flatbuffersIncludeDir}`,
      "-o",
      invokeObjectPath,
    ], { timeout: 120_000 });

    await execFile(compilerCommand, [
      sourceObjectPath,
      manifestObjectPath,
      invokeObjectPath,
      ...args,
      "-o",
      resolvedOutputPath,
    ], { timeout: 120_000 });
  } catch (error) {
    error.message =
      `Compilation failed with ${compilerCommand}: ` +
      (error.stderr || error.message);
    throw error;
  }

  const wasmBytes = await readFile(resolvedOutputPath);
  return { wasmBytes, outputPath: resolvedOutputPath, tempDir };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function compileModuleFromSource(options = {}) {
  const manifest = options.manifest ?? {};
  const sourceCode = String(options.sourceCode ?? "");
  if (!sourceCode.trim()) {
    throw new Error("compileModuleFromSource requires sourceCode.");
  }

  ensureExportableMethodIds(manifest);

  const validation = await validateArtifactWithStandards({ manifest });
  if (!validation.ok) {
    const error = new Error("Manifest validation failed.");
    error.report = validation;
    throw error;
  }

  const compiler = selectCompiler(options.language);
  const invokeSurfaces = resolveInvokeSurfaces(manifest);
  const includeCommandMain = invokeSurfaces.includes(InvokeSurface.COMMAND);
  const { manifest: embeddedManifest, warnings } = toEmbeddedPluginManifest(
    manifest,
  );
  const manifestSource = generateEmbeddedManifestSource({
    manifest: embeddedManifest,
  });
  const invokeHeaderSource = generateInvokeSupportHeader();
  const invokeSource = generateInvokeSupportSource({
    manifest,
    includeCommandMain,
  });

  const exportedSymbols = [
    "plugin_get_manifest_flatbuffer",
    "plugin_get_manifest_flatbuffer_size",
    DefaultInvokeExports.invokeSymbol,
    DefaultInvokeExports.allocSymbol,
    DefaultInvokeExports.freeSymbol,
    ...(includeCommandMain ? [DefaultInvokeExports.commandSymbol] : []),
    ...new Set(
      (Array.isArray(manifest.methods) ? manifest.methods : [])
        .map((method) => String(method?.methodId ?? "").trim())
        .filter(Boolean),
    ),
  ];

  let wasmBytes;
  let resolvedOutputPath = null;
  let tempDir = null;
  const result = await compileWithSystemToolchain({
    compilerCommand: "em++",
    sourceCompilerCommand: compiler.command,
    sourceExtension: compiler.extension,
    sourceCode,
    manifestSource,
    invokeHeaderSource,
    invokeSource,
    exportedSymbols,
    outputPath: options.outputPath,
    compileOptions: {
      ...options,
      noEntry: includeCommandMain !== true,
    },
  });
  wasmBytes = result.wasmBytes;
  resolvedOutputPath = result.outputPath;
  tempDir = result.tempDir;
  const compilerBackend = "em++ (system)";

  // Validate the compiled artifact
  const report = await validateArtifactWithStandards({
    manifest,
    wasmPath: resolvedOutputPath,
  });

  return {
    compiler: compilerBackend,
    language: compiler.language,
    outputPath: resolvedOutputPath,
    tempDir,
    wasmBytes,
    manifestWarnings: warnings,
    report,
  };
}

export async function cleanupCompilation(result) {
  if (result?.tempDir) {
    await rm(result.tempDir, { recursive: true, force: true });
  }
}

async function deriveSigningIdentity(mnemonic) {
  const wallet = await getWasmWallet();
  const resolvedMnemonic =
    mnemonic && wallet.mnemonic.validate(mnemonic)
      ? mnemonic
      : wallet.mnemonic.generate(12);
  const seed = wallet.mnemonic.toSeed(resolvedMnemonic);
  const root = wallet.hdkey.fromSeed(seed);
  const signingKey = wallet.getSigningKey(root, 0, 0, 0);
  return {
    wallet,
    mnemonic: resolvedMnemonic,
    signingKey,
  };
}

export async function protectModuleArtifact(options = {}) {
  const manifest = options.manifest ?? {};
  const wasmBytes =
    options.wasmBytes instanceof Uint8Array
      ? options.wasmBytes
      : base64ToBytes(options.wasmBase64 ?? "");
  if (wasmBytes.length === 0) {
    throw new Error("protectModuleArtifact requires wasmBytes or wasmBase64.");
  }

  const manifestBytes = encodePluginManifest(manifest);
  const wasmHashHex = bytesToHex(await sha256Bytes(wasmBytes));
  const manifestHashHex = bytesToHex(await sha256Bytes(manifestBytes));
  const artifactId = options.artifactId ?? `module-${wasmHashHex.slice(0, 16)}`;
  const programId = manifest.pluginId ?? artifactId;

  const identity = await deriveSigningIdentity(options.mnemonic ?? null);
  const signer = createHdWalletSigner({
    publicKeyHex: bytesToHex(identity.signingKey.publicKey),
    derivationPath: identity.signingKey.path,
    keyId: artifactId,
    async signDigest(digest) {
      return identity.wallet.curves.secp256k1.sign(
        digest,
        identity.signingKey.privateKey,
      );
    },
  });

  const authorization = await createDeploymentAuthorization({
    artifactId,
    programId,
    manifestHash: manifestHashHex,
    graphHash: wasmHashHex,
    target: options.targetUrl ?? options.target ?? null,
    capabilities: options.capabilities ?? [],
  });
  const signedAuthorization = await signAuthorization({
    authorization,
    signer,
  });

  const payload = {
    version: 1,
    format: "space-data-module-package",
    artifactId,
    programId,
    manifest,
    manifestBase64: bytesToBase64(manifestBytes),
    wasmBase64: bytesToBase64(wasmBytes),
    wasmHashHex,
    manifestHashHex,
    authorization: signedAuthorization,
  };

  let encryptedEnvelope = null;
  if (options.recipientPublicKeyHex) {
    encryptedEnvelope = await encryptJsonForRecipient({
      payload,
      recipientPublicKey: hexToBytes(options.recipientPublicKeyHex),
      context: "space-data-module-sdk/package",
    });
  }

  let singleFileBundle = null;
  if (options.singleFileBundle === true) {
    singleFileBundle = await createSingleFileBundle({
      wasmBytes,
      manifest,
      authorization: signedAuthorization,
      transportEnvelope: encryptedEnvelope,
      entries: options.bundleEntries,
    });
  }

  return {
    mnemonic: identity.mnemonic,
    signingPublicKeyHex: bytesToHex(identity.signingKey.publicKey),
    signingPath: identity.signingKey.path,
    payload,
    encrypted: Boolean(encryptedEnvelope),
    encryptedEnvelope,
    singleFileBundle,
    bundledWasmBytes: singleFileBundle?.wasmBytes ?? null,
  };
}

export async function createRecipientKeypairHex() {
  const keypair = await generateX25519Keypair();
  return {
    publicKeyHex: bytesToHex(keypair.publicKey),
    privateKeyHex: bytesToHex(keypair.privateKey),
  };
}
