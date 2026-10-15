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
  zeroWasmBytes,
} from "./browserModuleHarness.js";
import { openModuleArtifact } from "../bundle/artifactBytes.js";
import { attachHostDispatch, inspectModule } from "./isomorphicLoaderCore.js";
import { assertArtifactRuntimeTarget } from "./runtimeTargetGate.js";
import { DEFAULT_HOSTCALL_IMPORT_MODULE } from "./abi.js";

/** The typed failure the WasmEdge command harness's runner answers for any operation but plugin.getConfig. */
export const WASMEDGE_UNSUPPORTED_MESSAGE = "the WasmEdge command harness serves only plugin.getConfig";

export { inspectModule, attachHostDispatch };

const isBrowser =
  typeof globalThis.window !== "undefined" &&
  typeof globalThis.document !== "undefined";

/**
 * @param {Object} options - loadModule options
 * @param {Object} staged - the `stageModuleArtifact` result loadModule made:
 *   the checked payload in a private file. This harness launches that file and
 *   never re-reads the artifact path, so the bytes WasmEdge runs are the bytes
 *   whose signature was checked. It owns the stage and disposes it on destroy.
 * @param {WebAssembly.Module} wasmModule - the staged payload, compiled
 */
async function createWasmEdgeCommandHarness(options, staged, wasmModule) {
  const [
    { spawn },
    pathModule,
    { encodePluginInvokeRequest, decodePluginInvokeResponse },
    { buildWasmEdgeSpawnEnv },
    { DefaultInvokeExports },
    { toUint8Array },
  ] = await Promise.all([
    import("node:child_process"),
    import("node:path"),
    import("../invoke/codec.js"),
    import("../testing/processInvoke.js"),
    import("../runtime/constants.js"),
    import("../runtime/bufferLike.js"),
  ]);
  const path = pathModule.default ?? pathModule;
  const inspection = await inspectModule(wasmModule);

  const threaded = inspection.imports.some((entry) =>
    entry.module === "wasi" && entry.name === "thread-spawn");
  // The plain WasmEdge CLI provides WASI and nothing else: an artifact that
  // imports the typed hostcall bridge (space_data_module_host) fails to
  // instantiate there ("unknown import"). The SDK's runner serves the bridge,
  // threaded or not, so a bridged artifact always runs on it; plain wasmedge
  // stays for WASI-only artifacts.
  const bridged = inspection.imports.some((entry) =>
    entry.module === DEFAULT_HOSTCALL_IMPORT_MODULE);
  const useRunner = threaded || bridged;
  const hasCommand = inspection.exports.includes(DefaultInvokeExports.commandSymbol);
  const hasDirect = inspection.exports.includes(DefaultInvokeExports.invokeSymbol);
  // The one-shot wasi-threads runner serves the direct surface of a reactor,
  // and of a command artifact when the caller asks for it (--sdm-direct): the
  // module's constructors then run through its initializer export, never main.
  const surface = hasCommand && !(options.surface === "direct" && useRunner && hasDirect)
    ? "command"
    : "direct";
  if (surface === "direct" && (!useRunner || !hasDirect)) {
    throw new Error(
      "Standalone WasmEdge loading requires a command-surface artifact with the _start export.",
    );
  }

  const command = useRunner
    ? await (await import("../testing/buildWasmEdgeRunner.js")).resolveWasmEdgeWasiThreadsRunner(options)
    : options.wasmEdgeRunnerBinary ?? options.wasmEdgeBinary ?? "wasmedge";
  const launchWasmPath = staged.path;
  let tempArtifactDir = null;
  const ensureTempDir = async () => {
    if (!tempArtifactDir) {
      const [{ mkdtemp }, osModule] = await Promise.all([
        import("node:fs/promises"),
        import("node:os"),
      ]);
      const os = osModule.default ?? osModule;
      tempArtifactDir = await mkdtemp(path.join(os.tmpdir(), "sdm-module-"));
    }
    return tempArtifactDir;
  };
  // The runner replays staged $PIV answers for the bridge, as on the parity
  // lanes: plugin.getConfig answers the module's config (options.config, else
  // the host's plugin.getConfig(), else {}), and every other operation answers
  // a typed "unsupported" failure.
  const hostcallArgs = [];
  if (bridged) {
    const [{ writeFile }, { encodeParityHostcallAnswers, PARITY_HOSTCALL_FILES }] = await Promise.all([
      import("node:fs/promises"),
      import("../testing/parityHostcalls.js"),
    ]);
    const config = options.config ??
      (typeof options.host?.plugin?.getConfig === "function" ? await options.host.plugin.getConfig() : {});
    const answers = encodeParityHostcallAnswers(config, WASMEDGE_UNSUPPORTED_MESSAGE);
    const dir = await ensureTempDir();
    const configPath = path.join(dir, PARITY_HOSTCALL_FILES.config);
    const unsupportedPath = path.join(dir, PARITY_HOSTCALL_FILES.unsupported);
    await writeFile(configPath, answers.config);
    await writeFile(unsupportedPath, answers.unsupported);
    hostcallArgs.push("--sdm-hostcall-config", configPath, "--sdm-hostcall-unsupported", unsupportedPath);
  }

  const args = [
    ...(surface === "direct" && hasCommand ? ["--sdm-direct"] : []),
    ...hostcallArgs,
    ...(options.enableThreads === false ? [] : ["--enable-threads"]),
    ...Object.entries(options.env ?? {}).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
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
      surface,
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
      await staged.dispose();
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
 * @param {Object} [options.config] - The module config plugin.getConfig answers
 *   on the WasmEdge leg (default: options.host's plugin.getConfig(), else {}).
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

  const runtimeHostRequested =
    String(options.hostProfile ?? "").trim().toLowerCase() === "runtime-host" ||
    Array.isArray(options.modules) ||
    (typeof options.defaultModuleId === "string" &&
      options.defaultModuleId.trim().length > 0);

  if (runtimeKind !== "wasmedge") {
    // A caller-named process runtime receives the artifact path as delivered
    // (its own host decides how to load it); the signature is still checked
    // here first, through the one load path.
    const { readFile } = await import("node:fs/promises");
    const artifactBytes = new Uint8Array(await readFile(source));
    await openModuleArtifact(artifactBytes, options);
    zeroWasmBytes(artifactBytes);
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

  // ONE READ of the artifact, through the one load path: stageModuleArtifact
  // checks the signature, strips the trailer and writes exactly the checked
  // payload to a private file. Every WasmEdge launch below runs THAT file —
  // nothing re-reads `source` after the check. The same read answers the
  // runtime-target declaration and, for the command path, the profile
  // inspection; the plaintext is scrubbed the moment those are answered.
  const { stageModuleArtifact } = await import("../bundle/stageModuleArtifact.js");
  const staged = await stageModuleArtifact(source, options);
  let wasmModule = null;
  let embeddedManifest = null;
  try {
    // The profile inspection is the ONLY consumer here that needs a compiled
    // module. The runtime-host path does not take it, and it must not pay a
    // V8 compile of the whole artifact on every load just because the
    // runtime-target gate arrived — the gate reads a custom section.
    if (!runtimeHostRequested) {
      wasmModule = await WebAssembly.compile(staged.wasmBytes);
    }
    const { locateEmbeddedPlgManifest } = await import(
      "../compliance/index.js"
    );
    embeddedManifest =
      locateEmbeddedPlgManifest(staged.artifactBytes)?.decoded ?? null;
  } catch (error) {
    await staged.dispose();
    throw error;
  } finally {
    zeroWasmBytes(staged.artifactBytes);
  }

  try {
    // MIRROR OF THE BROWSER GATE. Enforcing the declaration on one leg only is
    // itself a divergence between the legs: a `["browser"]`-only artifact
    // handed to WasmEdge would run until it reached something WasmEdge does
    // not serve, while the reverse case is refused at the door. Both legs read
    // the same declaration and refuse the same way.
    assertArtifactRuntimeTarget({
      embeddedManifest,
      manifest: options.manifest,
      leg: "wasmedge",
    });
    if (wasmModule) {
      const inspection = await inspectModule(wasmModule);
      const threaded = inspection.imports.some((entry) => entry.module === "wasi" && entry.name === "thread-spawn");
      const bridged = inspection.imports.some((entry) => entry.module === DEFAULT_HOSTCALL_IMPORT_MODULE);
      const useRunner = threaded || bridged;
      if (
        (inspection.profile === "standalone" || inspection.profile === "module-host-abi") &&
        (inspection.exports.includes("_start") || (useRunner && inspection.exports.includes("plugin_invoke_stream"))) &&
        (!options.wasmEdgeRunnerBinary || options.surface === "command" || useRunner)
      ) {
        return attachHostDispatch(
          await createWasmEdgeCommandHarness(options, staged, wasmModule),
          options.host ?? null,
        );
      }
    }

    return attachHostDispatch(
      await createModuleHarness({
        runtime: {
          kind: "wasmedge",
          stagedArtifact: staged,
          wasmEdgeBinary: options.wasmEdgeBinary,
          wasmEdgeRunnerBinary: options.wasmEdgeRunnerBinary,
          enableThreads: options.enableThreads,
          env: options.env,
          cwd: options.cwd,
          hostProfile: options.hostProfile,
          modules: options.modules,
          defaultModuleId: options.defaultModuleId,
          metadata: options.metadata,
          verifySignature: options.verifySignature,
        },
      }),
      options.host ?? null,
    );
  } catch (error) {
    await staged.dispose();
    throw error;
  }
}
