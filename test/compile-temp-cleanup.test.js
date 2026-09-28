// Compile temp-dir hygiene. Measured 2026-09-28 on one workstation: 497
// per-process emception copies (about 159 MB each) and 647 compile scratch
// dirs had piled up in $TMPDIR. These tests hold the two fixes:
//
// - every compile removes its `space-data-module-sdk-compile-*` dir on
//   success and on failure unless the caller passes `keepTempDir: true`;
// - the patched emception tree is ONE shared, version-keyed root, published
//   by an atomic rename, instead of a copy per process.
//
// The whole file runs against a private TMPDIR so that other processes on the
// machine cannot move the counts, and so that nothing it creates outlives it.

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  cleanupCompilation,
  compileModuleFromSource,
  ModuleThreadModel,
  resolveWasiThreadsToolchain,
} from "../src/index.js";
import { preparePatchedEmceptionRoot } from "../src/compiler/emceptionNode.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPILER_ENTRY_URL = pathToFileURL(
  path.resolve(__dirname, "..", "src", "compiler", "index.js"),
).href;

const realTmpDir = os.tmpdir();
const isolatedTmpDir = await mkdtemp(path.join(realTmpDir, "sdm-tmpleak-test-"));
setTmpDir(process.env, isolatedTmpDir);
after(async () => {
  setTmpDir(process.env, realTmpDir);
  await rm(isolatedTmpDir, { recursive: true, force: true });
});

function setTmpDir(env, dir) {
  env.TMPDIR = dir;
  env.TMP = dir;
  env.TEMP = dir;
}

function wasiThreadsAvailable() {
  try {
    resolveWasiThreadsToolchain();
    return true;
  } catch {
    return false;
  }
}

const EMCEPTION_ROOT_PATTERN = /^space-data-module-sdk-emception-/;
const BUILD_DIR_PATTERN = /\.(?:staging|stale)-\d+-/;
const LEGACY_PER_PROCESS_PATTERN = /^space-data-module-sdk-emception-node-\d+$/;

async function sdkEntries(dir) {
  const names = await readdir(dir);
  return {
    compileDirs: names.filter((name) =>
      name.startsWith("space-data-module-sdk-compile-"),
    ),
    emceptionRoots: names.filter(
      (name) => EMCEPTION_ROOT_PATTERN.test(name) && !BUILD_DIR_PATTERN.test(name),
    ),
    buildDirs: names.filter(
      (name) => EMCEPTION_ROOT_PATTERN.test(name) && BUILD_DIR_PATTERN.test(name),
    ),
    perProcessCopies: names.filter((name) => LEGACY_PER_PROCESS_PATTERN.test(name)),
  };
}

