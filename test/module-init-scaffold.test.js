/**
 * `space-data-module init` — scaffolds a new SDN WASM module skeleton from
 * templates/<family>-module/.
 *
 * These tests exercise the scaffold engine directly (fast, in-process) AND
 * the CLI surface end to end (spawns bin/space-data-module.js), per the
 * repo's `Follow the existing style of runCheck/runCompile` guidance for new
 * verbs. They do NOT attempt to compile the scaffolded module to wasm — that
 * requires the wasm32-wasip1-threads toolchain, which is not guaranteed to
 * be installed everywhere `npm test` runs. (It WAS verified manually against
 * the real toolchain while building this template: `npm run build` in a
 * scaffolded output directory produces a `dist/isomorphic/module.wasm` that
 * passes the SDK's own pthread-artifact guard and compliance validator, and
 * `npm test` there passes against the built artifact.)
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { validateManifestWithStandards } from "../src/compliance/index.js";
import {
  listScaffoldFamilies,
  scaffoldModule,
  ScaffoldFamilyTemplateError,
} from "../src/scaffold/index.js";
import { UnknownPluginFamilyError } from "../src/manifest/normalize.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "bin", "space-data-module.js");

const TOKEN_LEFTOVER_PATTERN = /__[A-Z0-9_]+__/;

async function makeTempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

/** Recursively collect { relativePath, isFile } for every entry under root. */
async function walk(root, base = root, out = []) {
  const entries = await readdir(base, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) {
      await walk(root, full, out);
    } else if (entry.isFile()) {
      out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return out;
}

/** Assert NO `__TOKEN__`-shaped text survives in any file NAME or CONTENT. */
async function assertNoLeftoverTokens(root) {
  const files = await walk(root);
  for (const relativePath of files) {
    assert.doesNotMatch(
      relativePath,
      TOKEN_LEFTOVER_PATTERN,
      `file name still carries a token: ${relativePath}`,
    );
    const contents = await readFile(path.join(root, relativePath), "utf8");
    assert.doesNotMatch(
      contents,
      TOKEN_LEFTOVER_PATTERN,
      `${relativePath} still contains an unsubstituted token`,
    );
  }
  return files;
}

test("templates/propagator-module is the one family with a shipped init template", () => {
  assert.deepEqual(listScaffoldFamilies(), ["propagator"]);
});

test("init --family propagator --name <name> scaffolds a complete, token-clean tree", async () => {
  const outDir = await makeTempDir("scaffold-propagator-");
  const result = await scaffoldModule({
    family: "propagator",
    name: "foo-bar",
    outDir,
  });

  assert.equal(result.ok, true);
  assert.equal(result.family, "propagator");
  assert.equal(result.name, "foo-bar");
  // Documented default: com.orbpro.<name-with-dashes-as-dots>.
  assert.equal(result.pluginId, "com.orbpro.foo.bar");
  assert.equal(result.outDir, outDir);

  assert.deepEqual(result.files, [...result.files].sort(), "files list is sorted");
  for (const expected of [
    "README.md",
    "build.js",
    "package.json",
    "plugin-manifest.json",
    "src/foo_bar.cpp", // __MODULE_NAME_SNAKE__ in the file NAME
    "tests/module.build.test.mjs",
  ]) {
    assert.ok(result.files.includes(expected), `missing ${expected} in ${JSON.stringify(result.files)}`);
  }

  const filesOnDisk = await assertNoLeftoverTokens(outDir);
  assert.deepEqual([...filesOnDisk].sort(), [...result.files].sort());

  // Tokens actually landed with the RIGHT values, not just "no __ left".
  const manifest = JSON.parse(
    await readFile(path.join(outDir, "plugin-manifest.json"), "utf8"),
  );
  assert.equal(manifest.pluginId, "com.orbpro.foo.bar");
  assert.equal(manifest.pluginFamily, "propagator");
  assert.equal(manifest.buildArtifacts?.[0]?.path, "dist/isomorphic/module.wasm");
  // The reference propagator this template is derived from is
  // wasi-sequential (sharding belongs to the host, not the module) —
  // resolveThreadModel does not read manifest.threadModel on its own, so
  // build.js must pass it explicitly; this pins the manifest side of that.
  assert.equal(manifest.threadModel, "wasi-sequential");
  assert.equal(manifest.sequentialJustification?.kind, "caller-level-parallelism");
  assert.ok((manifest.sequentialJustification?.detail ?? "").length >= 40);

  const buildJs = await readFile(path.join(outDir, "build.js"), "utf8");
  assert.match(buildJs, /threadModel:\s*manifest\.threadModel/);

  const cpp = await readFile(path.join(outDir, "src", "foo_bar.cpp"), "utf8");
  assert.match(cpp, /TODO: your propagation goes here/);
  assert.match(cpp, /orbpro_state_init/);
  assert.match(cpp, /orbpro_state_set_reference_frame/);
  // plugin_propagate_batch must be a plain sequential loop, not its own
  // thread pool — see the SHARD-WRITE DISCIPLINE comment on that export.
  // (The prose comments legitimately name std::thread as an example of what
  // NOT to reach for here, so check for the actual include, not the string.)
  assert.doesNotMatch(cpp, /#include\s*<thread>/);
  assert.doesNotMatch(cpp, /#include\s*<atomic>/);

  const pkg = JSON.parse(await readFile(path.join(outDir, "package.json"), "utf8"));
  assert.equal(pkg.name, "space-data-network-module-propagator-foo-bar");

  const readme = await readFile(path.join(outDir, "README.md"), "utf8");
  // Naming table resolved every spelling correctly: __MODULE_NAME_CAMEL__ of
  // "foo-bar" is "fooBar" — check the ACTUAL resolved value, not just that
  // the (unsubstituted) "camelCase" label text survived.
  assert.match(readme, /`fooBar`/);
  assert.match(readme, /`foo_bar`/);
  assert.match(readme, /`com\.orbpro\.foo\.bar`/);
  assert.match(readme, /foo-bar/);
});

test("a --plugin-id override wins over the com.orbpro.<name> default", async () => {
  const outDir = await makeTempDir("scaffold-pluginid-");
  const result = await scaffoldModule({
    family: "propagator",
    name: "custom-id-mod",
    pluginId: "org.example.custom",
    outDir,
  });
  assert.equal(result.pluginId, "org.example.custom");
  const manifest = JSON.parse(
    await readFile(path.join(outDir, "plugin-manifest.json"), "utf8"),
  );
  assert.equal(manifest.pluginId, "org.example.custom");
});

test("the generated manifest passes the SDK's own manifest validator", async () => {
  // Cheap and local: validateManifestWithStandards reads spacedatastandards.org's
  // pinned dist/manifest.json off disk (a normal dependency of this repo) — no
  // network access and no heavy fixtures required, so we wire it directly
  // rather than only asserting structurally.
  const outDir = await makeTempDir("scaffold-validate-");
  await scaffoldModule({ family: "propagator", name: "validated-mod", outDir });
  const manifest = JSON.parse(
    await readFile(path.join(outDir, "plugin-manifest.json"), "utf8"),
  );
  const report = await validateManifestWithStandards(manifest, {
    sourceName: "scaffolded plugin-manifest.json",
  });
  assert.equal(report.ok, true, JSON.stringify(report.issues, null, 2));
});

test("an unknown --family (not even a real plugin family) fails loudly", async () => {
  const outDir = await makeTempDir("scaffold-unknown-family-");
  await assert.rejects(
    scaffoldModule({ family: "not-a-real-family", name: "x", outDir }),
    (error) => {
      assert.ok(error instanceof UnknownPluginFamilyError);
      assert.match(error.message, /not-a-real-family/);
      // Names the whole vocabulary, not just "invalid".
      assert.match(error.message, /propagator/);
      assert.match(error.message, /sensor/);
      return true;
    },
  );
});

test("a real plugin family with no init template fails loudly and lists what DOES have one", async () => {
  const outDir = await makeTempDir("scaffold-no-template-");
  await assert.rejects(
    scaffoldModule({ family: "sensor", name: "x", outDir }),
    (error) => {
      assert.ok(error instanceof ScaffoldFamilyTemplateError);
      assert.equal(error.value, "sensor");
      assert.deepEqual(error.availableFamilies, ["propagator"]);
      assert.match(error.message, /sensor/);
      assert.match(error.message, /propagator/);
      return true;
    },
  );
});

test("refuses to scaffold into a non-empty directory without --force", async () => {
  const outDir = await makeTempDir("scaffold-nonempty-");
  await writeFile(path.join(outDir, "keep-me.txt"), "pre-existing\n", "utf8");

  await assert.rejects(
    scaffoldModule({ family: "propagator", name: "blocked-mod", outDir }),
    /non-empty|--force/,
  );
  // Refusal must not have written anything (partial-scaffold is worse than none).
  const entriesAfterRefusal = await readdir(outDir);
  assert.deepEqual(entriesAfterRefusal, ["keep-me.txt"]);

  const result = await scaffoldModule({
    family: "propagator",
    name: "blocked-mod",
    outDir,
    force: true,
  });
  assert.equal(result.ok, true);
  const entriesAfterForce = await readdir(outDir);
  assert.ok(entriesAfterForce.includes("keep-me.txt"), "force must not delete unrelated files");
  assert.ok(entriesAfterForce.includes("plugin-manifest.json"));
});

test("CLI: init writes the scaffold and --json reports the same shape as the API", async () => {
  const outDir = await makeTempDir("scaffold-cli-");
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "init",
    "--family",
    "propagator",
    "--name",
    "cli-demo",
    "--out",
    outDir,
    "--json",
  ]);
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.name, "cli-demo");
  assert.equal(result.pluginId, "com.orbpro.cli.demo");
  await assertNoLeftoverTokens(outDir);
});

test("CLI: an unknown --family exits non-zero and names the offender", async () => {
  const outDir = await makeTempDir("scaffold-cli-bad-family-");
  await assert.rejects(
    execFileAsync(process.execPath, [
      cliPath,
      "init",
      "--family",
      "bogus-family",
      "--name",
      "x",
      "--out",
      outDir,
    ]),
    (error) => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /bogus-family/);
      assert.match(error.stderr, /propagator/);
      return true;
    },
  );
});

test("CLI: an unrecognized flag still errors (init did not weaken parseArgs)", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [cliPath, "init", "--totally-not-a-flag"]),
    (error) => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /Unknown argument/);
      return true;
    },
  );
});

test("CLI: help lists the init verb", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "help"]);
  assert.match(stdout, /space-data-module init --family propagator --name/);
});
