/**
 * Isomorphic module loader — NODE/WasmEdge leg (the `default` condition).
 *
 * Unified entry point that detects the runtime environment and artifact
 * profile, then loads the module through the appropriate path:
 *   - Browser (jsdom/embedded window under Node): createBrowserModuleHarness
 *   - Node/WasmEdge: createModuleHarness (subprocess) or the WasmEdge command
 *     harness below
 *
 * The same compiled .wasm artifact works in every environment; only HOW it is
 * launched differs, and that difference is absorbed here — never in a guest.
 *
 * A browser resolves `./host/isomorphic` to `isomorphicLoaderBrowser.js`
 * instead, via the package's `browser` export condition. The two legs share
 * `isomorphicLoaderCore.js` so the runtime-independent half cannot drift. The
 * split is what keeps a browser bundle from statically resolving the
 * node:child_process/os/path/fs imports below
 * (`module-sdk-browser-entry-node-builtins`).
 */

import {
  createBrowserModuleHarness,
  toLoadableWasmBytes,
  zeroWasmBytes,
} from "./browserModuleHarness.js";
import {
  resolveModuleSignaturePolicy,
  verifyModuleArtifact,
} from "../bundle/signing.js";
import { attachHostDispatch, inspectModule } from "./isomorphicLoaderCore.js";
import { assertArtifactRuntimeTarget } from "./runtimeTargetGate.js";

export { inspectModule, attachHostDispatch };

const isBrowser =
  typeof globalThis.window !== "undefined" &&
  typeof globalThis.document !== "undefined";

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
  // Signed/published artifacts carry an appended publication record
  // collection that WasmEdge rejects ("malformed section id"). Strip to the
  // canonical module payload; if anything was stripped, launch WasmEdge from
  // a temp copy of the stripped bytes (signature verification, when
  // requested, already ran against the full artifact in loadModule()).
  const loadableBytes = toLoadableWasmBytes(wasmBytes);
  const inspection = await inspectModule(loadableBytes);

  if (!inspection.exports.includes(DefaultInvokeExports.commandSymbol)) {
    throw new Error(
      "Standalone WasmEdge loading requires a command-surface artifact with the _start export.",
    );
  }

  let launchWasmPath = wasmPath;
  let tempArtifactDir = null;
  if (loadableBytes.byteLength !== wasmBytes.byteLength) {
    const [{ mkdtemp, writeFile }, osModule] = await Promise.all([
      import("node:fs/promises"),
      import("node:os"),
    ]);
    const os = osModule.default ?? osModule;
    tempArtifactDir = await mkdtemp(path.join(os.tmpdir(), "sdm-module-"));
    launchWasmPath = path.join(tempArtifactDir, "module.wasm");
    await writeFile(launchWasmPath, loadableBytes);
  }

  const command = options.wasmEdgeBinary ?? "wasmedge";
  const args = [
    ...(options.enableThreads === false ? [] : ["--enable-threads"]),
    launchWasmPath,
    ...(Array.isArray(options.args) ? options.args : []),
  ];
  const launchPlan = {
    command,
    args,
    env: buildWasmEdgeSpawnEnv(options.env),
    cwd: options.cwd ?? process.cwd(),
    wasmPath: launchWasmPath,
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
    async destroy() {
      if (tempArtifactDir) {
        const { rm } = await import("node:fs/promises");
        await rm(tempArtifactDir, { recursive: true, force: true });
        tempArtifactDir = null;
      }
    },
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
  const signaturePolicy = resolveModuleSignaturePolicy(options);
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

  // ONE READ of the artifact, serving every question this function asks of the
  // bytes: the signature, the runtime-target declaration, and the profile
  // inspection below. Each of those used to open the file for itself. The
  // plaintext buffer this function materialized is scrubbed the moment the
  // last of them is answered, matching the browser harness's
  // ownedArtifactBytes contract.
  const needsBytes = Boolean(signaturePolicy) || runtimeKind === "wasmedge";
  let artifactBytes = null;
  let wasmModule = null;
  if (needsBytes) {
    const { readFile } = await import("node:fs/promises");
    artifactBytes = new Uint8Array(await readFile(source));
    if (signaturePolicy) {
      await verifyModuleArtifact(artifactBytes, signaturePolicy);
    }
    if (runtimeKind === "wasmedge") {
      wasmModule = await WebAssembly.compile(toLoadableWasmBytes(artifactBytes));
    }
    zeroWasmBytes(artifactBytes);
    artifactBytes = null;
  }

  if (runtimeKind === "wasmedge") {
    // MIRROR OF THE BROWSER GATE. Enforcing the declaration on one leg only is
    // itself a divergence between the legs: a `["browser"]`-only artifact
    // handed to WasmEdge would run until it reached something WasmEdge does
    // not serve, while the reverse case is refused at the door. Both legs read
    // the same declaration and refuse the same way.
    assertArtifactRuntimeTarget({
      wasmModule,
      manifest: options.manifest,
      leg: "wasmedge",
    });
    const runtimeHostRequested =
      String(options.hostProfile ?? "").trim().toLowerCase() === "runtime-host" ||
      Array.isArray(options.modules) ||
      (typeof options.defaultModuleId === "string" &&
        options.defaultModuleId.trim().length > 0);
    if (!runtimeHostRequested && !options.wasmEdgeRunnerBinary) {
      const inspection = await inspectModule(wasmModule);
      if (
        (inspection.profile === "standalone" || inspection.profile === "module-host-abi") &&
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
