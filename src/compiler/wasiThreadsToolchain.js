// Resolves the WASI-threads (wasm32-wasip1-threads) toolchain used to build
// isomorphic pthreads module artifacts.
//
// WHY WASI-THREADS AND NOT EMSCRIPTEN -pthread:
// Emscripten's `-pthread` (even with -s STANDALONE_WASM=1) emits the browser-
// only Web Worker + postMessage thread model: the wasm imports
// `env.__pthread_create_js` and `env._emscripten_*` mailbox/postMessage hooks
// and has NO wasi thread-spawn contract. That artifact CANNOT spawn threads
// under WasmEdge (there is no JS runtime to satisfy those imports). WasmEdge's
// actual thread mechanism is wasi-threads: the guest imports `wasi.thread-spawn`
// and exports `wasi_thread_start`, over an imported shared memory. Compiling
// with clang `--target=wasm32-wasip1-threads -pthread` produces exactly that
// contract, which threads under WasmEdge AND loads in the browser via a
// wasi-threads (SharedArrayBuffer + Worker) shim. See docs/isomorphic-pthreads.md.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const DEFAULT_TARGET = "wasm32-wasip1-threads";
// The compiler-rt builtins for the threads target live under this normalized
// triple inside the resource dir.
const RESOURCE_TRIPLE = "wasm32-unknown-wasip1-threads";
// The threads libc/libc++ live under this triple inside the sysroot.
const SYSROOT_TRIPLE = "wasm32-wasip1-threads";

function firstExisting(candidates, probe) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (existsSync(probe(candidate))) {
        return candidate;
      }
    } catch {
      // ignore and keep searching
    }
  }
  return null;
}

function globVersionedRoots(cellarDir, tail) {
  try {
    return readdirSync(cellarDir)
      .map((entry) => path.join(cellarDir, entry, tail))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function resolveSysroot() {
  if (process.env.SDN_WASI_SYSROOT) {
    return process.env.SDN_WASI_SYSROOT;
  }
  const candidates = [
    "/opt/homebrew/share/wasi-sysroot",
    "/usr/local/share/wasi-sysroot",
    "/opt/wasi-sdk/share/wasi-sysroot",
    ...globVersionedRoots("/opt/homebrew/Cellar/wasi-libc", "share/wasi-sysroot"),
  ];
  return firstExisting(candidates, (root) =>
    path.join(root, "lib", SYSROOT_TRIPLE, "libc.a"),
  );
}

function resolveResourceDir() {
  if (process.env.SDN_WASI_RESOURCE_DIR) {
    return process.env.SDN_WASI_RESOURCE_DIR;
  }
  const candidates = [
    "/opt/homebrew/share/wasi-runtimes",
    "/usr/local/share/wasi-runtimes",
    ...globVersionedRoots(
      "/opt/homebrew/Cellar/wasi-runtimes",
      "share/wasi-runtimes",
    ),
  ];
  return firstExisting(candidates, (root) =>
    path.join(root, "lib", RESOURCE_TRIPLE, "libclang_rt.builtins.a"),
  );
}

let cachedToolchain;

/**
 * Resolve the wasi-threads toolchain. Returns a descriptor with the C/C++ driver
 * commands and the target/sysroot/resource-dir args that must be applied to
 * every compile and the final link. Throws a clear, actionable error (listing
 * the env overrides) when the toolchain or its threads sysroot is unavailable.
 *
 * Env overrides: SDN_WASI_CLANG, SDN_WASI_CLANGXX, SDN_WASI_TARGET,
 * SDN_WASI_SYSROOT, SDN_WASI_RESOURCE_DIR.
 */
export function resolveWasiThreadsToolchain(options = {}) {
  if (cachedToolchain && !options.force) {
    return cachedToolchain;
  }
  const clang = process.env.SDN_WASI_CLANG || "wasm32-wasi-clang";
  const clangxx = process.env.SDN_WASI_CLANGXX || "wasm32-wasi-clang++";
  const target = process.env.SDN_WASI_TARGET || DEFAULT_TARGET;
  const sysroot = resolveSysroot();
  const resourceDir = resolveResourceDir();

  const failures = [];
  try {
    execFileSync(clangxx, ["--version"], { stdio: "ignore" });
  } catch (error) {
    if (error?.code === "ENOENT") {
      failures.push(
        `WASI clang driver "${clangxx}" was not found on PATH (override with SDN_WASI_CLANGXX).`,
      );
    } else {
      failures.push(
        `WASI clang driver "${clangxx}" could not be executed: ${error?.message ?? error}.`,
      );
    }
  }
  if (!sysroot) {
    failures.push(
      `A wasi-threads sysroot (containing lib/${SYSROOT_TRIPLE}/libc.a) was not found (override with SDN_WASI_SYSROOT).`,
    );
  }
  if (failures.length > 0) {
    throw new Error(
      "Cannot build the isomorphic-pthreads (wasi-threads) artifact: " +
        `${failures.join(" ")} Install a wasi-sdk / wasi-libc+wasi-runtimes toolchain ` +
        "with the wasm32-wasip1-threads target (e.g. `brew install wasi-libc wasi-runtimes` " +
        "or a wasi-sdk release), or set the SDN_WASI_* env overrides.",
    );
  }

  const toolchainArgs = [`--target=${target}`, `--sysroot=${sysroot}`];
  if (resourceDir) {
    toolchainArgs.push(`-resource-dir=${resourceDir}`);
  }

  cachedToolchain = {
    clang,
    clangxx,
    target,
    sysroot,
    resourceDir,
    toolchainArgs,
    describe() {
      return `${clangxx} ${toolchainArgs.join(" ")}`;
    },
  };
  return cachedToolchain;
}
