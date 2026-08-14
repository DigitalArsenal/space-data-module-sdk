#!/usr/bin/env node
/**
 * Build the SDK playground — the in-browser C++ compile surface for the
 * harness families (graph task sdk-playground-emception).
 *
 * WHAT THIS SCRIPT IS FOR
 * -----------------------
 * The playground compiles C++ IN THE BROWSER with the SAME emception llvm-box
 * (clang + wasm-ld as wasm) the SDK already uses on the node side
 * (src/compiler/compileModule.js -> compileWithEmception). Nothing about the
 * compiler is re-vendored here: `sdn-emception` is the one artifact, copied
 * verbatim into public/vendor/emception so the page loads ZERO external-origin
 * bytes (node-UI law).
 *
 * What the BROWSER cannot do is generate the SDK's compile SUPPORT FILES: the
 * embedded-manifest source, the invoke bridge, the flatbuffers C++ runtime
 * headers and the generated SDS schema headers all come from node-side
 * generators (flatc-wasm over the pinned spacedatastandards.org tarball, plus
 * fs reads). So this script runs those SDK generators AT BUILD TIME and emits
 * them as a static JSON asset per family. The browser then writes exactly
 * those bytes into the emception FS and runs exactly the SDK's em++ command
 * sequence. The generation logic is the SDK's own — imported, never retyped.
 *
 * HONESTY BOUNDARY (Janus ruling, 2026-08-14)
 * -------------------------------------------
 * The emitted bytes are a TEACHING artifact. em++ -s STANDALONE_WASM=1
 * (single-thread) is sanctioned for the playground ONLY: it is never written
 * to dist/isomorphic/module.wasm, never called "conformant", and the shipped
 * module's real isomorphic wasm32-wasip1-threads / wasi-sequential artifact
 * stays a SERVER-DEFERRED lane that the UI names as a GAP. Tri-runtime parity
 * is unproven in the browser and is rendered as a named GAP, never a PASS.
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build as esbuild } from "esbuild";

import { generateEmbeddedManifestSource } from "../src/embeddedManifest.js";
import {
  generateInvokeSupportHeader,
  generateInvokeSupportSource,
} from "../src/compiler/invokeGlue.js";
import {
  getFlatbuffersCppRuntimeHeaders,
  getInvokeCppSchemaHeaders,
} from "../src/compiler/flatcSupport.js";
import { DefaultInvokeExports } from "../src/runtime/constants.js";

import { FAMILIES } from "./src/families.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SDK_ROOT = path.resolve(HERE, "..");
const PUBLIC_DIR = path.join(HERE, "public");
const ASSET_DIR = path.join(PUBLIC_DIR, "assets");
const VENDOR_DIR = path.join(PUBLIC_DIR, "vendor");

/**
 * Mirror of compileModule.js's EMSCRIPTEN_MEMORY_GROWTH_NOTIFY_SHIM (line 77).
 * It is a module-private constant there; two lines of C reproduced here beat
 * reaching into another agent's claimed file to export it.
 */
const EMSCRIPTEN_MEMORY_GROWTH_NOTIFY_SHIM = `
extern "C" __attribute__((weak)) void emscripten_notify_memory_growth(int) {}
`;

function substitute(text, replacements) {
  let out = String(text);
  for (const [token, value] of Object.entries(replacements)) {
    out = out.replaceAll(token, value);
  }
  return out;
}

/**
 * Build the support-file bundle for ONE family example.
 *
 * `exportedSymbols` reproduces compileModuleFromSource's list exactly (see
 * compileModule.js:1223) so the linked export set is the SDK's, not an
 * approximation: the conformance suite's Tier-0 structural check reads that
 * set directly.
 */
