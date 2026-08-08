/**
 * Browser-side host-contract instantiation probe.
 *
 * Bundled by parityGate.js and served to a REAL headless Chrome behind
 * COOP/COEP (cross-origin isolated, SAB-capable). Never jsdom — jsdom masks
 * Illegal-invocation and threading realities, and a probe that lies about the
 * browser is worse than no probe.
 *
 * For each artifact the probe synthesizes EXACTLY the declared host surface —
 * WASI preview1 stubs plus the declared capability imports, with the real
 * signatures read from the binary — and instantiates. Anything the artifact
 * demands beyond that surface produces a LinkError naming the offender, which
 * is the answer we want.
 */

import {
  classifyArtifactImports,
  readWasmImportDescriptors,
  resolveHostSurface,
  WASI_PREVIEW1_MODULE,
} from "./hostContract.js";

const ZERO_BY_RESULT = {
  i32: 0,
  i64: 0n,
  f32: 0,
  f64: 0,
  v128: 0,
};

function stubReturn(results) {
  if (!results || results.length === 0) return undefined;
  return ZERO_BY_RESULT[results[0]] ?? 0;
}

/**
 * Build an import object containing ONLY surface-legal entries. Out-of-surface
 * imports are deliberately NOT supplied: their absence is the signal.
 */
export function buildSurfaceImports(bytes, surfaceId) {
  const surface = resolveHostSurface(surfaceId);
  const allowedExtra = new Set(surface.extra);
  const descriptors = readWasmImportDescriptors(bytes);
  const imports = Object.create(null);
  const supplied = [];

  for (const entry of descriptors) {
    const key = `${entry.module}.${entry.name}`;
    const inSurface =
      (surface.wasiAny && entry.module === WASI_PREVIEW1_MODULE) ||
      allowedExtra.has(key);
    if (!inSurface) continue;

    imports[entry.module] ??= Object.create(null);
    if (entry.kind === "function") {
      const results = entry.results;
      imports[entry.module][entry.name] = () => stubReturn(results);
    } else if (entry.kind === "memory") {
      imports[entry.module][entry.name] = new WebAssembly.Memory({
        initial: entry.initial,
        maximum: entry.maximum ?? entry.initial,
        shared: entry.shared,
      });
    } else if (entry.kind === "table") {
      imports[entry.module][entry.name] = new WebAssembly.Table({
        element: entry.element === "anyfunc" ? "anyfunc" : "externref",
        initial: entry.initial,
        maximum: entry.maximum,
      });
    } else if (entry.kind === "global") {
      imports[entry.module][entry.name] = new WebAssembly.Global(
        { value: entry.valtype, mutable: entry.mutable },
        entry.valtype === "i64" ? 0n : 0,
      );
    }
    supplied.push(key);
  }
  return { imports, supplied };
}

function linkErrorTarget(message) {
  // Chrome: 'WebAssembly.instantiate(): Import #3 "env" "flatsql_io_open":
  //          function import requires a callable'
  const named = /Import\s+#\d+\s+"([^"]*)"\s+"([^"]*)"/.exec(String(message));
  if (named) return `${named[1]}.${named[2]}`;
  const moduleOnly = /module="([^"]*)"\s*function="([^"]*)"/.exec(String(message));
  if (moduleOnly) return `${moduleOnly[1]}.${moduleOnly[2]}`;
  return null;
}

export async function probeArtifactInBrowser(bytes, surfaceId) {
  const structural = classifyArtifactImports(bytes, surfaceId);
  let compiled;
  try {
    compiled = await WebAssembly.compile(bytes);
  } catch (error) {
    return {
      outcome: "compile-error",
      detail: String(error?.message ?? error),
      missingImport: null,
      structural,
      exportCount: 0,
    };
  }
  const { imports, supplied } = buildSurfaceImports(bytes, surfaceId);
  try {
    const instance = await WebAssembly.instantiate(compiled, imports);
    return {
      outcome: "instantiated",
      detail: null,
      missingImport: null,
      structural,
      suppliedImports: supplied,
      exportCount: Object.keys(instance.exports ?? {}).length,
      exportNames: Object.keys(instance.exports ?? {}).sort(),
    };
  } catch (error) {
    const message = String(error?.message ?? error);
    const isLink = error instanceof WebAssembly.LinkError || /Import #/.test(message);
    return {
      outcome: isLink ? "link-error" : "instantiate-error",
      detail: message,
      missingImport: linkErrorTarget(message),
      structural,
      suppliedImports: supplied,
      exportCount: 0,
    };
  }
}

/** Entry point executed inside the page. */
export async function runBrowserGateProbe() {
  const status = document.getElementById("status");
  const report = (text) => {
    if (status) status.textContent = text;
  };
  try {
    const plan = await (await fetch("/gate-plan")).json();
    report(`probing ${plan.artifacts.length} artifact(s)…`);
    const results = [];
    for (const artifact of plan.artifacts) {
      const bytes = new Uint8Array(
        await (await fetch(artifact.url)).arrayBuffer(),
      );
      const probe = await probeArtifactInBrowser(bytes, artifact.surface);
      results.push({
        id: artifact.id,
        surface: artifact.surface,
        byteLength: bytes.length,
        crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
        sharedArrayBufferAvailable: typeof SharedArrayBuffer === "function",
        ...probe,
      });
      report(`probed ${results.length}/${plan.artifacts.length}`);
    }
    await fetch("/done", {
      method: "POST",
      body: JSON.stringify({ results }),
    });
    report("done");
  } catch (error) {
    await fetch("/done", {
      method: "POST",
      body: JSON.stringify({ fatal: String(error?.stack ?? error) }),
    }).catch(() => {});
  }
}

if (typeof document !== "undefined") {
  runBrowserGateProbe();
}
