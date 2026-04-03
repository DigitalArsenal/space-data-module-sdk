import path from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { FlatcRunner } from "flatc-wasm";

const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA_DIR = path.join(SDK_ROOT, "schemas");

let flatcRunnerPromise = null;
let flatbuffersCppRuntimeHeadersPromise = null;
let invokeCppSchemaHeadersPromise = null;

function loadFlatcRunner() {
  if (!flatcRunnerPromise) {
    flatcRunnerPromise = FlatcRunner.init();
  }
  return flatcRunnerPromise;
}

const FLATBUFFERS_INCLUDE_ROOT_CANDIDATES = [
  process.env.FLATBUFFERS_INCLUDE_DIR,
  "/opt/homebrew/include",
  "/usr/local/include",
  "/usr/include",
].filter(Boolean);

async function findFlatbuffersIncludeRoot() {
  for (const candidate of FLATBUFFERS_INCLUDE_ROOT_CANDIDATES) {
    const headerPath = path.join(candidate, "flatbuffers", "flatbuffers.h");
    try {
      const headerStat = await stat(headerPath);
      if (headerStat.isFile()) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(
    "Unable to locate the installed flatbuffers C++ headers. Set FLATBUFFERS_INCLUDE_DIR to the directory containing flatbuffers/flatbuffers.h.",
  );
}

async function readDirectoryTree(rootDir, currentDir = rootDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await readDirectoryTree(rootDir, fullPath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const relativePath = path.relative(rootDir, fullPath).split(path.sep).join("/");
    files.push([`/${relativePath}`, await readFile(fullPath, "utf8")]);
  }
  return files;
}

async function loadInvokeSchemaFiles() {
  const filenames = [
    "TypedArenaBuffer.fbs",
    "PluginInvokeRequest.fbs",
    "PluginInvokeResponse.fbs",
  ];
  const entries = await Promise.all(
    filenames.map(async (filename) => [
      `/schemas/${filename}`,
      await readFile(path.join(SCHEMA_DIR, filename), "utf8"),
    ]),
  );
  return Object.fromEntries(entries);
}

export async function getFlatbuffersCppRuntimeHeaders() {
  if (!flatbuffersCppRuntimeHeadersPromise) {
    flatbuffersCppRuntimeHeadersPromise = (async () => {
      const includeRoot = await findFlatbuffersIncludeRoot();
      return Object.fromEntries(
        await readDirectoryTree(includeRoot, path.join(includeRoot, "flatbuffers")),
      );
    })();
  }
  return flatbuffersCppRuntimeHeadersPromise;
}

export async function getInvokeCppSchemaHeaders() {
  if (!invokeCppSchemaHeadersPromise) {
    invokeCppSchemaHeadersPromise = (async () => {
      const flatc = await loadFlatcRunner();
      const schemaFiles = await loadInvokeSchemaFiles();
      const generatedHeaders = {};
      for (const entry of Object.keys(schemaFiles)) {
        Object.assign(
          generatedHeaders,
          flatc.generateCode(
            { entry, files: schemaFiles },
            "cpp",
            { genObjectApi: true },
          ),
        );
      }
      return generatedHeaders;
    })();
  }
  return invokeCppSchemaHeadersPromise;
}
