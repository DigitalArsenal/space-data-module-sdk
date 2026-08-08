/**
 * THE tri-runtime parity GATE.
 *
 * `parityHarness.js` proves that ONE module.wasm produces byte-identical
 * OUTPUT across three runtimes for one fixture. That is necessary and not
 * sufficient: it can only speak about artifacts that already instantiate
 * everywhere, and it says nothing about the artifact SET a release actually
 * ships. The gate adds the missing half and is what the gauntlet runs:
 *
 *   Tier A — HOST-CONTRACT CONFORMANCE, per artifact, per lane, by REAL
 *            instantiation:
 *              * wasmedge lane: the pinned WasmEdge runtime (native binary
 *                when installed AND the pinned container; both when both are
 *                present, and they must agree — that is the host/container
 *                pin-pair law made testable);
 *              * browser lane: real headless Chrome behind COOP/COEP,
 *                instantiating with EXACTLY the declared host surface.
 *            Plus the structural import classification, which names the
 *            defect CLASS (emscripten glue vs. a declared capability) so a
 *            receipt can never read "failed" without saying why.
 *
 *   Tier B — BEHAVIORAL PARITY: artifacts that declare a fixture go through
 *            runParityHarness() — byte-identical stdout and identical
 *            trap classes across every lane × thread count.
 *
 * Verdict rules (all hard failures — an advisory isomorphism gate is not a
 * gate):
 *   R1 forbidden-import-class  -> FAIL. emcc-shaped artifacts are auto-reject
 *                                 whether or not the lanes agree; lanes
 *                                 agreeing that an artifact is broken
 *                                 everywhere is not parity.
 *   R2 imports outside surface -> FAIL. A private import is a NEW HOST
 *                                 CAPABILITY, which is an owner decision.
 *   R3 lane disagreement       -> FAIL. P1 cross-runtime divergence.
 *   R4 shim gap                -> FAIL. A lane that cannot supply a DECLARED
 *                                 capability is an SDK host-shim defect.
 *   R5 behavioral divergence   -> FAIL (delegated to the parity harness).
 *   R6 lane unavailable        -> FAIL, with kind `lane-unavailable`, kept
 *                                 lexically distinct from divergence: a
 *                                 harness that cannot run and a runtime that
 *                                 disagrees must never look alike in a
 *                                 receipt.
 *
 * Honest labelling of what each lane proves is part of the deliverable; see
 * LANE_EVIDENCE below and the `evidence` field of every lane result.
 */

import { spawn, execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, existsSync } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { toLoadableWasmBytes } from "../bundle/artifactBytes.js";
import {
  classifyArtifactImports,
  describeClassification,
  readWasmExportNames,
  resolveHostSurface,
} from "./hostContract.js";
import { normalizeWasmEdgeOutcome } from "./wasmedgeOutput.js";
import {
  assertWasmEdgeVersionMatchesPin,
  loadWasmEdgePin,
  runParityHarness,
  sha256Hex,
} from "./parityHarness.js";

