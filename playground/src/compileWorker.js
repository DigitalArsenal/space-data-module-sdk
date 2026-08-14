/**
 * The playground's COMPILE stage, in a Web Worker.
 *
 * Runs emception's llvm-box (clang + wasm-ld, themselves compiled to wasm) —
 * the SAME artifact the SDK's node compiler drives (compileWithEmception) and
 * the same lane the stack's isomorphic flow compiler runs under WasmEdge. It
 * is loaded from this page's OWN origin (public/vendor/emception, copied by
 * build.mjs); nothing is fetched from a CDN.
 *
 * The command sequence below reproduces compileWithEmception
 * (src/compiler/compileModule.js:704) step for step:
 *   1. em++ -c module.cpp                      -> module.o
 *   2. em++ -c plugin-manifest-exports.cpp     -> plugin-manifest-exports.o
 *   3. em++ -c plugin-invoke-bridge.cpp        -> plugin-invoke-bridge.o
 *   4. em++ *.o <link args>                    -> module.wasm
 *
 * The SDK's node lane also emits a second, symbol-renamed object for the
 * flow-graph guest-link format. The playground does not link modules into a
 * flow, so that object is not built here — a deliberate, named omission.
 *
 * Every failure is reported with the compiler's VERBATIM stderr/stdout. A
 * playground that swallows a diagnostic teaches nothing.
 */

import { buildLinkArgs, buildSourceArgs } from "./compileArgs.js";

const WORK_DIR = "/working/playground";
const RUNTIME_INCLUDE_DIR = `${WORK_DIR}/flatbuffers-runtime`;

let emceptionPromise = null;

function post(type, payload) {
  self.postMessage({ type, ...payload });
}

async function loadEmception() {
  if (emceptionPromise) return emceptionPromise;
  emceptionPromise = (async () => {
    const base = new URL("../vendor/emception/", import.meta.url);
    // Computed specifier: keeps the bundler from inlining emception, which
    // resolves its own packs relative to its module URL.
    const moduleUrl = new URL("emception.mjs", base).href;
    const { default: Emception } = await import(/* webpackIgnore: true */ moduleUrl);
    const emception = new Emception({ baseUrl: base.href });
    emception.onstdout = (line) => post("log", { stream: "stdout", line: String(line) });
    emception.onstderr = (line) => post("log", { stream: "stderr", line: String(line) });
    emception.onprogress = (stage, detail) =>
      post("progress", { stage: String(stage), detail: String(detail ?? "") });
    await emception.init();
    return emception;
  })();
  return emceptionPromise;
}

function mkdirTree(emception, dir) {
  emception.FS.mkdirTree(dir);
}

function writeAll(emception, rootDir, files) {
  for (const [relative, content] of Object.entries(files ?? {})) {
    const full = `${rootDir}/${relative}`;
    mkdirTree(emception, full.slice(0, full.lastIndexOf("/")));
    emception.writeFile(full, content);
  }
}

function removeTree(emception, target) {
  const analysis = emception.FS.analyzePath(target);
  if (!analysis.exists) return;
  if (!emception.FS.isDir(emception.FS.stat(target).mode)) {
    emception.FS.unlink(target);
    return;
  }
  for (const entry of emception.FS.readdir(target)) {
    if (entry === "." || entry === "..") continue;
    removeTree(emception, `${target}/${entry}`);
  }
  emception.FS.rmdir(target);
}

class CompileStepError extends Error {
  constructor(command, result) {
    super(`${command[0]} failed (exit ${result.returncode})`);
    this.name = "CompileStepError";
    this.command = command.join(" ");
    this.exitCode = result.returncode;
    this.stderr = String(result.stderr ?? "");
    this.stdout = String(result.stdout ?? "");
  }
}

function run(emception, command) {
  const started = performance.now();
  const result = emception.run(command.join(" "));
  const elapsedMs = performance.now() - started;
  post("step", {
    command: command.join(" "),
    exitCode: result.returncode,
    elapsedMs,
  });
  if (result.returncode !== 0) {
    throw new CompileStepError(command, result);
  }
  return { result, elapsedMs };
}

async function compile({ build: example, sourceCode }) {
  const emception = await loadEmception();
  const timings = { toolchainReadyMs: 0, steps: [], totalMs: 0 };
  const startedAll = performance.now();

  removeTree(emception, WORK_DIR);
  mkdirTree(emception, WORK_DIR);
  writeAll(emception, RUNTIME_INCLUDE_DIR, example.runtimeHeaders);
  writeAll(emception, WORK_DIR, example.schemaHeaders);
  writeAll(emception, WORK_DIR, example.abiHeaders);
  emception.writeFile(`${WORK_DIR}/module.cpp`, sourceCode);
  emception.writeFile(
    `${WORK_DIR}/plugin-manifest-exports.cpp`,
    example.manifestSource,
  );
  emception.writeFile(
    `${WORK_DIR}/space_data_module_invoke.h`,
    example.invokeHeaderSource,
  );
  emception.writeFile(
    `${WORK_DIR}/plugin-invoke-bridge.cpp`,
    example.invokeSource,
  );

  const includes = [`-I${WORK_DIR}`, `-I${RUNTIME_INCLUDE_DIR}`];
  const sourceArgs = buildSourceArgs();
  const includeCommandMain = example.exportedSymbols.includes("_start");
  const linkArgs = buildLinkArgs(example.exportedSymbols, {
    noEntry: includeCommandMain !== true,
  });

  const commands = [
    ["em++", "-c", `${WORK_DIR}/module.cpp`, ...includes, ...sourceArgs, "-o", `${WORK_DIR}/module.o`],
    ["em++", "-c", `${WORK_DIR}/plugin-manifest-exports.cpp`, "-std=c++17", ...includes, "-o", `${WORK_DIR}/plugin-manifest-exports.o`],
    ["em++", "-c", `${WORK_DIR}/plugin-invoke-bridge.cpp`, "-std=c++17", ...includes, "-o", `${WORK_DIR}/plugin-invoke-bridge.o`],
    ["em++", `${WORK_DIR}/module.o`, `${WORK_DIR}/plugin-manifest-exports.o`, `${WORK_DIR}/plugin-invoke-bridge.o`, ...linkArgs, "-o", `${WORK_DIR}/module.wasm`],
  ];

  for (const command of commands) {
    const { elapsedMs } = run(emception, command);
    timings.steps.push({ command: command.join(" "), elapsedMs });
  }

  const wasmBytes = new Uint8Array(emception.readFile(`${WORK_DIR}/module.wasm`));
  timings.totalMs = performance.now() - startedAll;

  return { wasmBytes, timings };
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data ?? {};
  if (type === "warmup") {
    const started = performance.now();
    try {
      await loadEmception();
      post("done", {
        id,
        ok: true,
        result: { warmupMs: performance.now() - started },
      });
    } catch (error) {
      post("done", { id, ok: false, error: serializeError(error) });
    }
    return;
  }
  if (type !== "compile") return;
  try {
    const { wasmBytes, timings } = await compile(payload);
    self.postMessage({ type: "done", id, ok: true, result: { wasmBytes, timings } }, [
      wasmBytes.buffer,
    ]);
  } catch (error) {
    post("done", { id, ok: false, error: serializeError(error) });
  }
};

function serializeError(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    command: error?.command ?? null,
    exitCode: error?.exitCode ?? null,
    // Verbatim. Never trimmed, never summarised.
    stderr: error?.stderr ?? "",
    stdout: error?.stdout ?? "",
    stack: error?.stack ?? "",
  };
}
