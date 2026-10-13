// Generates the JS/TS and C++ bindings for the module runtime contracts (schemas/runtime/*.fbs, namespace
// sdn.runtime): TimerTick, HttpRequest, HttpResponse, ModuleConfig, IngestRequest, IngestResult, FlowNotice - the
// typed frames that cross a module port, a host connector or the flow runtime (typed-contracts 1.0, owner
// 2026-10-13: "flatbuffer SDS only"; no JSON forms).
//
// Outputs (the HTTP ABI script's pipeline):
//   src/generated/runtime/sdn/runtime/*.ts|*.js  - flatc TypeScript bindings plus esbuild-transpiled ESM, and the
//     sdn/runtime.ts|js barrel;
//   src/generated/runtime/cpp/*_generated.h       - flatc C++ headers modules inline (version static_assert relaxed
//     as for the HTTP ABI).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";
import { FlatcRunner } from "flatc-wasm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const schemaRoot = path.join(packageRoot, "schemas", "runtime");
const outputRoot = path.join(packageRoot, "src", "generated", "runtime");

// every root, plus the shared tables they include
const rootFiles = ["TimerTick.fbs", "HttpRequest.fbs", "HttpResponse.fbs", "ModuleConfig.fbs", "IngestRequest.fbs", "IngestResult.fbs", "FlowNotice.fbs", "HostCall.fbs", "HostCallResult.fbs"];
const schemaFiles = ["RuntimeCommon.fbs", "HostCallTypes.fbs", ...rootFiles];

function asVirtualSchemaPath(fileName) {
  return `/schemas/${fileName}`;
}

function addJsImportExtensions(code) {
  return code.replace(
    /((?:import|export)\s+[^'"]*?\sfrom\s+)(['"])(\.[^'"]*?)(\2)/g,
    (match, prefix, quote, specifier, suffix) => {
      if (/\.[cm]?js$/.test(specifier) || /\.json$/.test(specifier)) {
        return match;
      }
      return `${prefix}${quote}${specifier}.js${suffix}`;
    },
  );
}

function relaxVersionStaticAssert(header) {
  return header.replace(
    /static_assert\(FLATBUFFERS_VERSION_MAJOR[\s\S]*?"Non-compatible flatbuffers version included"\);\n/,
    "// flatc version static_assert relaxed by generate-runtime-bindings.mjs:\n" +
      "// the HTTP envelope tables use only basic FlatBuffers features and are\n" +
      "// inlined next to spacedatastandards.org headers pinned to a different\n" +
      "// flatbuffers runtime version.\n",
  );
}

async function loadSchemaTree() {
  const files = {};
  for (const fileName of schemaFiles) {
    files[asVirtualSchemaPath(fileName)] = await fs.readFile(
      path.join(schemaRoot, fileName),
      "utf8",
    );
  }
  return files;
}

// flatc's TS generator with preserveCase names a union field's type accessor as the schema writes it (PARAMS ->
// PARAMS_type()) but its unpack()/unpackTo() still call the camel-cased name (this.paramsType()): rewrite those calls
// to the accessor that exists.
function fixPreservedCaseUnions(code) {
  return code.replace(/this\.([a-z][a-z0-9]*)Type\(\)/g, (match, field) => {
    const accessor = `${field.replace(/([A-Z])/g, "_$1").toUpperCase()}_type`;
    return code.includes(`${accessor}()`) ? `this.${accessor}()` : match;
  });
}

function setGeneratedFile(generatedFiles, relativePath, content) {
  const existing = generatedFiles.get(relativePath);
  if (existing !== undefined && existing !== content) {
    throw new Error(`Conflicting generated output for ${relativePath}`);
  }
  generatedFiles.set(relativePath, content);
}

async function main() {
  const schemaTree = await loadSchemaTree();
  const flatc = await FlatcRunner.init();

  const tsFiles = new Map();
  const cppFiles = new Map();
  for (const entryFile of schemaFiles) {
    const generatedTs = flatc.generateCode(
      { entry: asVirtualSchemaPath(entryFile), files: schemaTree },
      "ts",
      { genObjectApi: true, preserveCase: true },   // (field names as the schema writes them, as the SDS bindings do; the T classes: pack/unpack - src/standards/runtimeContracts.js builds on them)
    );
    for (const [relativePath, content] of Object.entries(generatedTs)) {
      // Only keep the per-table files; the per-entry barrels differ between
      // the two roots (manual barrel below, mirroring the orbpro script).
      if (!relativePath.endsWith(".ts") || !relativePath.startsWith("sdn/runtime/")) {
        continue;
      }
      setGeneratedFile(tsFiles, relativePath, fixPreservedCaseUnions(content));
    }

    const generatedCpp = flatc.generateCode(
      { entry: asVirtualSchemaPath(entryFile), files: schemaTree },
      "cpp",
      { genObjectApi: true },
    );
    for (const [relativePath, content] of Object.entries(generatedCpp)) {
      if (!relativePath.endsWith(".h")) {
        continue;
      }
      setGeneratedFile(
        cppFiles,
        path.join("cpp", relativePath),
        relaxVersionStaticAssert(content),
      );
    }
  }

  // the barrel: every generated table and enum module, by file
  const modules = [...tsFiles.keys()].filter((p) => p.startsWith("sdn/runtime/")).sort();
  tsFiles.set(
    "sdn/runtime.ts",
    "// generated by scripts/generate-runtime-bindings.mjs\n" +
      modules.map((p) => `export * from "./${p.slice("sdn/".length).replace(/\.ts$/, ".js")}";\n`).join(""),
  );

  await fs.rm(outputRoot, { recursive: true, force: true });
  for (const [relativePath, tsSource] of tsFiles.entries()) {
    const tsPath = path.join(outputRoot, relativePath);
    await fs.mkdir(path.dirname(tsPath), { recursive: true });
    await fs.writeFile(tsPath, tsSource, "utf8");
    const transformed = await transform(tsSource, {
      loader: "ts",
      format: "esm",
      target: "es2020",
    });
    await fs.writeFile(
      tsPath.replace(/\.ts$/, ".js"),
      addJsImportExtensions(transformed.code),
      "utf8",
    );
  }
  for (const [relativePath, content] of cppFiles.entries()) {
    const headerPath = path.join(outputRoot, relativePath);
    await fs.mkdir(path.dirname(headerPath), { recursive: true });
    await fs.writeFile(headerPath, content, "utf8");
  }

  console.log(
    `Generated ${tsFiles.size} TS (+JS) and ${cppFiles.size} C++ runtime contract files into ${path.relative(packageRoot, outputRoot)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
