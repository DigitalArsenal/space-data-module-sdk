// THE ONE LOAD PATH for signed module artifacts.
//
// A published artifact is `module.wasm || REC trailer` (MBL bundle carrying the
// sds.signature entry). Every wasm engine refuses the trailer, so every loader
// must turn the artifact into engine bytes — and the only function that does
// is openModuleArtifact (signature checked, trailer stripped, in one step).
// Engines that only read FILES get a private copy of exactly the checked
// payload from stageModuleArtifact. Both directions are proven here:
//
//  - a raw engine handed the signed artifact as delivered refuses it, and the
//    same engine runs the staged payload;
//  - a tampered, forged, re-trailered or (under policy) unsigned or
//    untrusted artifact never reaches an engine or a staged file, through any
//    SDK loader;
//  - the bytes an engine runs are the bytes that were checked, even when the
//    delivered file is swapped after the load (no re-read).

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendWasmCustomSection,
  createSingleFileBundle,
  openModuleArtifact,
  signModuleArtifact,
} from "../src/bundle/index.js";
import {
  isStagedModuleArtifact,
  stageModuleArtifact,
} from "../src/bundle/stageModuleArtifact.js";
import { extractPublicationRecordCollection } from "../src/transport/records.js";
import { createBrowserModuleHarness } from "../src/host/browserModuleHarness.js";
import { loadModule } from "../src/host/isomorphicLoader.js";
import { createModuleHarness } from "../src/testing/moduleHarness.js";
import { resolveWasmEdgePluginLaunchPlan } from "../src/testing/processInvoke.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SDK_INDEX = path.resolve(HERE, "..", "src", "index.js");

// (module (func (export "_start"))) — the smallest module a WasmEdge CLI runs.
const BASE_WASM = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x0a, 0x01, 0x06, 0x5f, 0x73, 0x74, 0x61, 0x72, 0x74, 0x00, 0x00,
  0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
]);

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tempDir = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `sdm-verified-${label}-`));

// Fresh keys per run: nothing here trusts a committed key.
const ownerSeedHex = randomBytes(32).toString("hex");
const attackerSeedHex = randomBytes(32).toString("hex");
const signed = await signModuleArtifact(BASE_WASM, { privateKeySeedHex: ownerSeedHex, keyId: "owner" });
const OWNER = signed.signature.publicKeyHex;
const SIGNED = signed.wasmBytes;
const PAYLOAD = extractPublicationRecordCollection(SIGNED).payloadBytes;
const TRUST_OWNER = { verifySignature: { trustedPublicKeys: [OWNER], requireSignature: true } };

function trailerOf(bytes) {
  return bytes.subarray(extractPublicationRecordCollection(bytes).payloadBytes.length);
}
// Code changed after signing, the signed trailer stapled back on verbatim.
const TAMPERED = Uint8Array.from([
  ...appendWasmCustomSection(PAYLOAD, "evil", new TextEncoder().encode("changed after signing")),
  ...trailerOf(SIGNED),
]);
// The owner's public key claimed, a signature the owner never made.
const FORGED = (
  await createSingleFileBundle({
    wasmBytes: PAYLOAD,
    signature: { ...signed.signature, signatureHex: randomBytes(64).toString("hex") },
  })
).wasmBytes;
// Validly signed — by somebody else's key.
const ATTACKER_SIGNED = (
  await signModuleArtifact(BASE_WASM, { privateKeySeedHex: attackerSeedHex, keyId: "owner" })
).wasmBytes;

const REFUSALS = [
  ["tampered", TAMPERED, "hash_mismatch"],
  ["forged", FORGED, "invalid_signature"],
];

test("engines refuse the trailer: the published artifact is not a wasm module", async () => {
  assert.equal(WebAssembly.validate(SIGNED), false);
  assert.equal(WebAssembly.validate(PAYLOAD), true);
});

test("openModuleArtifact: a trusted signature opens to the exact signed payload", async () => {
  const opened = await openModuleArtifact(SIGNED, TRUST_OWNER);
  assert.deepEqual(opened.wasmBytes, BASE_WASM);
  assert.equal(opened.verification.verified, true);
  assert.equal(opened.verification.trusted, true);
  assert.equal(opened.verification.publicKeyHex, OWNER);
});

test("openModuleArtifact: with no trust policy a signed artifact must still be intact, and is reported untrusted", async () => {
  const opened = await openModuleArtifact(SIGNED);
  assert.deepEqual(opened.wasmBytes, BASE_WASM);
  assert.equal(opened.verification.verified, false);
  assert.equal(opened.verification.trusted, false);
  assert.equal(opened.verification.intact, true);
  assert.equal(opened.verification.reason, "no_trust_policy");
});

