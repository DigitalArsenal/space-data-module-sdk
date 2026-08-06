import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  defaultOutputRoot,
  generatePlgBindings,
  packageRoot,
  resolveSdsPackageRoot,
} from "./generate-plg-bindings.mjs";

/**
 * hard-no-unreleased-deps-gate: generated code in this repo must be
 * byte-reproducible from the RELEASED, PUBLISHED version of its
 * source-of-truth package (spacedatastandards.org, pinned in package.json).
 *
 * This regenerates the SDS PLG mirror into a scratch directory using the
 * pinned npm-resolved package (never a `file:` link or a dirty sibling
 * checkout) and diffs it against the committed
 * src/generated/spacedatastandards/plg tree. ANY difference fails, naming
 * the file and the differing lines — the incident this gate exists for
 * (SDK commit 4810b01) baked in a field (`PLGFlowEdgeContract.CANONICAL_TYPE`)
 * that existed only in an uncommitted SDS working tree and was never in any
 * released SDS version the SDK could regenerate from.
 */

async function walkFiles(root, base = root) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return out;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full, base)));
    } else {
      out.push(path.relative(base, full));
    }
  }
  return out.sort();
}

// A minimal, dependency-free line-level diff summary: which lines are only
// on one side. Not a full LCS diff — this is a byte-reproducibility GATE,
// not a code-review tool, and the goal is naming what changed, not a pretty
// patch.
function summarizeLineDiff(expected, actual) {
  const expectedLines = new Map();
  for (const line of expected.split("\n")) {
    expectedLines.set(line, (expectedLines.get(line) ?? 0) + 1);
  }
  const actualLines = new Map();
  for (const line of actual.split("\n")) {
    actualLines.set(line, (actualLines.get(line) ?? 0) + 1);
  }
  const onlyInCommitted = [];
  const onlyInReleased = [];
  for (const [line, count] of expectedLines) {
    const remaining = count - (actualLines.get(line) ?? 0);
    for (let i = 0; i < remaining; i += 1) onlyInCommitted.push(line);
  }
  for (const [line, count] of actualLines) {
    const remaining = count - (expectedLines.get(line) ?? 0);
    for (let i = 0; i < remaining; i += 1) onlyInReleased.push(line);
  }
  return { onlyInCommitted, onlyInReleased };
}

function formatDiffLines(lines, prefix, limit = 12) {
  const shown = lines.filter((line) => line.trim().length > 0).slice(0, limit);
  return shown.map((line) => `    ${prefix} ${line.trim()}`).join("\n");
}

async function main() {
  if (process.env.SPACE_DATA_STANDARDS_ROOT) {
    console.error(
      "check-generated-bindings: SPACE_DATA_STANDARDS_ROOT is set. This gate " +
        "exists precisely to refuse resolving the source-of-truth package from " +
        "a dirty sibling checkout or a `file:` link — it always mirrors the " +
        "RELEASED, npm-pinned spacedatastandards.org package. Unset " +
        "SPACE_DATA_STANDARDS_ROOT (that override is a developer-only " +
        "regeneration convenience, never sanctioned for this check) and re-run.",
    );
    process.exitCode = 1;
    return;
  }

  const sdsPackageRoot = resolveSdsPackageRoot();

  // npm does NOT write _resolved/_from into the installed package's own
  // package.json (that was pre-npm@7 behavior) — the authoritative resolution
  // record lives in package-lock.json's packages["node_modules/<name>"].resolved.
  // A `file:` (or bare local path) entry there means `npm ci` linked a local
  // sibling checkout instead of fetching the real released tarball: exactly the
  // failure mode this gate exists to refuse.
  const lockPath = path.join(packageRoot, "package-lock.json");
  const lockText = await fs.readFile(lockPath, "utf8").catch(() => null);
  if (lockText) {
    const lock = JSON.parse(lockText);
    const lockEntry = lock?.packages?.["node_modules/spacedatastandards.org"];
    const resolvedFrom = lockEntry?.resolved ?? "";
    if (!resolvedFrom || /^file:/i.test(resolvedFrom) || path.isAbsolute(resolvedFrom)) {
      console.error(
        `check-generated-bindings: package-lock.json resolves spacedatastandards.org to ` +
          `"${resolvedFrom || "(nothing)"}", not a real released tarball URL. Refusing — ` +
          `this gate mirrors only a genuine \`npm ci\` install of the pinned released package, ` +
          `never a \`file:\` link or unresolved local checkout.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  const scratchRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "sdk-generated-bindings-check-"),
  );
  const scratchOutput = path.join(scratchRoot, "plg");
  try {
    await generatePlgBindings({ outputRoot: scratchOutput, sdsPackageRoot });

    const committedFiles = await walkFiles(defaultOutputRoot);
    const scratchFiles = await walkFiles(scratchOutput);
    const committedSet = new Set(committedFiles);
    const scratchSet = new Set(scratchFiles);

    const failures = [];

    for (const relativePath of scratchFiles) {
      if (!committedSet.has(relativePath)) {
        failures.push(
          `${relativePath}: present when regenerated from the pinned released ` +
            `spacedatastandards.org (${sdsPackageRoot}), MISSING from the committed tree.`,
        );
        continue;
      }
      const [committedBytes, scratchBytes] = await Promise.all([
        fs.readFile(path.join(defaultOutputRoot, relativePath), "utf8"),
        fs.readFile(path.join(scratchOutput, relativePath), "utf8"),
      ]);
      if (committedBytes !== scratchBytes) {
        const { onlyInCommitted, onlyInReleased } = summarizeLineDiff(
          committedBytes,
          scratchBytes,
        );
        const detail = [
          formatDiffLines(onlyInCommitted, "- committed, absent from pinned release:"),
          formatDiffLines(onlyInReleased, "+ pinned release, absent from committed:"),
        ]
          .filter(Boolean)
          .join("\n");
        failures.push(`${relativePath}: content differs from the pinned release.\n${detail}`);
      }
    }

    for (const relativePath of committedFiles) {
      if (!scratchSet.has(relativePath)) {
        failures.push(
          `${relativePath}: committed in the tree but ABSENT when regenerated from the ` +
            `pinned released spacedatastandards.org (${sdsPackageRoot}) — hand-committed ` +
            `generated code, or a field/table that never shipped in any released version.`,
        );
      }
    }

    const relativeOutput = path.relative(packageRoot, defaultOutputRoot);
    if (failures.length > 0) {
      console.error(
        `check-generated-bindings: FAIL — ${relativeOutput} is not byte-reproducible ` +
          `from the pinned released spacedatastandards.org (${sdsPackageRoot}):\n\n` +
          failures.map((entry) => `  - ${entry}`).join("\n\n") +
          "\n\nRegenerate with `node scripts/generate-plg-bindings.mjs` against the " +
          "pinned npm dependency and commit the result. If the difference is a schema " +
          "field that does not exist in any released spacedatastandards.org version, " +
          "the fix is to ratify/publish it there first (sds-always-publish law) — never " +
          "to hand-edit the generated tree.",
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      `check-generated-bindings: PASS — ${relativeOutput} is byte-reproducible from the ` +
        `pinned released spacedatastandards.org (${sdsPackageRoot}), ${committedFiles.length} file(s) checked.`,
    );
  } finally {
    await fs.rm(scratchRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
