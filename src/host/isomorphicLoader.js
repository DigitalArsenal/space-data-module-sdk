/**
 * Isomorphic module loader.
 *
 * Unified entry point that detects the runtime environment and artifact
 * profile, then loads the module through the appropriate path:
 *   - Browser: createBrowserModuleHarness (WASI shim + optional sdn_host)
 *   - Node/WasmEdge: createModuleHarness (subprocess)
 *
 * The same compiled .wasm artifact works in both environments.
 */

import {
  createBrowserModuleHarness,
  detectArtifactProfile,
} from "../testing/browserModuleHarness.js";
import { createAsyncHostDispatcher } from "./abi.js";

const isBrowser =
  typeof globalThis.window !== "undefined" &&
  typeof globalThis.document !== "undefined";

function attachHostDispatch(harness, host) {
  if (!host || typeof host !== "object") {
    return harness;
  }
  const dispatchHost = createAsyncHostDispatcher(host);
  return {
    ...harness,
    host,
    async callHost(operation, params = {}) {
      return dispatchHost(operation, params);
    },
  };
}

async function createWasmEdgeCommandHarness(options = {}) {
  const [
    { spawn },
    { readFile },
    pathModule,
    { encodePluginInvokeRequest, decodePluginInvokeResponse },
    { buildWasmEdgeSpawnEnv },
    { DefaultInvokeExports },
    { toUint8Array },
  ] = await Promise.all([
    import("node:child_process"),
    import("node:fs/promises"),
    import("node:path"),
    import("../invoke/codec.js"),
    import("../testing/processInvoke.js"),
    import("../runtime/constants.js"),
    import("../runtime/bufferLike.js"),
  ]);
  const path = pathModule.default ?? pathModule;
  const wasmPath = path.resolve(String(options.wasmSource));
  const wasmBytes = await readFile(wasmPath);
  const inspection = await inspectModule(wasmBytes);

  if (!inspection.exports.includes(DefaultInvokeExports.commandSymbol)) {
    throw new Error(
      "Standalone WasmEdge loading requires a command-surface artifact with the _start export.",
    );
  }

  const command = options.wasmEdgeBinary ?? "wasmedge";
  const args = [
    ...(options.enableThreads === false ? [] : ["--enable-threads"]),
    wasmPath,
    ...(Array.isArray(options.args) ? options.args : []),
  ];
  const launchPlan = {
    command,
    args,
    env: buildWasmEdgeSpawnEnv(options.env),
    cwd: options.cwd ?? process.cwd(),
    wasmPath,
  };

  async function invokeRaw(requestBytes) {
    const normalizedRequest = toUint8Array(requestBytes);
    if (!normalizedRequest) {
      throw new TypeError(
        "Expected Uint8Array, ArrayBufferView, or ArrayBuffer request bytes.",
      );
    }

    return new Promise((resolve, reject) => {
      const child = spawn(launchPlan.command, launchPlan.args, {
        cwd: launchPlan.cwd,
        env: launchPlan.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdoutChunks = [];
      const stderrChunks = [];

      function formatFailure(message, cause = null) {
        const stderrText = Buffer.concat(stderrChunks).toString("utf8").trim();
        const details = stderrText ? `${message}\n${stderrText}` : message;
        return cause ? new Error(details, { cause }) : new Error(details);
      }

      child.stdout.on("data", (chunk) => {
        stdoutChunks.push(Buffer.from(chunk));
      });
      child.stderr.on("data", (chunk) => {
        stderrChunks.push(Buffer.from(chunk));
      });
      child.on("error", (error) => {
        reject(
          formatFailure(
            "Failed to launch WasmEdge command harness.",
            error,
          ),
        );
      });
      child.on("close", (code, signal) => {
        if (code !== 0 || signal !== null) {
          reject(
            formatFailure(
              `WasmEdge command harness exited with ${
                signal ? `signal ${signal}` : `code ${code}`
              }.`,
            ),
          );
          return;
        }
        resolve(new Uint8Array(Buffer.concat(stdoutChunks)));
      });
      child.stdin.end(Buffer.from(normalizedRequest));
    });
  }

  return {
    runtime: {
      kind: "wasmedge",
      profile: inspection.profile,
      surface: "command",
    },
    launchPlan,
    invokeRaw,
    async invoke(request = {}) {
      const requestBytes = encodePluginInvokeRequest(request);
      const responseBytes = await invokeRaw(requestBytes);
      return decodePluginInvokeResponse(responseBytes);
    },
    readManifest() {
      return null;
    },
    async destroy() {},
  };
}

/**
 * Load a WASM module isomorphically.
 *
 * @param {Object} options
 * @param {Uint8Array|ArrayBuffer|Response|string|WebAssembly.Module} options.wasmSource
 *   The WASM artifact — same binary for all runtimes.
 * @param {Object} [options.host] - Host instance (BrowserHost or NodeHost).
 * @param {string[]} [options.args] - WASI args.
 * @param {Object} [options.env] - WASI environment variables.
 * @param {string} [options.surface] - "direct" or "command".
 * @param {Object} [options.runtimeHost] - Runtime host for row/region ops.
 * @returns {Promise<Object>} Harness with invoke(), readManifest(), destroy().
 */
export async function loadModule(options = {}) {
  if (isBrowser) {
    return createBrowserModuleHarness(options);
  }

  const { createModuleHarness } = await import("../testing/moduleHarness.js");
  const source = options.wasmSource;
  if (typeof source !== "string") {
    throw new TypeError(
      "Server-side isomorphic loader expects a file path string for wasmSource.",
    );
  }

  const runtimeKind = options.runtimeKind ?? "wasmedge";
  if (runtimeKind === "wasmedge") {
    const runtimeHostRequested =
      String(options.hostProfile ?? "").trim().toLowerCase() === "runtime-host" ||
      Array.isArray(options.modules) ||
      (typeof options.defaultModuleId === "string" &&
        options.defaultModuleId.trim().length > 0);
    if (!runtimeHostRequested && !options.wasmEdgeRunnerBinary) {
      const { readFile } = await import("node:fs/promises");
      const inspection = await inspectModule(await readFile(source));
      if (
        (inspection.profile === "standalone" || inspection.profile === "sdn-abi") &&
        inspection.exports.includes("_start")
      ) {
        return attachHostDispatch(
          await createWasmEdgeCommandHarness(options),
          options.host ?? null,
        );
      }
    }

    return attachHostDispatch(
      await createModuleHarness({
        runtime: {
          kind: "wasmedge",
          wasmPath: source,
        wasmEdgeBinary: options.wasmEdgeBinary,
        wasmEdgeRunnerBinary: options.wasmEdgeRunnerBinary,
        enableThreads: options.enableThreads,
        env: options.env,
        cwd: options.cwd,
        hostProfile: options.hostProfile,
        modules: options.modules,
        defaultModuleId: options.defaultModuleId,
          metadata: options.metadata,
        },
      }),
      options.host ?? null,
    );
  }

  return attachHostDispatch(
    await createModuleHarness({
      runtime: {
        kind: runtimeKind,
        command: options.command ?? runtimeKind,
        args: options.args ?? [source],
        env: options.env,
        cwd: options.cwd,
        hostProfile: options.hostProfile,
        modules: options.modules,
        defaultModuleId: options.defaultModuleId,
      },
    }),
    options.host ?? null,
  );
}

/**
 * Inspect a WASM module's artifact profile without instantiating it.
 *
 * @param {Uint8Array|ArrayBuffer|WebAssembly.Module} source
 * @returns {Promise<{profile: string, exports: string[], imports: Array}>}
 */
export async function inspectModule(source) {
  let wasmModule;
  if (source instanceof WebAssembly.Module) {
    wasmModule = source;
  } else {
    const bytes =
      source instanceof ArrayBuffer ? new Uint8Array(source) : source;
    wasmModule = await WebAssembly.compile(bytes);
  }

  const profile = detectArtifactProfile(wasmModule);
  const exports = WebAssembly.Module.exports(wasmModule).map((e) => e.name);
  const imports = WebAssembly.Module.imports(wasmModule);

  return { profile, exports, imports };
}
