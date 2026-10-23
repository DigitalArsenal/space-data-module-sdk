// Real Chromium regression: one shared-memory WASM guest calls the SDK host
// with legacy JSON metadata and a typed $PIV request, then reads both answers
// back through the guest ABI; the browser WASI shim then fills the same shared
// memory with random bytes. No compiler or published module is needed.
// Usage: node scripts/e2e/shared-memory-hostcall.mjs [--sdk-root <installed SDK>]
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { resolveHeadlessShell } from "../../src/testing/headlessShell.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rootFlag = process.argv.indexOf("--sdk-root");
const sdkRoot = rootFlag < 0 ? root : path.resolve(process.argv[rootFlag + 1]);

async function exercise() {
  function check(condition, message) {
    if (!condition) throw new Error(message);
  }
  check(crossOriginIsolated, "the browser must be cross-origin isolated");
  const encoder = new TextEncoder();
  // A minimal guest with a defined shared memory and actual WASM call
  // instructions forwarding to the three host imports. Indices 0..2 are
  // imports; 3..5 are the guest functions. This is test-only, never shipped.
  const leb = (value) => {
    const out = [];
    do { const byte = value & 127; value >>>= 7; out.push(byte | (value ? 128 : 0)); } while (value);
    return out;
  };
  const str = (value) => { const bytes = [...encoder.encode(value)]; return [...leb(bytes.length), ...bytes]; };
  const section = (id, bytes) => [id, ...leb(bytes.length), ...bytes];
  const signature = (count) => [0x60, count, ...Array(count).fill(0x7f), 1, 0x7f];
  const imported = (name, type) => [...str("space_data_module_host"), ...str(name), 0, type];
  const exported = (name, kind, index) => [...str(name), kind, index];
  const body = (argc, target) => {
    const code = [0, ...Array.from({ length: argc }, (_, i) => [0x20, i]).flat(), 0x10, target, 0x0b];
    return [...leb(code.length), ...code];
  };
  const wasm = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [3, ...signature(4), ...signature(0), ...signature(2)]),
    ...section(2, [3, ...imported("call", 0), ...imported("response_len", 1), ...imported("read_response", 2)]),
    ...section(3, [3, 0, 1, 2]),
    ...section(5, [1, 3, 1, 2]), // shared memory: min 1, max 2 pages
    ...section(7, [4, ...exported("memory", 2, 0), ...exported("run", 0, 3), ...exported("response_len", 0, 4), ...exported("read_response", 0, 5)]),
    ...section(10, [3, ...body(4, 0), ...body(0, 1), ...body(2, 2)]),
  ]);
  let guest;
  const calls = [];
  const config = { label: "shared guest ✓", count: 7 };
  const bridge = createHostcallBridge({
    getMemory: () => guest.memory,
    dispatch(operation, params) {
      check(operation === "plugin.getConfig", `unexpected operation: ${operation}`);
      calls.push(params);
      return config;
    },
  });
  guest = (await WebAssembly.instantiate(wasm, bridge.imports)).instance.exports;
  check(guest.memory.buffer instanceof SharedArrayBuffer, "the WASM guest must own shared memory");
  const heap = new Uint8Array(guest.memory.buffer);
  let rejectsShared = false;
  try { new TextDecoder().decode(heap.subarray(0, 1)); } catch { rejectsShared = true; }
  check(rejectsShared, "this browser must reproduce TextDecoder's rejection of shared views");

  function invoke(payload) {
    const operation = encoder.encode("plugin.getConfig");
    heap.set(operation, 64);
    heap.set(payload, 256);
    const status = guest.run(64, operation.length, 256, payload.length);
    const length = guest.response_len();
    check(guest.read_response(32768, length) === length, "guest did not receive the full host answer");
    const answer = heap.slice(32768, 32768 + length);
    check(status === 0, `hostcall status ${status}: ${new TextDecoder().decode(answer)}`);
    return answer;
  }

  const failures = [];
  const passed = [];
  for (const kind of ["json-meta", "$PIV", "wasi-random"]) {
    try {
      if (kind === "json-meta") {
        const meta = { label: "metadata ✓", sequence: 7 };
        const answer = decodeHostcallValueEnvelope(invoke(encodeHostcallValueEnvelope(meta)));
        check(answer.ok && answer.result.label === config.label && answer.result.count === 7, "wrong legacy host answer");
        check(calls.at(-1)?.label === meta.label && calls.at(-1)?.sequence === 7, "JSON metadata did not reach the host");
      } else if (kind === "wasi-random") {
        const wasi = createBrowserWasiShim();
        wasi.setMemory(guest.memory);
        const status = wasi.imports.wasi_snapshot_preview1.random_get(512, 32);
        check(status === 0, `random_get status ${status}`);
        check(heap.slice(512, 544).some((byte) => byte !== 0), "random_get left the shared memory zeroed");
      } else {
        const bytes = invoke(encodeHostCall("plugin.getConfig"));
        check(identifierOf(bytes) === "$PIV", "host answered without a $PIV response");
        const answer = decodeHostCallResult(bytes);
        check(answer.ok, `typed hostcall failed: ${answer.error?.message}`);
        const decoded = decodeModuleConfig(answer.raw.config);
        check(decoded.label === config.label && decoded.count === 7, "wrong $PIV config answer");
      }
      passed.push(kind);
    } catch (error) { failures.push(`${kind}: ${error.message}`); }
  }
  return { shared: true, passed, failures };
}

const imports = [
  ["createHostcallBridge", "src/host/abi.js"],
  ["encodeHostcallValueEnvelope, decodeHostcallValueEnvelope", "src/host/hostcallWire.js"],
  ["encodeHostCall, decodeHostCallResult, decodeModuleConfig, identifierOf", "src/standards/runtimeContracts.js"],
  ["createBrowserWasiShim", "src/host/wasiShim.js"],
].map(([names, file]) => `import { ${names} } from ${JSON.stringify(path.join(sdkRoot, file))};`).join("\n");
const bundle = await build({
  stdin: { contents: `${imports}\nwindow.exercise = ${exercise.toString()};`, resolveDir: sdkRoot, sourcefile: "shared-memory-hostcall-browser.js" },
  bundle: true, write: false, format: "esm", platform: "browser", nodePaths: [path.join(root, "node_modules")],
});
const server = http.createServer((req, res) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  if (req.url === "/bundle.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(bundle.outputFiles[0].contents);
  } else if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><title>Shared memory hostcall E2E</title><script type="module" src="/bundle.js"></script>');
  } else { res.writeHead(404); res.end(); }
});
let browser;
try {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  browser = await chromium.launch({ executablePath: await resolveHeadlessShell(), headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => typeof window.exercise === "function");
  const result = await page.evaluate(() => window.exercise());
  console.log(result);
  assert.deepEqual(pageErrors, [], "browser page errors");
  assert.deepEqual(result.failures, [], "shared-memory hostcall regression");
  assert.deepEqual(result.passed, ["json-meta", "$PIV", "wasi-random"]);
  console.log("SHARED-MEMORY-HOSTCALL PASS: headless Chromium, shared WASM memory, operation + JSON metadata + correct $PIV config response + WASI random_get");
} finally {
  await browser?.close(); // Playwright removes its temporary browser profile.
  await new Promise((resolve) => server.close(resolve));
}
