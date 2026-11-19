// The trailer's manifest copy is not covered by the publication signature.
// Every reader takes the manifest from the SIGNED code, and an artifact whose
// trailer copy differs from the code's copy is refused by name.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ModuleSignatureError,
  signModuleArtifact,
  verifyModuleArtifact,
} from "../src/bundle/signing.js";
import {
  readBoundManifestBytes,
  readSignedCodeManifest,
  readTrailerManifestBytes,
} from "../src/bundle/codeManifest.js";
import {
  appendWasmCustomSection,
  createSingleFileBundle,
} from "../src/bundle/wasm.js";
import { SDS_MANIFEST_SECTION_NAME } from "../src/bundle/constants.js";
import { encodePluginManifest } from "../src/manifest/index.js";
import { decodePlgManifest } from "../src/manifest/plgCodec.js";
import {
  locateBoundPlgManifest,
  locateEmbeddedPlgManifest,
  validatePluginArtifact,
} from "../src/compliance/index.js";
import {
  appendPublicationRecordCollection,
  encodePublicationRecordCollection,
  extractPublicationRecordCollection,
} from "../src/transport/records.js";
import { loadModule } from "../src/host/isomorphicLoader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_KEYPAIR_PATH = path.join(__dirname, "support", "dev-module-signing-keypair.json");

const MANIFEST_OFFSET = 1024;

function uleb(value) {
  const out = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return out;
}

function sleb(value) {
  const out = [];
  let v = value | 0;
  for (;;) {
    const byte = v & 0x7f;
    v >>= 7;
    if ((v === 0 && (byte & 0x40) === 0) || (v === -1 && (byte & 0x40) !== 0)) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

const name = (text) => [...uleb(text.length), ...Buffer.from(text, "utf8")];
const section = (id, payload) => [id, ...uleb(payload.length), ...payload];

// A wasm module whose CODE carries `manifestBytes`: one memory, an active data
// segment at MANIFEST_OFFSET, and the two manifest exports returning its
// pointer and size. With `customSection`, the same bytes also ride in an
// `sds.manifest` custom section, which the SDK's signer moves to the trailer.
function moduleCarryingManifest(manifestBytes, { customSection = true, exportManifest = true } = {}) {
  const funcBody = (value) => {
    const body = [0x00, 0x41, ...sleb(value), 0x0b];
    return [...uleb(body.length), ...body];
  };
  const exports = [[...name("memory"), 0x02, 0x00]];
  if (exportManifest) {
    exports.push([...name("plugin_get_manifest_flatbuffer"), 0x00, 0x00]);
    exports.push([...name("plugin_get_manifest_flatbuffer_size"), 0x00, 0x01]);
  }
  const bytes = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [0x01, 0x60, 0x00, 0x01, 0x7f]),
    ...section(3, [0x02, 0x00, 0x00]),
    ...section(5, [0x01, 0x00, 0x01]),
    ...section(7, [...uleb(exports.length), ...exports.flat()]),
    ...section(10, [0x02, ...funcBody(MANIFEST_OFFSET), ...funcBody(manifestBytes.length)]),
    ...section(11, [
      0x01, 0x00, 0x41, ...sleb(MANIFEST_OFFSET), 0x0b,
      ...uleb(manifestBytes.length), ...manifestBytes,
    ]),
  ];
  const wasm = Uint8Array.from(bytes);
  return customSection
    ? appendWasmCustomSection(wasm, SDS_MANIFEST_SECTION_NAME, manifestBytes)
    : wasm;
}

function testManifest(overrides = {}) {
  return {
    pluginId: "com.digitalarsenal.test.code-manifest",
    name: "Code manifest fixture",
    version: "1.0.0",
    pluginFamily: "data_source",
    capabilities: [],
    invokeSurfaces: ["direct"],
    runtimeTargets: ["browser", "wasmedge"],
    methods: [],
    schemasUsed: [],
    abiVersion: 1,
    ...overrides,
  };
}

async function loadDevKeypair() {
  return JSON.parse(await readFile(DEV_KEYPAIR_PATH, "utf8"));
}

// The signed file with its trailer manifest replaced after signing, the
// signature entry kept as it was. The bytes before the trailer are unchanged,
// so the publication signature still verifies.
async function withTrailerManifest(signedBytes, signature, manifestBytes) {
  const portable = extractPublicationRecordCollection(signedBytes).payloadBytes;
  const rebuilt = await createSingleFileBundle({
    wasmBytes: new Uint8Array(portable),
    manifestBytes,
    signature,
  });
  return new Uint8Array(rebuilt.wasmBytes);
}

