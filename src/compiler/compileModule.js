import os from "node:os";
import path from "node:path";
import {
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";

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
import {
  getFlatbuffersCppRuntimeHeaders,
  getInvokeCppSchemaHeaders,
} from "./flatcSupport.js";
import { runWithEmceptionLock } from "./emceptionNode.js";
import { encodePluginManifest, toEmbeddedPluginManifest } from "../manifest/index.js";
import { DefaultInvokeExports, InvokeSurface } from "../runtime/constants.js";
import {
  encryptJsonForRecipient,
  generateX25519Keypair,
} from "../transport/index.js";
import { createSingleFileBundle } from "../bundle/index.js";
import {
  SDS_GUEST_LINK_MEDIA_TYPE,
  SDS_GUEST_LINK_METADATA_ENTRY_ID,
  SDS_GUEST_LINK_OBJECT_ENTRY_ID,
  SDS_GUEST_LINK_SECTION_NAME,
} from "../bundle/constants.js";
import {
  decodeUnsignedLeb128,
  parseWasmModuleSections,
} from "../bundle/wasm.js";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
} from "../utils/encoding.js";
import { sha256Bytes } from "../utils/crypto.js";
import { getWasmWallet } from "../utils/wasmCrypto.js";

const C_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

function guestLinkSymbolPrefix(pluginId) {
  const normalized = String(pluginId ?? "module");
  const ascii = Array.from(new TextEncoder().encode(normalized))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
  return `sdm_guest_${ascii}_`;
}

