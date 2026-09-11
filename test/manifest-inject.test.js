import test from "node:test";
import assert from "node:assert/strict";

import { injectPluginManifest } from "../src/manifest/inject.js";
import { decodePluginManifest } from "../src/manifest/codec.js";
import { getWasmCustomSections } from "../src/bundle/wasm.js";
import { SDS_MANIFEST_SECTION_NAME } from "../src/bundle/constants.js";
import { locateEmbeddedPlgManifest } from "../src/compliance/pluginCompliance.js";

// A minimal but valid empty wasm module: magic + version, no sections. This
// stands in for a foreign-compiled (BYO-wasm) artifact that never ran
// compileModuleFromSource and therefore carries no sds.manifest section.
const EMPTY_WASM_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, // \0asm
  0x01, 0x00, 0x00, 0x00, // version 1
]);

const MANIFEST = {
  pluginId: "com.digitalarsenal.examples.byo-wasm-inject-test",
  name: "BYO wasm inject test",
  version: "0.1.0",
  pluginFamily: "propagator",
  capabilities: ["clock"],
  externalInterfaces: [],
  methods: [],
};

test("injectPluginManifest embeds a decodable sds.manifest section into a foreign wasm artifact", () => {
  const { wasmBytes, replacedExisting } = injectPluginManifest({
    wasmBytes: EMPTY_WASM_MODULE,
    manifest: MANIFEST,
  });
  assert.equal(replacedExisting, false);
  assert.ok(new WebAssembly.Module(wasmBytes), "result must still be a valid wasm module");

  const sections = getWasmCustomSections(wasmBytes, SDS_MANIFEST_SECTION_NAME);
  assert.equal(sections.length, 1);
  const decoded = decodePluginManifest(sections[0]);
  assert.equal(decoded.pluginId, MANIFEST.pluginId);
  assert.equal(decoded.name, MANIFEST.name);
  assert.equal(decoded.version, MANIFEST.version);

  const located = locateEmbeddedPlgManifest(wasmBytes);
  assert.ok(located, "compliance tooling must locate the injected manifest");
});

test("injectPluginManifest refuses to stack a second manifest without replace:true", () => {
  const once = injectPluginManifest({
    wasmBytes: EMPTY_WASM_MODULE,
    manifest: MANIFEST,
  });
  assert.throws(
    () => injectPluginManifest({ wasmBytes: once.wasmBytes, manifest: MANIFEST }),
    /already carries/,
  );
});

test("injectPluginManifest replaces an existing sds.manifest section with replace:true", () => {
  const once = injectPluginManifest({
    wasmBytes: EMPTY_WASM_MODULE,
    manifest: MANIFEST,
  });
  const updatedManifest = { ...MANIFEST, version: "0.2.0" };
  const twice = injectPluginManifest({
    wasmBytes: once.wasmBytes,
    manifest: updatedManifest,
    replace: true,
  });
  assert.equal(twice.replacedExisting, true);

  const sections = getWasmCustomSections(twice.wasmBytes, SDS_MANIFEST_SECTION_NAME);
  assert.equal(sections.length, 1, "must not stack sections when replacing");
  const decoded = decodePluginManifest(sections[0]);
  assert.equal(decoded.version, "0.2.0");
});

test("injectPluginManifest rejects missing wasmBytes or manifest", () => {
  assert.throws(() => injectPluginManifest({ manifest: MANIFEST }), TypeError);
  assert.throws(() => injectPluginManifest({ wasmBytes: EMPTY_WASM_MODULE }), TypeError);
});
