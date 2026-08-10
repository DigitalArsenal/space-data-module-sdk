/**
 * Build __MODULE_NAME__ through the SDK compiler lane.
 *
 * `compileModuleFromSource` takes ONE translation unit, so the generated
 * OrbPro propagator ABI header is INLINED into the source before compiling.
 * That inlining is mechanical and one-directional: the header is read from
 * the pinned `space-data-module-sdk` package, never copied into this repo.
 * If the SDK's ABI changes, this build picks it up on the next `npm run
 * build` — do not hand-vendor a copy of the header beside this file.
 *
 * Thread model: the manifest declares `threadModel: "wasi-sequential"` (see
 * plugin-manifest.json's `sequentialJustification`) — this module never
 * spawns a thread, which is the strong default for a propagator (sharding a
 * batch belongs to the HOST, not the module; see docs/propagator-abi.md
 * "Threading"). Both `wasi-sequential` and the threaded `emscripten-pthreads`
 * model compile through the SAME clang `wasm32-wasip1-threads` toolchain —
 * never `emcc -pthread`, which is browser-only and cannot thread under
 * WasmEdge — they differ only in which link-time contract the SDK's
 * post-link artifact guard then validates against the emitted wasm.
 */

import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileModuleFromSource } from "space-data-module-sdk/compiler";

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL(".", import.meta.url));
const manifestPath = path.join(packageRoot, "plugin-manifest.json");
const sourcePath = path.join(packageRoot, "src", "__MODULE_NAME_SNAKE__.cpp");
const distRoot = path.join(packageRoot, "dist");
const outputPath = path.join(distRoot, "isomorphic", "module.wasm");

const standardsRoot = path.dirname(
  require.resolve("spacedatastandards.org/package.json"),
);
process.env.SPACE_DATA_STANDARDS_ROOT ??= `${standardsRoot}${path.sep}`;

/** The ONE source of the ABI, resolved from the pinned SDK package. */
const abiHeaderPath = require.resolve(
  "space-data-module-sdk/include/orbpro/orbpro_propagator_abi.h",
);

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const abiHeader = await fs.readFile(abiHeaderPath, "utf8");
const rawSource = await fs.readFile(sourcePath, "utf8");

const INCLUDE_LINE = '#include "orbpro/orbpro_propagator_abi.h"';
if (!rawSource.includes(INCLUDE_LINE)) {
  throw new Error(
    `${path.relative(packageRoot, sourcePath)} no longer includes the generated ABI header. ` +
      `A propagator module must build against the ONE generated ABI, not a local copy.`,
  );
}

const sourceCode = rawSource.replace(
  INCLUDE_LINE,
  [
    `// --- BEGIN INLINED ${path.basename(abiHeaderPath)} (from ${manifest.pluginId}'s pinned SDK) ---`,
    abiHeader,
    `// --- END INLINED ${path.basename(abiHeaderPath)} ---`,
  ].join("\n"),
);

await fs.rm(distRoot, { recursive: true, force: true });
await fs.mkdir(path.dirname(outputPath), { recursive: true });

const compilation = await compileModuleFromSource({
  manifest,
  sourceCode,
  language: "c++",
  outputPath,
  // PASSED EXPLICITLY ON PURPOSE. `resolveThreadModel` reads the compile
  // OPTION, not `manifest.threadModel`, and otherwise infers the model from
  // `runtimeTargets` — where "wasmedge" infers pthreads. A manifest that
  // declares `wasi-sequential` and does not pass it here would be silently
  // compiled under the OTHER model and then rejected by the post-link
  // artifact guard for not spawning a thread it never claimed to spawn.
  // Filed as `sdk-manifest-threadmodel-silently-ignored`; keep this explicit
  // until that lands.
  threadModel: manifest.threadModel,
});

if (compilation.threadModel !== manifest.threadModel) {
  throw new Error(
    `threadModel drift: the manifest declares ${manifest.threadModel} but the ` +
      `compiler resolved ${compilation.threadModel}.`,
  );
}

await fs.copyFile(manifestPath, path.join(distRoot, "plugin-manifest.json"));

if (!compilation.report?.ok) {
  const issues = JSON.stringify(compilation.report?.issues ?? [], null, 2);
  throw new Error(`Compiled __MODULE_NAME__ artifact failed SDK validation:\n${issues}`);
}

console.log(
  `Built ${path.relative(packageRoot, outputPath)} ` +
    `(${compilation.compiler}, threadModel=${compilation.threadModel})`,
);
