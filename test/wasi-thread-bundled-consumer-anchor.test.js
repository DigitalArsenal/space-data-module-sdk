// GUARDRAIL: the wasi-threads browser worker must still resolve when this host
// source is BUNDLED.
//
// The defect this locks down (P1, DIVERGENCE): `wasiThreadHost.js` resolved its
// pooled browser worker as `new URL("./wasiThreadBrowserWorker.mjs",
// import.meta.url)`. That sibling assumption only holds in the package layout.
// Every bundler inlines this source and rewrites `import.meta.url` to the
// BUNDLE's URL, so five shipped OrbPro/sdn-js bundles re-emitted the literal and
// the published sandcastle bucket requested
// `Build/CesiumUnminified/wasiThreadBrowserWorker.mjs` -> 404 -> pooled worker
// error -> SILENT sequential fallback (an 8x perf loss that no gate caught,
// because the local pre-push check tolerated the fallback).
//
// This test therefore does the real thing: it runs the host source through
// esbuild into a directory that does NOT contain the worker chain, then drives
// the bundled host with a Worker mock that resolves URLs against the FILESYSTEM
// exactly as a browser resolves them against the origin — a URL that does not
// exist fires `onerror`, like a 404 module worker.
//
// Two halves of one contract:
//   1. NO anchor + bundled layout  -> HARD FAILURE (WasiThreadWorkerUnreachableError).
//      The silent sequential fallback is gone; it must never come back.
//   2. Explicit anchor at the served host directory -> the pool arms and
//      threadSpawn returns live tids, from the same bundle.
//
// There is no fetch-and-retry and no `location` sniffing anywhere in the
// resolution: it is a pure, deterministic function of the anchor.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_DIR = path.join(HERE, "..", "src", "host");
const HOST_SRC = path.join(HOST_DIR, "wasiThreadHost.js");

// The full chain the anchor must serve. Anchoring at a directory that holds only
// the worker entry is NOT enough: the worker itself imports the runtime module.
const WORKER_CHAIN = [
  "wasiThreadBrowserWorker.mjs",
  "wasiThreadWorkerRuntime.js",
];

const SHARED_MEMORY = { buffer: new SharedArrayBuffer(64) };
const WASM_MODULE = { __mockModule: true };

// A Worker that behaves like a browser's module Worker with respect to ASSET
// RESOLUTION: it resolves the given URL on the filesystem. Present -> speaks the
// pool protocol (probe -> ready). Absent -> `onerror`, never a message. That is
// precisely the 404 shape that produced the shipped defect.
function installWorkerMock() {
  const state = { urls: [], instances: [] };
  class FsResolvingWorker {
    constructor(url) {
      this.url = String(url);
      this.terminated = false;
      this.onmessage = null;
      this.onerror = null;
      state.urls.push(this.url);
      state.instances.push(this);
      // Resolution happens off-turn, like a real worker script fetch.
      this.ready = (async () => {
        try {
          await access(fileURLToPath(new URL(this.url)));
          this.reachable = true;
        } catch {
          this.reachable = false;
        }
        if (!this.terminated && !this.reachable) {
          this.onerror?.({ message: `404 ${this.url}` });
        }
      })();
    }

    postMessage(message) {
      if (this.terminated) {
        return;
      }
      this.ready.then(() => {
        if (this.terminated || !this.reachable) {
          return;
        }
        if (message.t === "probe") {
          this.onmessage?.({ data: { t: "ready", ok: true } });
        }
      });
    }

    terminate() {
      this.terminated = true;
    }
  }
  globalThis.Worker = FsResolvingWorker;
  globalThis.__SDM_ENABLE_BROWSER_WASI_THREADS__ = true;
  globalThis.crossOriginIsolated = true;
  Object.defineProperty(globalThis, "navigator", {
    value: { hardwareConcurrency: 4 },
    configurable: true,
  });
  return state;
}

// Bundle the host into `outDir` with esbuild. `outDir` deliberately does NOT
// receive the worker chain — that IS the published-bucket geometry.
async function bundleHostInto(outDir) {
  const esbuild = await import("esbuild");
  const outfile = path.join(outDir, "bundled-consumer.mjs");
  await esbuild.build({
    entryPoints: [HOST_SRC],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    // Match what a real engine build does to the Node branch's opaque specifier.
    external: ["node:*"],
    logLevel: "silent",
  });
  return outfile;
}

async function loadBundledHost(outfile) {
  // Force the BROWSER branch: IS_NODE is captured at module-eval time.
  const originalRelease = Object.getOwnPropertyDescriptor(process, "release");
  Object.defineProperty(process, "release", {
    value: { name: "bundled-consumer-guardrail" },
    configurable: true,
  });
  try {
    return await import(pathToFileURL(outfile).href);
  } finally {
    if (originalRelease) {
      Object.defineProperty(process, "release", originalRelease);
    }
  }
}

test("the worker chain the anchor must serve exists in the package host dir", async () => {
  for (const file of WORKER_CHAIN) {
    await access(path.join(HOST_DIR, file));
  }
});

