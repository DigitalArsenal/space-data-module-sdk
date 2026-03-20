import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";

import {
  cleanupCompilation,
  compileModuleFromSource,
  decodePluginInvokeResponse,
  generateManifestHarnessPlan,
  materializeHarnessScenario,
} from "../src/index.js";
import { compileStandaloneWasiC } from "./support/runtime-matrix/compile.js";
import {
  createRuntimeFixtureManifest,
  PLUGIN_RUNTIME_FIXTURE_SOURCE,
  PURE_WASI_FIXTURE_SOURCE,
} from "./support/runtime-matrix/fixtures.js";

const execFileAsync = promisify(execFile);

const ENABLED = process.env.SPACE_DATA_MODULE_SDK_ENABLE_RUNTIME_MATRIX === "1";

function runtimeMatrixTest(name, fn) {
  return ENABLED ? test(name, fn) : test.skip(name, fn);
}

async function ensurePythonWasmtime() {
  const targetDir = path.join(os.tmpdir(), "space-data-module-sdk-python-wasmtime");
  const sentinel = path.join(targetDir, ".ready");
  try {
    await fs.access(sentinel);
    return targetDir;
  } catch {}

  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
  await execFileAsync("python3", [
    "-m",
    "pip",
    "install",
    "--target",
    targetDir,
    "wasmtime",
  ]);
  await fs.writeFile(sentinel, "ready\n", "utf8");
  return targetDir;
}

async function writeSpec(tempRoot, name, spec) {
  const specPath = path.join(tempRoot, `${name}.json`);
  await fs.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
  return specPath;
}

async function spawnJson(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code !== 0) {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(
          new Error(
            `Failed to parse JSON from ${command} ${args.join(" ")}\nstdout:\n${stdout}\nstderr:\n${stderr}\n${error.message}`,
          ),
        );
      }
    });
  });
}

function decodeText(base64) {
  return Buffer.from(base64 ?? "", "base64").toString("utf8");
}

