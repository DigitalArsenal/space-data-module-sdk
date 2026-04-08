/**
 * Isomorphic WASM Plugin Demo — browser entry point.
 *
 * Loads the same standalone .wasm artifact in:
 *   1. Browser via createBrowserModuleHarness (WASI shim + sdn_host bridge)
 *   2. WasmEdge via server-side /api/wasmedge-invoke endpoint
 *
 * Compares the results side-by-side.
 */

import {
  createBrowserModuleHarness,
  detectArtifactProfile,
} from "../../src/testing/browserModuleHarness.js";
import {
  encodePluginInvokeRequest,
  decodePluginInvokeResponse,
} from "../../src/invoke/codec.js";

// --- DOM refs ---
const pluginSelect = document.getElementById("plugin-select");
const artifactSelect = document.getElementById("artifact-select");
const runBtn = document.getElementById("run-btn");
const browserOutput = document.getElementById("browser-output");
const wasmedgeOutput = document.getElementById("wasmedge-output");
const browserStatus = document.getElementById("browser-status");
const wasmedgeStatus = document.getElementById("wasmedge-status");
const inspectOutput = document.getElementById("inspect-output");
const comparisonDiv = document.getElementById("comparison");
const comparisonOutput = document.getElementById("comparison-output");

let pluginData = [];
let currentWasmPath = null;

// --- Initialize ---

async function loadPlugins() {
  try {
    const res = await fetch("/api/plugins");
    const data = await res.json();
    if (!data.ok || !data.plugins.length) {
      pluginSelect.innerHTML = '<option value="">No plugins found</option>';
      return;
    }
    pluginData = data.plugins;
    pluginSelect.innerHTML =
      '<option value="">Choose a plugin...</option>' +
      data.plugins.map((p) => `<option value="${p.name}">${p.name}</option>`).join("");
  } catch (err) {
    pluginSelect.innerHTML = `<option value="">Error: ${err.message}</option>`;
  }
}

pluginSelect.addEventListener("change", () => {
  const plugin = pluginData.find((p) => p.name === pluginSelect.value);
  if (!plugin) {
    artifactSelect.innerHTML = '<option value="">Select a plugin first</option>';
    runBtn.disabled = true;
    return;
  }
  artifactSelect.innerHTML = plugin.artifacts
    .map((a) => `<option value="${a}">${a.split("/").pop()}</option>`)
    .join("");
  currentWasmPath = plugin.artifacts[0] ?? null;
  runBtn.disabled = !currentWasmPath;
  if (currentWasmPath) inspectArtifact(currentWasmPath);
});

artifactSelect.addEventListener("change", () => {
  currentWasmPath = artifactSelect.value || null;
  runBtn.disabled = !currentWasmPath;
  if (currentWasmPath) inspectArtifact(currentWasmPath);
});

runBtn.addEventListener("click", () => {
  if (currentWasmPath) runIsomorphic(currentWasmPath);
});

// --- Inspect ---

async function inspectArtifact(wasmPath) {
  inspectOutput.textContent = "Fetching and inspecting...";
  try {
    const wasmBytes = await fetch(`/plugins/${wasmPath}`).then((r) => r.arrayBuffer());
    const wasmModule = await WebAssembly.compile(wasmBytes);
    const profile = detectArtifactProfile(wasmModule);
    const exports = WebAssembly.Module.exports(wasmModule).map((e) => `${e.name} (${e.kind})`);
    const imports = WebAssembly.Module.imports(wasmModule).map(
      (i) => `${i.module}.${i.name} (${i.kind})`,
    );

    inspectOutput.textContent = [
      `Profile: ${profile}`,
      `Size: ${(wasmBytes.byteLength / 1024).toFixed(1)} KB`,
      ``,
      `Exports (${exports.length}):`,
      ...exports.map((e) => `  ${e}`),
      ``,
      `Imports (${imports.length}):`,
      ...imports.map((i) => `  ${i}`),
    ].join("\n");
  } catch (err) {
    inspectOutput.textContent = `Error: ${err.message}`;
  }
}

// --- Run isomorphic ---