function parseStrongDefinedIdentifiers(nmOutput = "") {
  const identifiers = new Set();
  for (const line of String(nmOutput).split(/\r?\n/)) {
    const match = line.match(/^\S+\s+([A-Za-z])\s+(.+)$/);
    if (!match) {
      continue;
    }
    const symbolType = match[1];
    if (!"TDBCGRSV".includes(symbolType)) {
      continue;
    }
    const demangled = match[2].trim();
    const baseName = demangled
      .replace(/\(.*$/, "")
      .split("::")
      .at(-1)
      ?.trim();
    if (!C_IDENTIFIER.test(baseName ?? "")) {
      continue;
    }
    identifiers.add(baseName);
  }
  return Array.from(identifiers).sort();
}

const WASM_SYM_BINDING_WEAK = 0x01;
const WASM_SYM_BINDING_LOCAL = 0x02;
const WASM_SYM_UNDEFINED = 0x10;
const WASM_SYM_EXPLICIT_NAME = 0x40;
const WASM_SYMBOL_KIND_FUNCTION = 0;
const WASM_SYMBOL_KIND_DATA = 1;
const WASM_SYMBOL_KIND_GLOBAL = 2;
const WASM_SYMBOL_KIND_SECTION = 3;
const WASM_SYMBOL_KIND_EVENT = 4;
const WASM_SYMBOL_KIND_TABLE = 5;
const LINKING_SYMBOL_TABLE_SUBSECTION_ID = 8;
const textDecoder = new TextDecoder();

function decodeWasmName(bytes, offset) {
  const lengthInfo = decodeUnsignedLeb128(bytes, offset);
  const nameStart = lengthInfo.nextOffset;
  const nameEnd = nameStart + lengthInfo.value;
  if (nameEnd > bytes.length) {
    throw new Error("WASM name extends past end of symbol payload.");
  }
  return {
    value: textDecoder.decode(bytes.subarray(nameStart, nameEnd)),
    nextOffset: nameEnd,
  };
}

function parseDefinedLinkSymbolsFromObjectBytes(objectBytes) {
  const parsed = parseWasmModuleSections(objectBytes);
  const linkingSection = parsed.sections.find(
    (section) => section.id === 0 && section.name === "linking",
  );
  if (!linkingSection) {
    throw new Error("Guest-link object is missing a linking custom section.");
  }
  const payload = linkingSection.dataBytes;
  let offset = decodeUnsignedLeb128(payload, 0).nextOffset;
  const identifiers = new Set();
  while (offset < payload.length) {
    const subsectionId = payload[offset++];
    const sizeInfo = decodeUnsignedLeb128(payload, offset);
    offset = sizeInfo.nextOffset;
    const subsectionEnd = offset + sizeInfo.value;
    if (subsectionEnd > payload.length) {
      throw new Error("Linking subsection extends past end of payload.");
    }
    if (subsectionId !== LINKING_SYMBOL_TABLE_SUBSECTION_ID) {
      offset = subsectionEnd;
      continue;
    }
    let cursor = offset;
    const countInfo = decodeUnsignedLeb128(payload, cursor);
    cursor = countInfo.nextOffset;
    for (let symbolIndex = 0; symbolIndex < countInfo.value; symbolIndex += 1) {
      const kind = payload[cursor++];
      const flagsInfo = decodeUnsignedLeb128(payload, cursor);
      const flags = flagsInfo.value;
      cursor = flagsInfo.nextOffset;
      let name = "";
      if (
        kind === WASM_SYMBOL_KIND_FUNCTION ||
        kind === WASM_SYMBOL_KIND_GLOBAL ||
        kind === WASM_SYMBOL_KIND_EVENT ||
        kind === WASM_SYMBOL_KIND_TABLE
      ) {
        cursor = decodeUnsignedLeb128(payload, cursor).nextOffset;
        if (
          (flags & WASM_SYM_UNDEFINED) === 0 ||
          (flags & WASM_SYM_EXPLICIT_NAME) !== 0
        ) {
          const nameInfo = decodeWasmName(payload, cursor);
          name = nameInfo.value;
          cursor = nameInfo.nextOffset;
        }
      } else if (kind === WASM_SYMBOL_KIND_DATA) {
        const nameInfo = decodeWasmName(payload, cursor);
        name = nameInfo.value;
        cursor = nameInfo.nextOffset;
        if ((flags & WASM_SYM_UNDEFINED) === 0) {
          cursor = decodeUnsignedLeb128(payload, cursor).nextOffset;
          cursor = decodeUnsignedLeb128(payload, cursor).nextOffset;
          cursor = decodeUnsignedLeb128(payload, cursor).nextOffset;
        }
      } else if (kind === WASM_SYMBOL_KIND_SECTION) {
        cursor = decodeUnsignedLeb128(payload, cursor).nextOffset;
      } else {
        throw new Error(`Unsupported WASM linking symbol kind: ${kind}`);
      }
      if ((flags & WASM_SYM_UNDEFINED) !== 0) {
        continue;
      }
      if ((flags & WASM_SYM_BINDING_LOCAL) !== 0) {
        continue;
      }
      if ((flags & WASM_SYM_BINDING_WEAK) !== 0) {
        continue;
      }
      if (!C_IDENTIFIER.test(name)) {
        continue;
      }
      identifiers.add(name);
    }
    return Array.from(identifiers).sort();
  }
  throw new Error("Guest-link object is missing a symbol table subsection.");
}

function deriveGuestLinkRenameArgs({
  objectBytes,
  pluginId,
  methodIds = [],
} = {}) {
  const identifiers = parseDefinedLinkSymbolsFromObjectBytes(objectBytes);
  const prefix = guestLinkSymbolPrefix(pluginId);
  const renamedIdentifiers = Array.from(
    new Set([...identifiers, ...methodIds.filter((value) => C_IDENTIFIER.test(value))]),
  ).sort();
  return {
    prefix,
    identifiers: renamedIdentifiers,
    renameArgs: renamedIdentifiers.map(
      (identifier) => `-D${identifier}=${prefix}${identifier}`,
    ),
    methodSymbols: Object.fromEntries(
      methodIds.map((methodId) => [methodId, `${prefix}${methodId}`]),
    ),
  };
}

function createGuestLinkBundleEntries(guestLink) {
  if (!guestLink?.objectBytes || guestLink.objectBytes.length === 0) {
    return [];
  }
  return [
    {
      entryId: SDS_GUEST_LINK_OBJECT_ENTRY_ID,
      role: "auxiliary",
      sectionName: SDS_GUEST_LINK_SECTION_NAME,
      payloadEncoding: "raw-bytes",
      mediaType: "application/wasm",
      payload: guestLink.objectBytes,
      description: "Prefixed guest-link wasm object for monolithic flow linking.",
    },
    {
      entryId: SDS_GUEST_LINK_METADATA_ENTRY_ID,
      role: "auxiliary",
      sectionName: SDS_GUEST_LINK_SECTION_NAME,
      payloadEncoding: "json-utf8",
      mediaType: SDS_GUEST_LINK_MEDIA_TYPE,
      payload: {
        version: 1,
        format: "wasm-object",
        symbolPrefix: guestLink.symbolPrefix,
        methodSymbols: guestLink.methodSymbols,
        methodIds: Object.keys(guestLink.methodSymbols ?? {}),
        language: guestLink.language,
      },
      description: "Guest-link metadata for monolithic flow linking.",
    },
  ];
}

async function getInvokeCppSupportFiles() {
  const [runtimeHeaders, schemaHeaders] = await Promise.all([
    getFlatbuffersCppRuntimeHeaders(),
    getInvokeCppSchemaHeaders(),
  ]);
  return { runtimeHeaders, schemaHeaders };
}

async function writeFilesToEmception(emception, rootDir, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.posix.join(rootDir, relativePath);
    emception.FS.mkdirTree(path.posix.dirname(filePath));
    emception.writeFile(filePath, content);
  }
}

