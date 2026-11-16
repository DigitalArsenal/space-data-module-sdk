// A prewarmed secondary instance must not claim the shared-memory startup that
// establishes the owner's TLS base. Compile the fixture through the SDK; no
// binary or toolchain-specific address is pinned. The reversed order in Node
// is a negative control for the same TLS/stack overlap observed in browsers.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { resolveWasiThreadsToolchain } from "../src/compiler/wasiThreadsToolchain.js";
import { fileURLToPath } from "node:url";
import { compileModuleFromSource, cleanupCompilation } from "../src/compiler/compileModule.js";
import { createBrowserModuleHarness } from "../src/host/browserModuleHarness.js";
import { threadWaveToolchainAvailable } from "./support/threadWaveGuest.mjs";

const available = threadWaveToolchainAvailable();
const browserEnabled = process.env.SPACE_DATA_MODULE_SDK_ENABLE_BROWSER_THREADS === "1";
const browsers = (process.env.SPACE_DATA_MODULE_SDK_BROWSERS ?? "chromium,firefox,webkit").split(",");
let compilation, compilerDir;
async function guest() {
  if (compilation) return compilation.wasmBytes;
  // Match modules linked with --stack-first: an uninitialized TLS base then
  // aliases the owner stack. The compiler override remains local to this test.
  const toolchain = resolveWasiThreadsToolchain();
  compilerDir = await fs.mkdtemp(path.join(os.tmpdir(), "owner-tls-compiler-"));
  const wrapper = path.join(compilerDir, "clangxx");
  await fs.writeFile(wrapper, "#!/usr/bin/env node\n" +
    "const {execFileSync}=require('node:child_process');const a=process.argv.slice(2);" +
    "if(!a.includes('-c')&&!a.includes('--version'))a.push('-Wl,--stack-first');" +
    "try{execFileSync(" + JSON.stringify(toolchain.clangxx) + ",a,{stdio:'inherit'});}catch(e){process.exit(e.status||1);}", { mode: 0o755 });
  const prior = process.env.SDN_WASI_CLANGXX;
  process.env.SDN_WASI_CLANGXX = wrapper;
  resolveWasiThreadsToolchain({ force: true });
  try {
  compilation = await compileModuleFromSource({
    language: "c++", threadModel: "emscripten-pthreads",
    sourceCode: await fs.readFile(new URL("./support/tlsOwnerGuest.cpp", import.meta.url), "utf8"),
    manifest: {
      pluginId: "com.digitalarsenal.test.owner-tls", name: "Owner TLS", version: "0.1.0",
      pluginFamily: "analysis", runtimeTargets: ["browser", "wasmedge"], invokeSurfaces: ["direct"],
      methods: [{ methodId: "probe", displayName: "Probe", inputPorts: [], outputPorts: [], maxBatch: 1, drainPolicy: "single-shot" }],
    },
  });
  } finally {
    if (prior === undefined) delete process.env.SDN_WASI_CLANGXX;
    else process.env.SDN_WASI_CLANGXX = prior;
    resolveWasiThreadsToolchain({ force: true });
  }
  assert.equal(compilation.report.ok, true);
  return compilation.wasmBytes;
}
test.after(async () => { if (compilation) await cleanupCompilation(compilation); if (compilerDir) await fs.rm(compilerDir, {recursive:true, force:true}); });
const CANARY = 0x12345678;
function check(result) {
  assert.ok(result.tls >= result.stackTop, JSON.stringify(result));
  assert.equal(result.constructorResult, 0, "constructors can spawn after pool warm-up");
  assert.equal(result.before, CANARY);
  assert.equal(result.after, CANARY, "stack writes preserve owner TLS");
  assert.equal(result.spawnResult, 0);
  assert.equal(result.afterChild, CANARY, "child TLS is independent");
}

test("Node owner TLS survives an explicit pool and constructor thread", { skip: !available }, async () => {
  const h = await createBrowserModuleHarness({ wasmSource: await guest(), surface: "direct", wasiThreadPoolSize: 2 });
  try {
    const x = h.instance.exports;
    const result = { tls: x.tls_address(), stackTop: x.stack_top(), constructorResult: x.constructor_result(), before: x.tls_get() };
    x.stack_write(); result.after = x.tls_get(); result.spawnResult = x.spawn(); result.afterChild = x.tls_get();
    check(result);
  } finally { await h.destroy(); }
});

test("Node secondary-first negative control overlaps TLS and stack", { skip: !available }, async () => {
  const module = await WebAssembly.compile(await guest());
  for (const ownerFirst of [true, false]) {
    const memory = new WebAssembly.Memory({ initial: 1024, maximum: 32768, shared: true });
    const imports = {};
    for (const entry of WebAssembly.Module.imports(module)) {
      imports[entry.module] ??= {};
      imports[entry.module][entry.name] = entry.kind === "memory" ? memory : () => -1;
    }
    let owner;
    if (ownerFirst) { owner = new WebAssembly.Instance(module, imports); new WebAssembly.Instance(module, imports); }
    else { new WebAssembly.Instance(module, imports); owner = new WebAssembly.Instance(module, imports); }
    // The exported probes need no constructors for this raw instantiation control.
    const x = owner.exports; x.tls_set(); const before = x.tls_get(); x.stack_write();
    assert.equal(x.tls_get() === before, ownerFirst);
  }
});

async function server(wasmBytes) {
  const { build } = await import("esbuild");
  const bundle = async (entry) => (await build({ entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", external: ["node:*", "hd-wallet-wasm"], logLevel: "silent",
  })).outputFiles[0].text;
  const routes = {
    "/": ["text/html", '<script>const w=new Worker("/owner.js",{type:"module"});w.onmessage=e=>window.result=e.data;w.onerror=e=>window.result={error:e.message};w.postMessage({});</script>'],
    "/owner.js": ["text/javascript", await bundle("./support/tlsOwnerBrowser.mjs")],
    "/thread.js": ["text/javascript", await bundle("../src/host/wasiThreadBrowserWorker.mjs")],
    "/module.wasm": ["application/wasm", Buffer.from(wasmBytes)],
  };
  const s = http.createServer((req, res) => {
    const route = routes[req.url];
    res.writeHead(route ? 200 : 404, { "Content-Type": route?.[0] ?? "text/plain", "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin" });
    res.end(route?.[1]);
  });
  await new Promise(resolve => s.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${s.address().port}/`, close: () => new Promise(resolve => { s.closeAllConnections(); s.close(resolve); }) };
}
for (const name of browsers) {
  test(`${name}: owner TLS is outside its stack with a prewarmed pool`, {
    skip: !available || (!browserEnabled && "set SPACE_DATA_MODULE_SDK_ENABLE_BROWSER_THREADS=1"), timeout: 120000,
  }, async () => {
    const s = await server(await guest()); let browser;
    try {
      browser = await (await import("playwright-core"))[name].launch({ headless: true });
      const page = await browser.newPage(); await page.goto(s.url);
      await page.waitForFunction(() => window.result !== undefined);
      const reply = await page.evaluate(() => window.result);
      assert.equal(reply.error, undefined); assert.equal(reply.result.poolSize, 2); check(reply.result);
    } finally { await browser?.close(); await s.close(); }
  });
}
