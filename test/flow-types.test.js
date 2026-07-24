import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..");

test("flow runtime exports match the root and flow declarations", async () => {
  const [rootRuntime, flowRuntime] = await Promise.all([
    import("../src/index.js"),
    import("../src/flow/index.js"),
  ]);
  for (const exportName of [
    "FLOW_INVALID_INDEX",
    "createFlowRuntimeHost",
    "createIsomorphicFlowRuntimeHost",
  ]) {
    assert.ok(exportName in rootRuntime, `root runtime missing ${exportName}`);
    assert.ok(exportName in flowRuntime, `flow runtime missing ${exportName}`);
  }
  assert.equal(flowRuntime.FLOW_INVALID_INDEX, 0xffffffff);
  assert.equal(rootRuntime.FLOW_INVALID_INDEX, flowRuntime.FLOW_INVALID_INDEX);
  assert.equal(rootRuntime.createFlowRuntimeHost, flowRuntime.createFlowRuntimeHost);
  assert.equal(
    rootRuntime.createIsomorphicFlowRuntimeHost,
    flowRuntime.createIsomorphicFlowRuntimeHost,
  );
});

test("the flow package export publishes Phase 3 TypeScript declarations", async (t) => {
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.exports?.["./flow"]?.types,
    "./src/flow/index.d.ts",
  );
  assert.equal(
    packageJson.exports?.["./flow"]?.default,
    "./src/flow/index.js",
  );

  const declarations = await readFile(
    path.join(repositoryRoot, "src", "index.d.ts"),
    "utf8",
  );
  for (const requiredDeclaration of [
    "export interface FlowTriggerFrameOptions",
    "typeDescriptorCount: number",
    "getEdgeDescriptor(index: number): FlowEdgeDescriptor",
    "getRoutingState(): FlowRoutingState",
    "sha256: string | null",
    "signature: string | null",
    "signerPublicKey: string | null",
    "export function createIsomorphicFlowRuntimeHost",
    "export interface IsomorphicFlowRuntimeHostOptions",
    "nodeId: string",
    "config: Uint8Array",
  ]) {
    assert.ok(
      declarations.includes(requiredDeclaration),
      `missing declaration: ${requiredDeclaration}`,
    );
  }

  const version = spawnSync("tsc", ["--version"], { encoding: "utf8" });
  if (version.error?.code === "ENOENT") {
    t.diagnostic("tsc is unavailable; package export assertion still ran");
    return;
  }
  assert.equal(version.status, 0, version.stderr || version.stdout);

  const result = spawnSync(
    "tsc",
    [
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--lib",
      "ES2022,DOM",
      "test/types/flow-phase3.ts",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