function createManifest(overrides = {}) {
  return {
    pluginId: "com.digitalarsenal.examples.compile-temp-cleanup",
    name: "Compile temp cleanup",
    version: "0.1.0",
    pluginFamily: "propagator",
    capabilities: ["clock"],
    externalInterfaces: [],
    methods: [
      {
        methodId: "propagate",
        displayName: "Propagate",
        inputPorts: [
          {
            portId: "request",
            acceptedTypeSets: [
              {
                setId: "omm",
                allowedTypes: [
                  {
                    schemaName: "OMM.fbs",
                    fileIdentifier: "$OMM",
                    rootTypeName: "OMM",
                    wireFormat: "flatbuffer",
                  },
                ],
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        outputPorts: [
          {
            portId: "state",
            acceptedTypeSets: [
              {
                setId: "cat",
                allowedTypes: [
                  {
                    schemaName: "CAT.fbs",
                    fileIdentifier: "$CAT",
                    rootTypeName: "CAT",
                    wireFormat: "flatbuffer",
                  },
                ],
              },
            ],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        maxBatch: 32,
        drainPolicy: "drain-to-empty",
      },
    ],
    ...overrides,
  };
}

const C_SOURCE = "int propagate(void) { return 7; }\n";
const BROKEN_C_SOURCE = "int propagate(void) { return 7 }\n";
const THREADED_CPP_SOURCE =
  "#include <atomic>\n#include <thread>\n" +
  'extern "C" int propagate(void) {\n' +
  "  std::atomic<int> a{0};\n" +
  "  std::thread t([&]{ a.fetch_add(13, std::memory_order_seq_cst); });\n" +
  "  t.join();\n" +
  "  return a.load();\n" +
  "}\n";
const BROKEN_CPP_SOURCE = 'extern "C" int propagate(void) { return undeclared_symbol; }\n';

function assertCompiledWithoutHandoff(result) {
  assert.equal(result.report.ok, true);
  assert.ok(result.wasmBytes.length > 0);
  assert.equal(result.tempDir, null);
  assert.equal(result.outputPath, null);
}

async function runChild(script, args, env) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", script, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  const [code] = await once(child, "close");
  return { code, stdout, stderr, pid: child.pid };
}

async function deadPid() {
  const { pid } = await runChild("", [], process.env);
  return pid;
}

// First, so that this process has not loaded emception yet and the peak stays
// at two emception instances.
test("two compile processes started together share one emception root and leave no compile dirs", async () => {
  const raceTmpDir = await mkdtemp(path.join(isolatedTmpDir, "race-"));
  // A staging dir left by a process that died mid-build is swept.
  const orphan = path.join(
    raceTmpDir,
    `space-data-module-sdk-emception-node-v1-0.0.0-0000000000000000.staging-${await deadPid()}-AbC123`,
  );
  await mkdir(orphan);
  await writeFile(path.join(orphan, "partial.pack"), "partial");

  const script = `
    const { compileModuleFromSource } = await import(${JSON.stringify(COMPILER_ENTRY_URL)});
    const result = await compileModuleFromSource({
      manifest: JSON.parse(process.argv[1]),
      sourceCode: ${JSON.stringify(C_SOURCE)},
      language: "c",
    });
    process.stdout.write(JSON.stringify({
      ok: result.report.ok,
      bytes: result.wasmBytes.length,
      tempDir: result.tempDir,
      outputPath: result.outputPath,
    }));
  `;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  setTmpDir(env, raceTmpDir);
  const runs = await Promise.all([
    runChild(script, [JSON.stringify(createManifest())], env),
    runChild(script, [JSON.stringify(createManifest())], env),
  ]);
  for (const run of runs) {
    assert.equal(run.code, 0, run.stderr);
    const reported = JSON.parse(run.stdout);
    assert.equal(reported.ok, true);
    assert.ok(reported.bytes > 0);
    assert.equal(reported.tempDir, null);
    assert.equal(reported.outputPath, null);
  }

  const entries = await sdkEntries(raceTmpDir);
  assert.deepEqual(entries.compileDirs, []);
  assert.deepEqual(entries.buildDirs, []);
  assert.deepEqual(entries.perProcessCopies, []);
  assert.equal(entries.emceptionRoots.length, 1, entries.emceptionRoots.join(", "));
  assert.deepEqual(
    (await readdir(raceTmpDir)).sort(),
    entries.emceptionRoots,
    "the shared root is the only thing left behind",
  );
});

test("sequential, concurrent and failing emception compiles return the compile dir count to baseline", async () => {
  const baseline = (await sdkEntries(isolatedTmpDir)).compileDirs.length;

  for (let index = 0; index < 3; index += 1) {
    assertCompiledWithoutHandoff(
      await compileModuleFromSource({
        manifest: createManifest(),
        sourceCode: C_SOURCE,
        language: "c",
      }),
    );
    assert.equal((await sdkEntries(isolatedTmpDir)).compileDirs.length, baseline);
  }

  const concurrent = await Promise.all([
    compileModuleFromSource({ manifest: createManifest(), sourceCode: C_SOURCE, language: "c" }),
    compileModuleFromSource({ manifest: createManifest(), sourceCode: C_SOURCE, language: "c" }),
  ]);
  concurrent.forEach(assertCompiledWithoutHandoff);
  assert.equal((await sdkEntries(isolatedTmpDir)).compileDirs.length, baseline);

  await assert.rejects(
    compileModuleFromSource({
      manifest: createManifest(),
      sourceCode: BROKEN_C_SOURCE,
      language: "c",
    }),
    /Compilation failed/,
  );
  assert.equal((await sdkEntries(isolatedTmpDir)).compileDirs.length, baseline);

  const entries = await sdkEntries(isolatedTmpDir);
  assert.equal(entries.emceptionRoots.length, 1, entries.emceptionRoots.join(", "));
  assert.deepEqual(entries.buildDirs, []);
  assert.deepEqual(entries.perProcessCopies, []);
});

test("keepTempDir hands the dir to the caller and cleanupCompilation frees it", async () => {
  const baseline = (await sdkEntries(isolatedTmpDir)).compileDirs.length;
  const result = await compileModuleFromSource({
    manifest: createManifest(),
    sourceCode: C_SOURCE,
    language: "c",
    keepTempDir: true,
  });
  assert.equal(result.report.ok, true);
  assert.equal(typeof result.tempDir, "string");
  assert.equal(path.dirname(result.outputPath), result.tempDir);
  assert.deepEqual(new Uint8Array(await readFile(result.outputPath)), result.wasmBytes);
  assert.equal((await sdkEntries(isolatedTmpDir)).compileDirs.length, baseline + 1);

  await cleanupCompilation(result);
  assert.equal((await sdkEntries(isolatedTmpDir)).compileDirs.length, baseline);

  // A failed compile hands nothing off, so keepTempDir cannot leak it.
  await assert.rejects(
    compileModuleFromSource({
      manifest: createManifest(),
      sourceCode: BROKEN_C_SOURCE,
      language: "c",
      keepTempDir: true,
    }),
    /Compilation failed/,
  );
  assert.equal((await sdkEntries(isolatedTmpDir)).compileDirs.length, baseline);
});

test("an explicit outputPath is the only file a compile leaves behind", async () => {
  const baseline = (await sdkEntries(isolatedTmpDir)).compileDirs.length;
  const outputDir = await mkdtemp(path.join(isolatedTmpDir, "out-"));
  const outputPath = path.join(outputDir, "module.wasm");
  const result = await compileModuleFromSource({
    manifest: createManifest(),
    sourceCode: C_SOURCE,
    language: "c",
    outputPath,
  });
  assert.equal(result.outputPath, outputPath);
  assert.equal(result.tempDir, null);
  assert.deepEqual(new Uint8Array(await readFile(outputPath)), result.wasmBytes);
  assert.deepEqual(await readdir(outputDir), ["module.wasm"]);
  assert.equal((await sdkEntries(isolatedTmpDir)).compileDirs.length, baseline);
});

test("sequential, concurrent and failing wasi-threads compiles return the compile dir count to baseline", async (t) => {
  if (!wasiThreadsAvailable()) {
    t.skip("wasi-threads toolchain (wasm32-wasip1-threads) is not available.");
    return;
  }
  const manifest = createManifest({ runtimeTargets: ["wasmedge"] });
  const compile = (sourceCode) =>
    compileModuleFromSource({
      manifest,
      sourceCode,
      language: "c++",
      threadModel: ModuleThreadModel.EMSCRIPTEN_PTHREADS,
    });
  const baseline = (await sdkEntries(isolatedTmpDir)).compileDirs.length;

  for (let index = 0; index < 2; index += 1) {
    const result = await compile(THREADED_CPP_SOURCE);
    assert.match(result.compiler, /wasi-threads/);
    assertCompiledWithoutHandoff(result);
    assert.equal((await sdkEntries(isolatedTmpDir)).compileDirs.length, baseline);
  }

  (await Promise.all([compile(THREADED_CPP_SOURCE), compile(THREADED_CPP_SOURCE)])).forEach(
    assertCompiledWithoutHandoff,
  );
  assert.equal((await sdkEntries(isolatedTmpDir)).compileDirs.length, baseline);

  await assert.rejects(compile(BROKEN_CPP_SOURCE), /Compilation failed/);
  assert.equal((await sdkEntries(isolatedTmpDir)).compileDirs.length, baseline);
});

test("the shared emception root is rebuilt when its content check fails, never reused half-written", async () => {
  const cacheRoot = await mkdtemp(path.join(isolatedTmpDir, "content-check-"));
  const [first, second] = await Promise.all([
    preparePatchedEmceptionRoot({ cacheRoot }),
    preparePatchedEmceptionRoot({ cacheRoot }),
  ]);
  assert.equal(first, second);
  assert.match(path.basename(first), /^space-data-module-sdk-emception-node-v1-[^-]+-[0-9a-f]{16}(?:-u\d+)?$/);
  assert.deepEqual(await readdir(cacheRoot), [path.basename(first)]);

  const marker = JSON.parse(
    await readFile(path.join(first, ".space-data-module-sdk-emception-patch"), "utf8"),
  );
  const files = new Map(marker.files);
  const emceptionModule = await readFile(path.join(first, "emception.mjs"), "utf8");
  assert.match(emceptionModule, /cache: "\/tmp\/emception-cache"/, "the tree is patched");

  // A file purged from the root: the next prepare replaces the whole root.
  await unlink(path.join(first, "emception.mjs"));
  assert.equal(await preparePatchedEmceptionRoot({ cacheRoot }), first);
  assert.equal((await stat(path.join(first, "emception.mjs"))).size, files.get("emception.mjs"));
  assert.deepEqual(await readdir(cacheRoot), [path.basename(first)]);

  // A truncated file: same.
  const [largest] = [...files.entries()].sort((a, b) => b[1] - a[1])[0];
  await truncate(path.join(first, largest), 1);
  assert.equal(await preparePatchedEmceptionRoot({ cacheRoot }), first);
  assert.equal((await stat(path.join(first, largest))).size, files.get(largest));
  assert.deepEqual(await readdir(cacheRoot), [path.basename(first)]);
});