async function signedFixture() {
  const keypair = await loadDevKeypair();
  const manifestBytes = encodePluginManifest(testManifest());
  const signed = await signModuleArtifact(moduleCarryingManifest(manifestBytes), {
    privateKeySeedHex: keypair.privateKeySeedHex,
    keyId: keypair.keyId,
  });
  const altered = await withTrailerManifest(
    signed.wasmBytes,
    signed.signature,
    encodePluginManifest(testManifest({ runtimeTargets: ["browser"] })),
  );
  const policy = { trustedPublicKeys: [keypair.publicKeyHex], requireSignature: true };
  return { keypair, manifestBytes, signed: new Uint8Array(signed.wasmBytes), altered, policy };
}

test("a signed file's trailer manifest is outside the signature: an altered one still verifies", async () => {
  const { signed, altered, policy, manifestBytes } = await signedFixture();
  // The signer moved the manifest into the trailer; the code keeps its copy.
  assert.deepEqual(Buffer.from(readTrailerManifestBytes(signed)), Buffer.from(manifestBytes));
  const code = await readSignedCodeManifest(signed);
  assert.equal(code.source, "manifest-export");
  assert.deepEqual(Buffer.from(code.bytes), Buffer.from(manifestBytes));
  // The alteration: the publication signature does not see it.
  const result = await verifyModuleArtifact(altered, policy);
  assert.equal(result.verified, true);
  // The byte locator returned the altered declaration as if it were the
  // module's (what the two readers below used before 0.11.0). It still
  // returns it, since a byte scan does not find this code's copy, but it says
  // so: fromCode false. The unaltered file's trailer copy is found in the code.
  assert.deepEqual(locateEmbeddedPlgManifest(altered)?.decoded.runtimeTargets, ["browser"]);
  assert.equal(locateEmbeddedPlgManifest(altered)?.source, "bundle-manifest");
  assert.equal(locateEmbeddedPlgManifest(altered)?.fromCode, false);
  assert.equal(locateEmbeddedPlgManifest(signed)?.fromCode, true);
});

test("locateBoundPlgManifest asks the code and refuses an altered trailer manifest by name", async () => {
  const { signed, altered, manifestBytes } = await signedFixture();
  const bound = await locateBoundPlgManifest(signed);
  assert.equal(bound.source, "signed-code");
  assert.equal(bound.fromCode, true);
  assert.deepEqual(Buffer.from(bound.bytes), Buffer.from(manifestBytes));
  await assert.rejects(
    locateBoundPlgManifest(altered),
    (error) => error instanceof ModuleSignatureError && error.code === "trailer_manifest_mismatch",
  );
});

test("locateEmbeddedPlgManifest refuses a trailer manifest that differs from an sds.manifest section left in the code", async () => {
  const codeManifest = encodePluginManifest(testManifest());
  const otherManifest = encodePluginManifest(testManifest({ runtimeTargets: ["browser"] }));
  // The code keeps its sds.manifest section (a writer that does not move it,
  // as the node's signer leaves a payload); the trailer carries another.
  const code = moduleCarryingManifest(codeManifest, { customSection: true, exportManifest: false });
  const trailer = (await createSingleFileBundle({ wasmBytes: code, manifestBytes: otherManifest })).bundle;
  const artifact = appendPublicationRecordCollection(code, encodePublicationRecordCollection({ mbl: trailer }));
  assert.throws(() => locateEmbeddedPlgManifest(artifact), (error) => error.code === "trailer_manifest_mismatch");
  // The same section and the same trailer copy: found, from the code.
  const same = (await createSingleFileBundle({ wasmBytes: code, manifestBytes: codeManifest })).bundle;
  const matching = appendPublicationRecordCollection(code, encodePublicationRecordCollection({ mbl: same }));
  const located = locateEmbeddedPlgManifest(matching);
  assert.equal(located.fromCode, true);
  assert.deepEqual(Buffer.from(located.bytes), Buffer.from(codeManifest));
});

test("the compliance validator reports an altered trailer manifest by name", async () => {
  const { signed, altered } = await signedFixture();
  const manifest = testManifest();
  const good = await validatePluginArtifact({ manifest, wasmBytes: signed });
  assert.ok(!good.issues.some((issue) => issue.code === "trailer-manifest-mismatch"));
  const bad = await validatePluginArtifact({ manifest, wasmBytes: altered });
  assert.ok(
    bad.issues.some((issue) => issue.code === "trailer-manifest-mismatch" && issue.severity === "error"),
    JSON.stringify(bad.issues.map((issue) => issue.code)),
  );
});

test("readBoundManifestBytes returns the code's copy and refuses a different trailer copy by name", async () => {
  const { signed, altered, manifestBytes } = await signedFixture();
  assert.deepEqual(Buffer.from(await readBoundManifestBytes(signed)), Buffer.from(manifestBytes));
  await assert.rejects(
    readBoundManifestBytes(altered),
    (error) =>
      error instanceof ModuleSignatureError &&
      error.code === "trailer_manifest_mismatch" &&
      /changed after signing/.test(error.message),
  );
});

