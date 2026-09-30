import { accessSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile, rename, rm } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeResolvedPath(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return path.resolve(value);
}

function ensureReadableSync(targetPath, label) {
  try {
    accessSync(targetPath);
  } catch {
    throw new Error(`${label} not found: ${targetPath}`);
  }
}

function resolveWasmEdgeSharedLibraryFilename() {
  if (process.platform === "darwin") {
    return "libwasmedge.0.dylib";
  }
  if (process.platform === "win32") {
    return "wasmedge.dll";
  }
  return "libwasmedge.so.0";
}

function resolveGeneratedIncludeDir(requestedIncludeDir) {
  const directHeaderPath = path.join(
    requestedIncludeDir,
    "wasmedge",
    "enum_configure.h",
  );
  if (existsSync(directHeaderPath)) {
    return requestedIncludeDir;
  }

  const repoRoot = path.resolve(requestedIncludeDir, "..", "..");
  const generatedDir = path.join(repoRoot, "build", "include", "api");
  if (existsSync(path.join(generatedDir, "wasmedge", "enum_configure.h"))) {
    return generatedDir;
  }

  throw new Error(
    `WasmEdge include directory does not contain wasmedge/enum_configure.h: ${requestedIncludeDir}`,
  );
}

export function resolveWasmEdgeRunnerSourcePath(options = {}) {
  return path.resolve(
    __dirname,
    "native",
    options.runnerKind === "wasi-threads"
      ? "wasmedge_wasi_threads_runner.c"
      : "wasmedge_emscripten_pthread_runner.c",
  );
}

function resolveDefaultWasmEdgeInstall() {
  const home = os.homedir();
  const candidates = [
    {
      includeDir: path.join(home, ".wasmedge", "include"),
      libDir: path.join(home, ".wasmedge", "lib"),
    },
    {
      includeDir: "/opt/homebrew/include",
      libDir: "/opt/homebrew/opt/wasmedge/lib",
    },
    {
      includeDir: "/usr/local/include",
      libDir: "/usr/local/lib",
    },
  ];
  for (const candidate of candidates) {
    const header = path.join(
      candidate.includeDir,
      "wasmedge",
      "enum_configure.h",
    );
    const library = path.join(
      candidate.libDir,
      resolveWasmEdgeSharedLibraryFilename(),
    );
    if (existsSync(header) && existsSync(library)) {
      return candidate;
    }
  }
  return null;
}

export function resolveWasmEdgeRunnerBuildPlan(options = {}) {
  const detectedInstall = resolveDefaultWasmEdgeInstall();
  const requestedIncludeDir = normalizeResolvedPath(
    options.wasmedgeIncludeDir ??
      process.env.WASMEDGE_INCLUDE_DIR ??
      detectedInstall?.includeDir,
  );
  const wasmedgeLibDir = normalizeResolvedPath(
    options.wasmedgeLibDir ??
      process.env.WASMEDGE_LIB_DIR ??
      detectedInstall?.libDir,
  );
  const outputPath = normalizeResolvedPath(
    options.outputPath ?? options.output,
  );

  if (!requestedIncludeDir) {
    throw new Error(
      "Missing WasmEdge include directory. Set wasmedgeIncludeDir, --wasmedge-include-dir, or WASMEDGE_INCLUDE_DIR.",
    );
  }
  if (!wasmedgeLibDir) {
    throw new Error(
      "Missing WasmEdge library directory. Set wasmedgeLibDir, --wasmedge-lib-dir, or WASMEDGE_LIB_DIR.",
    );
  }
  if (!outputPath) {
    throw new Error("Missing runner outputPath.");
  }

  const runnerSourcePath = resolveWasmEdgeRunnerSourcePath(options);
  const wasmedgeSharedLibraryPath = path.join(
    wasmedgeLibDir,
    resolveWasmEdgeSharedLibraryFilename(),
  );

  return {
    runnerSourcePath,
    requestedIncludeDir,
    wasmedgeIncludeDir: requestedIncludeDir,
    wasmedgeLibDir,
    wasmedgeSharedLibraryPath,
    outputPath,
    compilerCommand:
      process.platform === "darwin" ? "xcrun" : process.env.CC ?? "cc",
    compilerArgs:
      process.platform === "darwin"
        ? [
            "clang",
            "-Wl,-headerpad_max_install_names",
            runnerSourcePath,
            "-std=c11",
            "-O2",
            "-pthread",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-Wno-unused-parameter",
            "-Wno-error=visibility",
            `-I${requestedIncludeDir}`,
            `-L${wasmedgeLibDir}`,
            "-lwasmedge",
            `-Wl,-rpath,${wasmedgeLibDir}`,
            "-o",
            outputPath,
          ]
        : [
            runnerSourcePath,
            "-std=c11",
            "-O2",
            "-pthread",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-Wno-unused-parameter",
            "-Wno-error=visibility",
            `-I${requestedIncludeDir}`,
            `-L${wasmedgeLibDir}`,
            "-lwasmedge",
            `-Wl,-rpath,${wasmedgeLibDir}`,
            "-o",
            outputPath,
          ],
  };
}

