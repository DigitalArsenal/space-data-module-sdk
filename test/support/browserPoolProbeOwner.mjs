import { createBrowserModuleHarness } from "../../src/host/browserModuleHarness.js";

// Observe termination calls while every worker executes the real SDK pool code.
const NativeWorker = globalThis.Worker;
const live = new Set();
let created = 0;
globalThis.Worker = class extends NativeWorker {
  constructor(...args) {
    super(...args);
    created += 1;
    live.add(this);
  }
  terminate() {
    live.delete(this);
    return super.terminate();
  }
};

self.onmessage = async ({ data }) => {
  const { id, poolSize, probeTimeoutMs, surface, env, request } = data;
  let harness;
  const before = created;
  const reply = { id };
  try {
    harness = await createBrowserModuleHarness({
      wasmSource: "/module.wasm",
      surface,
      env,
      enableBrowserWasiThreads: true,
      wasiThreadPoolSize: poolSize,
      wasiThreadProbeTimeoutMs: probeTimeoutMs,
      wasiThreadWorkerUrl: new URL("/wasi-thread-worker.js", self.location.href).href,
    });
    reply.initial = harness.wasiThreadPoolReport;
    reply.liveAfterArming = live.size;
    reply.frozen = Object.isFrozen(harness.wasiThreadPoolReport);
    try { harness.wasiThreadPoolReport = {}; } catch { reply.readOnly = true; }
    const response = await harness.invoke(request);
    reply.statusCode = response.statusCode;
    reply.errorMessage = response.errorMessage;
    reply.outputs = response.outputs.map(output => Array.from(output.payload));
    reply.report = harness.wasiThreadPoolReport;
    reply.spawnReport = harness.threadHost.spawnReport();
    reply.liveAfterInvoke = live.size;
  } catch (error) {
    reply.error = error.message;
  } finally {
    await harness?.destroy();
  }
  reply.created = created - before;
  reply.liveAfterDestroy = live.size;
  self.postMessage(reply);
};