const execFile = promisify(execFileCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const DEFAULT_GATE_MANIFEST = path.join(REPO_ROOT, "parity", "gate.json");

/**
 * What each lane runner actually demonstrates. Printed in every report so a
 * reader never has to guess how strong the evidence is.
 */
export const LANE_EVIDENCE = Object.freeze({
  browser:
    "REAL headless Chrome behind COOP/COEP (cross-origin isolated); instantiates with EXACTLY the declared host surface.",
  "wasmedge-native":
    "REAL native WasmEdge binary at the pin; bare CLI supplies WASI only, so declared capability imports surface as a named link error (see contractVerdict).",
  "wasmedge-docker":
    "REAL pinned WasmEdge container (image tag derived from wasmedgePin.json); bare CLI supplies WASI only, same capability caveat as the native lane.",
});

export const ContractVerdict = Object.freeze({
  /** Instantiated on the declared surface. */
  Satisfied: "satisfied",
  /**
   * Did not instantiate, and the ONLY blocker is a DECLARED capability import
   * this lane runner does not supply (the bare WasmEdge CLI has no mechanism
   * to register host functions). The artifact is contract-clean; the lane
   * runner is the limitation, and it is named as such — never silently
   * counted as a pass, never conflated with a divergence.
   * Upgrade path: module-sdk-parity-lane-embedded-wasmedge.
   */
  RunnerCannotSupplyCapability: "runner-cannot-supply-declared-capability",
  /** The artifact demands something the contract does not grant. */
  Violated: "violated",
  /** The lane could not supply a DECLARED capability -> SDK host-shim defect. */
  ShimGap: "shim-gap",
  /** The lane could not run at all. */
  Unavailable: "lane-unavailable",
});

// --- Manifest ------------------------------------------------------------------

/**
 * Locate an installed package's ROOT directory. `require.resolve(pkg +
 * "/package.json")` is the obvious route and fails on packages whose
 * "exports" map does not publish ./package.json (flatsql 0.4.2 is one), so
 * fall back to resolving the package entry and walking up. Wasm artifacts are
 * frequently outside the exports map — the gate must be able to see the bytes
 * a consumer would actually load, not only the ones the package advertises.
 */
export function packageRootDir(pkg, fromDir = REPO_ROOT) {
  try {
    return path.dirname(require.resolve(`${pkg}/package.json`, { paths: [fromDir] }));
  } catch {
    /* exports map hides package.json — walk up from the entry point */
  }
  // ESM-only packages with a restrictive exports map resolve through neither
  // route (flatsql 0.4.2 publishes no CJS main). Walk node_modules directly —
  // the installed directory is a fact on disk, not a package-author opinion.
  let dir = fromDir;
  while (true) {
    const candidate = path.join(dir, "node_modules", ...pkg.split("/"));
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `cannot locate the installed root of package "${pkg}" from ${fromDir} (run npm install in this worktree).`,
  );
}

function resolveArtifactPath(spec) {
  if (spec.packagePath) {
    // Resolve through node module resolution so the gate works in ANY fresh
    // worktree after `npm install` — never through a sibling checkout.
    const [pkg, ...rest] = String(spec.packagePath).split("/");
    return path.join(packageRootDir(pkg), ...rest);
  }
  return path.resolve(REPO_ROOT, String(spec.path));
}

/**
 * Load the gate manifest: the representative artifact SET this SDK certifies.
 *
 * Every entry resolves INSIDE this repo (a repo path or a node-resolved
 * dependency). External artifacts — e.g. a decrypted closed rf-* module —
 * are injected by the caller via `extraArtifacts`, so the gate never reaches
 * into a sibling checkout on its own (that shared-checkout coupling is a
 * documented trap, and it is what made the harness un-runnable before).
 */
export async function loadGateManifest(manifestPath = DEFAULT_GATE_MANIFEST) {
  const resolved = path.resolve(manifestPath);
  const raw = JSON.parse(await readFile(resolved, "utf8"));
  const artifacts = [];
  for (const spec of raw.artifacts ?? []) {
    const id = String(spec.id ?? "").trim();
    if (!id) throw new Error("gate manifest: every artifact needs an id.");
    resolveHostSurface(spec.surface);
    artifacts.push(
      Object.freeze({
        id,
        surface: String(spec.surface),
        artifactPath: resolveArtifactPath(spec),
        profile: String(spec.profile ?? "library"),
        fixture: spec.fixture
          ? path.resolve(path.dirname(resolved), String(spec.fixture))
          : null,
        required: spec.required !== false,
        note: spec.note ? String(spec.note) : null,
        negativeControl: spec.negativeControl === true,
      }),
    );
  }
  if (artifacts.length === 0) {
    throw new Error("gate manifest: artifacts[] must be non-empty.");
  }
  return Object.freeze({
    name: String(raw.name ?? path.basename(resolved)),
    manifestPath: resolved,
    artifacts: Object.freeze(artifacts),
  });
}

export function makeExternalArtifact(spec) {
  resolveHostSurface(spec.surface);
  return Object.freeze({
    id: String(spec.id),
    surface: String(spec.surface),
    artifactPath: path.resolve(String(spec.path)),
    profile: String(spec.profile ?? "library"),
    fixture: spec.fixture ? path.resolve(String(spec.fixture)) : null,
    required: spec.required !== false,
    note: spec.note ? String(spec.note) : "injected by caller (external artifact)",
    negativeControl: spec.negativeControl === true,
  });
}

// --- WasmEdge probe lanes -------------------------------------------------------

const UNKNOWN_IMPORT_RE =
  /unknown import[\s\S]*?When linking module:\s*"([^"]*)"\s*,\s*function name:\s*"([^"]*)"/;

/**
 * Classify a bare-WasmEdge probe run.
 *
 * `instantiated` requires POSITIVE evidence — a clean exit, or a diagnostic
 * that can only be produced AFTER linking succeeded (a reactor artifact has no
 * `_start`, so "function not found" is proof it linked). Anything else is a
 * `probe-failure`, which fails the gate as `lane-unavailable`.
 *
 * The earlier version of this function defaulted to `instantiated` whenever it
 * did not recognize the output, and it read only stderr — while WasmEdge logs
 * to STDOUT. Together those produced a silent FALSE PASS on an artifact that
 * demonstrably cannot link. An acceptance instrument may return "I could not
 * tell"; it may never return "fine" by default.
 */
export function classifyWasmEdgeProbe({
  code,
  signal,
  stderrText,
  guestOutputLength = 0,
}) {
  const text = String(stderrText ?? "");
  const unknownImport = UNKNOWN_IMPORT_RE.exec(text);
  if (unknownImport) {
    return {
      outcome: "link-error",
      missingImport: `${unknownImport[1]}.${unknownImport[2]}`,
      detail: `instantiation failed: unknown import ${unknownImport[1]}.${unknownImport[2]}`,
    };
  }
  const head = (limit = 3) => text.trim().split("\n").slice(0, limit).join(" | ");
  if (/instantiation failed/i.test(text)) {
    return { outcome: "instantiate-error", missingImport: null, detail: head() };
  }
  if (/(loading failed|validation failed|magic header|malformed|invalid section)/i.test(text)) {
    return { outcome: "compile-error", missingImport: null, detail: head() };
  }
  // The CLI rejected the INVOCATION, before loading anything: reactor mode
  // needs an entry name. This says nothing about the artifact, so it must not
  // be reported against the artifact — stageArtifact() now names `_initialize`
  // for reactor artifacts, and this branch exists so a regression there is
  // legible instead of masquerading as a cross-runtime divergence.
  if (/function name is required when reactor mode is enabled/i.test(text)) {
    return {
      outcome: "probe-failure",
      missingImport: null,
      detail:
        "WasmEdge refused the invocation: reactor mode requires an entry " +
        "function name. This is a PROBE defect, not an artifact defect — the " +
        "lane must pass the artifact's reactor entry (see resolveReactorEntry).",
    };
  }
  // Linked, then the CLI could not find a start entry: a reactor artifact.
  // Only reachable after successful instantiation.
  if (/(wasm function not found|function not found|_start|_initialize)/i.test(text)) {
    return {
      outcome: "instantiated",
      missingImport: null,
      detail: `linked; no command entry point (reactor artifact): ${head(1)}`,
    };
  }
  if (!signal && code === 0) {
    return { outcome: "instantiated", missingImport: null, detail: "linked; guest exited 0" };
  }
  if (/\[error\]/i.test(text)) {
    return { outcome: "instantiate-error", missingImport: null, detail: head() };
  }
  if (guestOutputLength > 0) {
    // The guest WROTE something, so it ran, so it linked — even though it then
    // chose to exit nonzero.
    return {
      outcome: "instantiated",
      missingImport: null,
      detail: `linked; guest produced ${guestOutputLength} byte(s) and exited (code=${code ?? "null"}, signal=${signal ?? "null"})`,
    };
  }
  // Nonzero/​signalled exit, no runtime diagnostic, no guest output: nothing
  // observed instantiation. Do not guess. (This is precisely the shape that
  // used to read as a pass — a docker mount that delivered no file, a runtime
  // that logged to a stream nobody read.)
  return {
    outcome: "probe-failure",
    missingImport: null,
    detail: `WasmEdge exited (code=${code ?? "null"}, signal=${signal ?? "null"}) with no diagnostic output and no guest output — the probe could not observe instantiation. Refusing to infer a pass.`,
  };
}

function spawnCapture(command, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${timeoutMs}ms (gate probe).`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
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
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.end();
  });
}

async function binaryExists(candidate) {
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function detectNativeWasmEdge(context = {}) {
  const explicit =
    context.wasmedgeBinary ??
    process.env.SDM_WASMEDGE_BINARY ??
    process.env.WASMEDGE_BINARY;
  const candidates = explicit
    ? [String(explicit)]
    : [path.join(os.homedir(), ".wasmedge", "bin", "wasmedge"), "wasmedge"];
  for (const candidate of candidates) {
    if (candidate !== "wasmedge" && !(await binaryExists(candidate))) continue;
    try {
      const { stdout } = await execFile(candidate, ["--version"]);
      return { binary: candidate, versionOutput: stdout };
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Native WasmEdge probe lane. */
async function probeWithNativeWasmEdge(context, staged) {
  const detected = context.nativeWasmEdge;
  if (!detected) throw new Error("native WasmEdge binary not available");
  assertWasmEdgeVersionMatchesPin(
    detected.versionOutput,
    context.pin,
    `native binary ${detected.binary}`,
  );
  const outcome = await spawnCapture(detected.binary, wasmEdgeProbeArgs(staged), {
    cwd: staged.dir,
    env: { PATH: process.env.PATH ?? "" },
    timeoutMs: context.timeoutMs,
  });
  const normalized = normalizeWasmEdgeOutcome(outcome);
  return classifyWasmEdgeProbe({
    code: outcome.code,
    signal: outcome.signal,
    stderrText: normalized.diagnosticText,
    guestOutputLength: normalized.stdout.length,
  });
}

/** Pinned-container WasmEdge probe lane. */
async function probeWithDockerWasmEdge(context, staged) {
  const args = [
    "run",
    "--rm",
    "-i",
    "--network",
    "none",
    "-v",
    `${staged.dir}:/parity:ro`,
    "-w",
    "/parity",
  ];
  if (context.dockerPlatform) args.push("--platform", String(context.dockerPlatform));
  args.push(context.pin.dockerImage, ...wasmEdgeProbeArgs(staged));
  const outcome = await spawnCapture(context.dockerBinary ?? "docker", args, {
    cwd: staged.dir,
    env: process.env,
    timeoutMs: context.timeoutMs,
  });
  const normalized = normalizeWasmEdgeOutcome(outcome);
  return classifyWasmEdgeProbe({
    code: outcome.code,
    signal: outcome.signal,
    stderrText: normalized.diagnosticText,
    guestOutputLength: normalized.stdout.length,
  });
}

async function ensureDockerLane(context) {
  const dockerBinary = context.dockerBinary ?? "docker";
  await execFile(dockerBinary, ["--version"]);
  const { pin } = context;
  let present = true;
  try {
    await execFile(dockerBinary, ["image", "inspect", pin.dockerImage]);
  } catch {
    present = false;
  }
  if (!present) {
    if (!context.autoBuildDockerImage) {
      throw new Error(
        `pinned WasmEdge image ${pin.dockerImage} is missing and autoBuildDockerImage is disabled.`,
      );
    }
    context.log(`gate: building ${pin.dockerImage} (WasmEdge ${pin.wasmedgeVersion})`);
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
  const { stdout } = await execFile(
    dockerBinary,
    ["run", "--rm", "--entrypoint", "wasmedge", pin.dockerImage, "--version"],
    { timeout: 120_000 },
  );
  return assertWasmEdgeVersionMatchesPin(
    stdout,
    context.pin,
    `docker image ${pin.dockerImage}`,
  );
}

// --- Browser probe lane ---------------------------------------------------------

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
    context.chromeBinary ?? process.env.SDM_CHROME_BINARY ?? process.env.CHROME_BINARY;
  if (explicit) return String(explicit);
  for (const candidate of CHROME_CANDIDATES) {
    if (await binaryExists(candidate)) return candidate;
  }
  throw new Error(
    "browser lane: no Chrome/Chromium binary found (set SDM_CHROME_BINARY). " +
      "The browser lane requires a REAL browser context — jsdom masks SAB/threading realities.",
  );
}

const PROBE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>sdm parity gate</title></head>
<body><pre id="status">gate probe booting…</pre>
<script type="module" src="/probe.js"></script></body></html>`;

async function runBrowserProbeLane(context, artifacts) {
  const chromeBinary = await resolveChromeBinary(context);
  const esbuild = await import("esbuild");
  const built = await esbuild.build({
    entryPoints: [path.join(__dirname, "parityGateBrowserProbe.js")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: ["chrome110"],
    external: ["node:*"],
    logLevel: "silent",
  });
  const bundle = built.outputFiles[0].text;

  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const byUrl = new Map(
    artifacts.map((artifact) => [`/artifact/${artifact.id}.wasm`, artifact]),
  );
  const plan = {
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      surface: artifact.surface,
      url: `/artifact/${artifact.id}.wasm`,
    })),
  };

  const headers = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cache-Control": "no-store",
  };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/done") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        response.writeHead(200, headers);
        response.end("ok");
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (body.fatal) rejectDone(new Error(`browser gate lane fatal: ${body.fatal}`));
          else resolveDone(body.results ?? []);
        } catch (error) {
          rejectDone(error);
        }
      });
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8" });
      response.end(PROBE_HTML);
      return;
    }
    if (url.pathname === "/probe.js") {
      response.writeHead(200, {
        ...headers,
        "Content-Type": "text/javascript; charset=utf-8",
      });
      response.end(bundle);
      return;
    }
    if (url.pathname === "/gate-plan") {
      response.writeHead(200, { ...headers, "Content-Type": "application/json" });
      response.end(JSON.stringify(plan));
      return;
    }
    const artifact = byUrl.get(url.pathname);
    if (artifact) {
      response.writeHead(200, { ...headers, "Content-Type": "application/wasm" });
      response.end(Buffer.from(artifact.loadableBytes));
      return;
    }
    response.writeHead(404, headers);
    response.end("not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "sdm-gate-chrome-"));
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
    rejectDone(new Error(`browser gate lane: failed to launch Chrome (${error.message})`)),
  );
  chrome.on("exit", (code, signal) =>
    rejectDone(
      new Error(
        `browser gate lane: Chrome exited before reporting (code=${code}, signal=${signal}). ` +
          Buffer.concat(chromeStderr).toString("utf8").slice(-400),
      ),
    ),
  );
  const timer = setTimeout(
    () => rejectDone(new Error(`browser gate lane timed out after ${context.timeoutMs}ms.`)),
    context.timeoutMs,
  );
  try {
    return await done;
  } finally {
    clearTimeout(timer);
    chrome.removeAllListeners("exit");
    chrome.kill("SIGKILL");
    server.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

// --- Verdict derivation ---------------------------------------------------------

/**
 * Reduce one lane's raw probe outcome to a contract verdict, using the
 * artifact's structural classification and what the lane runner is CAPABLE of
 * supplying. Pure — this is the rule set, testable without any runtime.
 */
export function deriveContractVerdict({
  laneSuppliesCapabilities,
  probe,
  structural,
}) {
  if (probe.outcome === "lane-unavailable") {
    return {
      verdict: ContractVerdict.Unavailable,
      reason: probe.detail ?? "lane could not run",
    };
  }
  if (structural.verdict === "forbidden") {
    return {
      verdict: ContractVerdict.Violated,
      reason: describeClassification(structural),
    };
  }
  if (structural.verdict === "malformed") {
    return { verdict: ContractVerdict.Violated, reason: describeClassification(structural) };
  }
  if (structural.verdict === "outside-surface") {
    return {
      verdict: ContractVerdict.Violated,
      reason: describeClassification(structural),
    };
  }
  if (probe.outcome === "instantiated") {
    return { verdict: ContractVerdict.Satisfied, reason: null };
  }
  if (probe.outcome === "link-error") {
    const missing = probe.missingImport;
    const isDeclaredCapability =
      missing !== null && structural.capabilityImports.includes(missing);
    if (isDeclaredCapability) {
      return laneSuppliesCapabilities
        ? {
            verdict: ContractVerdict.ShimGap,
            reason: `lane supplies the declared surface but failed to link ${missing} — SDK host-shim defect`,
          }
        : {
            verdict: ContractVerdict.RunnerCannotSupplyCapability,
            reason: `blocked ONLY on the declared capability import ${missing}; this lane runner registers no host functions`,
          };
    }
    return {
      verdict: ContractVerdict.Violated,
      reason: `link error on ${missing ?? "an unnamed import"} which is NOT in the declared surface: ${probe.detail}`,
    };
  }
  return {
    verdict: ContractVerdict.Violated,
    reason: `${probe.outcome}: ${probe.detail ?? "no detail"}`,
  };
}

/**
 * Cross-lane comparison. Two lanes agree when their verdicts are equivalent
 * modulo the runner's declared capability limitation — an artifact that is
 * `satisfied` in the browser and `runner-cannot-supply-declared-capability`
 * under the bare WasmEdge CLI is NOT a divergence, and the report says so in
 * those words rather than pretending the lanes matched.
 */
export function lanesAgree(a, b) {
  const equivalence = (verdict) =>
    verdict === ContractVerdict.RunnerCannotSupplyCapability
      ? ContractVerdict.Satisfied
      : verdict;
  return equivalence(a) === equivalence(b);
}

// --- Orchestrator ---------------------------------------------------------------

/**
 * A REACTOR artifact has no `_start`; its initialisation entry is `_initialize`
 * (clang `-mexec-model=reactor`). The WasmEdge CLI refuses to run one without
 * being told which function to call — "A function name is required when reactor
 * mode is enabled." on stderr, exit 1, and NO runtime diagnostic — which the
 * probe classifier could only honestly report as `probe-failure`. The effect
 * was that a CORRECTLY built library module (the shape the module contract
 * mandates for the RF family) was reported as a P1 cross-runtime divergence
 * while the browser lane passed: the gate failed the artifact for the gate's
 * own inability to invoke it.
 *
 * Naming the entry is also STRICTLY STRONGER evidence than the old bare
 * invocation: a clean exit 0 means the runtime linked the imports, instantiated
 * the module, and RAN its initialiser — observed, not inferred from an error
 * string.
 */
export function resolveReactorEntry(loadableBytes) {
  let exportNames;
  try {
    exportNames = readWasmExportNames(loadableBytes);
  } catch {
    return null;
  }
  if (exportNames.includes("_start")) return null;
  return exportNames.includes("_initialize") ? "_initialize" : null;
}

async function stageArtifact(artifact) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `sdm-gate-${artifact.id}-`));
  const basename = "artifact.wasm";
  await writeFile(path.join(dir, basename), artifact.loadableBytes);
  return {
    dir,
    basename,
    reactorEntry: resolveReactorEntry(artifact.loadableBytes),
  };
}

