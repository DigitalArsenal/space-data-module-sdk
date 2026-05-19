import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMPILED_RUNTIME_EXPORTS,
  COMPILED_RUNTIME_HOST_DISPATCH,
  COMPILED_RUNTIME_HOST_IMPORT_MODULE,
} from "../src/runtime/index.js";

test("compiled runtime ABI uses space-data-module-sdk names only", () => {
  assert.equal(COMPILED_RUNTIME_HOST_IMPORT_MODULE, "space_data_module_host");
  assert.equal(COMPILED_RUNTIME_HOST_DISPATCH, "dispatch_current_invocation");

  for (const value of Object.values(COMPILED_RUNTIME_EXPORTS)) {
    assert.equal(typeof value, "string");
    assert.equal(value.includes("sdn_flow"), false);
    assert.equal(
      value.startsWith("space_data_module_runtime_") ||
        value === "malloc" ||
        value === "free",
      true,
    );
  }
});

test("compiled runtime JSON ABI mirrors the JavaScript contract", async () => {
  const json = JSON.parse(
    await readFile(
      new URL("../src/runtime/compiledRuntimeAbi.json", import.meta.url),
      "utf8",
    ),
  );

  assert.equal(json.hostImportModule, COMPILED_RUNTIME_HOST_IMPORT_MODULE);
  assert.equal(json.hostDispatchImport, COMPILED_RUNTIME_HOST_DISPATCH);
  assert.deepEqual(json.exports, COMPILED_RUNTIME_EXPORTS);
});
