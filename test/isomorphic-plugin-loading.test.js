import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createBrowserModuleHarness,
  createHdWalletVerifier,
  createRecipientKeypairHex,
  decryptProtectedBytes,
  extractPublicationRecordCollection,
  inspectModule,
  loadModule,
  protectModuleArtifact,
  validatePluginArtifact,
  verifyAuthorization,
} from "../src/index.js";
import { secp256k1VerifyDigest } from "../src/utils/wasmCrypto.js";
import {
  assertSiblingPluginInvokeResponse,
  createSiblingPluginCommandScenario,
  hasSiblingPluginWorkspace,
  listCheckedOutSiblingPluginSpecs,
  readSiblingPluginManifest,
  readSiblingPluginStandaloneBytes,
  siblingPluginSpecs,
  siblingPluginsRoot,
} from "./support/siblingPluginFixtures.js";

function createAuthorizationVerifier() {
  return createHdWalletVerifier({
    async verifyDigest(digest, signature, header) {
      return secp256k1VerifyDigest(
        digest,
        signature,
        Buffer.from(String(header?.publicKeyHex ?? ""), "hex"),
      );
    },
  });
}

function skipIfSiblingWorkspaceMissing(t) {
  if (hasSiblingPluginWorkspace()) {
    return false;
  }
  t.skip(
    `Set SPACE_DATA_NETWORK_PLUGINS_ROOT to a checked-out space-data-network-plugins workspace. Missing: ${siblingPluginsRoot}`,
  );
  return true;
}

function skipIfStandaloneArtifactsUnavailable(t) {
  if (skipIfSiblingWorkspaceMissing(t)) {
    return true;
  }
  const availableArtifacts = listCheckedOutSiblingPluginSpecs().filter((spec) =>
    fs.existsSync(spec.standaloneArtifactPath),
  );
  if (availableArtifacts.length > 0) {
    return false;
  }
  t.skip(
    `No dist/isomorphic/module.wasm artifacts were found under ${siblingPluginsRoot}. Build the migrated plugin packages first.`,
  );
  return true;
}

test("sibling plugin fixture catalog includes pending migrated packages", () => {
  const names = siblingPluginSpecs.map((spec) => spec.name).sort();
  assert.ok(names.includes("conjunction-assessment"));
  assert.ok(names.includes("hpop"));
});

test("all sibling plugin packages emit standalone artifacts", (t) => {
  if (skipIfStandaloneArtifactsUnavailable(t)) {
    return;
  }
  for (const spec of listCheckedOutSiblingPluginSpecs()) {
    assert.equal(
      fs.existsSync(spec.standaloneArtifactPath),
      true,
      `Missing ${spec.standaloneArtifactPath}. Run ${spec.packageDir}/build.sh after the standalone build path is wired.`,
    );
  }
});

test("all sibling plugin packages emit the canonical shared artifact path", (t) => {
  if (skipIfStandaloneArtifactsUnavailable(t)) {
    return;
  }
  for (const spec of listCheckedOutSiblingPluginSpecs()) {
    assert.equal(
      fs.existsSync(spec.standaloneArtifactPath),
      true,
      `Missing ${spec.standaloneArtifactPath}. Build outputs must place the shared artifact at dist/isomorphic/module.wasm.`,
    );
  }
});

test("browser adapters, when published, live under dist/browser", (t) => {
  if (skipIfStandaloneArtifactsUnavailable(t)) {
    return;
  }
  for (const spec of listCheckedOutSiblingPluginSpecs()) {
    const hasLoader = fs.existsSync(spec.browserLoaderPath);
    const hasBrowserWasm = fs.existsSync(spec.browserArtifactPath);
    assert.equal(
      hasLoader,
      hasBrowserWasm,
      `Browser adapter outputs for ${spec.name} must either publish both dist/browser/module.js and dist/browser/module.wasm or omit both.`,
    );
  }
});

