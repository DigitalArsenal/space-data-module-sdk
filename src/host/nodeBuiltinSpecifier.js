/**
 * Opaque Node builtin specifiers for isomorphic host shims.
 *
 * A host shim that serves BOTH runtimes needs a Node-only branch that is dead
 * in a browser. Writing that branch as a literal `import("node:worker_threads")`
 * does not work: esbuild/vite/rollup resolve dynamic imports STATICALLY, so a
 * branch that can never run still fails — or, worse, is emitted as an external
 * `node:` specifier that the browser then tries to FETCH, which is how the
 * whole OrbPro gallery went dark (`orbpro-engine-bundle-ships-node-builtins`).
 *
 * Assembling the specifier at runtime keeps it opaque to the bundler. This is
 * host-shim code absorbing a runtime difference, which is the only place the
 * tri-runtime contract allows a difference to be absorbed; no guest module ever
 * gains a runtime check.
 *
 * Use it ONLY behind a runtime check that is false in a browser, and only in
 * `src/host/**` — a module that needs a Node builtin unconditionally belongs on
 * a Node-only subpath instead.
 */

// Split so no bundler's `node:`-prefix scanner sees a literal here either.
const NODE_BUILTIN_PREFIX = "no" + "de:";

/**
 * @param {string} name - builtin name without the `node:` prefix
 * @returns {string} the specifier, assembled at runtime
 */
export function nodeBuiltinSpecifier(name) {
  return NODE_BUILTIN_PREFIX + name;
}

/**
 * Import a Node builtin from an isomorphic host shim.
 *
 * @param {string} name - builtin name without the `node:` prefix
 * @returns {Promise<any>} the builtin's module namespace
 */
export async function importNodeBuiltin(name) {
  const specifier = nodeBuiltinSpecifier(name);
  return import(/* @vite-ignore */ /* webpackIgnore: true */ specifier);
}

export { NODE_BUILTIN_PREFIX };