for (const [label, bytes, code] of REFUSALS) {
  test(`openModuleArtifact: a ${label} artifact is refused under policy, without one, and with verifySignature:false`, async () => {
    for (const options of [TRUST_OWNER, {}, { verifySignature: false }]) {
      await assert.rejects(openModuleArtifact(bytes, options), (error) => error.code === code);
    }
  });
}

test("openModuleArtifact: an artifact signed by an untrusted key is refused under policy; without one it is intact but untrusted", async () => {
  await assert.rejects(openModuleArtifact(ATTACKER_SIGNED, TRUST_OWNER), (error) => error.code === "untrusted_signer");
  const opened = await openModuleArtifact(ATTACKER_SIGNED);
  assert.equal(opened.verification.trusted, false);
});

test("openModuleArtifact: an unsigned module is refused when a signature is required, and passes through when not", async () => {
  await assert.rejects(openModuleArtifact(BASE_WASM, TRUST_OWNER), (error) => error.code === "missing_signature");
  const opened = await openModuleArtifact(BASE_WASM);
  assert.equal(opened.wasmBytes, BASE_WASM);
  assert.equal(opened.verification.signed, false);
});

test("stageModuleArtifact: the checked payload in a private, read-only file; nothing staged for a refused artifact", async () => {
  const dir = tempDir("stage");
  const artifactPath = path.join(dir, "module.wasm");
  fs.writeFileSync(artifactPath, SIGNED);
  const parent = path.join(dir, "staging");
  const staged = await stageModuleArtifact(artifactPath, { ...TRUST_OWNER, directory: parent });
  try {
    assert.ok(isStagedModuleArtifact(staged));
    assert.notEqual(staged.path, artifactPath);
    assert.deepEqual(new Uint8Array(fs.readFileSync(staged.path)), BASE_WASM);
    assert.equal(fs.statSync(staged.path).mode & 0o777, 0o400);
    assert.equal(fs.statSync(staged.directory).mode & 0o777, 0o700);
    assert.equal(staged.verification.verified, true);
  } finally {
    await staged.dispose();
  }
  assert.equal(fs.existsSync(staged.directory), false);
  assert.equal(isStagedModuleArtifact({ path: artifactPath }), false);

  for (const [, bytes, code] of REFUSALS) {
    const refusedPath = path.join(dir, `refused-${code}.wasm`);
    fs.writeFileSync(refusedPath, bytes);
    await assert.rejects(stageModuleArtifact(refusedPath, { directory: parent }), (error) => error.code === code);
  }
  assert.deepEqual(fs.readdirSync(parent), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

function findWasmEdge() {
  const candidates = [
    process.env.SDM_WASMEDGE_BINARY,
    process.env.WASMEDGE_BINARY,
    path.join(os.homedir(), ".wasmedge", "bin", "wasmedge"),
    "wasmedge",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return null;
}

test("a raw WasmEdge engine refuses the signed artifact as delivered and runs the staged payload", async (t) => {
  const wasmedge = findWasmEdge();
  if (!wasmedge) {
    t.skip("WasmEdge is not installed");
    return;
  }
  const dir = tempDir("wasmedge");
  const artifactPath = path.join(dir, "module.wasm");
  fs.writeFileSync(artifactPath, SIGNED);
  const raw = spawnSync(wasmedge, [artifactPath], { encoding: "utf8" });
  assert.notEqual(raw.status, 0);
  assert.match(`${raw.stdout}${raw.stderr}`, /malformed section id|loading failed/);

  const staged = await stageModuleArtifact(artifactPath, TRUST_OWNER);
  try {
    const run = spawnSync(wasmedge, [staged.path], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
  } finally {
    await staged.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveWasmEdgePluginLaunchPlan refuses a published artifact path instead of handing it to the engine", async () => {
  const dir = tempDir("plan");
  const signedPath = path.join(dir, "signed.wasm");
  const plainPath = path.join(dir, "plain.wasm");
  fs.writeFileSync(signedPath, SIGNED);
  fs.writeFileSync(plainPath, BASE_WASM);
  assert.throws(() => resolveWasmEdgePluginLaunchPlan({ wasmPath: signedPath }), (error) => error.code === "unstaged_artifact");
  assert.equal(resolveWasmEdgePluginLaunchPlan({ wasmPath: plainPath }).wasmPath, plainPath);
  fs.rmSync(dir, { recursive: true, force: true });
});

// A stand-in "engine" that behaves like WasmEdge where it matters here: it
// reads the module file named on its command line, refuses anything that is
// not a wasm module, and answers each plugin-invoke request with the SHA-256
// of the bytes it loaded — so a test can see exactly what the engine ran.
function createProbeEngine(dir) {
  const marker = path.join(dir, "engine-started");
  const script = path.join(dir, "probe-engine.mjs");
  fs.writeFileSync(
    script,
    `import fs from "node:fs";
import { createHash } from "node:crypto";
import { encodePluginInvokeResponse } from ${JSON.stringify(SDK_INDEX)};
fs.writeFileSync(${JSON.stringify(marker)}, "started");
const wasmPath = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const bytes = fs.readFileSync(wasmPath);
if (!WebAssembly.validate(bytes)) { process.stderr.write("loading failed: malformed section id\\n"); process.exit(1); }
const digest = createHash("sha256").update(bytes).digest("hex");
let inbox = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  inbox = Buffer.concat([inbox, chunk]);
  while (inbox.length >= 4 && inbox.length >= 4 + inbox.readUInt32LE(0)) {
    inbox = inbox.subarray(4 + inbox.readUInt32LE(0));
    const response = Buffer.from(encodePluginInvokeResponse({ statusCode: 0, outputs: [{ portId: "sha256", payload: new TextEncoder().encode(digest) }] }));
    const prefix = Buffer.alloc(4); prefix.writeUInt32LE(response.length, 0);
    process.stdout.write(Buffer.concat([prefix, response]));
  }
});
process.stdin.on("end", () => process.exit(0));
`,
  );
  const binary = path.join(dir, "probe-engine");
  fs.writeFileSync(binary, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  return { binary, marker };
}

async function engineDigest(harness) {
  const response = await harness.invoke({ methodId: "probe", inputs: [] });
  return new TextDecoder().decode(response.outputs[0].payload);
}

test("createModuleHarness launches WasmEdge on the staged payload, never on the artifact path, and cleans it up", async () => {
  const dir = tempDir("harness");
  const engine = createProbeEngine(dir);
  const artifactPath = path.join(dir, "module.wasm");
  fs.writeFileSync(artifactPath, SIGNED);
  const harness = await createModuleHarness({
    runtime: { kind: "wasmedge", wasmPath: artifactPath, wasmEdgeBinary: engine.binary, ...TRUST_OWNER },
  });
  let stagedPath;
  try {
    stagedPath = harness.launchPlan.wasmPath;
    assert.notEqual(stagedPath, artifactPath);
    assert.equal(await engineDigest(harness), sha256Hex(BASE_WASM));
  } finally {
    await harness.destroy();
  }
  assert.equal(fs.existsSync(stagedPath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("createModuleHarness refuses tampered, forged and untrusted artifacts before any engine starts", async () => {
  const cases = [...REFUSALS, ["untrusted", ATTACKER_SIGNED, "untrusted_signer"]];
  for (const [label, bytes, code] of cases) {
    const dir = tempDir(`refuse-${label}`);
    const engine = createProbeEngine(dir);
    const artifactPath = path.join(dir, "module.wasm");
    fs.writeFileSync(artifactPath, bytes);
    await assert.rejects(
      createModuleHarness({ runtime: { kind: "wasmedge", wasmPath: artifactPath, wasmEdgeBinary: engine.binary, ...TRUST_OWNER } }),
      (error) => error.code === code,
      label,
    );
    assert.equal(fs.existsSync(engine.marker), false, `${label}: the engine must never start`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("createModuleHarness accepts only a genuine stageModuleArtifact result as a pre-staged artifact", async () => {
  const dir = tempDir("fake-stage");
  const artifactPath = path.join(dir, "module.wasm");
  fs.writeFileSync(artifactPath, TAMPERED);
  await assert.rejects(
    createModuleHarness({ runtime: { kind: "wasmedge", stagedArtifact: { path: artifactPath } } }),
    TypeError,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadModule runs the bytes it checked: swapping the delivered file afterwards changes nothing", async () => {
  const dir = tempDir("toctou");
  const engine = createProbeEngine(dir);
  const artifactPath = path.join(dir, "module.wasm");
  fs.writeFileSync(artifactPath, SIGNED);
  const harness = await loadModule({ wasmSource: artifactPath, wasmEdgeBinary: engine.binary, ...TRUST_OWNER });
  try {
    assert.equal(await engineDigest(harness), sha256Hex(BASE_WASM));
    fs.writeFileSync(artifactPath, TAMPERED);
    assert.equal(await engineDigest(harness), sha256Hex(BASE_WASM));
  } finally {
    await harness.destroy();
  }
  for (const [, bytes, code] of REFUSALS) {
    fs.writeFileSync(artifactPath, bytes);
    await assert.rejects(loadModule({ wasmSource: artifactPath, wasmEdgeBinary: engine.binary }), (error) => error.code === code);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the browser harness refuses tampered and forged artifacts even with no trust policy configured", async () => {
  for (const [label, bytes, code] of REFUSALS) {
    await assert.rejects(createBrowserModuleHarness({ wasmSource: bytes, surface: "command" }), (error) => error.code === code, label);
  }
  await assert.rejects(
    createBrowserModuleHarness({ wasmSource: ATTACKER_SIGNED, surface: "command", ...TRUST_OWNER }),
    (error) => error.code === "untrusted_signer",
  );
});
