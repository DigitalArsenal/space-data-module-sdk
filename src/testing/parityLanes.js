/**
 * Default lane runners for the tri-runtime parity harness.
 *
 * Every runner receives the shared context from runParityHarness():
 *   {wasmPath, wasmBytes, plan, pin, log, timeoutMs, ...lane options}
 * and returns a flat array of normalized run results:
 *   {caseId, threadCount, exitClass, exitDetail?, stdout, stderr?, stateFiles?}
 *
 * Determinism contract shared by all lanes:
 *   - guest stdin bytes come pre-encoded from the plan (identical everywhere);
 *   - guest env is delivered EXPLICITLY (wasmedge --env / browser shim env) —
 *     ambient host environment never leaks into the guest;
 *   - guest argv[0] is always "module.wasm" (relative invocation in a private
 *     workdir for the wasmedge lanes, literal argv for the browser shim);
 *   - thread counts are communicated via plan.threadEnvVar.
 *
 * WasmEdge lanes verify the live runtime version against wasmedgePin.json
 * BEFORE running anything; pin drift aborts the lane loudly.
 */

import { spawn, execFile as execFileCallback } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { ExitClass, assertWasmEdgeVersionMatchesPin } from "./parityHarness.js";
import { normalizeWasmEdgeOutcome } from "./wasmedgeOutput.js";

const execFile = promisify(execFileCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODULE_BASENAME = "module.wasm";

// WasmEdge prints these on guest traps; used to split "trap" from a plain
// nonzero guest exit so trap classes can be compared across lanes.
const WASMEDGE_TRAP_MARKERS = [
  "unreachable",
  "out of bounds",
  "integer overflow",
  "integer divide by zero",
  "indirect call type mismatch",
  "undefined element",
  "uninitialized element",
  "invalid conversion to integer",
  "call stack exhausted",
  "memory access out of bound",
  "wasm trap",
  "execution failed",
];

function classifyProcessOutcome({ code, signal, stderrText }) {
  if (signal) {
    return { exitClass: ExitClass.Trap, exitDetail: `signal=${signal}` };
  }
  if (code === 0) {
    return { exitClass: ExitClass.Ok, exitDetail: null };
  }
  const lowered = String(stderrText ?? "").toLowerCase();
  if (WASMEDGE_TRAP_MARKERS.some((marker) => lowered.includes(marker))) {
    return { exitClass: ExitClass.Trap, exitDetail: `exit=${code}` };
  }
  return { exitClass: ExitClass.GuestError, exitDetail: `exit=${code}` };
}

function spawnWithStdin(command, args, { cwd, env, stdinBytes, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new Error(
          `${command} timed out after ${timeoutMs}ms (parity lane run).`,
        ),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout: new Uint8Array(Buffer.concat(stdoutChunks)),
        stderr: new Uint8Array(Buffer.concat(stderrChunks)),
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(Buffer.from(stdinBytes));
  });
}

function guestEnvEntries(planCase, plan, threadCount) {
  return Object.entries({
    ...planCase.env,
    [plan.threadEnvVar]: String(threadCount),
  });
}

function wasmedgeInvocationArgs(planCase, plan, threadCount) {
  const args = ["--enable-threads"];
  for (const [key, value] of guestEnvEntries(planCase, plan, threadCount)) {
    args.push(`--env`, `${key}=${value}`);
  }
  args.push(MODULE_BASENAME, ...planCase.args);
  return args;
}

async function stageModuleWorkdir(context, label) {
  const workdir = await mkdtemp(path.join(os.tmpdir(), `sdm-parity-${label}-`));
  // Stage the canonical loadable bytes (publication records stripped by the
  // orchestrator) so every lane executes the identical module payload.
  await writeFile(
    path.join(workdir, MODULE_BASENAME),
    context.loadableBytes ?? context.wasmBytes,
  );
  return workdir;
}

// --- Native WasmEdge lane ----------------------------------------------------

