import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileModuleFromSource } from "space-data-module-sdk/compiler";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL(".", import.meta.url));
const manifest = JSON.parse(await fs.readFile(path.join(root, "plugin-manifest.json"), "utf8"));
const source = await fs.readFile(path.join(root, "src/reference_estimation.cpp"), "utf8");
const propagatorHeader = await fs.readFile(
  require.resolve("space-data-module-sdk/include/orbpro/orbpro_propagator_abi.h"), "utf8");
const estimationHeader = (await fs.readFile(
  require.resolve("space-data-module-sdk/include/orbpro/orbpro_estimation_abi.h"), "utf8"))
  .replace('#include "orbpro/orbpro_propagator_abi.h"', "");
const translationUnit = source
  .replace('#include "orbpro/orbpro_propagator_abi.h"', propagatorHeader)
  .replace('#include "orbpro/orbpro_estimation_abi.h"', estimationHeader);
const outputPath = path.join(root, "dist/isomorphic/module.wasm");
await fs.rm(path.join(root, "dist"), { recursive: true, force: true });
await fs.mkdir(path.dirname(outputPath), { recursive: true });
const result = await compileModuleFromSource({
  manifest,
  sourceCode: translationUnit,
  language: "c++",
  outputPath,
  threadModel: manifest.threadModel,
});
if (!result.report?.ok) throw new Error(JSON.stringify(result.report?.issues ?? [], null, 2));
await fs.copyFile(path.join(root, "plugin-manifest.json"), path.join(root, "dist/plugin-manifest.json"));
console.log(`Built ${path.relative(root, outputPath)} with ${result.compiler}`);
