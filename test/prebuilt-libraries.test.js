import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { compileModuleFromSource, protectModuleArtifact, resolveWasiThreadsToolchain, writeGuestLinkFiles } from "../src/compiler/index.js";
import { compileFlowProgram, resolveFlowDependencies } from "../src/flow/flowCompiler.js";
import { createFlowRuntimeHost } from "../src/flow/flowRuntimeHost.js";
import { createBrowserModuleHarness } from "../src/host/browserModuleHarness.js";

import { parseSingleFileBundle } from "../src/bundle/index.js";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const port = portId => ({
  portId, required: true, minStreams: 1, maxStreams: 1,
  acceptedTypeSets: [{ setId: portId, allowedTypes: [{ acceptsAnyFlatbuffer: true }],
    wildcardJustification: { kind: "foreign-wire-format", detail: "A four-byte little-endian integer for an arithmetic integration test.", mediaType: "application/vnd.sdn.test-uint32" } }],
});
const manifestFor = pluginId => ({
  pluginId, name: pluginId, version: "1.0.0", pluginFamily: "foundation",
  capabilities: [], externalInterfaces: [], invokeSurfaces: ["direct"],
  runtimeTargets: ["browser", "wasmedge"], schemasUsed: [], abiVersion: 1,
  sequentialJustification: { kind: "pure-transform", detail: "Integer arithmetic has no concurrency or shared state." },
  methods: [
    { methodId: "answer", displayName: "Answer", inputPorts: [], outputPorts: [], maxBatch: 1, drainPolicy: "single-shot" },
    { methodId: "tick", displayName: "Tick", inputPorts: [port("in")], outputPorts: [port("out")], maxBatch: 1, drainPolicy: "single-shot" },
  ],
});
const sourceCode = `
#include "space_data_module_invoke.h"
#include <stdint.h>
#include <string.h>
extern "C" int plain_value(void);
extern "C" int answer(void) { return plain_value(); }
extern "C" int tick(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame || frame->payload_length != 4) return 400;
  uint32_t value;
  memcpy(&value, frame->payload, 4);
  value += plain_value();
  plugin_push_output("out", 0, 0, (const uint8_t *)&value, 4);
  return 0;
}
`;
const optionsFor = pluginId => ({ manifest: manifestFor(pluginId), sourceCode, language: "c++", threadModel: "wasi-sequential", catalog: [] });

async function temporary(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sdk-prebuilt-e2e-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function runAnswer(t, result, expected) {
  assert.equal(result.report.ok, true, JSON.stringify(result.report));
  const host = await createBrowserModuleHarness({ wasmSource: result.wasmBytes, surface: "direct" });
  try { assert.equal(host.instance.exports.answer(), expected); }
  finally { host.destroy(); }
}
async function buildLibraries(dir, value) {
  const toolchain = resolveWasiThreadsToolchain();
  const compile = async (name, source) => {
    await writeFile(path.join(dir, `${name}.c`), source);
    await exec(toolchain.clang, [...toolchain.toolchainArgs, "-O2", "-c", path.join(dir, `${name}.c`), "-o", path.join(dir, `${name}.o`)]);
  };
  await compile("used", `int archive_value(void) { return ${value}; }`);
  // An unresolved reference in the unused archive member proves lazy extraction.
  await compile("unused", "extern int must_not_link(void); int unused(void) { return must_not_link(); }");
  await compile("plain", "extern int archive_value(void); int plain_value(void) { return archive_value() + 2; }");
  const { stdout } = await exec(toolchain.clang, ["--print-prog-name=llvm-ar"]);
  const archive = path.join(dir, "arithmetic.a");
  await exec(stdout.trim(), ["rcs", archive, path.join(dir, "used.o"), path.join(dir, "unused.o")]);
  const library = async (name, file, kind) => {
    const objectBytes = new Uint8Array(await readFile(file));
    return { name, version: "1.0.0", language: "c", namespace: `sdm_lib_${name}_`, kind, sha256: hash(objectBytes), objectBytes };
  };
  return [await library("plain", path.join(dir, "plain.o"), "wasm-object"), await library("arithmetic", archive, "archive")];
}
async function persist(dir, manifest, result) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "plugin-manifest.json"), JSON.stringify(manifest));
  const metadata = await writeGuestLinkFiles(result, path.join(dir, "dist", "guest-link"));
  for (const library of metadata.libraries) {
    assert.equal(hash(await readFile(path.join(dir, "dist", "guest-link", library.file))), library.sha256);
  }
  assert.equal(metadata.libraries[1].kind, "archive");
  assert.match(metadata.libraries[1].file, /\.a$/);
}

