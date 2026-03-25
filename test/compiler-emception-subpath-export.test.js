import test from "node:test";
import assert from "node:assert/strict";

import {
  createIsolatedEmceptionSession,
  createSharedEmceptionSession,
  loadSharedEmception,
  withSharedEmception,
} from "space-data-module-sdk/compiler/emception";
import { createSharedEmceptionSession as createFromCompilerIndex } from "space-data-module-sdk/compiler";

test("compiler emception helpers are exported from compiler surfaces", () => {
  assert.equal(typeof createSharedEmceptionSession, "function");
  assert.equal(typeof createIsolatedEmceptionSession, "function");
  assert.equal(typeof loadSharedEmception, "function");
  assert.equal(typeof withSharedEmception, "function");
  assert.equal(createFromCompilerIndex, createSharedEmceptionSession);
});

test("shared emception session exposes stable locked filesystem helpers", async () => {
  const sharedA = await loadSharedEmception();
  const sharedB = await loadSharedEmception();
  assert.equal(sharedA, sharedB);

  const session = createSharedEmceptionSession();
  const rootDir = `/working/emception-public-api-${Date.now().toString(16)}`;
  const filePath = `${rootDir}/hello.txt`;

  await session.withLock((handle) => {
    assert.equal(handle.exists(rootDir), false);
    handle.mkdirTree(rootDir);
    handle.writeFile(filePath, "hello from emception\n");
    assert.equal(handle.exists(filePath), true);
    assert.equal(handle.readFile(filePath, { encoding: "utf8" }), "hello from emception\n");
    const result = handle.run("emcc --version", { throwOnNonZero: false });
    assert.equal(result.exitCode, 0);
    handle.removeTree(rootDir);
    assert.equal(handle.exists(rootDir), false);
  });
});

test("isolated emception sessions use distinct compiler instances", async () => {
  const sharedSession = createSharedEmceptionSession();
  const isolatedSessionA = createIsolatedEmceptionSession();
  const isolatedSessionB = createIsolatedEmceptionSession();

  const [sharedRaw, isolatedRawA, isolatedRawB] = await Promise.all([
    sharedSession.load(),
    isolatedSessionA.load(),
    isolatedSessionB.load(),
  ]);

  assert.notEqual(sharedRaw, isolatedRawA);
  assert.notEqual(isolatedRawA, isolatedRawB);
});
