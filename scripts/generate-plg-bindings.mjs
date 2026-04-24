import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";
import { FlatcRunner } from "flatc-wasm";

/**
 * Generate TS + JS bindings for the canonical spacedatastandards.org `PLG`
 * plugin manifest schema. The root table and the .fbs file share a name
 * (`PLG`), which causes the stock flatc TS backend to emit a barrel file
 * that collides with the class file. We sidestep that by feeding flatc a
 * virtual schema path whose basename differs from the root table; the
 * class file then ends up at `plg.ts` and the barrel at
 * `plg-manifest.ts`, which we rename to `index.ts` in the output tree.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const schemaPath = path.join(
  packageRoot,
  "schemas",
  "spacedatastandards",
  "PLG.fbs",
);
const outputRoot = path.join(
  packageRoot,
  "src",
  "generated",
  "spacedatastandards",
  "plg",
);

const VIRTUAL_ENTRY = "/schemas/plg-manifest.fbs";

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

async function main() {
  const fbs = await fs.readFile(schemaPath, "utf8");
  const flatc = await FlatcRunner.init();
  const generated = flatc.generateCode(
    { entry: VIRTUAL_ENTRY, files: { [VIRTUAL_ENTRY]: fbs } },
    "ts",
  );

  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(outputRoot, { recursive: true });

  for (const [relPath, tsSource] of Object.entries(generated)) {
    if (!relPath.endsWith(".ts")) {
      continue;
    }
    // The barrel file ends up named after the virtual entry (`plg-manifest.ts`).
    // Rename it to `index.ts` so consumers can import from the directory.
    const outputName =
      relPath === "plg-manifest.ts" ? "index.ts" : relPath;
    const tsPath = path.join(outputRoot, outputName);
    const jsPath = tsPath.replace(/\.ts$/, ".js");
    await fs.mkdir(path.dirname(tsPath), { recursive: true });
    await fs.writeFile(tsPath, tsSource, "utf8");

    const transformed = await transform(tsSource, {
      loader: "ts",
      format: "esm",
      target: "es2020",
    });
    await fs.writeFile(
      jsPath,
      addJsImportExtensions(transformed.code),
      "utf8",
    );
  }

  console.log(
    `Generated PLG TS+JS bindings into ${path.relative(packageRoot, outputRoot)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
