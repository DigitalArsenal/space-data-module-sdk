import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const excludedNames = new Set(["node_modules", ".git", "CHANGELOG.md"]);
// Construct the retired name in parts so this file is included in its own scan.
const retiredName = new RegExp(["hp", "op"].join(""), "i");

function findRetiredReferences(directory, matches = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (excludedNames.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      findRetiredReferences(fullPath, matches);
    } else if (entry.isFile() && retiredName.test(readFileSync(fullPath, "utf8"))) {
      matches.push(path.relative(repoRoot, fullPath));
    }
  }
  return matches;
}

try {
  assert.deepEqual(findRetiredReferences(repoRoot), [], "Retired name remains in the tree");
  console.log("PASS: tree contains zero retired-name references (case-insensitive)");

  const crosswalk = JSON.parse(
    readFileSync(path.join(repoRoot, "schemas/orbpro/reference-frame-crosswalk.json"), "utf8"),
  );
  const vocabulary = crosswalk.vocabularies.find((entry) => entry.id === "modules.ffm.coords");
  assert.ok(vocabulary, "Missing modules.ffm.coords crosswalk entry");
  assert.equal(vocabulary.source, "propagator/ffm/lib/coords_types.h");
  console.log("PASS: modules.ffm.coords source is propagator/ffm/lib/coords_types.h");

  const { siblingPluginSpecs } = await import("./support/siblingPluginFixtures.js");
  const spec = siblingPluginSpecs.find((entry) => entry.name === "ffm");
  assert.ok(spec, "Missing ffm sibling plugin spec");
  assert.equal(spec.packagePath, "propagator/ffm");
  console.log("PASS: ffm sibling plugin spec uses propagator/ffm");
  console.log("FFM rename E2E passed (3 checks).");
} catch (error) {
  console.error("FFM rename E2E failed:", error);
  process.exitCode = 1;
}
