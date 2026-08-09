/**
 * Browser-side entry for the tri-runtime parity harness.
 *
 * esbuild-bundled by parityLanes.js and served to a REAL headless Chrome
 * behind COOP/COEP headers (cross-origin isolated, SharedArrayBuffer-capable).
 * Never executed under jsdom — jsdom masks Illegal-invocation and threading
 * realities, which is exactly what this lane exists to catch.
 *
 * Protocol with the lane server (same origin):
 *   GET  /plan        -> {threadEnvVar, cases:[{id, stdinBase64, env, args, threadCounts}]}
 *   GET  /module.wasm -> the ONE isomorphic artifact
 *   POST /done        -> {runs:[...]} on completion or {fatal} on runner failure
 */

import { createBrowserModuleHarness } from "../host/browserModuleHarness.js";

const OK = "ok";
const GUEST_ERROR = "guest-error";
const TRAP = "trap";
const OUT_OF_SCOPE = "out-of-declared-scope";

function base64ToBytes(value) {
  const binary = atob(String(value ?? ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function classifyBrowserError(error) {
  // WasiExitError with code 0 is swallowed inside the harness; reaching here
  // with one means a real nonzero guest exit.
  if (error?.name === "WasiExitError") {
    return { exitClass: GUEST_ERROR, exitDetail: `exit=${error.code}` };
  }
  // The harness refused the artifact because the ARTIFACT declares it does not
  // run here. That is the contract working. Classing it TRAP would score a
  // correct refusal as a P1 cross-runtime divergence — the gate failing the
  // very artifacts the compiler now legitimately emits.
  if (error?.name === "RuntimeTargetError") {
    return {
      exitClass: OUT_OF_SCOPE,
      exitDetail: `declared runtimeTargets [${(error.declaredTargets ?? []).join(", ")}]`,
    };
  }
  return {
    exitClass: TRAP,
    exitDetail: `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`,
  };
}

export async function runParityPlanInBrowser({ baseUrl = "" } = {}) {
  const status = globalThis.document?.getElementById?.("status") ?? null;
  const setStatus = (text) => {
    if (status) status.textContent = text;
  };

  const [planResponse, moduleResponse] = await Promise.all([
    fetch(`${baseUrl}/plan`),
    fetch(`${baseUrl}/module.wasm`),
  ]);
  if (!planResponse.ok || !moduleResponse.ok) {
    throw new Error("parity browser runner: failed to fetch plan or module.");
  }
  const plan = await planResponse.json();
  const moduleBytes = new Uint8Array(await moduleResponse.arrayBuffer());

  if (globalThis.crossOriginIsolated !== true) {
    throw new Error(
      "parity browser runner: page is not cross-origin isolated (COOP/COEP missing) — SAB-backed thread parity cannot be validated.",
    );
  }

  const runs = [];
  for (const planCase of plan.cases) {
    const stdinBytes = base64ToBytes(planCase.stdinBase64);
    for (const threadCount of planCase.threadCounts) {
      setStatus(`case ${planCase.id} @ ${threadCount} thread(s)`);
      let exitClass = OK;
      let exitDetail = null;
      let stdout = new Uint8Array(0);
      let stderr = new Uint8Array(0);
      let harness = null;
      try {
        // Plaintext hygiene: no per-case copy. createBrowserModuleHarness
        // compiles directly from a caller-supplied buffer without copying it
        // (and never mutates/zeroes a buffer it does not own — see
        // browserModuleHarness.js's zeroWasmBytes/ownedArtifactBytes
        // contract), so the one fetched `moduleBytes` is safe to reuse
        // as-is across every case/thread-count iteration. A `.slice()` here
        // would only add a fresh, unzeroed plaintext copy per run.
        harness = await createBrowserModuleHarness({
          wasmSource: moduleBytes,
          surface: "command",
          args: planCase.args,
          env: {
            ...planCase.env,
            [plan.threadEnvVar]: String(threadCount),
          },
        });
        stdout = await harness.invokeRaw(stdinBytes);
        stderr = harness.wasi?.stderr ?? new Uint8Array(0);
      } catch (error) {
        ({ exitClass, exitDetail } = classifyBrowserError(error));
      } finally {
        try {
          harness?.destroy?.();
        } catch {
          /* teardown must never mask the run result */
        }
      }
      runs.push({
        caseId: planCase.id,
        threadCount,
        exitClass,
        exitDetail,
        stdoutBase64: bytesToBase64(stdout),
        stderrBase64: bytesToBase64(stderr),
      });
    }
  }
  setStatus(`done: ${runs.length} run(s)`);
  return runs;
}

async function postDone(body) {
  await fetch("/done", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Auto-run only inside a real browser page (the served runner). Node imports
// of this module (tests, bundlers) never auto-run.
if (
  typeof globalThis.document !== "undefined" &&
  typeof globalThis.window !== "undefined" &&
  globalThis.__SDM_PARITY_AUTORUN__ !== false
) {
  runParityPlanInBrowser({})
    .then((runs) => postDone({ runs }))
    .catch((error) =>
      postDone({ fatal: `${error?.name ?? "Error"}: ${error?.message ?? error}` }),
    );
}