test("prebuilt objects and archives compile, invalidate cache, compose once, and reject conflicts and forbidden imports", async t => {
  const dir = await temporary(t);
  const libraries = await buildLibraries(dir, 40);
  const opts = { ...optionsFor("test.prebuilt.first"), compileCache: { dir: path.join(dir, "cache") }, prebuiltLibraries: libraries };
  const first = await compileModuleFromSource(opts);
  await runAnswer(t, first, 42);
  assert.deepEqual(first.guestLink.libraries.map(l => l.objectBytes), libraries.map(l => l.objectBytes));
  const cached = await compileModuleFromSource(opts);
  assert.ok(cached.compileCache.hits.includes("link"));
  await runAnswer(t, cached, 42);
  await assert.rejects(compileModuleFromSource({ ...opts, prebuiltLibraries: [{ ...libraries[0], sha256: "0".repeat(64) }] }), /plain.*SHA-256 mismatch/);
  await assert.rejects(compileModuleFromSource({ ...opts, prebuiltLibraries: [{ ...libraries[0], kind: "archive" }] }), /plain.*kind/);
  const changed = await buildLibraries(dir, 41);
  const changedResult = await compileModuleFromSource({ ...opts, prebuiltLibraries: changed });
  assert.ok(changedResult.compileCache.misses.includes("link"));
  assert.ok(changedResult.compileCache.hits.includes("module"));
  await runAnswer(t, changedResult, 43);

  const secondOptions = optionsFor("test.prebuilt.second");
  const second = await compileModuleFromSource({ ...secondOptions, prebuiltLibraries: libraries });
  const packages = path.join(dir, "packages");
  await persist(path.join(packages, "first"), opts.manifest, first);
  await persist(path.join(packages, "second"), secondOptions.manifest, second);
  // Protection creates a throwaway in-memory test identity; no key is persisted.
  const protectedArtifact = await protectModuleArtifact({ manifest: opts.manifest, wasmBytes: first.wasmBytes, guestLink: first.guestLink, singleFileBundle: true });
  const bundle = await parseSingleFileBundle(protectedArtifact.singleFileBundle.wasmBytes);
  const bundledMetadata = bundle.entries.find(entry => entry.entryId === "guest-link-metadata").decodedPayload;
  assert.equal(bundledMetadata.version, 2);
  for (const library of bundledMetadata.libraries) {
    assert.equal(hash(bundle.entries.find(entry => entry.entryId === library.file).payloadBytes), library.sha256);
  }
  const cliSource = path.join(dir, "module.cpp");
  const cliOutput = path.join(dir, "cli.wasm");
  await writeFile(cliSource, sourceCode);
  await exec(process.execPath, [fileURLToPath(new URL("../bin/space-data-module.js", import.meta.url)), "compile",
    "--manifest", path.join(packages, "first", "plugin-manifest.json"), "--source", cliSource,
    "--language", "c++", "--thread-model", "wasi-sequential", "--out", cliOutput,
    "--prebuilt-libraries", path.join(packages, "first", "dist", "guest-link", "metadata.json")]);
  await runAnswer(t, { report: { ok: true }, wasmBytes: await readFile(cliOutput) }, 42);
  const dependencies = await resolveFlowDependencies({ depsPath: packages });
  const flow = {
    programId: "test.prebuilt.flow", name: "Prebuilt arithmetic", version: "1.0.0",
    nodes: [
      { nodeId: "first", pluginId: opts.manifest.pluginId, methodId: "tick", kind: "transform" },
      { nodeId: "second", pluginId: secondOptions.manifest.pluginId, methodId: "tick", kind: "transform" },
      { nodeId: "sink", pluginId: "test.sink", methodId: "collect", kind: "sink" },
    ],
    edges: [
      { fromNodeId: "first", fromPortId: "out", toNodeId: "second", toPortId: "in", opaque: true },
      { fromNodeId: "second", fromPortId: "out", toNodeId: "sink", toPortId: "result", opaque: true },
    ],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [{ triggerId: "manual", targetNodeId: "first", targetPortId: "in" }],
    requiredPlugins: [opts.manifest.pluginId, secondOptions.manifest.pluginId],
  };
  const result = await compileFlowProgram({ flow, dependencies, catalog: [] });
  assert.equal(result.report.ok, true, JSON.stringify(result.report));
  const host = await createFlowRuntimeHost({ wasmSource: result.wasmBytes });
  host.enqueueTriggerFrame(0, { portId: "in", bytes: new Uint8Array(4) });
  const frames = [];
  await host.drain({ "test.sink:collect": result => { frames.push(...result.frames); return { statusCode: 0 }; } }, { maxIterations: 20 });
  assert.equal(frames.length, 1);
  assert.equal(new DataView(frames[0].bytes.buffer, frames[0].bytes.byteOffset).getUint32(0, true), 84);
  assert.equal(host.getNodeState(0).invocationCount, 1n);
  assert.equal(host.getNodeState(1).invocationCount, 1n);

  // Same name, different bytes, even under a different namespace, is refused.
  const changedSecond = await compileModuleFromSource({ ...secondOptions, prebuiltLibraries: changed.map(l => ({ ...l, namespace: l.namespace + "other_" })) });
  await persist(path.join(packages, "second"), secondOptions.manifest, changedSecond);
  await assert.rejects(compileFlowProgram({ flow, dependencies: await resolveFlowDependencies({ depsPath: packages }), catalog: [] }), /Conflicting guest-link library "arithmetic"/);
  await writeFile(path.join(packages, "first", "dist", "guest-link", "libraries", `plain-1.0.0-${libraries[0].sha256.slice(0, 12)}.o`), changed[1].objectBytes);
  await assert.rejects(resolveFlowDependencies({ depsPath: packages }), /plain.*SHA-256 mismatch/);

  const toolchain = resolveWasiThreadsToolchain();
  await writeFile(path.join(dir, "forbidden.c"), '__attribute__((import_module("env"), import_name("__pthread_create_js"))) extern int forbidden(void); int plain_value(void) { return forbidden(); }');
  await exec(toolchain.clang, [...toolchain.toolchainArgs, "-c", path.join(dir, "forbidden.c"), "-o", path.join(dir, "forbidden.o")]);
  const objectBytes = new Uint8Array(await readFile(path.join(dir, "forbidden.o")));
  await assert.rejects(compileModuleFromSource({ ...opts, prebuiltLibraries: [{ ...libraries[0], name: "forbidden_threads", objectBytes, sha256: hash(objectBytes) }] }), error => {
    assert.match(error.message, /forbidden_threads/);
    assert.match(error.message, /imports Emscripten.*thread hooks/);
    return true;
  });
});

