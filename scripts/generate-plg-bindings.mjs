import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Generate TS + JS bindings for the canonical spacedatastandards.org `PLG`
 * plugin manifest schema. SDS owns the schema and generated bindings; the
 * SDK mirrors those artifacts so module manifest codecs use the exact SDS
 * root table, import paths, and filename casing.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const packageRoot = path.resolve(__dirname, "..");
const sdsPackageRoot = process.env.SPACE_DATA_STANDARDS_ROOT
  ? path.resolve(process.env.SPACE_DATA_STANDARDS_ROOT)
  : path.dirname(require.resolve("spacedatastandards.org/package.json"));
const sdsSchemaRoot = path.join(sdsPackageRoot, "schema");
const schemaPath = path.join(sdsSchemaRoot, "PLG", "main.fbs");
const jsBindingsRoot = path.join(sdsPackageRoot, "lib", "js", "PLG");
const tsBindingsRoot = path.join(sdsPackageRoot, "lib", "ts", "PLG");
const outputRoot = path.join(
  packageRoot,
  "src",
  "generated",
  "spacedatastandards",
  "plg",
);

async function main() {
  await fs.access(schemaPath);
  await fs.access(jsBindingsRoot);
  await fs.access(tsBindingsRoot);
  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.cp(jsBindingsRoot, outputRoot, { recursive: true });
  await fs.cp(tsBindingsRoot, outputRoot, { recursive: true });

  console.log(
    `Mirrored SDS PLG TS+JS bindings into ${path.relative(packageRoot, outputRoot)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
