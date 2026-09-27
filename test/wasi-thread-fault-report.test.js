import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileModuleFromSource, cleanupCompilation } from "../src/compiler/compileModule.js";
import { resolveWasiThreadsToolchain } from "../src/compiler/wasiThreadsToolchain.js";
import { encodePluginInvokeRequest } from "../src/invoke/index.js";

// A guest thread that traps never completes the pthread exit protocol, so the
// thread joining it stays blocked inside the guest and cannot run the worker's
// error event. The worker must report the fault itself, on stderr, right away.

const wasiThreadsAvailable = (() => {
  try {
    resolveWasiThreadsToolchain();
    return true;
  } catch {
    return false;
  }
})();

const identity = { schemaName: "CAT.fbs", fileIdentifier: "$CAT", rootTypeName: "CAT" };
const port = (portId) => ({
  portId, required: true, minStreams: 1, maxStreams: 1,
  acceptedTypeSets: [{ setId: "catalog", allowedTypes: [{ ...identity, wireFormat: "flatbuffer" }] }],
});
const source = `#include <pthread.h>
#include "space_data_module_invoke.h"
static void *faulting(void *arg) {
  (void)arg;
  __builtin_trap();
  return 0;
}
int run(void) {
  pthread_t worker;
  if (pthread_create(&worker, 0, faulting, 0) != 0) return 5;
  pthread_join(worker, 0);
  return 0;
}`;

test("a trapping guest thread is reported on stderr while its joiner is blocked", {
  skip: !wasiThreadsAvailable && "wasi-threads toolchain unavailable",
}, async (t) => {
  const compilation = await compileModuleFromSource({
    language: "c", sourceCode: source, threadModel: "emscripten-pthreads",
    manifest: {
      pluginId: "com.digitalarsenal.test.thread-fault", name: "Thread fault", version: "0.1.0",
      pluginFamily: "analysis", runtimeTargets: ["browser", "wasmedge"], invokeSurfaces: ["direct"],
      methods: [{ methodId: "run", displayName: "Run", inputPorts: [port("request")],
        outputPorts: [port("response")], maxBatch: 1, drainPolicy: "single-shot" }],
    },
  });
  t.after(() => cleanupCompilation(compilation));
  const dir = await mkdtemp(path.join(os.tmpdir(), "sdm-thread-fault-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const wasmPath = path.join(dir, "module.wasm");
  const requestPath = path.join(dir, "request.bin");
  await writeFile(wasmPath, compilation.wasmBytes);
  await writeFile(requestPath, encodePluginInvokeRequest({
    methodId: "run", inputs: [{ portId: "request", typeRef: identity, payload: new Uint8Array(8) }],
  }));
  const harnessUrl = new URL("../src/host/browserModuleHarness.js", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", `
    import { readFile } from "node:fs/promises";
    const { createBrowserModuleHarness } = await import(${JSON.stringify(harnessUrl)});
    const h = await createBrowserModuleHarness({ wasmSource: await readFile(${JSON.stringify(wasmPath)}), surface: "direct" });
    await h.invokeRaw(await readFile(${JSON.stringify(requestPath)}));
  `], { stdio: ["ignore", "ignore", "pipe"] });
  const stderr = await new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`no guest thread fault report within 60 s; stderr: ${text}`));
    }, 60000);
    child.stderr.on("data", (chunk) => {
      text += chunk;
      if (/guest thread \d+ trapped/.test(text) && text.includes("\n", text.search(/guest thread/))) {
        clearTimeout(timer);
        child.kill("SIGKILL");
        resolve(text);
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(text);
    });
  });
  assert.match(stderr, /\[wasi-thread\] guest thread 1 trapped: RuntimeError: unreachable/);
});