const PEPPER_URL = "https://github.com/TJKoury/pepper/releases/download/wasm-v0.1.0/pepper-wasm-0.1.0.tgz";
const PEPPER_SHA256 = "1c9cfaedef4dc3769f9b1fbeee6088f451f004d65f27eb8142264f807df89c51";
test("PEPPER release libraries link and run a kernel-free vector norm", async t => {
  const dir = await temporary(t);
  let tarball;
  if (process.env.SDN_PEPPER_TARBALL) tarball = await readFile(process.env.SDN_PEPPER_TARBALL);
  else {
    try {
      const response = await fetch(PEPPER_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      tarball = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      t.skip(`PEPPER release download unavailable: ${error.message}`);
      return;
    }
  }
  assert.equal(hash(tarball), PEPPER_SHA256);
  const archivePath = path.join(dir, "pepper.tgz");
  await writeFile(archivePath, tarball);
  await exec("tar", ["-xzf", archivePath, "-C", dir]);
  const guestDir = path.join(dir, "package", "dist", "guest-link");
  const metadata = JSON.parse(await readFile(path.join(guestDir, "metadata.json")));
  const prebuiltLibraries = [];
  for (const library of metadata.libraries) {
    const objectBytes = new Uint8Array(await readFile(path.join(guestDir, library.file)));
    const kind = Buffer.from(objectBytes.subarray(0, 8)).toString() === "!<arch>\n" ? "archive" : "wasm-object";
    prebuiltLibraries.push({ ...library, kind, objectBytes });
  }
  const header = await readFile(path.join(dir, "package", "dist", "include", "pepper_wasm.h"), "utf8");
  const manifest = manifestFor("test.prebuilt.pepper");
  manifest.methods = [manifest.methods[0]];
  const result = await compileModuleFromSource({
    manifest, language: "c++", threadModel: "wasi-sequential", catalog: [], prebuiltLibraries,
    sourceCode: `${header}\nextern "C" int answer(void) { const double v[3] = {3, 4, 0}; double result = 0; if (pepper_vnorm(v, &result) != 0) return -1; return (int)result; }`,
  });
  await runAnswer(t, result, 5);
});
