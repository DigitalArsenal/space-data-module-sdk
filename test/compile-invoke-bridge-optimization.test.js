// The emcc single-thread lane compiles three objects: the module source, the
// embedded manifest and the generated invoke bridge. The bridge copies every
// request and response payload (std::vector inserts), so an unoptimized
// bridge costs hundreds of interpreted wasm instructions per payload byte in
// every emcc module. These tests hold the bridge and the manifest objects to
// the module source's own optimization flags, and bound the per-byte cost of
// a payload round trip under the WasmEdge interpreter.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { cleanupCompilation, compileModuleFromSource } from "../src/index.js";
import { loadEmception } from "../src/compiler/emceptionNode.js";
import { resolveWasmEdgeBinary } from "../src/testing/index.js";
import { splitWasmEdgeDiagnostics } from "../src/testing/wasmedgeOutput.js";

const ATM_TYPE = Object.freeze({
  schemaName: "ATM.fbs",
  fileIdentifier: "$ATM",
  rootTypeName: "ATM",
  wireFormat: "flatbuffer",
});

function createPort(portId, required) {
  return {
    portId,
    acceptedTypeSets: [{ setId: `${portId}-atm`, allowedTypes: [{ ...ATM_TYPE }] }],
    minStreams: required ? 1 : 0,
    maxStreams: 1,
    required,
  };
}

const ECHO_MANIFEST = Object.freeze({
  pluginId: "com.digitalarsenal.examples.invoke-bridge-optimization",
  name: "Invoke Bridge Optimization Fixture",
  version: "0.1.0",
  pluginFamily: "analysis",
  capabilities: [],
  externalInterfaces: [],
  invokeSurfaces: ["command"],
  methods: [
    {
      methodId: "echo",
      displayName: "echo",
      inputPorts: [createPort("echo", true)],
      outputPorts: [createPort("echo", false)],
      maxBatch: 1,
      drainPolicy: "single-shot",
    },
  ],
});

const ECHO_SOURCE = `#include <stdint.h>
#include "space_data_module_invoke.h"

int echo(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) {
    plugin_set_error("missing-frame", "No input frame was provided.");
    return 3;
  }
  plugin_push_output(
    "echo",
    frame->schema_name,
    frame->file_identifier,
    frame->payload,
    frame->payload_length
  );
  return 0;
}
`;

// Measured on the echo fixture under WasmEdge 0.16.4 (interpreter), per byte
// of payload that enters on stdin and leaves on stdout: about 878 wasm
// instructions with the bridge at -O0, about 2 with it at -O3.
const MAX_INSTRUCTIONS_PER_PAYLOAD_BYTE = 16;
const SMALL_PAYLOAD_BYTES = 64 * 1024;
const LARGE_PAYLOAD_BYTES = 256 * 1024;

let compilation = null;
let compileCommands = [];

before(async () => {
  // The emception lane runs every compile step through one shared instance;
  // record the command lines it is handed for this compilation.
  const emception = await loadEmception();
  const run = emception.run;
  const recorded = [];
  emception.run = function recordingRun(command, ...rest) {
    recorded.push(String(command));
    return run.call(this, command, ...rest);
  };
  try {
    compilation = await compileModuleFromSource({
      manifest: ECHO_MANIFEST,
      sourceCode: ECHO_SOURCE,
      language: "c",
    });
  } finally {
    emception.run = run;
  }
  compileCommands = recorded.map((command) => command.trim().split(/\s+/));
});

after(async () => {
  if (compilation) {
    await cleanupCompilation(compilation);
  }
});

function findObjectCompile(sourceBasename) {
  const matches = compileCommands.filter(
    (tokens) =>
      tokens.includes("-c") &&
      tokens.some((token) => path.posix.basename(token) === sourceBasename),
  );
  assert.ok(matches.length > 0, `no object compile of ${sourceBasename} was issued`);
  return matches;
}

