// Reading a module's manifest from its code never runs code nobody verified.
// The two manifest exports are answered from the bytes alone when their bodies
// are constants; otherwise the code is instantiated only when its signature
// was verified under a policy that requires one, and else it is reported as
// not asked (trailer_manifest_unbound, codeNotRun). A start function that
// loops, or a declared memory of 65,536 pages (4 GiB), cannot hang or load
// the caller's process through `check` or a load with no policy.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readSignedCodeManifest, readStaticManifestBytes } from "../src/bundle/codeManifest.js";
import { createSingleFileBundle } from "../src/bundle/wasm.js";
import { encodePluginManifest } from "../src/manifest/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "..", "src");
const CLI_PATH = path.join(__dirname, "..", "bin", "space-data-module.js");
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
const sized = (body) => [...uleb(body.length), ...body];

// A module whose code carries `manifestBytes` at MANIFEST_OFFSET.
//  - constantExports: the export bodies are `i32.const N` (the SDK's builds);
//    otherwise `i32.const N-1; i32.const 1; i32.add`, which only running
//    the code answers.
//  - loopingStart: a start function `loop br 0 end` that never returns.
//  - initialPages: the memory's declared initial size.
function fixtureModule(manifestBytes, { constantExports, loopingStart = false, initialPages = 1 }) {
  const valueBody = (value) =>
    constantExports
      ? [0x00, 0x41, ...sleb(value), 0x0b]
      : [0x00, 0x41, ...sleb(value - 1), 0x41, 0x01, 0x6a, 0x0b];
  const functions = [0x00, 0x00, ...(loopingStart ? [0x01] : [])];
  const bodies = [
    sized(valueBody(MANIFEST_OFFSET)),
    sized(valueBody(manifestBytes.length)),
    ...(loopingStart ? [sized([0x00, 0x03, 0x40, 0x0c, 0x00, 0x0b, 0x0b])] : []),
  ];
  const exports = [
    [...name("memory"), 0x02, 0x00],
    [...name("plugin_get_manifest_flatbuffer"), 0x00, 0x00],
    [...name("plugin_get_manifest_flatbuffer_size"), 0x00, 0x01],
  ];
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [0x02, 0x60, 0x00, 0x01, 0x7f, 0x60, 0x00, 0x00]),
    ...section(3, [...uleb(functions.length), ...functions]),
    ...section(5, [0x01, 0x00, ...uleb(initialPages)]),
    ...section(7, [...uleb(exports.length), ...exports.flat()]),
    ...(loopingStart ? section(8, [0x02]) : []),
    ...section(10, [...uleb(bodies.length), ...bodies.flat()]),
    ...section(11, [
      0x01, 0x00, 0x41, ...sleb(MANIFEST_OFFSET), 0x0b,
      ...uleb(manifestBytes.length), ...manifestBytes,
    ]),
  ]);
}

function fixtureManifest() {
  return {
    pluginId: "com.digitalarsenal.test.code-not-run",
    name: "Code not run fixture",
    version: "1.0.0",
    pluginFamily: "data_source",
    capabilities: [],
    invokeSurfaces: ["direct"],
    runtimeTargets: ["browser", "wasmedge"],
    methods: [],
    schemasUsed: [],
    abiVersion: 1,
  };
}

// A bundle: the trailer carries the manifest, as the SDK's writer leaves it.
async function bundled(wasm, manifestBytes) {
  return new Uint8Array((await createSingleFileBundle({ wasmBytes: wasm, manifestBytes })).wasmBytes);
}