export async function buildWasmEdgeEmscriptenPthreadRunner(options = {}) {
  const basePlan = resolveWasmEdgeRunnerBuildPlan(options);
  const wasmedgeIncludeDir = resolveGeneratedIncludeDir(
    basePlan.requestedIncludeDir,
  );
  const compilerArgs =
    process.platform === "darwin"
      ? [
          "clang",
          "-Wl,-headerpad_max_install_names",
          basePlan.runnerSourcePath,
          "-std=c11",
          "-O2",
          "-pthread",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-Wno-unused-parameter",
          "-Wno-error=visibility",
          `-I${wasmedgeIncludeDir}`,
          `-L${basePlan.wasmedgeLibDir}`,
          "-lwasmedge",
          `-Wl,-rpath,${basePlan.wasmedgeLibDir}`,
          "-o",
          basePlan.outputPath,
        ]
      : [
          basePlan.runnerSourcePath,
          "-std=c11",
          "-O2",
          "-pthread",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-Wno-unused-parameter",
          "-Wno-error=visibility",
          `-I${wasmedgeIncludeDir}`,
          `-L${basePlan.wasmedgeLibDir}`,
          "-lwasmedge",
          `-Wl,-rpath,${basePlan.wasmedgeLibDir}`,
          "-o",
          basePlan.outputPath,
        ];
  const plan = {
    ...basePlan,
    wasmedgeIncludeDir,
    compilerArgs,
  };

  ensureReadableSync(plan.runnerSourcePath, "Runner source");
  ensureReadableSync(plan.wasmedgeIncludeDir, "WasmEdge include directory");
  ensureReadableSync(plan.wasmedgeLibDir, "WasmEdge library directory");
  ensureReadableSync(
    plan.wasmedgeSharedLibraryPath,
    "WasmEdge shared library",
  );

  await execFileAsync(plan.compilerCommand, plan.compilerArgs, {
    cwd: options.cwd ?? process.cwd(),
  });
  if (process.platform === "darwin") {
    let linkedLibrary = plan.wasmedgeSharedLibraryPath;
    if (options.runnerKind === "wasi-threads") {
      // DYLD_LIBRARY_PATH can override even an absolute install name by its
      // basename. Give this exact runtime a unique name so ambient SDK paths
      // cannot silently replace the corrected atomic-wait implementation.
      const sha = createHash("sha256").update(await readFile(linkedLibrary)).digest("hex");
      linkedLibrary = path.join(path.dirname(plan.outputPath), `libsdm-wasmedge-${sha}.dylib`);
      if (!existsSync(linkedLibrary)) {
        const stagingLibrary = `${linkedLibrary}.${process.pid}`;
        try {
          await copyFile(plan.wasmedgeSharedLibraryPath, stagingLibrary);
          await rename(stagingLibrary, linkedLibrary);
        } finally { await rm(stagingLibrary, { force: true }); }
      }
    }
    await execFileAsync("install_name_tool", [
      "-change",
      "@rpath/libwasmedge.0.dylib",
      linkedLibrary,
      plan.outputPath,
    ]);
  }
  return plan.outputPath;
}

const WASMEDGE_THREADS_REVISION = "be85c2fbba68318f103b4a766728f6946e65abf8";
const runtimeBuilds = new Map();

