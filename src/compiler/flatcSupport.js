import path from "node:path";
import { readFile } from "node:fs/promises";
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
      const flatc = await loadFlatcRunner();
      return flatc.getEmbeddedRuntime("cpp");
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
