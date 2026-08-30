#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderAbiArtifacts } from "./generate-propagator-abi.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const header = "include/orbpro/orbpro_estimation_abi.h";
const spec = Object.freeze({
  schemaFileName: "Estimation.fbs",
  generatorScript: "shared schema ABI renderer",
  checkScript: "analysis/estimation/tests/abi_schema_lock.test.mjs",
  contractDoc: "docs/families/estimation.md",
  headerGuard: "ORBPRO_ESTIMATION_ABI_H",
  headerRelativePath: header,
  tsRelativePath: "/private/tmp/estimation-abi.ts",
  jsRelativePath: "/private/tmp/estimation-abi.js",
  bundleConstName: "ORBPRO_ESTIMATION_ABI",
  cIncludes: ["orbpro/orbpro_propagator_abi.h"],
  tsForeignModule: "./propagator-abi.js",
  cLanguageNote: ["/* Fixed-layout estimation ABI; valid in C and C++. */"],
});

const generated = (await renderAbiArtifacts(spec)).get(header);
const committed = await fs.readFile(path.join(root, header), "utf8");
if (generated !== committed) {
  console.error(`${header} is stale; regenerate it from schemas/orbpro/Estimation.fbs`);
  process.exit(1);
}
console.log(`estimation ABI is synchronized (${Buffer.byteLength(committed)} bytes)`);
