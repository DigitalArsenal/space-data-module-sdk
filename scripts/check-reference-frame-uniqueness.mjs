#!/usr/bin/env node
/**
 * check-reference-frame-uniqueness.mjs — the ReferenceFrame drift gate.
 *
 * The finding this exists for (graph/findings/official-harness-shapes.md §4.2,
 * §8.2) is that several incompatible `ReferenceFrame` vocabularies cross one
 * seam and were wire-compatible only by little-endian accident. The cure is not
 * to pretend they are one enum — two of them are frozen by compiled WASM in the
 * field, and the engine's FIXED/INERTIAL is INVERTED against the ABI's 0/1.
 * The cure is that exactly ONE of them crosses the ABI, that its numbering can
 * never move, and that every other vocabulary's relationship to it is DECLARED
 * DATA rather than an assumption living in someone's head.
 *
 * Janus ruled the four clauses (consult 2026-08-30,
 * gmat-08-frames-and-state-representations):
 *
 *   C1 SINGLE DEFINITION. schemas/orbpro/Propagator.fbs is the one
 *      authoritative declaration. The C header and both generated bindings must
 *      agree with it name-for-name AND value-for-value. Any other file in this
 *      repo declaring a ReferenceFrame/OrbProReferenceFrame with member values
 *      is a FAIL.
 *
 *   C2 STABLE NUMBERING. Values 0-5 are pinned to the six frozen tokens.
 *      Appended members are ascending, contiguous and gap-free. Nothing may be
 *      renamed, renumbered or removed against the committed baseline in
 *      schemas/orbpro/reference-frame.lock.json. Append-only, always.
 *
 *   C3 CROSSWALK TOTALITY. Every foreign vocabulary in
 *      schemas/orbpro/reference-frame-crosswalk.json maps BY NAMED TOKEN onto
 *      the ABI enum; the mapping is total (no unmapped member) and numeric
 *      identity is never asserted across repositories. When a listed source is
 *      present on disk it is re-read and any manifest-vs-source drift FAILS;
 *      when it is absent the re-read is SKIPPED with a printed note, and C1-C4
 *      still run against the manifest. A missing or malformed manifest is a
 *      FAIL, never a skip.
 *
 *   C4 ONE RTN CONVENTION. RIC / RSW / RTN / LVLH / VVLH resolve to ONE ABI
 *      member plus an axes spec. They may appear only as crosswalk aliases; a
 *      second RTN-named ABI member is a FAIL.
 *
 * Exit 0 = PASS. Exit 1 = FAIL, naming the file and the differing lines.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCHEMA = "schemas/orbpro/Propagator.fbs";
const LOCK = "schemas/orbpro/reference-frame.lock.json";
const CROSSWALK = "schemas/orbpro/reference-frame-crosswalk.json";
const HEADER = "include/orbpro/orbpro_propagator_abi.h";
const GENERATED = [
  "src/generated/orbpro/propagator-abi.ts",
  "src/generated/orbpro/propagator-abi.js",
  "src/generated/orbpro/propagator/reference-frame.ts",
  "src/generated/orbpro/propagator/reference-frame.js",
];

const FROZEN = [
  ["TEME", 0],
  ["J2000", 1],
  ["ICRF", 2],
  ["ECEF", 3],
  ["MCI", 4],
  ["MCMF", 5],
];

// Where a sibling checkout is looked for when a crosswalk entry names one. The
// repo may or may not be there; C3 says what happens either way.
const SIBLING_ROOTS = {
  OrbPro: [
    "../../repos/main-packages/OrbPro",
    "../../main-packages/OrbPro",
    "../OrbPro",
  ],
  "space-data-network-modules": [
    "../../repos/main-packages/space-data-network-modules",
    "../../main-packages/space-data-network-modules",
    "../space-data-network-modules",
  ],
  "space-data-module-sdk": ["."],
};

const failures = [];
const notes = [];

function fail(clause, message) {
  failures.push(`${clause}: ${message}`);
}

function readRepoFile(relative) {
  const absolute = path.join(repoRoot, relative);
  if (!fs.existsSync(absolute)) {
    return null;
  }
  return fs.readFileSync(absolute, "utf8");
}

/** Members of the authoritative enum, as [name, value] in declaration order. */
function parseSchemaEnum(source) {
  const block = source.match(/enum\s+ReferenceFrame\s*:\s*\w+\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  if (!block) {
    return null;
  }
  const members = [];
  for (const line of block[1].split("\n")) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*,?\s*$/);
    if (match) {
      members.push([match[1], Number(match[2])]);
    }
  }
  return members;
}