test("a trailer manifest with no manifest in the code is refused; no manifest anywhere declares nothing", async () => {
  const keypair = await loadDevKeypair();
  const manifestBytes = encodePluginManifest(testManifest());
  // Code without the manifest exports and without a data copy, the manifest
  // only in the custom section the signer moves to the trailer.
  const bare = await signModuleArtifact(
    appendWasmCustomSection(
      Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
      SDS_MANIFEST_SECTION_NAME,
      manifestBytes,
    ),
    { privateKeySeedHex: keypair.privateKeySeedHex },
  );
  assert.ok(readTrailerManifestBytes(bare.wasmBytes));
  await assert.rejects(
    readBoundManifestBytes(bare.wasmBytes),
    (error) => error instanceof ModuleSignatureError && error.code === "trailer_manifest_unbound",
  );
  // No manifest in the code and none in the trailer: nothing is declared.
  const none = await signModuleArtifact(
    moduleCarryingManifest(manifestBytes, { customSection: false, exportManifest: false }),
    { privateKeySeedHex: keypair.privateKeySeedHex },
  );
  assert.equal(readTrailerManifestBytes(none.wasmBytes), null);
  assert.equal(await readBoundManifestBytes(none.wasmBytes), null);
});

test("an sds.manifest section left in the signed bytes is the code's copy", async () => {
  const manifestBytes = encodePluginManifest(testManifest());
  const raw = moduleCarryingManifest(manifestBytes);
  const read = await readSignedCodeManifest(raw);
  assert.equal(read.source, "custom-section");
  assert.deepEqual(Buffer.from(await readBoundManifestBytes(raw)), Buffer.from(manifestBytes));
});

test("the WasmEdge leg of loadModule refuses a file whose trailer manifest was altered after signing", async () => {
  const { signed, altered, policy } = await signedFixture();
  const dir = await mkdtemp(path.join(tmpdir(), "sdm-code-manifest-"));
  const alteredPath = path.join(dir, "altered.wasm");
  const signedPath = path.join(dir, "signed.wasm");
  await writeFile(alteredPath, altered);
  await writeFile(signedPath, signed);
  await assert.rejects(
    loadModule({ wasmSource: alteredPath, runtimeKind: "wasmedge", verifySignature: policy }),
    (error) => error instanceof ModuleSignatureError && error.code === "trailer_manifest_mismatch",
  );
  // Without a signature policy too: the trailer is never trusted.
  await assert.rejects(
    loadModule({ wasmSource: alteredPath, runtimeKind: "wasmedge" }),
    (error) => error.code === "trailer_manifest_mismatch",
  );
  // The untouched file passes the manifest step. (Whether it then runs needs a
  // WasmEdge binary, which this test does not require: any later failure is
  // not a manifest refusal.)
  await loadModule({ wasmSource: signedPath, runtimeKind: "wasmedge", verifySignature: policy }).then(
    (harness) => harness?.destroy?.(),
    (error) => {
      assert.notEqual(error?.code, "trailer_manifest_mismatch");
      assert.notEqual(error?.code, "trailer_manifest_unbound");
    },
  );
});

test("the WasmEdge leg judges the runtime target by the code's declaration, not the trailer's", async () => {
  const keypair = await loadDevKeypair();
  const manifestBytes = encodePluginManifest(testManifest({ runtimeTargets: ["browser"] }));
  const signed = await signModuleArtifact(moduleCarryingManifest(manifestBytes), {
    privateKeySeedHex: keypair.privateKeySeedHex,
  });
  // A trailer that claims WasmEdge for a browser-only code declaration.
  const altered = await withTrailerManifest(
    signed.wasmBytes,
    signed.signature,
    encodePluginManifest(testManifest({ runtimeTargets: ["wasmedge"] })),
  );
  const dir = await mkdtemp(path.join(tmpdir(), "sdm-code-manifest-"));
  const signedPath = path.join(dir, "browser-only.wasm");
  const alteredPath = path.join(dir, "claims-wasmedge.wasm");
  await writeFile(signedPath, signed.wasmBytes);
  await writeFile(alteredPath, altered);
  await assert.rejects(
    loadModule({ wasmSource: signedPath, runtimeKind: "wasmedge" }),
    /does not target "wasmedge"[\s\S]*runtimeTargets \[browser\]/,
  );
  await assert.rejects(
    loadModule({ wasmSource: alteredPath, runtimeKind: "wasmedge" }),
    (error) => error.code === "trailer_manifest_mismatch",
  );
  assert.deepEqual(decodePlgManifest(await readBoundManifestBytes(signed.wasmBytes)).runtimeTargets, ["browser"]);
});
