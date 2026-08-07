// ARTIFACT-level guard: actually bundle every browser-facing subpath for the
// browser, then read the bytes that come out.
//
// Why this exists on top of the module-level walker: this defect class escaped
// module-level checking TWICE. A source walker can only fail on what it knows
// how to resolve — an unusual specifier form, a re-export chain it mis-follows,
// a dependency's own conditional exports, a transform that synthesises an
// import. The bundler has no such gaps, because the bundler IS what the
// consumer runs. If a `node:` specifier survives into the emitted JavaScript,
// the browser will try to FETCH it, and the page dies with
//
//   Access to script at 'node:os' ... blocked by CORS policy
//
// which is precisely how all 275 OrbPro gallery demos rendered no canvas
// (`orbpro-engine-bundle-ships-node-builtins`). Only an artifact-level check
// catches that, so the gate is: bundle it, grep it.
//
// Note the deliberate absence of `external: [...node builtins]`. A consumer
// that externalises them (OrbPro's build does, for the emscripten plugin
// artifacts) converts a build error into a runtime browser error — the SDK must
// be clean under BOTH configurations, so here we let esbuild fail hard.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

import { BROWSER_FACING_SUBPATHS } from "./browser-reachable-node-builtins.test.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PACKAGE_NAME = JSON.parse(
  readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
).name;

const BUILTIN_PATTERN = new RegExp(
  `["'\`](?:node:)?(?:${builtinModules
    .filter((name) => !name.startsWith("_"))
    .map((name) => name.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&"))
    .join("|")})["'\`]`,
  "g",
);

/**
 * A `node:`-prefixed specifier anywhere in emitted browser JavaScript is fatal
 * on its own — the browser fetches it. A bare builtin name (`"fs"`) only
 * matters in import position, so scan for it as an import/require argument.
 */
function findNodeSpecifiers(code) {
  const hits = new Set();
  for (const match of code.matchAll(/["'`]node:[a-z/]+["'`]/g)) {
    hits.add(match[0].replace(/["'`]/g, ""));
  }
  for (const match of code.matchAll(
    /(?:^|[^\w$.])(?:import|require)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  )) {
    if (BUILTIN_PATTERN.test(`"${match[1]}"`)) hits.add(match[1]);
    BUILTIN_PATTERN.lastIndex = 0;
  }
  for (const match of code.matchAll(
    /(?:^|[^\w$])(?:import|export)\s[^;]*?from\s*["'`]([^"'`]+)["'`]/g,
  )) {
    if (BUILTIN_PATTERN.test(`"${match[1]}"`)) hits.add(match[1]);
    BUILTIN_PATTERN.lastIndex = 0;
  }
  return [...hits].sort();
}

test("every browser-facing subpath bundles for the browser with no node: specifier in the artifact", async (t) => {
  let esbuild;
  try {
    ({ default: esbuild } = await import("esbuild"));
  } catch {
    // esbuild is a devDependency; a consumer install without it must not turn
    // this gate into a silent pass, so say so loudly and fail.
    assert.fail(
      "esbuild is required for the artifact-level browser guard; run `npm install`.",
    );
  }

  const failures = [];

  for (const subpath of BROWSER_FACING_SUBPATHS) {
    const specifier =
      subpath === "." ? PACKAGE_NAME : `${PACKAGE_NAME}/${subpath.slice(2)}`;

    let result;
    try {
      result = await esbuild.build({
        stdin: {
          contents: `export * from ${JSON.stringify(specifier)};`,
          resolveDir: PACKAGE_ROOT,
          sourcefile: `browser-guard-${subpath.replace(/[^a-z0-9]/gi, "-")}.js`,
          loader: "js",
        },
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        conditions: ["browser"],
        logLevel: "silent",
        absWorkingDir: PACKAGE_ROOT,
      });
    } catch (error) {
      failures.push(
        `${subpath}: browser bundle FAILED to build\n    ${String(error.message).split("\n").slice(0, 12).join("\n    ")}`,
      );
      continue;
    }

    const code = result.outputFiles.map((file) => file.text).join("\n");
    const specifiers = findNodeSpecifiers(code);
    if (specifiers.length > 0) {
      failures.push(
        `${subpath}: bundled artifact still references ${specifiers.join(", ")}`,
      );
    }
  }

  assert.deepEqual(
    failures,
    [],
    `browser bundles are not browser-safe:\n\n  ${failures.join("\n\n  ")}\n`,
  );
});