test("real sibling standalone plugin artifacts load through the browser harness", async (t) => {
  if (skipIfStandaloneArtifactsUnavailable(t)) {
    return;
  }
  for (const spec of listCheckedOutSiblingPluginSpecs().filter((entry) =>
    fs.existsSync(entry.standaloneArtifactPath),
  )) {
    await t.test(spec.name, async (t) => {
      const manifest = readSiblingPluginManifest(spec);
      const standaloneBytes = readSiblingPluginStandaloneBytes(spec);
      const scenario = createSiblingPluginCommandScenario(spec);
      const inspection = await inspectModule(standaloneBytes);
      const importedModuleNames = Array.from(
        new Set(inspection.imports.map((entry) => entry.module)),
      ).sort();

      assert.equal(
        inspection.profile,
        spec.expectedIsomorphicProfile ?? "standalone",
      );
      assert.deepEqual(
        importedModuleNames,
        spec.expectedImportModules ?? ["wasi_snapshot_preview1"],
      );

      const report = await validatePluginArtifact({
        manifest,
        wasmPath: spec.standaloneArtifactPath,
      });
      assert.equal(report.ok, true, JSON.stringify(report.issues, null, 2));

      if (spec.skipBrowserHarness) {
        t.skip(spec.skipBrowserHarness);
        return;
      }

      const harness = await createBrowserModuleHarness({
        wasmSource: standaloneBytes,
        surface: "command",
      });
      t.after(() => {
        harness.destroy();
      });

      const response = await harness.invoke({
        methodId: scenario.methodId,
        inputs: scenario.inputs,
      });
      assertSiblingPluginInvokeResponse(spec, response);
    });
  }
});

test("real sibling standalone plugin artifacts can round-trip in WasmEdge", async (t) => {
  if (skipIfStandaloneArtifactsUnavailable(t)) {
    return;
  }
  if (process.env.SPACE_DATA_MODULE_SDK_ENABLE_WASMEDGE_PLUGIN_PARITY !== "1") {
    t.skip(
      "Set SPACE_DATA_MODULE_SDK_ENABLE_WASMEDGE_PLUGIN_PARITY=1 to run live WasmEdge parity checks for sibling plugins.",
    );
    return;
  }

  for (const spec of listCheckedOutSiblingPluginSpecs().filter((entry) =>
    fs.existsSync(entry.standaloneArtifactPath),
  )) {
    await t.test(spec.name, async (t) => {
      let harness;
      try {
        harness = await loadModule({
          wasmSource: spec.standaloneArtifactPath,
          runtimeKind: "wasmedge",
        });
      } catch (error) {
        if (/spawn wasmedge ENOENT|command not found|Failed to launch/i.test(String(error))) {
          t.skip("Install wasmedge to verify standalone plugin parity.");
          return;
        }
        throw error;
      }
      t.after(async () => {
        await harness.destroy();
      });

      const scenario = createSiblingPluginCommandScenario(spec);
      const response = await harness.invoke({
        methodId: scenario.methodId,
        inputs: scenario.inputs,
      });
      assertSiblingPluginInvokeResponse(spec, response);
    });
  }
});

test("real sibling standalone plugin artifacts round-trip through signing and encryption protection", async (t) => {
  if (skipIfStandaloneArtifactsUnavailable(t)) {
    return;
  }
  const verifier = createAuthorizationVerifier();

  for (const spec of listCheckedOutSiblingPluginSpecs().filter((entry) =>
    fs.existsSync(entry.standaloneArtifactPath),
  )) {
    await t.test(spec.name, async () => {
      const manifest = readSiblingPluginManifest(spec);
      const standaloneBytes = readSiblingPluginStandaloneBytes(spec);

      const signedOnly = await protectModuleArtifact({
        artifactId: `${spec.name}-standalone-signed`,
        manifest,
        wasmBytes: standaloneBytes,
      });
      const signedPublication = extractPublicationRecordCollection(
        signedOnly.protectedArtifactBytes,
      );
      assert.ok(signedPublication?.pnm);
      assert.equal(signedPublication?.enc ?? null, null);
      assert.equal(
        await verifyAuthorization({
          envelope: signedOnly.payload.authorization,
          verifier,
        }),
        true,
      );

      const recipient = await createRecipientKeypairHex();
      const encryptedDelivery = await protectModuleArtifact({
        artifactId: `${spec.name}-standalone-encrypted`,
        manifest,
        wasmBytes: standaloneBytes,
        recipientPublicKeyHex: recipient.publicKeyHex,
      });
      const encryptedPublication = extractPublicationRecordCollection(
        encryptedDelivery.protectedArtifactBytes,
      );
      assert.ok(encryptedPublication?.pnm);
      assert.ok(encryptedPublication?.enc);
      assert.equal(
        await verifyAuthorization({
          envelope: encryptedDelivery.payload.authorization,
          verifier,
        }),
        true,
      );

      const decryptedBytes = await decryptProtectedBytes({
        protectedBytes: encryptedDelivery.protectedArtifactBytes,
        recipientPrivateKey: recipient.privateKeyHex,
      });
      assert.deepEqual(
        Array.from(decryptedBytes),
        Array.from(standaloneBytes),
      );
    });
  }
});