// Runs `body` (an async function's source, given `file`) in a child process,
// so a hang is a failed test, not a hung run. Returns what it printed and how
// long the call itself took.
function inChild(file, body) {
  const url = (rel) => pathToFileURL(path.join(SRC, rel)).href;
  const script = `
    const codeManifest = await import(${JSON.stringify(url("bundle/codeManifest.js"))});
    const compliance = await import(${JSON.stringify(url("compliance/index.js"))});
    const loader = await import(${JSON.stringify(url("host/isomorphicLoader.js"))});
    const { readFile } = await import("node:fs/promises");
    const file = ${JSON.stringify(file)};
    const bytes = new Uint8Array(await readFile(file));
    const started = performance.now();
    const result = await (async () => { ${body} })();
    console.log(JSON.stringify({ ms: performance.now() - started, result }));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(child.signal, null, `the child was killed (it hung): ${child.stderr}`);
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout.trim().split("\n").at(-1));
}

const manifestBytes = encodePluginManifest(fixtureManifest());
const CASES = {
  "a start function that loops": { loopingStart: true },
  "65,536 initial pages (4 GiB)": { initialPages: 65536 },
};

for (const [label, shape] of Object.entries(CASES)) {
  test(`check and a load with no policy return within a second, with the named reason, for ${label}`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sdm-not-run-"));
    try {
      const file = path.join(dir, "module.wasm");
      await writeFile(file, await bundled(fixtureModule(manifestBytes, { constantExports: false, ...shape }), manifestBytes));
      const manifestPath = path.join(dir, "manifest.json");
      await writeFile(manifestPath, JSON.stringify(fixtureManifest()));

      const bound = inChild(file, `
        try { await codeManifest.readBoundManifestBytes(bytes); return { bound: true }; }
        catch (error) { return { code: error.code, codeNotRun: error.codeNotRun, message: error.message }; }
      `);
      assert.equal(bound.result.code, "trailer_manifest_unbound");
      assert.equal(bound.result.codeNotRun, true);
      assert.match(bound.result.message, /was not run/);
      assert.ok(bound.ms < 1000, `readBoundManifestBytes took ${bound.ms} ms`);

      const checked = inChild(file, `
        const report = await compliance.validatePluginArtifact({
          manifest: JSON.parse(await readFile(${JSON.stringify(manifestPath)}, "utf8")),
          wasmBytes: bytes,
        });
        return report.issues.map((issue) => issue.code);
      `);
      assert.ok(checked.result.includes("trailer-manifest-unbound"), JSON.stringify(checked.result));
      assert.ok(checked.ms < 1000, `validatePluginArtifact took ${checked.ms} ms`);

      // A WasmEdge load with no policy: refused by name before anything runs.
      const loaded = inChild(file, `
        try { const h = await loader.loadModule({ wasmSource: file, runtimeKind: "wasmedge" }); await h?.destroy?.(); return { loaded: true }; }
        catch (error) { return { code: error.code ?? null, message: String(error?.message ?? error) }; }
      `);
      assert.equal(loaded.result.code, "trailer_manifest_unbound", loaded.result.message);
      assert.ok(loaded.ms < 1000, `loadModule took ${loaded.ms} ms`);

      // The command line's check returns, and names the reason.
      const cli = spawnSync(process.execPath, [CLI_PATH, "check", "--manifest", manifestPath, "--wasm", file], {
        encoding: "utf8",
        timeout: 20_000,
      });
      assert.equal(cli.signal, null, "the check command hung");
      assert.notEqual(cli.status, 0);
      assert.match(`${cli.stdout}${cli.stderr}`, /trailer-manifest-unbound/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("constant manifest exports are answered from the bytes alone: a looping start never runs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sdm-not-run-"));
  try {
    const wasm = fixtureModule(manifestBytes, { constantExports: true, loopingStart: true });
    assert.deepEqual(Buffer.from(readStaticManifestBytes(wasm).bytes), Buffer.from(manifestBytes));
    const file = path.join(dir, "module.wasm");
    await writeFile(file, await bundled(wasm, manifestBytes));
    const bound = inChild(file, `
      const read = await codeManifest.readSignedCodeManifest(bytes);
      const boundBytes = await codeManifest.readBoundManifestBytes(bytes);
      return { source: read.source, length: boundBytes.length };
    `);
    assert.equal(bound.result.source, "static-exports");
    assert.equal(bound.result.length, manifestBytes.length);
    assert.ok(bound.ms < 1000, `took ${bound.ms} ms`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("exports that only running answers are asked only when the signature was verified", async () => {
  const wasm = await bundled(fixtureModule(manifestBytes, { constantExports: false }), manifestBytes);
  const unverified = await readSignedCodeManifest(wasm);
  assert.equal(unverified.bytes, null);
  assert.equal(unverified.notRun, true);
  const verified = await readSignedCodeManifest(wasm, { verifiedSignature: true });
  assert.equal(verified.source, "manifest-export");
  assert.deepEqual(Buffer.from(verified.bytes), Buffer.from(manifestBytes));
});
