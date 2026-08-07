// The SDK's browser-facing export subpaths must not reach a Node builtin.
//
// A browser bundler resolves imports STATICALLY, including dynamic
// `import("node:...")` inside a branch that can never run in a browser. One
// leaked import fails the whole consumer bundle -- which is how a module-sdk
// pin bump broke `sdn-js`'s browser build: `./runtime-host` reached the
// manifest barrel (`node:fs`, `node:path`) through a relative import that
// bypassed the package's `browser` export condition, and `./testing/browser`
// -- the subpath whose entire purpose is the browser -- reached
// `node:worker_threads`.
//
// This walks the real import graph from each browser-facing entry and fails on
// any Node builtin it can reach. "Works in Node" is not a defence for a
// subpath a browser consumes.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));

// Export subpaths a browser bundle legitimately consumes. Adding a browser
// consumer surface means adding it here; this list is the contract.
const BROWSER_FACING_SUBPATHS = [
  ".", // resolves through the `browser` condition
  "./manifest", // ditto
  "./licensing",
  "./runtime-host",
  "./invoke",
  "./runtime",
  "./transport",
  "./host/browser",
  "./host/timer-driver",
  "./host/browser-edge-shims",
  "./host/wasi-shim",
  "./host/isomorphic",
  "./testing/browser",
  "./testing/module-flatbuffer-stream-pump",
  "./utils/wasm-crypto",
  "./capabilities",
  "./standards",
  "./compat",
];

// KNOWN LEAKS, 2026-08-07, filed as `module-sdk-browser-entry-node-builtins`.
// These PREDATE this guard: `src/browser.js` -- the target of the package's own
// `browser` export condition -- reaches `src/host/isomorphicLoader.js`, which
// imports node:fs/promises, node:child_process, node:os, node:path,
// node:process, node:buffer and node:worker_threads; `./standards` reads its
// catalog off disk. They are listed, not silently skipped: a browser consumer
// that bundles any of them still fails, and the list only ever shrinks.
const KNOWN_LEAKING_SUBPATHS = new Set([".", "./host/isomorphic", "./standards"]);

const BUILTIN_NAMES = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

function resolveSubpath(subpath) {
  const { exports } = JSON.parse(
    readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
  );
  const entry = exports[subpath];
  assert.ok(entry, `package.json exports has no ${subpath}`);
  const target = typeof entry === "string" ? entry : (entry.browser ?? entry.default);
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

function resolveRelative(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, path.join(base, "index.js")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

test("no browser-facing export subpath can reach a Node builtin", () => {
  const offenders = [];
  const stillLeaking = new Set();

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
          if (KNOWN_LEAKING_SUBPATHS.has(subpath)) {
            stillLeaking.add(subpath);
            continue;
          }
          const chain = [];
          let cursor = file;
          while (cursor) {
            chain.unshift(path.relative(PACKAGE_ROOT, cursor));
            cursor = previous.get(cursor);
          }
          offenders.push(`${subpath} -> ${specifier}\n    via ${chain.join("\n     -> ")}`);
          continue;
        }
        if (!specifier.startsWith(".")) continue; // node_modules: bundler's problem
        const resolved = resolveRelative(file, specifier);
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

  // The exception list must shrink, never rot: a subpath that stopped leaking
  // has to leave it, or the guard quietly stops covering that subpath.
  assert.deepEqual(
    [...KNOWN_LEAKING_SUBPATHS].filter((subpath) => !stillLeaking.has(subpath)),
    [],
    "a KNOWN_LEAKING_SUBPATHS entry no longer leaks — remove it and let the guard cover it",
  );
});
