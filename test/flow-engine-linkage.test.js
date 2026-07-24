import test from "node:test";
import assert from "node:assert/strict";

import {
  checkFlowProgram,
  compileFlowProgram,
  ENGINE_LINK_CAPABILITY,
} from "../src/flow/flowCompiler.js";

function retiredEngineFlow() {
  return {
    programId: "test.retired-engine-linkage",
    name: "Retired engine linkage",
    version: "0.1.0",
    engineLinkage: "flatsql",
    nodes: [],
    edges: [],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [],
    requiredPlugins: [],
  };
}

test("flow compiler rejects retired in-process FlatSQL engine linkage", async () => {
  const flow = retiredEngineFlow();
  const dependencies = new Map();
  const check = checkFlowProgram({ flow, dependencies });

  assert.equal(check.ok, false);
  assert.ok(
    check.errors.some(
      (issue) =>
        issue.code === "invalid-engine-linkage" &&
        /independently signed and instantiated isomorphic WASM node/.test(
          issue.message,
        ),
    ),
    JSON.stringify(check.issues),
  );
  assert.equal(check.capabilities.includes(ENGINE_LINK_CAPABILITY), false);

  await assert.rejects(
    () => compileFlowProgram({ flow, dependencies }),
    (error) =>
      error?.check?.errors?.some(
        (issue) => issue.code === "invalid-engine-linkage",
      ) === true,
  );
});
