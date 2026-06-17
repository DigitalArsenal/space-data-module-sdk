import path from "node:path";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { FlatcRunner } from "flatc-wasm";

const require = createRequire(import.meta.url);
const SDS_ROOT = path.dirname(require.resolve("spacedatastandards.org/package.json"));
const SDS_SCHEMA_DIR = path.join(SDS_ROOT, "schema");

let flatcRunnerPromise = null;
let flatbuffersCppRuntimeHeadersPromise = null;
let invokeCppSchemaHeadersPromise = null;

function loadFlatcRunner() {
  if (!flatcRunnerPromise) {
    flatcRunnerPromise = FlatcRunner.init();
  }
  return flatcRunnerPromise;
}

async function loadSdsInvokeSchemaFiles() {
  return {
    "/sds/TAB/main.fbs": await readFile(
      path.join(SDS_SCHEMA_DIR, "TAB/main.fbs"),
      "utf8",
    ),
    "/sds/PIV/main.fbs": await readFile(
      path.join(SDS_SCHEMA_DIR, "PIV/main.fbs"),
      "utf8",
    ),
  };
}

function rewriteGeneratedHeaderGuard(content, guardName) {
  return String(content).replaceAll("FLATBUFFERS_GENERATED_MAIN_H_", guardName);
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
      const generatedHeaders = {};
      const sdsSchemaFiles = await loadSdsInvokeSchemaFiles();
      const tabHeaders = flatc.generateCode(
        { entry: "/sds/TAB/main.fbs", files: sdsSchemaFiles },
        "cpp",
        { genObjectApi: true },
      );
      const pivHeaders = flatc.generateCode(
        { entry: "/sds/PIV/main.fbs", files: sdsSchemaFiles },
        "cpp",
        { genObjectApi: true },
      );
      generatedHeaders["sds/TAB/main_generated.h"] = rewriteGeneratedHeaderGuard(
        tabHeaders["main_generated.h"],
        "FLATBUFFERS_GENERATED_SDS_TAB_MAIN_H_",
      );
      generatedHeaders["sds/PIV/main_generated.h"] = rewriteGeneratedHeaderGuard(
        pivHeaders["main_generated.h"].replace(
          '#include "main_generated.h"',
          '#include "sds/TAB/main_generated.h"',
        ),
        "FLATBUFFERS_GENERATED_SDS_PIV_MAIN_H_",
      );
      return generatedHeaders;
    })();
  }
  return invokeCppSchemaHeadersPromise;
}
