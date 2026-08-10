#!/usr/bin/env node
/**
 * The propagator ABI drift gate.
 *
 * Regenerates every ABI artifact from schemas/orbpro/Propagator.fbs into a
 * scratch directory and byte-diffs it against what is committed. ANY
 * difference fails, naming the file and the differing lines.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before W1.1 the propagator ABI was declared in five hand-maintained places
 * and generated from none of them:
 *
 *   1. OrbPro  packages/orbpro-integration/sdk/include/orbpro_propagator.h
 *   2. SDK     schemas/orbpro/Propagator.fbs
 *   3. modules propagator/sgp4/schemas/StateVector.fbs
 *   4. modules propagator/sgp4/src/cpp/include/orbpro_propagator.h  (verbatim copy)
 *   5. closed  packages/poly-coverage/src/poly_coverage_module.cpp  (retyped struct)
 *
 * They drifted, exactly as the ecosystem critic predicted they would: (1) said
 * the position field was kilometres in its struct comments and METERS in its
 * layout block three lines below — a 1000x error a builder could compile
 * against for months. `packages/orbpro-integration/sdk/schemas/` — the input
 * the committed bindings were supposedly generated from — did not exist in the
 * repository's history at all, so nothing could be regenerated and no
 * difference could be detected.
 *
 * A generated tree with no regeneration gate is indistinguishable from a
 * hand-written one. This is the gate.
 *
 * Run: node scripts/check-propagator-abi.mjs        (wired into `npm test`)
 * Fix: node scripts/generate-propagator-abi.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";

import { renderPropagatorAbiArtifacts } from "./generate-propagator-abi.mjs";
import { packageRoot } from "./propagator-abi-model.mjs";

/**
 * A minimal line-level difference summary — which lines exist on only one
 * side. This is a byte-reproducibility gate, not a code-review tool: the job
 * is naming what changed, not rendering a pretty patch. (Same shape as
 * scripts/check-generated-bindings.mjs, deliberately.)
 */
function summarizeLineDiff(committed, regenerated) {
  const count = (text) => {
    const map = new Map();
    for (const line of text.split("\n")) map.set(line, (map.get(line) ?? 0) + 1);
    return map;
  };
  const a = count(committed);
  const b = count(regenerated);
  const onlyInCommitted = [];
  const onlyInRegenerated = [];
  for (const [line, n] of a) {
    for (let i = 0; i < n - (b.get(line) ?? 0); i += 1) onlyInCommitted.push(line);
  }
  for (const [line, n] of b) {
    for (let i = 0; i < n - (a.get(line) ?? 0); i += 1) onlyInRegenerated.push(line);
  }
  return { onlyInCommitted, onlyInRegenerated };
}

function formatDiffLines(lines, prefix, limit = 12) {
  const shown = lines.filter((l) => l.trim().length > 0).slice(0, limit);
  const more = lines.filter((l) => l.trim().length > 0).length - shown.length;
  const body = shown.map((l) => `      ${prefix} ${l.trim()}`).join("\n");
  return more > 0 ? `${body}\n      … and ${more} more` : body;
}

/**
 * Verify one tree of generated artifacts against freshly rendered text.
 * Exported so consumer repos (OrbPro, modules, closed-modules) can run the
 * SAME comparison against their committed copy of the header.
 */
export async function verifyAbiArtifacts({ root, artifacts, label }) {
  const failures = [];
  for (const [relativePath, expected] of artifacts) {
    const target = path.join(root, relativePath);
    let actual;
    try {
      actual = await fs.readFile(target, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        failures.push(
          `${relativePath}: MISSING from ${label}. The generator produces it; the tree does not have it.`,
        );
        continue;
      }
      throw error;
    }
    if (actual !== expected) {
      const { onlyInCommitted, onlyInRegenerated } = summarizeLineDiff(actual, expected);
      const detail = [
        formatDiffLines(onlyInCommitted, "- committed, not regenerated:"),
        formatDiffLines(onlyInRegenerated, "+ regenerated, not committed:"),
      ]
        .filter(Boolean)
        .join("\n");
      failures.push(`${relativePath}: differs from what the IDL generates.\n${detail}`);
    }
  }
  return failures;
}

async function main() {
  const artifacts = await renderPropagatorAbiArtifacts();
  const failures = await verifyAbiArtifacts({
    root: packageRoot,
    artifacts,
    label: "the committed tree",
  });

  if (failures.length > 0) {
    console.error(
      `check-propagator-abi: FAIL — the committed propagator ABI is not reproducible from ` +
        `schemas/orbpro/Propagator.fbs:\n\n` +
        failures.map((f) => `  - ${f}`).join("\n\n") +
        `\n\nRegenerate with \`node scripts/generate-propagator-abi.mjs\` and commit the result.\n` +
        `If you meant to CHANGE the ABI, change the .fbs — it is the single source of truth, and\n` +
        `an ABI change is additive-only within a MAJOR (docs/propagator-abi.md, "Versioning").`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `check-propagator-abi: PASS — ${artifacts.size} artifact(s) reproduce byte-for-byte from ` +
      `schemas/orbpro/Propagator.fbs.`,
  );
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
