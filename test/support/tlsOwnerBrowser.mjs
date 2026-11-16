import { createBrowserModuleHarness } from "../../src/host/browserModuleHarness.js";
self.onmessage = async () => {
  let harness;
  try {
    harness = await createBrowserModuleHarness({
      wasmSource: new Uint8Array(await (await fetch("/module.wasm")).arrayBuffer()),
      surface: "direct",
      enableBrowserWasiThreads: true,
      wasiThreadPoolSize: 2,
      wasiThreadWorkerUrl: new URL("/thread.js", self.location.href).href,
    });
    const x = harness.instance.exports;
    const result = {
      tls: x.tls_address(), stackTop: x.stack_top(),
      constructorResult: x.constructor_result(),
      before: x.tls_get(), poolSize: harness.threadHost.spawnReport().poolSize,
    };
    x.stack_write();
    result.after = x.tls_get();
    result.spawnResult = x.spawn();
    result.afterChild = x.tls_get();
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: String(error) });
  } finally {
    await harness?.destroy();
  }
};