/**
 * The invocation tail shared by both WasmEdge lanes, so the native and Docker
 * lanes can never drift into probing the same artifact two different ways.
 */
export function wasmEdgeProbeArgs(staged) {
  return staged.reactorEntry
    ? ["--enable-threads", "--reactor", staged.basename, staged.reactorEntry]
    : ["--enable-threads", staged.basename];
}

/**
 * Run the gate.
 *
 * @param {Object} options
 * @param {string}  [options.manifestPath]
 * @param {Object[]} [options.extraArtifacts]  external artifacts (e.g. a
 *   decrypted closed rf-* module) injected by the caller.
 * @param {boolean} [options.requireNativeWasmEdge] when true, the absence of a
 *   native WasmEdge at the pin FAILS the gate (host+container pin pair cannot
 *   be cross-verified without it). Default false: the absence is reported as
 *   an explicit `pinVerification` gap, never as a pass.
 * @param {boolean} [options.expectFailure] negative-control mode: the gate
 *   must FAIL; a PASS is itself the error.
 */
export async function runParityGate(options = {}) {
  const log = options.log ?? (() => {});
  const pin = loadWasmEdgePin();
  const manifest = options.manifest ?? (await loadGateManifest(options.manifestPath));
  const declared = [
    ...manifest.artifacts,
    ...(options.extraArtifacts ?? []).map(makeExternalArtifact),
  ];

  const context = {
    pin,
    log,
    dockerBinary: options.dockerBinary ?? "docker",
    dockerPlatform: options.dockerPlatform,
    chromeBinary: options.chromeBinary,
    wasmedgeBinary: options.wasmedgeBinary,
    autoBuildDockerImage: options.autoBuildDockerImage !== false,
    timeoutMs: options.timeoutMs ?? 120_000,
    nativeWasmEdge: null,
  };

  // --- resolve + load artifacts
  const artifacts = [];
  const failures = [];
  for (const spec of declared) {
    try {
      const rawBytes = new Uint8Array(await readFile(spec.artifactPath));
      const loadableBytes = toLoadableWasmBytes(rawBytes);
      artifacts.push({
        ...spec,
        rawBytes,
        loadableBytes,
        artifactSha256: sha256Hex(rawBytes),
        moduleSha256: sha256Hex(loadableBytes),
        structural: classifyArtifactImports(loadableBytes, spec.surface),
      });
    } catch (error) {
      if (spec.required) {
        failures.push({
          artifact: spec.id,
          kind: "artifact-missing",
          message: `${spec.artifactPath}: ${error?.message ?? error}`,
        });
      } else {
        log(`gate: optional artifact ${spec.id} absent (${spec.artifactPath})`);
      }
    }
  }

  // --- lane availability (unavailability is a FAILURE, distinct from divergence)
  const laneNames = options.lanes ?? ["browser", "wasmedge-docker", "wasmedge-native"];
  const laneState = new Map();

  context.nativeWasmEdge = await detectNativeWasmEdge(context);
  const nativeRequested = laneNames.includes("wasmedge-native");
  const nativeAvailable = Boolean(context.nativeWasmEdge);
  if (nativeRequested && !nativeAvailable) {
    if (options.requireNativeWasmEdge) {
      failures.push({
        artifact: null,
        kind: "lane-unavailable",
        message:
          "native WasmEdge lane: no binary found. Host and container WasmEdge versions pin and bump TOGETHER, so with no host runtime the pin pair cannot be cross-verified.",
      });
    } else {
      laneState.set("wasmedge-native", {
        available: false,
        reason: "no native WasmEdge binary on this box",
      });
    }
  }

  const activeLanes = [];
  for (const lane of laneNames) {
    if (lane === "wasmedge-native") {
      if (nativeAvailable) activeLanes.push(lane);
      continue;
    }
    if (lane === "wasmedge-docker") {
      try {
        const version = await ensureDockerLane(context);
        laneState.set(lane, { available: true, version });
        activeLanes.push(lane);
      } catch (error) {
        failures.push({
          artifact: null,
          kind: "lane-unavailable",
          message: `docker WasmEdge lane: ${error?.message ?? error}`,
        });
      }
      continue;
    }
    activeLanes.push(lane);
  }

  const wasmedgeLanes = activeLanes.filter((lane) => lane.startsWith("wasmedge"));
  if (wasmedgeLanes.length === 0) {
    failures.push({
      artifact: null,
      kind: "lane-unavailable",
      message:
        "no WasmEdge lane could run (neither a native binary at the pin nor the pinned container). Parity is unprovable.",
    });
  }
  if (!activeLanes.includes("browser")) {
    failures.push({
      artifact: null,
      kind: "lane-unavailable",
      message: "browser lane not selected; a WasmEdge-only run cannot claim parity.",
    });
  }

  // --- Tier A: real instantiation probes
  const laneProbes = new Map(); // lane -> Map(artifactId -> probe)

  if (activeLanes.includes("browser") && artifacts.length > 0) {
    const probes = new Map();
    try {
      const results = await runBrowserProbeLane(context, artifacts);
      for (const result of results) {
        probes.set(result.id, {
          outcome: result.outcome,
          missingImport: result.missingImport ?? null,
          detail: result.detail ?? null,
          exportCount: result.exportCount ?? 0,
          crossOriginIsolated: result.crossOriginIsolated === true,
        });
      }
      const missing = artifacts.filter((artifact) => !probes.has(artifact.id));
      for (const artifact of missing) {
        probes.set(artifact.id, {
          outcome: "lane-unavailable",
          detail: "browser lane returned no result for this artifact",
          missingImport: null,
        });
      }
    } catch (error) {
      for (const artifact of artifacts) {
        probes.set(artifact.id, {
          outcome: "lane-unavailable",
          detail: error?.message ?? String(error),
          missingImport: null,
        });
      }
      failures.push({
        artifact: null,
        kind: "lane-unavailable",
        message: `browser lane: ${error?.message ?? error}`,
      });
    }
    laneProbes.set("browser", probes);
  }

  for (const lane of wasmedgeLanes) {
    const probes = new Map();
    for (const artifact of artifacts) {
      const staged = await stageArtifact(artifact);
      try {
        const probe =
          lane === "wasmedge-native"
            ? await probeWithNativeWasmEdge(context, staged)
            : await probeWithDockerWasmEdge(context, staged);
        probes.set(artifact.id, probe);
      } catch (error) {
        probes.set(artifact.id, {
          outcome: "lane-unavailable",
          detail: error?.message ?? String(error),
          missingImport: null,
        });
      } finally {
        await rm(staged.dir, { recursive: true, force: true });
      }
    }
    laneProbes.set(lane, probes);
  }

  // --- Tier A verdicts + cross-lane diff
  const artifactReports = [];
  for (const artifact of artifacts) {
    const lanes = [];
    for (const lane of laneProbes.keys()) {
      const probe = laneProbes.get(lane).get(artifact.id) ?? {
        outcome: "lane-unavailable",
        detail: "no probe recorded",
        missingImport: null,
      };
      const derived = deriveContractVerdict({
        laneSuppliesCapabilities: lane === "browser",
        probe,
        structural: artifact.structural,
      });
      lanes.push({
        lane,
        evidence: LANE_EVIDENCE[lane] ?? "unlabelled lane",
        outcome: probe.outcome,
        missingImport: probe.missingImport ?? null,
        detail: probe.detail ?? null,
        contractVerdict: derived.verdict,
        reason: derived.reason,
        crossOriginIsolated: probe.crossOriginIsolated,
      });
    }

    for (const laneResult of lanes) {
      if (laneResult.contractVerdict === ContractVerdict.Violated) {
        failures.push({
          artifact: artifact.id,
          kind:
            artifact.structural.verdict === "forbidden"
              ? "forbidden-import-class"
              : "contract-violation",
          message: `${laneResult.lane}: ${laneResult.reason}`,
        });
      } else if (laneResult.contractVerdict === ContractVerdict.ShimGap) {
        failures.push({
          artifact: artifact.id,
          kind: "host-shim-gap",
          message: `${laneResult.lane}: ${laneResult.reason}`,
        });
      } else if (laneResult.contractVerdict === ContractVerdict.Unavailable) {
        failures.push({
          artifact: artifact.id,
          kind: "lane-unavailable",
          message: `${laneResult.lane}: ${laneResult.reason}`,
        });
      }
    }

    for (let index = 1; index < lanes.length; index += 1) {
      if (!lanesAgree(lanes[0].contractVerdict, lanes[index].contractVerdict)) {
        failures.push({
          artifact: artifact.id,
          kind: "lane-divergence",
          message: `P1 cross-runtime divergence: ${lanes[0].lane}=${lanes[0].contractVerdict} vs ${lanes[index].lane}=${lanes[index].contractVerdict} (${lanes[index].reason ?? "-"})`,
        });
      }
    }

    artifactReports.push({
      id: artifact.id,
      surface: artifact.surface,
      profile: artifact.profile,
      artifactPath: artifact.artifactPath,
      artifactSha256: artifact.artifactSha256,
      moduleSha256: artifact.moduleSha256,
      byteLength: artifact.loadableBytes.length,
      structural: {
        verdict: artifact.structural.verdict,
        summary: describeClassification(artifact.structural),
        importCount: artifact.structural.importCount,
        capabilityImports: artifact.structural.capabilityImports,
        forbidden: artifact.structural.forbidden,
        outsideSurface: artifact.structural.outsideSurface,
      },
      lanes,
      note: artifact.note,
    });
  }

  // --- Tier B: behavioral parity for artifacts that declare a fixture
  const behavioral = [];
  for (const artifact of artifacts) {
    if (!artifact.fixture) continue;
    const harnessLanes = ["browser", ...(wasmedgeLanes.includes("wasmedge-native") ? ["wasmedge"] : []), "docker-wasmedge"];
    try {
      const report = await runParityHarness({
        wasmPath: artifact.artifactPath,
        fixturePath: artifact.fixture,
        lanes: harnessLanes,
        chromeBinary: context.chromeBinary,
        wasmedgeBinary: context.wasmedgeBinary,
        dockerPlatform: context.dockerPlatform,
        timeoutMs: context.timeoutMs,
        log,
      });
      behavioral.push({ artifact: artifact.id, ok: report.ok, report });
      if (!report.ok) {
        for (const failure of report.failures) {
          failures.push({
            artifact: artifact.id,
            kind: `behavioral-${failure.kind}`,
            message: `${failure.caseId ?? "-"}: ${failure.message}`,
          });
        }
      }
    } catch (error) {
      behavioral.push({ artifact: artifact.id, ok: false, error: String(error?.message ?? error) });
      failures.push({
        artifact: artifact.id,
        kind: "behavioral-harness-failure",
        message: String(error?.message ?? error),
      });
    }
  }

  const ok = failures.length === 0;
  return {
    ok,
    gate: manifest.name,
    manifestPath: manifest.manifestPath,
    pin: pin.wasmedgeVersion,
    pinVerification: {
      native: nativeAvailable
        ? { status: "verified", binary: context.nativeWasmEdge.binary }
        : {
            status: "absent",
            note:
              "No native WasmEdge on this box: the host/container pin PAIR could not be cross-verified. This is a recorded gap, not a pass — pass requireNativeWasmEdge on hosts that provision it (graph: parity-harness-cannot-run-locally).",
          },
      docker: laneState.get("wasmedge-docker") ?? { status: "not-run" },
    },
    lanes: activeLanes.map((lane) => ({
      lane,
      evidence: LANE_EVIDENCE[lane] ?? "unlabelled lane",
    })),
    lanesSkipped: [...laneState.entries()]
      .filter(([, value]) => value.available === false)
      .map(([lane, value]) => ({ lane, reason: value.reason })),
    artifacts: artifactReports,
    behavioral: behavioral.map((entry) => ({
      artifact: entry.artifact,
      ok: entry.ok,
      comparisons: entry.report?.comparisons ?? 0,
      lanes: entry.report?.lanes ?? [],
      error: entry.error ?? null,
    })),
    failures,
  };
}

