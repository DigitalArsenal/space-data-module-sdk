import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const generatedStandardsRoot = path.join(
  repoRoot,
  "src",
  "generated",
  "spacedatastandards",
);

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function* walkFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(target);
    } else {
      yield target;
    }
  }
}

function findExactCaseImportFailures(root) {
  const importPattern =
    /(?:export\s+\*\s+from|import\s+[^;]+?\s+from)\s+["'](\.\/[^"']+\.js)["']/g;
  const failures = [];

  for (const file of walkFiles(root)) {
    if (!/\.(?:d\.ts|js|ts)$/.test(file)) {
      continue;
    }

    const source = fs.readFileSync(file, "utf8");
    let match;
    while ((match = importPattern.exec(source)) !== null) {
      const specifier = match[1];
      const target = path.resolve(path.dirname(file), specifier);
      const directory = path.dirname(target);
      const expectedName = path.basename(target);
      const actualNames = fs.readdirSync(directory);
      if (!actualNames.includes(expectedName)) {
        const actualName = actualNames.find(
          (name) => name.toLowerCase() === expectedName.toLowerCase(),
        );
        failures.push(
          `${path.relative(repoRoot, file)} imports ${specifier}${
            actualName ? ` but the exact file is ${actualName}` : ""
          }`,
        );
      }
    }
  }

  return failures;
}

test("PLG binding generation uses SDS-owned schema rather than an SDK-local schema copy", () => {
  const generator = readRepoFile("scripts/generate-plg-bindings.mjs");
  const localPlgSchemaPath = path.join(
    repoRoot,
    "schemas",
    "spacedatastandards",
    "PLG.fbs",
  );

  assert.equal(
    fs.existsSync(localPlgSchemaPath),
    false,
    "SDK must not own a shadow PLG.fbs schema; canonical PLG lives in SDS",
  );
  assert.doesNotMatch(
    generator,
    /schemas[\\/]+spacedatastandards[\\/]+PLG\.fbs/,
  );
  assert.match(generator, /spacedatastandards\.org/);
  assert.match(generator, /SPACE_DATA_STANDARDS_ROOT/);
  assert.match(generator, /"schema"[\s\S]*"PLG"[\s\S]*"main\.fbs"/);
});

test("generated SDS binding imports resolve with exact filename casing", () => {
  assert.deepEqual(findExactCaseImportFailures(generatedStandardsRoot), []);
});

test("generated PLG mirror preserves SDS root filename casing", () => {
  const plgRoot = path.join(generatedStandardsRoot, "plg");
  const entries = new Set(fs.readdirSync(plgRoot));

  assert.equal(entries.has("PLG.js"), true);
  assert.equal(entries.has("PLG.ts"), true);
  assert.equal(entries.has("plg.js"), false);
  assert.equal(entries.has("plg.ts"), false);
  assert.match(
    readRepoFile("src/generated/spacedatastandards/plg/main.js"),
    /'\.\/PLG\.js'/,
  );
  assert.match(
    readRepoFile("src/generated/spacedatastandards/plg/main.ts"),
    /'\.\/PLG\.js'/,
  );
});