// Flags that decide how the object is optimized: -O<level>, -m<feature> and
// NDEBUG. Include paths, output paths and symbol renames are not compared.
function optimizationFlags(tokens) {
  return tokens
    .filter((token) => /^-O/.test(token) || /^-m/.test(token) || token === "-DNDEBUG")
    .sort();
}

test("the emcc lane compiles the invoke bridge and the embedded manifest with the module source's optimization flags", () => {
  assert.equal(compilation.compiler, "em++ (emception)");
  const [sourceCompile] = findObjectCompile("module.c");
  const expected = optimizationFlags(sourceCompile);
  assert.ok(
    expected.some((flag) => /^-O[1-3sz]$/.test(flag)),
    `the module source is compiled with an optimization level (${sourceCompile.join(" ")})`,
  );
  for (const generated of ["plugin-invoke-bridge.cpp", "plugin-manifest-exports.cpp"]) {
    for (const tokens of findObjectCompile(generated)) {
      assert.deepEqual(optimizationFlags(tokens), expected, `${generated}: ${tokens.join(" ")}`);
    }
  }
});

function wasmedgeAvailable(binary) {
  const probe = spawnSync(binary, ["--version"], { encoding: "utf8" });
  return !probe.error && probe.status === 0;
}

function countEchoInstructions(binary, wasmPath, payload) {
  const outcome = spawnSync(
    binary,
    ["--force-interpreter", "--enable-instruction-count", wasmPath, "--method", "echo"],
    { input: payload, maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(outcome.error, undefined);
  const stdoutBytes = new Uint8Array(outcome.stdout);
  // The guest writes its payload first; WasmEdge then logs its statistics to
  // the same stream, starting on the payload's last line.
  const logBytes = stdoutBytes.subarray(payload.length);
  const logText = Buffer.from(logBytes).toString("utf8");
  const diagnosticText = `${logText}\n${outcome.stderr.toString("utf8")}`;
  assert.equal(outcome.status, 0, diagnosticText);
  assert.deepEqual(
    Buffer.from(stdoutBytes.subarray(0, payload.length)),
    payload,
    "the echo method returns its input",
  );
  assert.equal(
    splitWasmEdgeDiagnostics(logBytes).stdout.length,
    0,
    "the guest writes nothing after its payload",
  );
  const match = /Executed wasm instructions count:\s*(\d+)/.exec(logText);
  assert.ok(match, `WasmEdge reported no instruction count:\n${diagnosticText}`);
  return Number(match[1]);
}

test("a payload byte costs a bounded number of wasm instructions through the emcc bridge", async (t) => {
  const binary = await resolveWasmEdgeBinary();
  if (!wasmedgeAvailable(binary)) {
    t.skip("WasmEdge is not available (set SDM_WASMEDGE_BINARY).");
    return;
  }
  const workdir = mkdtempSync(path.join(os.tmpdir(), "sdm-bridge-optimization-"));
  try {
    const wasmPath = path.join(workdir, "module.wasm");
    writeFileSync(wasmPath, compilation.wasmBytes);
    // Printable, newline-free payload bytes: WasmEdge's log lines follow the
    // guest's output on stdout.
    const payload = (length) =>
      Buffer.from(Array.from({ length }, (_, index) => 0x41 + (index % 26)));
    const small = countEchoInstructions(binary, wasmPath, payload(SMALL_PAYLOAD_BYTES));
    const large = countEchoInstructions(binary, wasmPath, payload(LARGE_PAYLOAD_BYTES));
    const perByte = (large - small) / (LARGE_PAYLOAD_BYTES - SMALL_PAYLOAD_BYTES);
    assert.ok(
      perByte <= MAX_INSTRUCTIONS_PER_PAYLOAD_BYTE,
      `${perByte.toFixed(1)} wasm instructions per payload byte (${small} at ${SMALL_PAYLOAD_BYTES} B, ${large} at ${LARGE_PAYLOAD_BYTES} B)`,
    );
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});