async function runIsomorphic(wasmPath) {
  runBtn.disabled = true;
  browserOutput.textContent = "";
  wasmedgeOutput.textContent = "";
  browserStatus.textContent = "";
  wasmedgeStatus.textContent = "";
  comparisonDiv.style.display = "none";

  // Build a minimal invoke request (command surface: stdin bytes)
  // For the demo we invoke with an empty or minimal request
  const invokeRequest = {
    methodId: "invoke",
    inputFrames: [
      {
        portId: "request",
        payload: new TextEncoder().encode(
          JSON.stringify({ type: "version" }),
        ),
      },
    ],
  };

  const requestBytes = encodePluginInvokeRequest(invokeRequest);
  const stdinBase64 = uint8ArrayToBase64(requestBytes);

  // Run both in parallel
  const [browserResult, wasmedgeResult] = await Promise.allSettled([
    runInBrowser(wasmPath, requestBytes),
    runInWasmEdge(wasmPath, stdinBase64),
  ]);

  // Browser result
  if (browserResult.status === "fulfilled") {
    browserOutput.textContent = formatResult(browserResult.value);
    browserStatus.className = "status status-ok";
    browserStatus.textContent = `OK (${browserResult.value.elapsed}ms)`;
  } else {
    browserOutput.textContent = browserResult.reason?.message ?? String(browserResult.reason);
    browserStatus.className = "status status-err";
    browserStatus.textContent = "Error";
  }

  // WasmEdge result
  if (wasmedgeResult.status === "fulfilled") {
    wasmedgeOutput.textContent = formatResult(wasmedgeResult.value);
    wasmedgeStatus.className = "status status-ok";
    wasmedgeStatus.textContent = `OK (${wasmedgeResult.value.elapsed}ms)`;
  } else {
    wasmedgeOutput.textContent = wasmedgeResult.reason?.message ?? String(wasmedgeResult.reason);
    wasmedgeStatus.className = "status status-err";
    wasmedgeStatus.textContent = "Error";
  }

  // Compare
  if (browserResult.status === "fulfilled" && wasmedgeResult.status === "fulfilled") {
    const match =
      browserResult.value.statusCode === wasmedgeResult.value.statusCode &&
      browserResult.value.outputCount === wasmedgeResult.value.outputCount;
    comparisonDiv.style.display = "block";
    comparisonOutput.innerHTML = match
      ? '<span class="badge badge-match">MATCH</span> Both runtimes produced equivalent results.'
      : '<span class="badge badge-mismatch">MISMATCH</span> Results differ between runtimes.';
  }

  runBtn.disabled = false;
}

async function runInBrowser(wasmPath, requestBytes) {
  const start = performance.now();
  const wasmBytes = await fetch(`/plugins/${wasmPath}`).then((r) => r.arrayBuffer());
  const harness = await createBrowserModuleHarness({
    wasmSource: wasmBytes,
    args: [],
    env: {},
  });

  let result;
  try {
    if (harness.runtime.surface === "direct") {
      const responseBytes = harness.invokeRaw(requestBytes);
      const response = decodePluginInvokeResponse(responseBytes);
      result = {
        statusCode: response.statusCode,
        outputCount: response.outputs?.length ?? 0,
        outputs: (response.outputs ?? []).map(summarizeFrame),
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
        profile: harness.runtime.profile,
        surface: harness.runtime.surface,
      };
    } else {
      result = {
        statusCode: -1,
        outputCount: 0,
        outputs: [],
        errorCode: "unsupported-surface",
        errorMessage: `Command surface not supported in browser demo.`,
        profile: harness.runtime.profile,
        surface: harness.runtime.surface,
      };
    }
  } catch (err) {
    result = {
      statusCode: -1,
      outputCount: 0,
      outputs: [],
      errorCode: "browser-error",
      errorMessage: err.message,
      profile: harness.runtime.profile,
      surface: harness.runtime.surface,
    };
  }

  harness.destroy();
  result.elapsed = Math.round(performance.now() - start);
  return result;
}

async function runInWasmEdge(wasmPath, stdinBase64) {
  const start = performance.now();
  const res = await fetch("/api/wasmedge-invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wasmPath, stdinBase64 }),
  });
  const data = await res.json();

  if (!data.ok) {
    throw new Error(data.error ?? "WasmEdge invoke failed.");
  }

  let result;
  try {
    const stdoutBytes = base64ToUint8Array(data.stdoutBase64);
    if (stdoutBytes.length === 0) {
      result = {
        statusCode: data.exitCode,
        outputCount: 0,
        outputs: [],
        errorCode: data.exitCode !== 0 ? "nonzero-exit" : null,
        errorMessage: data.stderrText || null,
      };
    } else {
      const response = decodePluginInvokeResponse(stdoutBytes);
      result = {
        statusCode: response.statusCode,
        outputCount: response.outputs?.length ?? 0,
        outputs: (response.outputs ?? []).map(summarizeFrame),
        errorCode: response.errorCode,
        errorMessage: response.errorMessage,
      };
    }
  } catch {
    result = {
      statusCode: data.exitCode,
      outputCount: 0,
      outputs: [],
      errorCode: "decode-error",
      errorMessage: `Exit ${data.exitCode}. stderr: ${data.stderrText}`,
    };
  }

  result.elapsed = Math.round(performance.now() - start);
  return result;
}

// --- Helpers ---

function summarizeFrame(frame) {
  const summary = { portId: frame.portId };
  if (frame.payload) {
    try {
      summary.payloadPreview = new TextDecoder()
        .decode(frame.payload)
        .slice(0, 200);
    } catch {
      summary.payloadSize = frame.payload.length;
    }
  }
  return summary;
}

function formatResult(result) {
  return JSON.stringify(result, null, 2);
}

function uint8ArrayToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  if (!base64) return new Uint8Array(0);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- Boot ---
loadPlugins();
