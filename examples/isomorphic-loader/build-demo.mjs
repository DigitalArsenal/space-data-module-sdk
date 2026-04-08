import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanupCompilation,
  compileModuleFromSource,
} from "../../src/index.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(currentDir, "manifest.json");
const sourcePath = path.join(currentDir, "module.c");
const outputDir = path.join(currentDir, "generated");
const outputPath = path.join(outputDir, "isomorphic-echo.wasm");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const sourceCode = await readFile(sourcePath, "utf8");

await mkdir(outputDir, { recursive: true });

const compilation = await compileModuleFromSource({
  manifest,
  sourceCode,
  language: "c",
  outputPath,
});

await writeFile(outputPath, compilation.wasmBytes);

console.log(
  JSON.stringify(
    {
      artifactPath: outputPath,
      runtimeTargets: manifest.runtimeTargets,
      threadModel: compilation.threadModel,
      compiler: compilation.compiler,
      exports: compilation.report.exportNames,
    },
    null,
    2,
  ),
);

await cleanupCompilation(compilation);