// The SDN patch series for WasmEdge 0.16.4 (sdn-server/internal/wasmrt/SUBSTRATE.md),
// applied here byte-identical from SDN's testdata/ (kept local so this build
// has no cross-repo file dependency). Order matters (02 and 04 both touch
// lib/llvm/compiler.cpp) and matches SDN's own build-static-wasmedge.sh.
//   01-atomic-wait            compare/register/sleep under one mutex; a notify
//                             wakes a waiter without a store. Fixes upstream's
//                             lost wakeups — this build's interpreter is the
//                             only execution mode, so this is the one patch
//                             with an observable effect here.
//   02-stop-token             a stop is sticky, read (never consumed) by the
//                             interpreter and by Interruptible AOT code.
//   03-fault-jmp              darwin _setjmp/_longjmp signal-stack-flag fix
//                             for the native-fault path AOT execution uses.
//   04-atomic-memarg-offset   AOT memory.atomic.notify/wait honour the
//                             instruction's memarg offset (lib/llvm/compiler.cpp).
//
// This runner is built with -DWASMEDGE_USE_LLVM=OFF: in 0.16.4 that flag also
// gates WASMEDGE_BUILD_AOT_RUNTIME (WasmEdge's CMakeLists.txt), so the linked
// library can neither compile nor LOAD AOT code. Patches 02-04 therefore
// patch code this runner never executes; only 01 is load-bearing today. They
// stay applied anyway so this isolated dependency's WasmEdge checkout tracks
// SDN's full patched baseline (never drifts if AOT is enabled here later),
// and 04 specifically is why no memarg-offset regression test is added
// alongside it: there is no AOT lane in this SDK to run SDN's substrate probe
// against (module-sdk-oracle: tri-runtime parity is browser / native
// interpreter WasmEdge / Docker interpreter WasmEdge — none compile AOT).
const WASMEDGE_PATCH_NAMES = Object.freeze([
  "wasmedge-0.16.4-atomic-wait.patch",
  "wasmedge-0.16.4-stop-token.patch",
  "wasmedge-0.16.4-fault-jmp.patch",
  "wasmedge-0.16.4-atomic-memarg-offset.patch",
]);