function toBase64Bytes(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function languageDefinitions(pythonPath) {
  return [
    {
      id: "node",
      mode: "native",
      command: "node",
      args: ["test/runtime-matrix/node-runner.mjs"],
      env: {},
    },
    {
      id: "python",
      mode: "native",
      command: "python3",
      args: ["test/runtime-matrix/python-runner.py"],
      env: {
        PYTHONPATH: pythonPath,
      },
    },
    {
      id: "go",
      mode: "native",
      command: "go",
      args: ["run", "."],
      cwd: path.resolve("test/runtime-matrix/go-runner"),
      env: {
        GOCACHE: path.join(os.tmpdir(), "space-data-module-sdk-go-cache"),
        GOPATH: path.join(os.tmpdir(), "space-data-module-sdk-go-path"),
        GOMODCACHE: path.join(os.tmpdir(), "space-data-module-sdk-go-modcache"),
      },
    },
    {
      id: "rust",
      mode: "fallback-node",
      command: "rustc",
      args: [
        "test/runtime-matrix/rust-runner.rs",
        "-O",
        "-o",
        path.join(os.tmpdir(), "space-data-module-sdk-rust-runner"),
      ],
      compileOnly: true,
    },
    {
      id: "java",
      mode: "fallback-node",
      command: "java",
      args: ["test/runtime-matrix/java-runner.java"],
      env: {},
    },
    {
      id: "swift",
      mode: "fallback-node",
      command: "swift",
      args: ["test/runtime-matrix/swift-runner.swift"],
      env: {},
    },
    {
      id: "csharp",
      mode: "fallback-node",
      command: "dotnet",
      args: ["run", "--project", "test/runtime-matrix/csharp-runner"],
      env: {},
    },
  ];
}

async function prepareLanguageRunners() {
  const pythonPath = await ensurePythonWasmtime();
  const definitions = languageDefinitions(pythonPath);

  const prepared = [];
  for (const definition of definitions) {
    if (definition.id === "rust") {
      await execFileAsync(definition.command, definition.args, {
        cwd: process.cwd(),
        env: process.env,
      });
      prepared.push({
        id: definition.id,
        mode: definition.mode,
        command: path.join(os.tmpdir(), "space-data-module-sdk-rust-runner"),
        args: [],
        env: {},
      });
      continue;
    }
    prepared.push(definition);
  }
  return prepared;
}

runtimeMatrixTest("runtime matrix executes WASI smoke cases across supported flatbuffers languages", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "space-data-module-sdk-runtime-matrix-"),
  );
  const preopenHostDir = path.join(tempRoot, "preopen");
  const guestMountPath = ".";
  const guestFilePath = "input.txt";
  await fs.mkdir(preopenHostDir, { recursive: true });
  await fs.writeFile(path.join(preopenHostDir, "input.txt"), "from-preopen", "utf8");

  const pureWasmPath = path.join(tempRoot, "pure-wasi.wasm");
  await fs.writeFile(pureWasmPath, await compileStandaloneWasiC({
    sourceCode: PURE_WASI_FIXTURE_SOURCE,
  }));

  const manifest = createRuntimeFixtureManifest();
  const compilation = await compileModuleFromSource({
    manifest,
    sourceCode: PLUGIN_RUNTIME_FIXTURE_SOURCE,
    language: "c",
  });
  const pluginWasmPath = path.join(tempRoot, "plugin-runtime.wasm");
  await fs.writeFile(pluginWasmPath, compilation.wasmBytes);

  try {
    const pythonPath = await ensurePythonWasmtime();
    const languages = await prepareLanguageRunners();
    assert.ok(pythonPath.includes("space-data-module-sdk-python-wasmtime"));

    const pureSpecPath = await writeSpec(tempRoot, "pure-wasi", {
      wasmPath: pureWasmPath,
      stdinBase64: Buffer.from("hello-stdin").toString("base64"),
      args: ["pure-wasi", "arg-value"],
      env: {
        HARNESS_ENV: "env-value",
        HARNESS_FILE: guestFilePath,
      },
      preopens: [
        {
          hostPath: preopenHostDir,
          guestPath: guestMountPath,
        },
      ],
    });

    const plan = generateManifestHarnessPlan({
      manifest,
      scenarios: [
        {
          id: "command:env_file_probe",
          kind: "invoke",
          surface: "command",
          methodId: "env_file_probe",
          inputs: [],
          expectedStatusCode: 0,
        },
      ],
      payloadForPort({ methodId }) {
        if (methodId === "echo") {
          return new TextEncoder().encode("aligned-payload!");
        }
        return null;
      },
    });

    const echoScenario = materializeHarnessScenario(
      plan.scenarios.find((scenario) => scenario.id === "command:echo"),
    );
    const envFileScenario = materializeHarnessScenario(
      plan.scenarios.find((scenario) => scenario.id === "command:env_file_probe"),
    );
    const stderrScenario = materializeHarnessScenario(
      plan.scenarios.find((scenario) => scenario.id === "command:stderr_probe"),
    );

    const echoSpecPath = await writeSpec(tempRoot, "plugin-echo", {
      wasmPath: pluginWasmPath,
      stdinBase64: toBase64Bytes(echoScenario.stdinBytes),
      args: ["plugin-runtime"],
      env: {
        HARNESS_ENV: "env-value",
        HARNESS_FILE: guestFilePath,
      },
      preopens: [
        {
          hostPath: preopenHostDir,
          guestPath: guestMountPath,
        },
      ],
    });

    const envFileSpecPath = await writeSpec(tempRoot, "plugin-env-file", {
      wasmPath: pluginWasmPath,
      stdinBase64: toBase64Bytes(envFileScenario.stdinBytes),
      args: ["plugin-runtime"],
      env: {
        HARNESS_ENV: "env-value",
        HARNESS_FILE: guestFilePath,
      },
      preopens: [
        {
          hostPath: preopenHostDir,
          guestPath: guestMountPath,
        },
      ],
    });

    const stderrSpecPath = await writeSpec(tempRoot, "plugin-stderr", {
      wasmPath: pluginWasmPath,
      stdinBase64: toBase64Bytes(stderrScenario.stdinBytes),
      args: ["plugin-runtime"],
      env: {
        HARNESS_ENV: "env-value",
        HARNESS_FILE: guestFilePath,
      },
      preopens: [
        {
          hostPath: preopenHostDir,
          guestPath: guestMountPath,
        },
      ],
    });

    for (const language of languages) {
      const pureResult = await spawnJson(
        language.command,
        [...(language.args ?? []), pureSpecPath],
        {
          cwd: language.cwd,
          env: language.env,
        },
      );
      assert.equal(pureResult.ok, true, `${language.id} pure WASI runner failed`);
      assert.equal(pureResult.exitCode, 0, `${language.id} pure WASI exit code`);
      const pureStdout = decodeText(pureResult.stdoutBase64);
      const pureStderr = decodeText(pureResult.stderrBase64);
      assert.match(pureStdout, /stdin=hello-stdin/, `${language.id} stdin`);
      assert.match(pureStdout, /env=env-value/, `${language.id} env`);
      assert.match(pureStdout, /arg=arg-value/, `${language.id} arg`);
      assert.match(pureStdout, /file=.*/, `${language.id} preopen file smoke`);
      assert.match(pureStdout, /time_ok=1/, `${language.id} clock/time`);
      assert.match(pureStderr, /stderr=env-value/, `${language.id} stderr`);

      const echoResult = await spawnJson(
        language.command,
        [...(language.args ?? []), echoSpecPath],
        {
          cwd: language.cwd,
          env: language.env,
        },
      );
      const echoResponse = decodePluginInvokeResponse(
        new Uint8Array(Buffer.from(echoResult.stdoutBase64, "base64")),
      );
      assert.equal(echoResponse.statusCode, 0, `${language.id} command echo status`);
      assert.equal(
        new TextDecoder().decode(echoResponse.outputs[0].payload),
        "aligned-payload!",
        `${language.id} command echo payload`,
      );
      assert.equal(
        echoResponse.outputs[0].typeRef?.wireFormat,
        "aligned-binary",
        `${language.id} command echo wire format`,
      );
      assert.equal(
        echoResponse.outputs[0].typeRef?.rootTypeName,
        "AlignedEcho",
        `${language.id} command echo root type`,
      );
      assert.equal(
        echoResponse.outputs[0].typeRef?.byteLength,
        16,
        `${language.id} command echo byte length`,
      );
      assert.equal(
        echoResponse.outputs[0].typeRef?.requiredAlignment,
        8,
        `${language.id} command echo required alignment`,
      );

      const envFileResult = await spawnJson(
        language.command,
        [...(language.args ?? []), envFileSpecPath],
        {
          cwd: language.cwd,
          env: language.env,
        },
      );
      const envFileResponse = decodePluginInvokeResponse(
        new Uint8Array(Buffer.from(envFileResult.stdoutBase64, "base64")),
      );
      assert.equal(envFileResponse.statusCode, 0, `${language.id} env file status`);
      assert.match(
        new TextDecoder().decode(envFileResponse.outputs[0].payload),
        /^env=env-value;file=.*$/,
        `${language.id} env file payload`,
      );
      assert.match(
        decodeText(envFileResult.stderrBase64),
        /stderr:env_file_probe:env-value/,
        `${language.id} plugin stderr`,
      );

      const stderrResult = await spawnJson(
        language.command,
        [...(language.args ?? []), stderrSpecPath],
        {
          cwd: language.cwd,
          env: language.env,
        },
      );
      const stderrResponse = decodePluginInvokeResponse(
        new Uint8Array(Buffer.from(stderrResult.stdoutBase64, "base64")),
      );
      assert.equal(stderrResponse.statusCode, 0, `${language.id} stderr status`);
      assert.equal(
        new TextDecoder().decode(stderrResponse.outputs[0].payload),
        "stderr-ok",
        `${language.id} stderr payload`,
      );
      assert.match(
        decodeText(stderrResult.stderrBase64),
        /stderr:explicit/,
        `${language.id} stderr side channel`,
      );
    }
  } finally {
    await cleanupCompilation(compilation);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
