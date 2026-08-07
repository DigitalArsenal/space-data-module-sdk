// The SDK's browser-facing export subpaths must not reach a Node builtin.
// ZERO tolerance: there is no exception list, and there must never be one.
//
// A browser bundler resolves imports STATICALLY, including a dynamic
// `import("node:...")` inside a branch that can never run in a browser. What
// happens next depends on the consumer's config and BOTH outcomes are fatal:
// the bundle fails to build, or the specifier is emitted as an external and the
// BROWSER tries to fetch `node:os` over HTTP. The second one is how every one
// of OrbPro's 275 gallery demos went dark
// (`orbpro-engine-bundle-ships-node-builtins`) after a routine pin bump — a
// total-gallery outage that no unit test and no build step noticed.
//
// This walks the real import graph from each browser-facing entry, THROUGH
// package dependencies (resolved under the `browser` condition, as a bundler
// would), and fails on any Node builtin it can reach. "Works in Node" is not a
// defence for a subpath a browser consumes.
//
// This is the module-level half. test/browser-bundle-node-builtins.test.js is
// the artifact-level half: it actually bundles each subpath and greps the
// OUTPUT. Keep both — this defect class escaped module-level checking twice.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));

// Export subpaths a browser bundle legitimately consumes. Adding a browser
// consumer surface means adding it here; this list is the contract.
export const BROWSER_FACING_SUBPATHS = [
  ".", // resolves through the `browser` condition
  "./manifest", // ditto
  "./licensing",
  "./runtime-host",
  "./invoke",
  "./runtime",
  "./transport",
  "./bundle",
  "./host/browser",
  "./host/timer-driver",
  "./host/browser-edge-shims",
  "./host/wasi-shim",
  "./host/isomorphic",
  "./host/browser-module",
  "./host/worker-module",
  "./testing/browser",
  "./testing/module-flatbuffer-stream-pump",
  "./utils/wasm-crypto",
  "./capabilities",
  "./standards",
  "./compat",
];

const BUILTIN_NAMES = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

const PACKAGE_JSON = JSON.parse(
  readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
);

/** Pick a target out of an exports entry the way a browser bundler would. */
function pickBrowserTarget(entry) {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return null;
  for (const condition of ["browser", "import", "module", "default", "require"]) {
    const value = entry[condition];
    if (value === undefined) continue;
    const picked = pickBrowserTarget(value);
    if (picked) return picked;
  }
  return null;
}

function resolveSubpath(subpath) {
  const entry = PACKAGE_JSON.exports[subpath];
  assert.ok(entry, `package.json exports has no ${subpath}`);
  const target = pickBrowserTarget(entry);
  assert.ok(target, `${subpath} has no browser/default target`);
  return path.join(PACKAGE_ROOT, target);
}

