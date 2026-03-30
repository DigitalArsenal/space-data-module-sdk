import { accessSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

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

export function resolveWasmEdgeRunnerSourcePath() {
  return path.resolve(
    __dirname,
    "native",
    "wasmedge_emscripten_pthread_runner.c",
  );
}

export function resolveWasmEdgeRunnerBuildPlan(options = {}) {
  const requestedIncludeDir = normalizeResolvedPath(
    options.wasmedgeIncludeDir ?? process.env.WASMEDGE_INCLUDE_DIR,
  );
  const wasmedgeLibDir = normalizeResolvedPath(
    options.wasmedgeLibDir ?? process.env.WASMEDGE_LIB_DIR,
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

  const runnerSourcePath = resolveWasmEdgeRunnerSourcePath();
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
    await execFileAsync("install_name_tool", [
      "-change",
      "@rpath/libwasmedge.0.dylib",
      plan.wasmedgeSharedLibraryPath,
      plan.outputPath,
    ]);
  }
  return plan.outputPath;
}