async function binaryExists(candidate) {
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveWasmEdgeBinary(context = {}) {
  const explicit =
    context.wasmedgeBinary ??
    process.env.SDM_WASMEDGE_BINARY ??
    process.env.WASMEDGE_BINARY;
  if (explicit) return String(explicit);
  const homeInstall = path.join(os.homedir(), ".wasmedge", "bin", "wasmedge");
  if (await binaryExists(homeInstall)) return homeInstall;
  return "wasmedge"; // PATH lookup; spawn error surfaces loudly if absent.
}

export async function runNativeWasmEdgeLane(context) {
  const binary = await resolveWasmEdgeBinary(context);
  let versionOutput;
  try {
    versionOutput = (await execFile(binary, ["--version"])).stdout;
  } catch (error) {
    throw new Error(
      `native WasmEdge lane: cannot execute "${binary}" (--version failed: ${error.message}). ` +
        "Install the pinned WasmEdge or point SDM_WASMEDGE_BINARY at it.",
    );
  }
  assertWasmEdgeVersionMatchesPin(
    versionOutput,
    context.pin,
    `native binary ${binary}`,
  );

  const workdir = await stageModuleWorkdir(context, "native");
  const runs = [];
  try {
    for (const planCase of context.plan.cases) {
      for (const threadCount of planCase.threadCounts) {
        const outcome = await spawnWithStdin(
          binary,
          wasmedgeInvocationArgs(planCase, context.plan, threadCount),
          {
            cwd: workdir,
            env: { PATH: process.env.PATH ?? "" },
            stdinBytes: planCase.stdinBytes,
            timeoutMs: context.timeoutMs,
          },
        );
        // WasmEdge logs its own diagnostics to STDOUT; pull them out before
        // anything compares guest bytes or classifies an exit.
        const normalized = normalizeWasmEdgeOutcome(outcome);
        const { exitClass, exitDetail } = classifyProcessOutcome({
          code: outcome.code,
          signal: outcome.signal,
          stderrText: normalized.diagnosticText,
        });
        runs.push({
          caseId: planCase.id,
          threadCount,
          exitClass,
          exitDetail,
          stdout: normalized.stdout,
          stderr: normalized.stderr,
          stateFiles: null,
        });
      }
    }
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
  return runs;
}

// --- Docker WasmEdge lane ------------------------------------------------------

async function dockerImageExists(dockerBinary, image) {
  try {
    await execFile(dockerBinary, ["image", "inspect", image]);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDockerParityImage(context) {
  const dockerBinary = context.dockerBinary ?? "docker";
  const { pin } = context;
  if (!(await dockerImageExists(dockerBinary, pin.dockerImage))) {
    if (!context.autoBuildDockerImage) {
      throw new Error(
        `docker WasmEdge lane: image ${pin.dockerImage} is missing and autoBuildDockerImage is disabled.`,
      );
    }
    context.log(
      `parity: building ${pin.dockerImage} (WasmEdge ${pin.wasmedgeVersion}) from ${pin.dockerfilePath}`,
    );
    await execFile(
      dockerBinary,
      [
        "build",
        "-f",
        pin.dockerfilePath,
        "--build-arg",
        `WASMEDGE_VERSION=${pin.wasmedgeVersion}`,
        "-t",
        pin.dockerImage,
        pin.dockerfileContextDir,
      ],
      { maxBuffer: 64 * 1024 * 1024, timeout: 900_000 },
    );
  }
  // Version-lock check: the container runtime must match the pin exactly.
  const { stdout } = await execFile(
    dockerBinary,
    ["run", "--rm", pin.dockerImage, "--version"],
    { timeout: 120_000 },
  );
  assertWasmEdgeVersionMatchesPin(
    stdout,
    context.pin,
    `docker image ${pin.dockerImage}`,
  );
  return pin.dockerImage;
}

export async function runDockerWasmEdgeLane(context) {
  const dockerBinary = context.dockerBinary ?? "docker";
  try {
    await execFile(dockerBinary, ["--version"]);
  } catch (error) {
    throw new Error(
      `docker WasmEdge lane: cannot execute "${dockerBinary}" (${error.message}).`,
    );
  }
  const image = await ensureDockerParityImage(context);

  const workdir = await stageModuleWorkdir(context, "docker");
  const runs = [];
  try {
    for (const planCase of context.plan.cases) {
      for (const threadCount of planCase.threadCounts) {
        const dockerArgs = [
          "run",
          "--rm",
          "-i",
          "--network",
          "none",
          "-v",
          `${workdir}:/parity:ro`,
          "-w",
          "/parity",
        ];
        if (context.dockerPlatform) {
          dockerArgs.push("--platform", String(context.dockerPlatform));
        }
        dockerArgs.push(
          image,
          ...wasmedgeInvocationArgs(planCase, context.plan, threadCount),
        );
        const outcome = await spawnWithStdin(dockerBinary, dockerArgs, {
          cwd: workdir,
          env: process.env, // docker client env; guest env still explicit-only
          stdinBytes: planCase.stdinBytes,
          timeoutMs: context.timeoutMs,
        });
        const normalized = normalizeWasmEdgeOutcome(outcome);
        const { exitClass, exitDetail } = classifyProcessOutcome({
          code: outcome.code,
          signal: outcome.signal,
          stderrText: normalized.diagnosticText,
        });
        runs.push({
          caseId: planCase.id,
          threadCount,
          exitClass,
          exitDetail,
          stdout: normalized.stdout,
          stderr: normalized.stderr,
          stateFiles: null,
        });
      }
    }
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
  return runs;
}

// --- Browser lane (real headless Chrome; never jsdom) --------------------------

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export async function resolveChromeBinary(context = {}) {
  const explicit =
    context.chromeBinary ??
    process.env.SDM_CHROME_BINARY ??
    process.env.CHROME_BINARY;
  if (explicit) return String(explicit);
  for (const candidate of CHROME_CANDIDATES) {
    if (await binaryExists(candidate)) return candidate;
  }
  throw new Error(
    "browser lane: no Chrome/Chromium binary found. Set SDM_CHROME_BINARY. " +
      "(The browser lane requires a REAL browser context — jsdom masks SAB/threading realities.)",
  );
}

async function buildBrowserRunnerBundle() {
  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, "parityBrowserRunner.js")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: ["chrome110"],
    // Node-only escape hatches inside the harness chain are dynamic imports
    // that the browser code path never executes for WASI-surface modules.
    external: ["node:*", "hd-wallet-wasm"],
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

function browserPlanPayload(context) {
  return JSON.stringify({
    threadEnvVar: context.plan.threadEnvVar,
    cases: context.plan.cases.map((planCase) => ({
      id: planCase.id,
      stdinBase64: Buffer.from(planCase.stdinBytes).toString("base64"),
      env: planCase.env,
      args: [MODULE_BASENAME, ...planCase.args],
      threadCounts: planCase.threadCounts,
    })),
  });
}

const RUNNER_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>sdm parity runner</title></head>
  <body><pre id="status">parity runner booting…</pre>
  <script type="module" src="/runner.js"></script></body>
</html>`;

export async function runBrowserLane(context) {
  const chromeBinary = await resolveChromeBinary(context);
  const runnerBundle = await buildBrowserRunnerBundle();
  const planPayload = browserPlanPayload(context);

  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const server = http.createServer((request, response) => {
    const securityHeaders = {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cache-Control": "no-store",
    };
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/done") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        response.writeHead(200, securityHeaders);
        response.end("ok");
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (body.fatal) {
            rejectDone(new Error(`browser lane fatal: ${body.fatal}`));
          } else {
            resolveDone(body.runs ?? []);
          }
        } catch (error) {
          rejectDone(error);
        }
      });
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.writeHead(200, {
        ...securityHeaders,
        "Content-Type": "text/html; charset=utf-8",
      });
      response.end(RUNNER_HTML);
      return;
    }
    if (url.pathname === "/runner.js") {
      response.writeHead(200, {
        ...securityHeaders,
        "Content-Type": "text/javascript; charset=utf-8",
      });
      response.end(runnerBundle);
      return;
    }
    if (url.pathname === "/plan") {
      response.writeHead(200, {
        ...securityHeaders,
        "Content-Type": "application/json",
      });
      response.end(planPayload);
      return;
    }
    if (url.pathname === "/module.wasm") {
      response.writeHead(200, {
        ...securityHeaders,
        "Content-Type": "application/wasm",
      });
      response.end(Buffer.from(context.loadableBytes ?? context.wasmBytes));
      return;
    }
    response.writeHead(404, securityHeaders);
    response.end("not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const userDataDir = await mkdtemp(
    path.join(os.tmpdir(), "sdm-parity-chrome-"),
  );

  const chrome = spawn(
    chromeBinary,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      `--user-data-dir=${userDataDir}`,
      `http://127.0.0.1:${port}/`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const chromeStderr = [];
  chrome.stderr.on("data", (chunk) => chromeStderr.push(Buffer.from(chunk)));
  chrome.on("error", (error) =>
    rejectDone(
      new Error(`browser lane: failed to launch Chrome (${error.message})`),
    ),
  );
  chrome.on("exit", (code, signal) =>
    rejectDone(
      new Error(
        `browser lane: Chrome exited before reporting results (code=${code}, signal=${signal}). ` +
          Buffer.concat(chromeStderr).toString("utf8").slice(-500),
      ),
    ),
  );

  const timeout = setTimeout(
    () =>
      rejectDone(
        new Error(`browser lane timed out after ${context.timeoutMs}ms.`),
      ),
    context.timeoutMs,
  );

  try {
    const rawRuns = await done;
    return rawRuns.map((run) => ({
      caseId: String(run.caseId),
      threadCount: Number(run.threadCount),
      exitClass: String(run.exitClass),
      exitDetail: run.exitDetail ?? null,
      stdout: new Uint8Array(Buffer.from(String(run.stdoutBase64 ?? ""), "base64")),
      stderr: new Uint8Array(Buffer.from(String(run.stderrBase64 ?? ""), "base64")),
      stateFiles: null,
    }));
  } finally {
    clearTimeout(timeout);
    chrome.removeAllListeners("exit");
    chrome.kill("SIGKILL");
    server.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

export const defaultParityLaneRunners = Object.freeze({
  browser: runBrowserLane,
  wasmedge: runNativeWasmEdgeLane,
  "docker-wasmedge": runDockerWasmEdgeLane,
});