test("BUNDLED with no anchor: the worker 404s and the host FAILS LOUD (no silent sequential fallback)", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "sdm-wasi-bundle-"));
  try {
    const outfile = await bundleHostInto(outDir);
    const bundled = await loadBundledHost(outfile);
    const workers = installWorkerMock();

    await assert.rejects(
      () =>
        bundled.createWasiThreadSpawn({
          wasmModule: WASM_MODULE,
          memory: SHARED_MEMORY,
          requestedThreads: 2,
        }),
      (error) => {
        assert.equal(error.name, "WasiThreadWorkerUnreachableError");
        // The message must name the resolved URL and tell the integrator what to
        // pass — a 404 that only whispers into the console is what shipped.
        assert.match(error.message, /unreachable/);
        assert.match(error.message, /browserWorkerBaseUrl/);
        return true;
      },
    );

    // Proof the bundle really did anchor at ITSELF, not at the package layout.
    assert.ok(workers.urls.length > 0, "the pooled path was actually requested");
    assert.ok(
      workers.urls[0].includes(path.basename(outDir)),
      `bundled default anchored at the bundle, not the package: ${workers.urls[0]}`,
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("BUNDLED with an explicit base anchor: the pool arms and threads spawn", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "sdm-wasi-bundle-"));
  try {
    const outfile = await bundleHostInto(outDir);
    const bundled = await loadBundledHost(outfile);
    installWorkerMock();

    // What a bundling consumer passes: the directory its build SERVES the SDK
    // host chain from (OrbPro: js/vendor/space-data-module-sdk/src/host/).
    const anchor = pathToFileURL(path.join(HOST_DIR, "/")).href;
    const host = await bundled.createWasiThreadSpawn({
      wasmModule: WASM_MODULE,
      memory: SHARED_MEMORY,
      requestedThreads: 2,
      browserWorkerBaseUrl: anchor,
    });
    assert.equal(host.distinctOsThreadCount(), 2, "warm pool armed");
    assert.ok(host.threadSpawn(1) > 0, "a pooled thread actually spawns");
    assert.ok(host.threadSpawn(2) > 0);
    assert.equal(host.spawnCount(), 2);
    await host.terminateAll();
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("BUNDLED with the process-wide setter: a host shim can install the anchor once", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "sdm-wasi-bundle-"));
  try {
    const outfile = await bundleHostInto(outDir);
    const bundled = await loadBundledHost(outfile);
    installWorkerMock();

    // No trailing slash on purpose: the setter normalizes it.
    bundled.setBrowserWasiThreadWorkerBase(pathToFileURL(HOST_DIR).href);
    try {
      assert.match(
        bundled.getBrowserWasiThreadWorkerBase(),
        /\/$/,
        "the base is normalized to a directory URL",
      );
      const host = await bundled.createWasiThreadSpawn({
        wasmModule: WASM_MODULE,
        memory: SHARED_MEMORY,
        requestedThreads: 1,
      });
      assert.equal(host.distinctOsThreadCount(), 1);
      assert.ok(host.threadSpawn(1) > 0);
      await host.terminateAll();
    } finally {
      // Restoring null must put the packaged default back.
      bundled.setBrowserWasiThreadWorkerBase(null);
      assert.equal(bundled.getBrowserWasiThreadWorkerBase(), null);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("resolution precedence is deterministic: url > base option > setter > packaged sibling", async () => {
  const mod = await import("../src/host/wasiThreadHost.js");
  const {
    resolveBrowserWorkerUrl,
    setBrowserWasiThreadWorkerBase,
    DEFAULT_BROWSER_WORKER_URL,
  } = mod;

  // 4. Default (unbundled package layout) — unchanged behavior.
  assert.equal(resolveBrowserWorkerUrl(), String(DEFAULT_BROWSER_WORKER_URL));
  assert.match(
    String(DEFAULT_BROWSER_WORKER_URL),
    /\/src\/host\/wasiThreadBrowserWorker\.mjs$/,
  );

  // 3. Process-wide setter.
  setBrowserWasiThreadWorkerBase("https://example.test/js/vendor/sdk/src/host");
  try {
    assert.equal(
      resolveBrowserWorkerUrl(),
      "https://example.test/js/vendor/sdk/src/host/wasiThreadBrowserWorker.mjs",
    );
    // 2. Per-call base wins over the setter.
    assert.equal(
      resolveBrowserWorkerUrl({
        browserWorkerBaseUrl: "https://other.test/host/",
      }),
      "https://other.test/host/wasiThreadBrowserWorker.mjs",
    );
    // 1. Explicit file URL wins over everything.
    assert.equal(
      resolveBrowserWorkerUrl({
        browserWorkerUrl: "https://other.test/host/renamed.mjs",
        browserWorkerBaseUrl: "https://ignored.test/host/",
      }),
      "https://other.test/host/renamed.mjs",
    );
  } finally {
    setBrowserWasiThreadWorkerBase(null);
  }
  assert.equal(resolveBrowserWorkerUrl(), String(DEFAULT_BROWSER_WORKER_URL));
});

test("resolution performs NO network probing and NO location sniffing", async () => {
  // Deterministic by construction: the resolver must not consult fetch (Node
  // never fetches; making browser thread count a function of network timing was
  // explicitly forbidden). Any fetch call here is a contract break.
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error("resolution must never fetch");
  };
  try {
    const { resolveBrowserWorkerUrl } = await import(
      "../src/host/wasiThreadHost.js"
    );
    resolveBrowserWorkerUrl();
    resolveBrowserWorkerUrl({ browserWorkerBaseUrl: "https://a.test/host/" });
    assert.equal(fetchCalls, 0);
  } finally {
    if (originalFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = originalFetch;
    }
  }

  // And the SOURCE carries no consumer-side location sniffing in its resolver.
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(HOST_SRC, "utf8");
  const resolver = source.slice(
    source.indexOf("export function resolveBrowserWorkerUrl"),
  );
  const body = resolver.slice(0, resolver.indexOf("\n}\n") + 2);
  assert.ok(
    !/location\.(pathname|origin|hostname|host)\b/.test(body),
    "the resolver must not sniff the consumer's location",
  );
  assert.ok(!/\bfetch\s*\(/.test(body), "the resolver must not fetch");
});