export function formatGateReport(report) {
  const lines = [];
  lines.push(
    `parity-gate ${report.ok ? "PASS" : "FAIL"} gate=${report.gate} wasmedge-pin=${report.pin} artifacts=${report.artifacts.length} lanes=[${report.lanes.map((lane) => lane.lane).join(", ")}]`,
  );
  for (const lane of report.lanes) {
    lines.push(`  lane ${lane.lane}: ${lane.evidence}`);
  }
  for (const skipped of report.lanesSkipped ?? []) {
    lines.push(`  lane ${skipped.lane}: NOT RUN — ${skipped.reason}`);
  }
  if (report.pinVerification?.native?.status === "absent") {
    lines.push(`  PIN GAP: ${report.pinVerification.native.note}`);
  }
  for (const artifact of report.artifacts) {
    lines.push(
      `  ${artifact.id} [${artifact.surface}/${artifact.profile}] sha256=${artifact.moduleSha256.slice(0, 16)} :: ${artifact.structural.summary}`,
    );
    for (const lane of artifact.lanes) {
      lines.push(
        `      ${lane.lane.padEnd(16)} ${lane.contractVerdict}${lane.reason ? ` — ${lane.reason}` : ""}`,
      );
    }
  }
  for (const entry of report.behavioral ?? []) {
    lines.push(
      `  behavioral ${entry.artifact}: ${entry.ok ? "PASS" : "FAIL"} comparisons=${entry.comparisons}${entry.error ? ` (${entry.error})` : ""}`,
    );
  }
  for (const failure of report.failures) {
    lines.push(
      `  GATE FAIL artifact=${failure.artifact ?? "-"} kind=${failure.kind}: ${failure.message}`,
    );
  }
  return lines.join("\n");
}

export function gateReceiptDigest(report) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        gate: report.gate,
        pin: report.pin,
        artifacts: report.artifacts.map((artifact) => [
          artifact.id,
          artifact.moduleSha256,
          artifact.lanes.map((lane) => [lane.lane, lane.contractVerdict]),
        ]),
        ok: report.ok,
      }),
    )
    .digest("hex");
}