function removeEmceptionDirectory(emception, directoryPath) {
  if (!emception.FS.analyzePath(directoryPath).exists) {
    return;
  }
  const entries = emception.FS.readdir(directoryPath).filter(
    (entry) => entry !== "." && entry !== "..",
  );
  for (const entry of entries) {
    const entryPath = path.posix.join(directoryPath, entry);
    const stat = emception.FS.stat(entryPath);
    if (emception.FS.isDir(stat.mode)) {
      removeEmceptionDirectory(emception, entryPath);
      emception.FS.rmdir(entryPath);
    } else {
      emception.FS.unlink(entryPath);
    }
  }
  emception.FS.rmdir(directoryPath);
}

async function compileWithEmception(options = {}) {
  const {
    manifest,
    language,
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
  const resolvedOutputPath = path.resolve(
    outputPath ?? path.join(tempDir, "module.wasm"),
  );

  try {
    return await runWithEmceptionLock(async (emception) => {
      const workDir = "/working/space-data-module-sdk-compile";
      const runtimeIncludeDir = path.posix.join(workDir, "flatbuffers-runtime");
      const sourcePath = path.posix.join(workDir, `module.${sourceExtension}`);
      const manifestSourcePath = path.posix.join(workDir, "plugin-manifest-exports.cpp");
      const invokeHeaderPath = path.posix.join(workDir, "space_data_module_invoke.h");
      const invokeSourcePath = path.posix.join(workDir, "plugin-invoke-bridge.cpp");
      const sourceObjectPath = path.posix.join(workDir, "module.o");
      const linkObjectPath = path.posix.join(workDir, "module-link.o");
      const manifestObjectPath = path.posix.join(workDir, "plugin-manifest-exports.o");
      const invokeObjectPath = path.posix.join(workDir, "plugin-invoke-bridge.o");
      const wasmOutputPath = path.posix.join(workDir, "module.wasm");

      const { runtimeHeaders, schemaHeaders } = await getInvokeCppSupportFiles();
      const args = buildCompilerArgs(exportedSymbols, compileOptions);

      try {
        emception.FS.mkdirTree(workDir);
        await writeFilesToEmception(emception, runtimeIncludeDir, runtimeHeaders);
        await writeFilesToEmception(emception, workDir, schemaHeaders);
        emception.writeFile(sourcePath, sourceCode);
        emception.writeFile(manifestSourcePath, manifestSource);
        emception.writeFile(invokeHeaderPath, invokeHeaderSource);
        emception.writeFile(invokeSourcePath, invokeSource);

        const commands = [
          [
            sourceCompilerCommand,
            "-c",
            sourcePath,
            `-I${workDir}`,
            "-o",
            sourceObjectPath,
          ],
        ];

        for (const command of commands) {
          const result = emception.run(command.join(" "));
          if (result.returncode !== 0) {
            throw new Error(
              `Compilation failed with ${command[0]} (emception): ${result.stderr || result.stdout}`,
            );
          }
        }

        const sourceObjectBytes = new Uint8Array(emception.readFile(sourceObjectPath));
        const guestLink = deriveGuestLinkRenameArgs({
          objectBytes: sourceObjectBytes,
          pluginId: manifest?.pluginId,
          methodIds: Array.isArray(manifest?.methods)
            ? manifest.methods.map((method) => String(method?.methodId ?? ""))
            : [],
        });

        const linkCompileCommand = [
          sourceCompilerCommand,
          "-c",
          sourcePath,
          `-I${workDir}`,
          ...guestLink.renameArgs,
          "-o",
          linkObjectPath,
        ];
        const linkCompileResult = emception.run(linkCompileCommand.join(" "));
        if (linkCompileResult.returncode !== 0) {
          throw new Error(
            `Compilation failed with ${linkCompileCommand[0]} (emception): ${linkCompileResult.stderr || linkCompileResult.stdout}`,
          );
        }

        const remainingCommands = [
          [
            "em++",
            "-c",
            manifestSourcePath,
            "-std=c++17",
            `-I${workDir}`,
            `-I${runtimeIncludeDir}`,
            "-o",
            manifestObjectPath,
          ],
          [
            "em++",
            "-c",
            invokeSourcePath,
            "-std=c++17",
            `-I${workDir}`,
            `-I${runtimeIncludeDir}`,
            "-o",
            invokeObjectPath,
          ],
          [
            "em++",
            sourceObjectPath,
            manifestObjectPath,
            invokeObjectPath,
            ...args,
            "-o",
            wasmOutputPath,
          ],
        ];
        for (const command of remainingCommands) {
          const result = emception.run(command.join(" "));
          if (result.returncode !== 0) {
            throw new Error(
              `Compilation failed with ${command[0]} (emception): ${result.stderr || result.stdout}`,
            );
          }
        }

        const wasmBytes = new Uint8Array(emception.readFile(wasmOutputPath));
        const linkObjectBytes = new Uint8Array(emception.readFile(linkObjectPath));
        await writeFile(resolvedOutputPath, wasmBytes);
        return {
          wasmBytes,
          outputPath: resolvedOutputPath,
          tempDir,
          guestLink: {
            format: "wasm-object",
            language,
            symbolPrefix: guestLink.prefix,
            methodSymbols: guestLink.methodSymbols,
            objectBytes: linkObjectBytes,
          },
        };
      } finally {
        try {
          removeEmceptionDirectory(emception, workDir);
        } catch {
          // Best-effort cleanup only; the shared emception instance remains usable.
        }
      }
    });
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

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
  const compileOptions = {
    ...options,
    noEntry: includeCommandMain !== true,
  };
  const result = await compileWithEmception({
    manifest,
    language: compiler.language,
    sourceCompilerCommand: compiler.command,
    sourceExtension: compiler.extension,
    sourceCode,
    manifestSource,
    invokeHeaderSource,
    invokeSource,
    exportedSymbols,
    outputPath: options.outputPath,
    compileOptions,
  });
  wasmBytes = result.wasmBytes;
  resolvedOutputPath = result.outputPath;
  tempDir = result.tempDir;

  // Validate the compiled artifact
  const report = await validateArtifactWithStandards({
    manifest,
    wasmPath: resolvedOutputPath,
  });

  return {
    compiler: "em++ (emception)",
    language: compiler.language,
    outputPath: resolvedOutputPath,
    tempDir,
    wasmBytes,
    guestLink: result.guestLink,
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
    const additionalEntries = [
      ...(Array.isArray(options.bundleEntries) ? options.bundleEntries : []),
      ...createGuestLinkBundleEntries(options.guestLink),
    ];
    singleFileBundle = await createSingleFileBundle({
      wasmBytes,
      manifest,
      authorization: signedAuthorization,
      transportEnvelope: encryptedEnvelope,
      entries: additionalEntries,
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
