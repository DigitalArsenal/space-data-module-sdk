/**
 * `space-data-module conformance <family>` — the official-harness conformance
 * runner (finding graph/findings/official-harness-shapes.md §5; W1.4 of the
 * harness program).
 *
 * WASM artifacts ONLY (owner ruling 2026-08-10: "No JS propagator!!!! WASM
 * ONLY") — the runner instantiates a compiled module and drives the family's
 * ABI; there is no path that certifies a JS object, because JS registries are
 * internal engine plumbing, never a public contract.
 *
 * Verdict vocabulary matches the gauntlet's: PASS / PASS-WITH-GAPS / FAIL.
 * A gap is a check that could not be adjudicated HERE (no corpus, or a lane
 * another command owns) — named, never silent.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { loadPropagatorArtifact } from "./abiDriver.js";
import { computeVerdict, runPropagatorSuite } from "./propagatorSuite.js";
import { runEstimationSuite } from "./estimationSuite.js";
import { makeEstimationReferenceEvidence } from "./estimationReference.js";

export { ErrorCode, REQUIRED_ABI_EXPORTS } from "./abiDriver.js";
export {
  computeVerdict,
  runPropagatorSuite,
  DEFAULT_LEAK_OPTIONS,
} from "./propagatorSuite.js";
export { runPropagatorSelfTest, formatSelfTestReport } from "./selfTest.js";

/**
 * Families with a conformance kit. The vocabulary is the SDS pluginCategory
 * projection (W0.3): unknown families are refused BY NAME with the known set,
 * never coerced — the ANALYSIS fallback was the namespace corruption the
 * finding killed.
 */
export const CONFORMANCE_FAMILIES = Object.freeze(["estimation", "propagator"]);

export class UnknownConformanceFamilyError extends Error {
  constructor(family) {
    super(
      `no conformance kit for family "${family}" — kits exist for: ` +
        `${CONFORMANCE_FAMILIES.join(", ")}. A family with no kit can never be CORE ` +
        "(finding §5); maneuver remains Wave 2.",
    );
    this.name = "UnknownConformanceFamilyError";
    this.family = family;
  }
}

/**
 * Locate a module's own corpus: <package-root>/vectors/vectors.json, walking
 * up from the artifact (dist/isomorphic/module.wasm -> package root).
 */
export async function resolveCorpusPath(artifactPath) {
  let dir = path.dirname(path.resolve(artifactPath));
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.join(dir, "vectors", "vectors.json");
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function loadCorpus(vectorsPath) {
  const raw = await fs.readFile(vectorsPath, "utf8");
  const corpus = JSON.parse(raw);
  if (!Array.isArray(corpus.cases)) {
    throw new Error(`${vectorsPath} has no cases[] — not a conformance corpus`);
  }
  return corpus;
}

/**
 * Run conformance for one family against one WASM artifact.
 *
 * @param {object} options
 * @param {string} options.family        e.g. "propagator"
 * @param {string} options.artifactPath  dist/isomorphic/module.wasm
 * @param {string} [options.vectorsPath] corpus override; default = the
 *   module's own vectors/vectors.json, found by walking up from the artifact
 * @param {object} [options.leak]        {warmupCycles, measureCycles, entities}
 */
export async function runConformance(options) {
  const family = String(options.family ?? "").trim().toLowerCase();
  if (!CONFORMANCE_FAMILIES.includes(family)) {
    throw new UnknownConformanceFamilyError(options.family);
  }
  if (family === "estimation") {
    const evidence = options.evidence ?? JSON.parse(
      await fs.readFile(path.resolve(options.evidencePath), "utf8"),
    );
    const evaluated = runEstimationSuite(evidence);
    let artifact = evidence.artifact ?? null;
    if (options.artifactPath) {
      const artifactPath = path.resolve(options.artifactPath);
      const artifactBytes = await fs.readFile(artifactPath);
      artifact = {
        path: artifactPath,
        sha256: crypto.createHash("sha256").update(artifactBytes).digest("hex"),
      };
    }
    return { family, artifact, corpus: null, evidence: options.evidencePath ?? null, ...evaluated };
  }

  const artifactPath = path.resolve(options.artifactPath);
  const artifactBytes = await fs.readFile(artifactPath);
  const artifactSha256 = crypto
    .createHash("sha256")
    .update(artifactBytes)
    .digest("hex");

  let vectorsPath = options.vectorsPath
    ? path.resolve(options.vectorsPath)
    : await resolveCorpusPath(artifactPath);
  let corpus = null;
  if (vectorsPath) {
    corpus = await loadCorpus(vectorsPath);
  }

  const checks = await runPropagatorSuite(
    () => loadPropagatorArtifact(artifactPath),
    { corpus, leak: options.leak },
  );

  return {
    family,
    artifact: { path: artifactPath, sha256: artifactSha256 },
    corpus: vectorsPath
      ? {
          path: vectorsPath,
          schemaVersion: corpus.schemaVersion ?? null,
          cases: corpus.cases.length,
          model: corpus.conformance?.model ?? null,
        }
      : null,
    checks,
    verdict: computeVerdict(checks),
  };
}

export { runEstimationSuite } from "./estimationSuite.js";
export { makeEstimationReferenceEvidence } from "./estimationReference.js";

export async function runEstimationSelfTest() {
  const controls = [];
  for (const [id, mutate] of [
    ["runtime-divergence", (e) => { e.runtime.threads["8"] = "different"; }],
    ["ekf-ukf-alias", (e) => { e.filter.ekfUkfCovarianceDifference = 0; }],
    ["covariance-placeholder", (e) => { e.invariants.actualOcmCovariance = false; }],
  ]) {
    const evidence = makeEstimationReferenceEvidence();
    mutate(evidence);
    const report = runEstimationSuite(evidence);
    controls.push({ id, caught: report.verdict === "FAIL" });
  }
  return { ok: controls.every((control) => control.caught), controls };
}

export function formatConformanceReport(report) {
  const lines = [];
  lines.push(`conformance ${report.family} — ${report.verdict}`);
  lines.push(`  artifact ${report.artifact.path}`);
  lines.push(`  sha256   ${report.artifact.sha256}`);
  if (report.corpus) {
    lines.push(
      `  corpus   ${report.corpus.path} (${report.corpus.cases} cases` +
        `${report.corpus.model ? `, model: ${report.corpus.model}` : ""})`,
    );
  } else {
    lines.push("  corpus   none supplied");
  }
  for (const check of report.checks) {
    const marker =
      check.status === "pass" ? "PASS" : check.status === "gap" ? "GAP " : "FAIL";
    lines.push(`  [${marker}] ${check.id} — ${check.detail}`);
  }
  return lines.join("\n");
}