/** Comments are not import graph; a bundler never resolves them. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** Every specifier a bundler would try to resolve from this file. */
function specifiersOf(rawSource) {
  const source = stripComments(rawSource);
  const found = [];
  for (const match of source.matchAll(/(?:^|[^\w$])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g)) {
    found.push(match[1]);
  }
  for (const match of source.matchAll(/(?:^|[^\w$.])import\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    found.push(match[1]);
  }
  for (const match of source.matchAll(/(?:^|[^\w$.])require\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    found.push(match[1]);
  }
  return found;
}

function existingFile(base) {
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, path.join(base, "index.js"), path.join(base, "index.mjs")]) {
    if (existsSync(candidate) && !existsSync(path.join(candidate, "."))) return candidate;
  }
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, path.join(base, "index.js"), path.join(base, "index.mjs")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveRelative(fromFile, specifier) {
  return existingFile(path.resolve(path.dirname(fromFile), specifier));
}

function findPackageDir(fromFile, packageName) {
  let dir = path.dirname(fromFile);
  while (true) {
    const candidate = path.join(dir, "node_modules", packageName);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function matchExportsSubpath(exportsField, subpath) {
  if (exportsField === undefined || exportsField === null) return null;
  if (typeof exportsField === "string") {
    return subpath === "." ? exportsField : null;
  }
  const keys = Object.keys(exportsField);
  const isSubpathMap = keys.some((key) => key === "." || key.startsWith("./"));
  if (!isSubpathMap) {
    return subpath === "." ? pickBrowserTarget(exportsField) : null;
  }
  if (exportsField[subpath] !== undefined) {
    return pickBrowserTarget(exportsField[subpath]);
  }
  for (const key of keys) {
    if (!key.includes("*")) continue;
    const [prefix, suffix] = key.split("*");
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const star = subpath.slice(prefix.length, subpath.length - suffix.length);
    const target = pickBrowserTarget(exportsField[key]);
    if (target) return target.replace("*", star);
  }
  return null;
}

/**
 * Resolve a bare specifier the way a browser bundler resolves it: package
 * `exports` under the `browser` condition first, then the `browser` field, then
 * `module`/`main`. This is the half the previous guard skipped as "the
 * bundler's problem" — and skipping it is why a dependency's `node:sqlite`
 * could ride into a browser bundle unchallenged.
 */
function resolveBare(fromFile, specifier) {
  const scoped = specifier.startsWith("@");
  const parts = specifier.split("/");
  const packageName = scoped ? parts.slice(0, 2).join("/") : parts[0];
  const subpath = `.${specifier.slice(packageName.length)}` === "." ? "." : `.${specifier.slice(packageName.length)}`;
  const packageDir = findPackageDir(fromFile, packageName);
  if (!packageDir) return null;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
  } catch {
    return null;
  }

  const fromExports = matchExportsSubpath(manifest.exports, subpath);
  if (fromExports) return existingFile(path.join(packageDir, fromExports));

  if (subpath !== ".") return existingFile(path.join(packageDir, subpath));

  const browserField = manifest.browser;
  if (typeof browserField === "string") {
    return existingFile(path.join(packageDir, browserField));
  }
  const main = manifest.module ?? manifest.main ?? "index.js";
  return existingFile(path.join(packageDir, main));
}

test("no browser-facing export subpath can reach a Node builtin", () => {
  const offenders = [];

  for (const subpath of BROWSER_FACING_SUBPATHS) {
    const entry = resolveSubpath(subpath);
    const seen = new Set();
    const previous = new Map();
    const queue = [entry];

    while (queue.length > 0) {
      const file = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);

      let source;
      try {
        source = readFileSync(file, "utf8");
      } catch {
        continue;
      }

      for (const specifier of specifiersOf(source)) {
        if (BUILTIN_NAMES.has(specifier)) {
          const chain = [];
          let cursor = file;
          while (cursor) {
            chain.unshift(path.relative(PACKAGE_ROOT, cursor));
            cursor = previous.get(cursor);
          }
          offenders.push(`${subpath} -> ${specifier}\n    via ${chain.join("\n     -> ")}`);
          continue;
        }
        const resolved = specifier.startsWith(".")
          ? resolveRelative(file, specifier)
          : resolveBare(file, specifier);
        if (!resolved || seen.has(resolved)) continue;
        previous.set(resolved, file);
        queue.push(resolved);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `browser-facing subpaths reach Node builtins:\n\n${offenders.join("\n\n")}\n`,
  );
});

test("no browser-facing subpath resolves into src/testing", () => {
  // `src/testing/**` is HARNESS surface: it may (and does) spawn WasmEdge,
  // shell out and open files. The only thing that keeps it out of a browser
  // bundle is that nothing browser-facing points at it. `./testing/browser` is
  // the one deliberate exception — it is a pure re-export shim of the runtime
  // host surfaces, kept for consumers still pointed at the old name.
  const offenders = [];

  for (const subpath of BROWSER_FACING_SUBPATHS) {
    const entry = resolveSubpath(subpath);
    const seen = new Set();
    const queue = [entry];
    const testingRoot = path.join(PACKAGE_ROOT, "src", "testing") + path.sep;

    while (queue.length > 0) {
      const file = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);

      if (file.startsWith(testingRoot) && path.basename(file) !== "browser.js") {
        offenders.push(`${subpath} -> ${path.relative(PACKAGE_ROOT, file)}`);
      }

      let source;
      try {
        source = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const specifier of specifiersOf(source)) {
        if (!specifier.startsWith(".")) continue;
        const resolved = resolveRelative(file, specifier);
        if (resolved && !seen.has(resolved)) queue.push(resolved);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `browser-facing subpaths reach src/testing harness code:\n  ${offenders.join("\n  ")}\n`,
  );
});