/** Strip // and /* *\/ comments so example values in prose are never read as members. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function parseNamedValues(source, pattern) {
  const members = [];
  let match;
  const regex = new RegExp(pattern, "g");
  while ((match = regex.exec(source)) !== null) {
    members.push([match[1], Number(match[2])]);
  }
  return members;
}

function compareMembers(clause, label, actual, expected) {
  if (actual.length !== expected.length) {
    fail(
      clause,
      `${label} declares ${actual.length} members, the schema declares ${expected.length}`,
    );
    return;
  }
  for (let i = 0; i < expected.length; i += 1) {
    const [expectedName, expectedValue] = expected[i];
    const [actualName, actualValue] = actual[i];
    if (actualName !== expectedName || actualValue !== expectedValue) {
      fail(
        clause,
        `${label} member ${i} is ${actualName} = ${actualValue}, the schema says ${expectedName} = ${expectedValue}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------

const schemaSource = readRepoFile(SCHEMA);
if (schemaSource === null) {
  fail("C1", `${SCHEMA} is missing; it is the one authoritative declaration`);
}
const schemaMembers = schemaSource ? parseSchemaEnum(schemaSource) : null;
if (!schemaMembers || schemaMembers.length === 0) {
  fail("C1", `no ReferenceFrame enum could be read out of ${SCHEMA}`);
}

if (schemaMembers) {
  // ---- C1: one definition, and every derived copy agrees -------------------
  const headerSource = readRepoFile(HEADER);
  if (headerSource === null) {
    fail("C1", `${HEADER} is missing`);
  } else {
    const headerMembers = parseNamedValues(
      headerSource.match(/typedef enum \{([\s\S]*?)\} OrbProReferenceFrame;/)?.[1] ?? "",
      "ORBPRO_FRAME_([A-Z0-9_]+)\\s*=\\s*(\\d+)",
    );
    compareMembers("C1", HEADER, headerMembers, schemaMembers);
  }

  for (const relative of GENERATED) {
    const source = readRepoFile(relative);
    if (source === null) {
      fail("C1", `${relative} is missing; the generated bindings are part of the contract`);
      continue;
    }
    // Comments carry example values ("the mean equinox of J2000 is J2000 = 1")
    // that would otherwise be read as members, so they are stripped first.
    const code = stripComments(source);
    const tsBody = code.match(/(?:export\s+)?(?:enum|const)\s+ReferenceFrame[^{]*\{([\s\S]*?)\n\}/)?.[1];
    let members = null;
    if (tsBody !== undefined) {
      members = parseNamedValues(tsBody, "\\b([A-Z][A-Z0-9_]*)\\s*[:=]\\s*(\\d+)");
    } else if (/ReferenceFrame\d?\[/.test(code)) {
      // The bundled JS form: ReferenceFrame2[ReferenceFrame2["TEME"] = 0] = "TEME";
      members = parseNamedValues(code, '\\[\\"([A-Z][A-Z0-9_]*)\\"\\]\\s*=\\s*(\\d+)');
    }
    if (members === null || members.length === 0) {
      fail("C1", `${relative} declares no ReferenceFrame`);
      continue;
    }
    compareMembers("C1", relative, members, schemaMembers);
  }

  // Any OTHER file in this repo that declares the enum with values is a second
  // definition, which is exactly what this gate exists to refuse.
  const searchRoots = ["src", "include", "schemas"];
  const allowed = new Set([SCHEMA, HEADER, ...GENERATED]);
  const stack = searchRoots.map((entry) => path.join(repoRoot, entry));
  while (stack.length > 0) {
    const current = stack.pop();
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!/\.(fbs|h|ts|js)$/.test(entry.name)) continue;
      const relative = path.relative(repoRoot, absolute);
      if (allowed.has(relative)) continue;
      const source = fs.readFileSync(absolute, "utf8");
      if (!/ReferenceFrame/.test(source)) continue;
      const declares =
        /enum\s+ReferenceFrame\s*[:{]/.test(source) ||
        /typedef enum \{[\s\S]*?\} OrbProReferenceFrame;/.test(source) ||
        /(?:export\s+)?enum\s+ReferenceFrame\s*\{/.test(source);
      if (declares) {
        fail("C1", `${relative} declares a second ReferenceFrame; there may be exactly one`);
      }
    }
  }

  // ---- C2: stable, append-only numbering -----------------------------------
  for (const [name, value] of FROZEN) {
    const found = schemaMembers.find((member) => member[0] === name);
    if (!found) {
      fail("C2", `frozen member ${name} is missing from ${SCHEMA}`);
    } else if (found[1] !== value) {
      fail("C2", `frozen member ${name} moved to ${found[1]}; 0-5 are never renumbered`);
    }
  }
  const seenNames = new Set();
  schemaMembers.forEach(([name, value], index) => {
    if (seenNames.has(name)) {
      fail("C2", `member ${name} is declared twice`);
    }
    seenNames.add(name);
    if (value !== index) {
      fail("C2", `member ${name} = ${value} breaks the contiguous ascending numbering at index ${index}`);
    }
  });

  const lockSource = readRepoFile(LOCK);
  if (lockSource === null) {
    fail("C2", `${LOCK} is missing; the committed numbering baseline is not optional`);
  } else {
    let lock;
    try {
      lock = JSON.parse(lockSource);
    } catch (error) {
      fail("C2", `${LOCK} is not valid JSON: ${error.message}`);
    }
    if (lock) {
      const locked = (lock.members ?? []).map((member) => [member.name, member.value]);
      for (const [name, value] of locked) {
        const found = schemaMembers.find((member) => member[0] === name);
        if (!found) {
          fail("C2", `${name} = ${value} is in ${LOCK} but no longer in ${SCHEMA}; removal is not append-only`);
        } else if (found[1] !== value) {
          fail("C2", `${name} is ${found[1]} in ${SCHEMA} but ${value} in ${LOCK}; renumbering is refused`);
        }
      }
      const lockedNames = new Set(locked.map(([name]) => name));
      const added = schemaMembers.filter(([name]) => !lockedNames.has(name));
      if (added.length > 0) {
        fail(
          "C2",
          `${SCHEMA} adds ${added.map(([name, value]) => `${name}=${value}`).join(", ")} that ${LOCK} does not carry. Append the same rows to the lock in this commit.`,
        );
      }
    }
  }

  // ---- C3: crosswalk totality ---------------------------------------------
  const crosswalkSource = readRepoFile(CROSSWALK);
  let crosswalk = null;
  if (crosswalkSource === null) {
    fail("C3", `${CROSSWALK} is missing; a crosswalk that does not exist cannot be total`);
  } else {
    try {
      crosswalk = JSON.parse(crosswalkSource);
    } catch (error) {
      fail("C3", `${CROSSWALK} is not valid JSON: ${error.message}`);
    }
  }

  if (crosswalk) {
    const abiNames = new Set(schemaMembers.map(([name]) => name));
    const vocabularies = Array.isArray(crosswalk.vocabularies) ? crosswalk.vocabularies : [];
    if (vocabularies.length === 0) {
      fail("C3", `${CROSSWALK} lists no vocabularies`);
    }
    for (const vocabulary of vocabularies) {
      const id = vocabulary.id ?? "<unnamed>";
      const members = vocabulary.members ?? {};
      const names = Object.keys(members);
      if (names.length === 0) {
        fail("C3", `crosswalk vocabulary ${id} maps no members`);
      }
      const targets = new Map();
      for (const name of names) {
        const target = members[name];
        if (target === null) {
          continue; // an explicitly unmapped token (e.g. an UNKNOWN sentinel)
        }
        if (typeof target !== "string") {
          fail("C3", `${id}.${name} maps to ${JSON.stringify(target)}; a mapping is a NAMED TOKEN`);
          continue;
        }
        if (/^\d+$/.test(target)) {
          fail("C3", `${id}.${name} maps to a NUMBER; numeric identity is never asserted across repositories`);
          continue;
        }
        if (!abiNames.has(target)) {
          fail("C3", `${id}.${name} maps to ${target}, which is not a member of the ABI enum`);
          continue;
        }
        if (!targets.has(target)) {
          targets.set(target, []);
        }
        targets.get(target).push(name);
      }

      // Re-read the source when the repo is on disk; skip with a note otherwise.
      const roots = SIBLING_ROOTS[vocabulary.repo] ?? [];
      let sourcePath = null;
      for (const root of roots) {
        const candidate = path.resolve(repoRoot, root, vocabulary.source ?? "");
        if (vocabulary.source && fs.existsSync(candidate)) {
          sourcePath = candidate;
          break;
        }
      }
      if (sourcePath === null) {
        notes.push(
          `SKIPPED (repo not on disk): ${vocabulary.repo}/${vocabulary.source ?? "<no source>"} — C1-C4 still ran against the manifest`,
        );
        continue;
      }
      const source = fs.readFileSync(sourcePath, "utf8");
      for (const name of names) {
        const token = new RegExp(`\\b${name}\\b`);
        if (!token.test(source)) {
          fail(
            "C3",
            `${id}.${name} is in the crosswalk but not in ${path.relative(repoRoot, sourcePath)}; the manifest has drifted from its source`,
          );
        }
      }
    }

    // ---- C4: one RTN convention -------------------------------------------
    const rtn = crosswalk.rtnConvention;
    if (!rtn || typeof rtn.abiMember !== "string") {
      fail("C4", `${CROSSWALK} declares no rtnConvention.abiMember`);
    } else {
      if (!abiNames.has(rtn.abiMember)) {
        fail("C4", `rtnConvention.abiMember ${rtn.abiMember} is not an ABI member`);
      }
      const aliases = Array.isArray(rtn.aliases) ? rtn.aliases : [];
      if (aliases.length === 0) {
        fail("C4", "rtnConvention lists no aliases; the collapse must be stated, not implied");
      }
      for (const alias of aliases) {
        if (abiNames.has(alias)) {
          fail(
            "C4",
            `${alias} is BOTH an RTN alias and an ABI member; the three live RTN triads collapse to ${rtn.abiMember} plus an axes spec, never to a member of their own`,
          );
        }
      }
      // And every crosswalk mapping of an alias must land on that one member.
      for (const vocabulary of vocabularies) {
        for (const [name, target] of Object.entries(vocabulary.members ?? {})) {
          if (aliases.includes(name) && target !== null && target !== rtn.abiMember) {
            fail(
              "C4",
              `${vocabulary.id}.${name} is an RTN triad mapped to ${target}, not ${rtn.abiMember}`,
            );
          }
        }
      }
    }
  }
}

for (const note of notes) {
  console.log(`check-reference-frame-uniqueness: ${note}`);
}

if (failures.length > 0) {
  console.error("check-reference-frame-uniqueness: FAIL");
  for (const failure of failures) {
    console.error(`  ${failure}`);
  }
  process.exit(1);
}

console.log(
  `check-reference-frame-uniqueness: PASS — one ReferenceFrame (${schemaMembers.length} members, 0-5 frozen), ${
    JSON.parse(readRepoFile(CROSSWALK)).vocabularies.length
  } crosswalked vocabularies, one RTN convention.`,
);
