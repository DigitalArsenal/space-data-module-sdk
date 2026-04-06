import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SDK_ROOT = path.resolve(TEST_DIR, "..");
const SRC_ROOT = path.join(SDK_ROOT, "src");

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(target);
      continue;
    }
    yield target;
  }
}

test("sdk source never imports flatbuffers through relative node_modules paths", async () => {
  const offenders = [];
  for await (const file of walk(SRC_ROOT)) {
    if (!file.endsWith(".js") && !file.endsWith(".ts")) {
      continue;
    }
    const source = await readFile(file, "utf8");
    if (source.includes("node_modules/flatbuffers/mjs/flatbuffers.js")) {
      offenders.push(path.relative(SDK_ROOT, file));
    }
  }
  assert.deepEqual(offenders, []);
});
