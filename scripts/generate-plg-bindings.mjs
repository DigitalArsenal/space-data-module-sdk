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
export const packageRoot = path.resolve(__dirname, "..");
export const defaultOutputRoot = path.join(
  packageRoot,
  "src",
  "generated",
  "spacedatastandards",
  "plg",
);

/**
 * Resolve the spacedatastandards.org package root. `SPACE_DATA_STANDARDS_ROOT`
 * is a DEVELOPER convenience for regenerating against a local uncommitted SDS
 * checkout — never sanctioned for an automated gate, which must always mirror
 * the RELEASED, npm-pinned package (hard-no-unreleased-deps-gate). Callers
 * that need to refuse the override entirely should check
 * `process.env.SPACE_DATA_STANDARDS_ROOT` themselves before calling this.
 */
export function resolveSdsPackageRoot() {
  return process.env.SPACE_DATA_STANDARDS_ROOT
    ? path.resolve(process.env.SPACE_DATA_STANDARDS_ROOT)
    : path.dirname(require.resolve("spacedatastandards.org/package.json"));
}

/**
 * Mirror the SDS PLG bindings into `outputRoot` (defaults to the committed
 * tree). Returns the resolved sdsPackageRoot used, for callers that want to
 * report provenance.
 */
export async function generatePlgBindings({
  outputRoot = defaultOutputRoot,
  sdsPackageRoot = resolveSdsPackageRoot(),
} = {}) {
  const sdsSchemaRoot = path.join(sdsPackageRoot, "schema");
  const schemaPath = path.join(sdsSchemaRoot, "PLG", "main.fbs");
  const jsBindingsRoot = path.join(sdsPackageRoot, "lib", "js", "PLG");
  const tsBindingsRoot = path.join(sdsPackageRoot, "lib", "ts", "PLG");

  await fs.access(schemaPath);
  await fs.access(jsBindingsRoot);
  await fs.access(tsBindingsRoot);
  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.cp(jsBindingsRoot, outputRoot, { recursive: true });
  await fs.cp(tsBindingsRoot, outputRoot, { recursive: true });

  return { sdsPackageRoot, outputRoot };
}

async function main() {
  const { sdsPackageRoot, outputRoot } = await generatePlgBindings();
  console.log(
    `Mirrored SDS PLG TS+JS bindings from ${sdsPackageRoot} into ${path.relative(packageRoot, outputRoot)}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
