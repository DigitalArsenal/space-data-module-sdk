import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { readdirSync, statSync } from "node:fs";

const repoRoot = resolve(".");
const forbidden = [
  /\bcrypto\.subtle\b/,
  /\bwebcrypto\.subtle\b/,
  /\bSubtleCrypto\b/,
  /\bderiveBits\b/,
  /\bderiveKey\b/,
];

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) out.push(...listFiles(absolute));
    else if (/\.(js|mjs|ts)$/.test(entry)) out.push(absolute);
  }
  return out;
}

test("SDK production runtime does not use browser WebCrypto", () => {
  const failures = [];
  for (const file of listFiles(resolve(repoRoot, "src"))) {
    const source = readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        failures.push(`${relative(repoRoot, file)} matches ${pattern}`);
      }
    }
  }

  assert.deepEqual(failures, []);
});