async function buildFamilyAsset(family, shared) {
  if (family.status !== "shipped") {
    return {
      id: family.id,
      label: family.label,
      group: family.group,
      status: family.status,
      statusNote: family.statusNote,
      ratified: false,
      examples: [],
      build: null,
    };
  }

  const templateDir = path.join(SDK_ROOT, family.templateDir);
  const rawManifest = JSON.parse(
    await readFile(path.join(templateDir, "plugin-manifest.json"), "utf8"),
  );
  const manifest = JSON.parse(
    substitute(JSON.stringify(rawManifest), family.replacements),
  );
  // The playground's browser lane is the emception single-thread lane. The
  // shipped module's manifest declares wasi-sequential, which routes to the
  // node-only clang wasm32-wasip1-threads toolchain (compileModule.js:1257).
  // Overriding it here is the ONE deviation, and it is surfaced in the UI as
  // the browser-lane gap rather than hidden.
  const shippedThreadModel = manifest.threadModel;
  manifest.threadModel = "single-thread";
  delete manifest.sequentialJustification;

  const includeCommandMain = Array.isArray(manifest.invokeSurfaces)
    ? manifest.invokeSurfaces.includes("command")
    : false;

  const manifestSource = generateEmbeddedManifestSource({ manifest });
  const invokeHeaderSource = generateInvokeSupportHeader();
  const invokeSource =
    EMSCRIPTEN_MEMORY_GROWTH_NOTIFY_SHIM +
    generateInvokeSupportSource({ manifest, includeCommandMain });

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

  const abiHeaders = {};
  for (const relative of family.abiHeaders) {
    abiHeaders[relative] = await readFile(
      path.join(SDK_ROOT, "include", relative),
      "utf8",
    );
  }

  const examples = [];
  for (const example of family.examples) {
    const sourcePath = example.file
      ? example.file
      : path.posix.join(family.templateDir, example.template);
    const raw = await readFile(
      example.file
        ? path.join(SDK_ROOT, example.file)
        : path.join(templateDir, example.template),
      "utf8",
    );
    examples.push({
      id: example.id,
      title: example.title,
      summary: example.summary,
      sourcePath,
      sourceCode: substitute(raw, family.replacements),
      language: "c++",
    });
  }

  return {
    id: family.id,
    label: family.label,
    group: family.group,
    status: family.status,
    statusNote: family.statusNote,
    ratified: true,
    conformanceKit: family.conformanceKit,
    examples,
    // One build context per family: every example in a family links against
    // the same generated ABI header, invoke bridge and embedded manifest.
    build: {
      manifest,
      shippedThreadModel,
      browserThreadModel: "single-thread",
      manifestSource,
      invokeHeaderSource,
      invokeSource,
      exportedSymbols,
      abiHeaders,
      runtimeHeaders: shared.runtimeHeaders,
      schemaHeaders: shared.schemaHeaders,
    },
  };
}

async function main() {
  await rm(ASSET_DIR, { recursive: true, force: true });
  await mkdir(ASSET_DIR, { recursive: true });

  // The SDK's own generators — flatc-wasm over the pinned SDS tarball.
  const [runtimeHeaders, schemaHeaders] = await Promise.all([
    getFlatbuffersCppRuntimeHeaders(),
    getInvokeCppSchemaHeaders(),
  ]);
  const shared = { runtimeHeaders, schemaHeaders };

  const families = [];
  for (const family of FAMILIES) {
    families.push(await buildFamilyAsset(family, shared));
  }

  const sdkPackage = JSON.parse(
    await readFile(path.join(SDK_ROOT, "package.json"), "utf8"),
  );

  await writeFile(
    path.join(ASSET_DIR, "families.json"),
    `${JSON.stringify(
      {
        generatedBy: "playground/build.mjs",
        sdkVersion: sdkPackage.version,
        emceptionVersion: sdkPackage.dependencies["sdn-emception"],
        families,
      },
      null,
      2,
    )}\n`,
  );

  // The compiler artifact — copied, never rebuilt. One llvm-box in the stack.
  await rm(VENDOR_DIR, { recursive: true, force: true });
  await mkdir(VENDOR_DIR, { recursive: true });
  await cp(
    path.join(SDK_ROOT, "node_modules", "sdn-emception", "build", "emception"),
    path.join(VENDOR_DIR, "emception"),
    { recursive: true, dereference: true },
  );

  // src/conformance/abiDriver.js imports node:fs/promises for its NODE loader
  // (loadPropagatorArtifact). The playground never calls that function — it
  // instantiates bytes it just compiled in memory — so the import is stubbed
  // rather than shipped. A stub that THROWS, not one that returns undefined:
  // if a future edit reaches for the node loader in the browser, it must fail
  // loudly at the call, not read as an empty file.
  const nodeStubPlugin = {
    name: "node-builtin-stub",
    setup(build) {
      build.onResolve({ filter: /^node:/ }, (args) => ({
        path: args.path,
        namespace: "node-stub",
      }));
      build.onLoad({ filter: /.*/, namespace: "node-stub" }, (args) => ({
        contents:
          `const refuse = () => { throw new Error(${JSON.stringify(
            `${args.path} is not available in the browser playground lane`,
          )}); };\n` +
          "export default new Proxy({}, { get: refuse });\n" +
          "export const readFile = refuse;\n",
        loader: "js",
      }));
    },
  };

  await esbuild({
    plugins: [nodeStubPlugin],
    entryPoints: [
      path.join(HERE, "src", "app.js"),
      path.join(HERE, "src", "compileWorker.js"),
    ],
    outdir: path.join(PUBLIC_DIR, "bundle"),
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    // The conformance driver reaches src/bundle/wasm.js for the wasm section
    // parser, and that module's graph pulls in the whole spacedatastandards.org
    // JS record library (~5 MB unminified). Splitting that graph belongs to the
    // SDK's own module layout, not to this page, so the playground minifies and
    // records the cost rather than reaching into another task's files.
    minify: true,
    sourcemap: false,
    logLevel: "info",
  });

  process.stdout.write(
    `playground built: ${families.filter((f) => f.ratified).length} ratified family example(s), ` +
      `${families.length - families.filter((f) => f.ratified).length} declared-not-ratified stub(s)\n`,
  );
}

await main();
