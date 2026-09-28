// The OWNER worker of the headless-browser thread-wave test: a cross-origin
// isolated module worker that runs the wave guest through the SDK's browser
// harness, as a consumer's analysis worker does. The guest blocks this worker
// for the whole invoke, so every thread the pool recycles is recycled without
// this worker's event loop. Bundled by threadWaveBrowser.mjs.

import { createBrowserModuleHarness } from "../../src/host/browserModuleHarness.js";

function toHex(bytes) {
  return Array.from(bytes ?? [], (byte) => byte.toString(16).padStart(2, "0")).join("");
}

self.onmessage = async (event) => {
  const { id, lanes, env, surface, invokes, spawnWaitMs, request } = event.data;
  let harness = null;
  try {
    const wasmBytes = new Uint8Array(await (await fetch("/module.wasm")).arrayBuffer());
    harness = await createBrowserModuleHarness({
      wasmSource: wasmBytes,
      surface,
      enableBrowserWasiThreads: true,
      maxThreads: lanes,
      wasiThreadWorkerUrl: new URL("/wasi-thread-worker.js", self.location.href).href,
      wasiThreadSpawnWaitMs: spawnWaitMs,
      env,
    });
    const runs = [];
    for (let index = 0; index < invokes; index += 1) {
      const response = await harness.invoke({
        methodId: request.methodId,
        inputs: request.inputs.map((input) => ({
          ...input,
          payload: new Uint8Array(input.payload),
        })),
      });
      runs.push({
        statusCode: response.statusCode,
        errorCode: response.errorCode ?? null,
        errorMessage: response.errorMessage ?? null,
        outputs: (response.outputs ?? []).map((output) => toHex(output.payload)),
      });
    }
    const report = harness.threadHost.spawnReport();
    self.postMessage({
      id,
      ok: true,
      crossOriginIsolated: self.crossOriginIsolated === true,
      hardwareConcurrency: self.navigator?.hardwareConcurrency ?? null,
      runs,
      spawnCount: harness.threadHost.spawnCount(),
      poolWorkers: harness.threadHost.distinctOsThreadCount(),
      report,
    });
  } catch (error) {
    self.postMessage({ id, ok: false, error: `${error?.name ?? "Error"}: ${error?.message ?? error}` });
  } finally {
    try {
      await harness?.destroy?.();
    } catch {
      // teardown never masks the result
    }
  }
};
