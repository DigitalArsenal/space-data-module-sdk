// Under a signature policy the Node loader's WasmEdge leg runs the bytes it
// VERIFIED. Through 0.10.4 it verified one read of the caller's file and then
// handed the PATH to the harness, which read the file again: a file swapped in
// between ran unverified. The harness is built here without launching WasmEdge
// (its launch plan is fixed when it is built), so this runs without WasmEdge.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SDK_TEST_SIGNER_PUBLIC_KEY_HEX, signModuleArtifact } from "../src/bundle/signing.js";
import { toLoadableWasmBytes } from "../src/bundle/artifactBytes.js";
import { loadModule } from "../src/host/isomorphicLoader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_KEYPAIR_PATH = path.join(__dirname, "support", "dev-module-signing-keypair.json");

// A WASI command: imports wasi_snapshot_preview1.proc_exit, exports _start,
// whose body is `i32.const <value>; drop`. Two values give two different
// modules of the same shape.
function wasiCommand(value) {
  const name = (text) => [text.length, ...Buffer.from(text, "utf8")];
  const section = (id, payload) => [id, payload.length, ...payload];
  const body = [0x00, 0x41, value & 0x3f, 0x1a, 0x0b];
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [0x02, 0x60, 0x01, 0x7f, 0x00, 0x60, 0x00, 0x00]),
    ...section(2, [0x01, ...name("wasi_snapshot_preview1"), ...name("proc_exit"), 0x00, 0x00]),
    ...section(3, [0x01, 0x01]),
    ...section(7, [0x01, ...name("_start"), 0x00, 0x01]),
    ...section(10, [0x01, body.length, ...body]),
  ]);
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function signedCommandFile(t) {
  const keypair = JSON.parse(await readFile(DEV_KEYPAIR_PATH, "utf8"));
  const signed = new Uint8Array(
    (await signModuleArtifact(wasiCommand(1), {
      privateKeySeedHex: keypair.privateKeySeedHex,
      keyId: keypair.keyId,
    })).wasmBytes,
  );
  const dir = await mkdtemp(path.join(tmpdir(), "sdm-verified-bytes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, "module.wasm");
  await writeFile(source, signed);
  return { source, signed };
}

test("the WasmEdge leg runs the verified bytes even when the file is swapped after the check", async (t) => {
  const { source, signed } = await signedCommandFile(t);
  const swapped = wasiCommand(2);
  const options = {
    wasmSource: source,
    runtimeKind: "wasmedge",
    verifySignature: { trustedPublicKeys: [SDK_TEST_SIGNER_PUBLIC_KEY_HEX] },
  };
  // Read by the runtime-target gate, after the signature check and before
  // the harness is built: the moment a swap would have run unverified.
  let swaps = 0;
  Object.defineProperty(options, "manifest", {
    enumerable: true,
    get() {
      swaps += 1;
      writeFileSync(source, swapped);
      return undefined;
    },
  });

  const harness = await loadModule(options);
  assert.ok(swaps > 0, "the file was swapped during the load");
  assert.deepEqual(new Uint8Array(await readFile(source)), swapped);

  const launchPath = harness.launchPlan.wasmPath;
  assert.notEqual(path.resolve(launchPath), path.resolve(source));
  assert.ok(harness.launchPlan.args.includes(launchPath));
  assert.ok(!harness.launchPlan.args.includes(source));
  const launched = new Uint8Array(await readFile(launchPath));
  assert.deepEqual(launched, toLoadableWasmBytes(signed));
  assert.notDeepEqual(launched, swapped);

  // The verified copy is private and lives as long as the harness.
  const copyPath = harness.verifiedArtifactPath;
  assert.ok(copyPath && (await exists(copyPath)));
  assert.equal((await stat(copyPath)).mode & 0o077, 0);
  await harness.destroy();
  assert.equal(await exists(copyPath), false);
  assert.equal(await exists(path.dirname(copyPath)), false);
});

test("a refused load leaves no verified copy behind", async (t) => {
  const { source } = await signedCommandFile(t);
  // A temporary directory of this test's own, so no other test's files count.
  const ownTmp = await mkdtemp(path.join(tmpdir(), "sdm-verified-bytes-tmp-"));
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = ownTmp;
  t.after(async () => {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    await rm(ownTmp, { recursive: true, force: true });
  });
  assert.equal(tmpdir(), ownTmp);
  await assert.rejects(
    loadModule({
      wasmSource: source,
      runtimeKind: "wasmedge",
      verifySignature: { trustedPublicKeys: [SDK_TEST_SIGNER_PUBLIC_KEY_HEX] },
      // Verifies, then is refused by the runtime-target gate.
      manifest: { runtimeTargets: ["browser"] },
    }),
    /wasmedge|runtime/i,
  );
  assert.deepEqual(await readdir(ownTmp), []);
});

test("without a signature policy the loader reads the caller's path as before (nothing is verified)", async (t) => {
  const { source } = await signedCommandFile(t);
  const harness = await loadModule({ wasmSource: source, runtimeKind: "wasmedge" });
  t.after(() => harness.destroy());
  assert.equal(harness.verifiedArtifactPath, undefined);
});