async function prepareWasmEdgeThreadsRuntime(options) {
  if ((options.wasmedgeIncludeDir ?? process.env.WASMEDGE_INCLUDE_DIR) &&
      (options.wasmedgeLibDir ?? process.env.WASMEDGE_LIB_DIR)) return {};
  const patchPaths = WASMEDGE_PATCH_NAMES.map((name) => path.join(__dirname, "native", name));
  const patchBytes = await Promise.all(patchPaths.map((p) => readFile(p)));
  const digestHash = createHash("sha256").update(WASMEDGE_THREADS_REVISION);
  for (const bytes of patchBytes) digestHash.update(bytes);
  const digest = digestHash.update(`${process.platform}-${process.arch}`).digest("hex");
  if (!runtimeBuilds.has(digest)) {
    const build = (async () => {
      const root = path.join(os.tmpdir(), "sdm-wasmedge-runtimes", digest);
      const prefix = path.join(root, "sdk");
      const marker = path.join(root, "complete.json");
      const lock = `${root}.lock`;
      await mkdir(path.dirname(root), { recursive: true, mode: 0o700 });
      const started = Date.now();
      let held = false;
      while (!existsSync(marker)) {
        try {
          await mkdir(lock);
          held = true;
          await writeFile(path.join(lock, "pid"), String(process.pid));
          break;
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          try {
            const owner = Number(await readFile(path.join(lock, "pid"), "utf8"));
            if (owner > 0) {
              try { process.kill(owner, 0); }
              catch (error) { if (error.code === "ESRCH") await rm(lock, { recursive: true, force: true }); }
            }
          } catch { /* another builder is still acquiring its lock */ }
          if (Date.now() - started > 900000) throw new Error("Timed out waiting for the isolated WasmEdge runtime build.");
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      try {
        if (!existsSync(marker)) {
          await mkdir(root, { recursive: true });
          const source = path.join(root, "source");
          const buildDir = path.join(root, "build");
          const run = (command, args) => execFileAsync(command, args, { timeout: 900000, maxBuffer: 16 * 1024 * 1024 });
          if (!existsSync(path.join(source, ".git"))) {
            await run("git", ["clone", "--depth", "1", "--branch", "0.16.4", "https://github.com/WasmEdge/WasmEdge.git", source]);
          }
          const revision = (await run("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
          if (revision !== WASMEDGE_THREADS_REVISION) throw new Error(`Unexpected WasmEdge source revision: ${revision}`);
          for (const patchPath of patchPaths) {
            try { await run("git", ["-C", source, "apply", "--reverse", "--check", patchPath]); }
            catch { await run("git", ["-C", source, "apply", patchPath]); }
          }
          await run("cmake", ["-S", source, "-B", buildDir, "-G", "Ninja",
            "-DCMAKE_BUILD_TYPE=Release", `-DCMAKE_INSTALL_PREFIX=${prefix}`,
            process.platform === "darwin" ? "-DCMAKE_CXX_FLAGS=-Wno-invalid-specialization" : "-DCMAKE_CXX_FLAGS=-Wno-error=maybe-uninitialized -Wno-error=array-bounds",
            "-DWASMEDGE_USE_LLVM=OFF",
            "-DWASMEDGE_BUILD_PLUGINS=OFF", "-DWASMEDGE_BUILD_TOOLS=OFF", "-DWASMEDGE_FORCE_DISABLE_LTO=ON"]);
          await run("cmake", ["--build", buildDir, "-j", "4"]);
          await run("cmake", ["--install", buildDir]);
          const patchesSha256 = Object.fromEntries(
            WASMEDGE_PATCH_NAMES.map((name, i) => [name, createHash("sha256").update(patchBytes[i]).digest("hex")]),
          );
          await writeFile(marker, JSON.stringify({ revision, patchesSha256 }));
        }
      } finally {
        if (held) await rm(lock, { recursive: true, force: true });
      }
      const libDir = existsSync(path.join(prefix, "lib", resolveWasmEdgeSharedLibraryFilename())) ? "lib" : "lib64";
      return { wasmedgeIncludeDir: path.join(prefix, "include"), wasmedgeLibDir: path.join(prefix, libDir) };
    })();
    runtimeBuilds.set(digest, build);
    build.catch(() => runtimeBuilds.delete(digest));
  }
  return runtimeBuilds.get(digest);
}

export async function buildWasmEdgeWasiThreadsRunner(options = {}) {
  const runtime = await prepareWasmEdgeThreadsRuntime(options);
  return buildWasmEdgeEmscriptenPthreadRunner({ ...options, ...runtime, runnerKind: "wasi-threads" });
}

const builds = new Map();

// The command runner is separate from the legacy resident Emscripten host.
// Invalidate cached binaries when either the source or linked library changes.
export async function resolveWasmEdgeWasiThreadsRunner(options = {}) {
  const explicit = options.wasmEdgeRunnerBinary ?? options.wasmedgeRunnerBinary ??
    process.env.SDM_WASMEDGE_RUNNER_BINARY;
  if (explicit) return path.resolve(String(explicit));
  options = { ...options, ...await prepareWasmEdgeThreadsRuntime(options) };
  const plan = resolveWasmEdgeRunnerBuildPlan({
    ...options, runnerKind: "wasi-threads", outputPath: path.join(os.tmpdir(), "sdm-runner"),
  });
  const digest = createHash("sha256")
    .update(await readFile(__filename))
    .update(await readFile(plan.runnerSourcePath))
    .update(await readFile(plan.wasmedgeSharedLibraryPath))
    .update(JSON.stringify([process.platform, process.arch, plan.wasmedgeIncludeDir,
      plan.wasmedgeSharedLibraryPath, plan.compilerCommand, plan.compilerArgs]))
    .digest("hex");
  if (!builds.has(digest)) {
    const build = (async () => {
      const dir = path.join(os.tmpdir(), "sdm-wasmedge-runners");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const outputPath = path.join(dir, `wasi-threads-${digest}`);
      if (!existsSync(outputPath)) {
        const staging = `${outputPath}.${process.pid}`;
        try {
          await buildWasmEdgeWasiThreadsRunner({ ...options, outputPath: staging });
          await rename(staging, outputPath);
        } finally {
          await rm(staging, { force: true });
        }
      }
      // This executes the linked library's version check, including on cache hits.
      await execFileAsync(outputPath, ["--version"]);
      return outputPath;
    })();
    builds.set(digest, build);
    build.catch(() => builds.delete(digest));
  }
  return builds.get(digest);
}
