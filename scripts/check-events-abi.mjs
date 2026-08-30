#!/usr/bin/env node
/**
 * The event-locator ABI drift gate.
 *
 * Regenerates every ABI artifact from schemas/orbpro/Events.fbs into memory
 * and byte-diffs it against what is committed. ANY difference fails, naming
 * the file and the differing lines. Same comparison as
 * scripts/check-propagator-abi.mjs, which owns the shared implementation:
 * a generated tree with no regeneration gate is indistinguishable from a
 * hand-written one, and a second copy of the gate is a second thing to drift.
 *
 * Run: node scripts/check-events-abi.mjs        (wired into `npm test`)
 * Fix: node scripts/generate-events-abi.mjs
 */

import path from "node:path";

import { verifyAbiArtifacts } from "./check-propagator-abi.mjs";
import { renderEventsAbiArtifacts } from "./generate-events-abi.mjs";
import { packageRoot } from "./propagator-abi-model.mjs";

async function main() {
  const artifacts = await renderEventsAbiArtifacts();
  const failures = await verifyAbiArtifacts({
    root: packageRoot,
    artifacts,
    label: "the committed tree",
  });

  if (failures.length > 0) {
    console.error(
      `check-events-abi: FAIL — the committed event-locator ABI is not reproducible from ` +
        `schemas/orbpro/Events.fbs:\n\n` +
        failures.map((f) => `  - ${f}`).join("\n\n") +
        `\n\nRegenerate with \`node scripts/generate-events-abi.mjs\` and commit the result.\n` +
        `If you meant to CHANGE the ABI, change the .fbs — it is the single source of truth, and\n` +
        `an ABI change is additive-only within a MAJOR (docs/events-abi.md, "Versioning").`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `check-events-abi: PASS — ${artifacts.size} artifact(s) reproduce byte-for-byte from ` +
      `schemas/orbpro/Events.fbs.`,
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
