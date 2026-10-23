// E2E (module-sdk-simd128-option-20261023): the opt-in WebAssembly SIMD build option.
//
// One kernel, written twice in one C source: a clang-vector path under
// __wasm_simd128__ and a plain-loop path otherwise. Every operation is lane-wise
// IEEE or modular integer arithmetic, so both paths must produce the same bits.
// This compiles that source on the SDK's own toolchain and checks, on the artifact
// bytes and on the running instances:
//   1. option: `simd128: true` builds v128 code (wasi-sequential and the
//      wasi-threads model); the artifact guard records it on the compile result and
//      the guest-link metadata.json; the artifact declares simd128 in target_features,
//      holds no relaxed-SIMD and no exception-handling instruction or tag section;
//   2. unchanged: the same source WITHOUT the option is byte-identical (module.wasm and
//      the guest-link object) to what the SDK produced before the option (0.9.14, main 66ebffd), on
//      both thread models, and carries no SIMD and no simd128 record;
//   3. browser and native WasmEdge: the SIMD artifacts run in real headless Chromium
//      and in native WasmEdge 0.16.4 with byte-identical responses (the sequential one
//      once, the wasi-threads one at 1, 2 and 4 threads, spawning real threads), and a
//      response is a success, not just equal bytes;
//   4. AOT: the SIMD artifact AOT-compiled by WasmEdge 0.16.4 and run as native code
//      answers the same bytes as the browser; the wasi-threads one AOT-compiles;
//   5. same bits as scalar: the SIMD build's results equal the scalar build's, byte
//      for byte, apart from the field that says which path ran;
//   6. guard: SIMD without the option (a per-function target attribute), relaxed-SIMD,
//      the legacy single-thread model and a non-boolean value are all refused.
// usage: node scripts/e2e/simd128-option.mjs   (browser lane: run it through headless-run)
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { compileModuleFromSource } from "../../src/compiler/compileModule.js";
import { resolveWasiThreadsToolchain } from "../../src/compiler/wasiThreadsToolchain.js";
import { writeGuestLinkFiles } from "../../src/compiler/guestLinkFiles.js";
import { analyzeWasmThreadFeatures } from "../../src/compiler/pthreadArtifactGuard.js";
import { readTargetFeatureEntries } from "../../src/compiler/wasmTargetFeatures.js";
import { scanWasmCode } from "../../src/compiler/wasmCodeScan.js";
import { parseWasmModuleSections } from "../../src/bundle/wasm.js";
import { decodePluginInvokeResponse } from "../../src/invoke/index.js";
import {
  assertWasmEdgeVersionMatchesPin,
  formatParityReport,
  loadWasmEdgePin,
  normalizeParityFixture,
  runParityHarness,
} from "../../src/testing/parityHarness.js";
import { defaultParityLaneRunners, resolveWasmEdgeBinary } from "../../src/testing/parityLanes.js";
import { resolveHeadlessShell } from "../../src/testing/headlessShell.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The SDK this change is based on (0.9.14): what "unchanged" is measured against.
const BASELINE_SDK = "66ebffd282330fd5a1a3d0a4aa6d3496ecd4af37";

const SLICES = 8;
const RESULT_BYTES = 36; // 4 f32/i32 sums, 4 hash lanes, 1 u32 "which path ran" flag
const PATH_FLAG_OFFSET = 32;

const KERNEL_SOURCE = String.raw`
/* One kernel, two implementations that must agree to the byte. With -msimd128 the clang vector
 * extensions lower to v128 instructions; without it the plain loops run. */
#include <math.h>
#include <stdint.h>
#include <string.h>

#include "space_data_module_invoke.h"

#define LANES 4

typedef float f32x4 __attribute__((vector_size(16)));
typedef int32_t i32x4 __attribute__((vector_size(16)));
typedef uint32_t u32x4 __attribute__((vector_size(16)));

typedef struct {
  float dot;       /* sum over lanes of x * reverse(x)            */
  float roots;     /* sum over lanes of sqrt(|x|)                 */
  float picked;    /* sum over lanes of (x > 0 ? x * 2 : x / 4)   */
  int32_t fixed;   /* sum over lanes of trunc(x * 16)             */
  uint32_t mix[4]; /* per-lane multiplicative hash of trunc(x*16) */
  uint32_t simd;   /* 1 when this build ran the v128 path         */
} Result;

static Result kernel(const float *x, uint32_t n) {
  Result r;
  memset(&r, 0, sizeof r);
#ifdef __wasm_simd128__
  f32x4 dot = {0, 0, 0, 0}, roots = {0, 0, 0, 0}, picked = {0, 0, 0, 0};
  i32x4 fixed = {0, 0, 0, 0};
  u32x4 mix = {0x811C9DC5u, 0x811C9DC5u, 0x811C9DC5u, 0x811C9DC5u};
  for (uint32_t i = 0; i + LANES <= n; i += LANES) {
    f32x4 v;
    memcpy(&v, x + i, sizeof v);
    f32x4 rev = __builtin_shufflevector(v, v, 3, 2, 1, 0);
    dot += v * rev;
    roots += __builtin_elementwise_sqrt(__builtin_elementwise_abs(v));
    i32x4 positive = v > (f32x4){0, 0, 0, 0};
    f32x4 doubled = v * (f32x4){2, 2, 2, 2};
    f32x4 quartered = v / (f32x4){4, 4, 4, 4};
    picked += (f32x4)((positive & (i32x4)doubled) | (~positive & (i32x4)quartered));
    i32x4 q = __builtin_convertvector(v * (f32x4){16, 16, 16, 16}, i32x4);
    fixed += q;
    mix = (mix ^ (u32x4)q) * (u32x4){16777619u, 16777619u, 16777619u, 16777619u};
    mix = (mix << 5) | (mix >> 27);
  }
  r.dot = ((dot[0] + dot[1]) + dot[2]) + dot[3];
  r.roots = ((roots[0] + roots[1]) + roots[2]) + roots[3];
  r.picked = ((picked[0] + picked[1]) + picked[2]) + picked[3];
  r.fixed = ((fixed[0] + fixed[1]) + fixed[2]) + fixed[3];
  for (int l = 0; l < LANES; l++) r.mix[l] = mix[l];
  r.simd = 1;
#else
  float dot[LANES] = {0}, roots[LANES] = {0}, picked[LANES] = {0};
  int32_t fixed[LANES] = {0};
  uint32_t mix[LANES] = {0x811C9DC5u, 0x811C9DC5u, 0x811C9DC5u, 0x811C9DC5u};
  for (uint32_t i = 0; i + LANES <= n; i += LANES) {
    for (int l = 0; l < LANES; l++) {
      float v = x[i + l];
      dot[l] += v * x[i + (LANES - 1 - l)];
      roots[l] += sqrtf(fabsf(v));
      picked[l] += v > 0 ? v * 2 : v / 4;
      int32_t q = (int32_t)(v * 16);
      fixed[l] += q;
      uint32_t m = (mix[l] ^ (uint32_t)q) * 16777619u;
      mix[l] = (m << 5) | (m >> 27);
    }
  }
  r.dot = ((dot[0] + dot[1]) + dot[2]) + dot[3];
  r.roots = ((roots[0] + roots[1]) + roots[2]) + roots[3];
  r.picked = ((picked[0] + picked[1]) + picked[2]) + picked[3];
  r.fixed = ((fixed[0] + fixed[1]) + fixed[2]) + fixed[3];
  for (int l = 0; l < LANES; l++) r.mix[l] = mix[l];
  r.simd = 0;
#endif
  return r;
}

#ifdef SDM_THREADED
/* The samples are split into SLICES fixed slices; thread t takes slices t, t+T, t+2T... and each
 * slice's result lands in its own slot, so the response is the same bytes at any thread count. */
#include <pthread.h>
#include <stdlib.h>

#define SLICES 8

typedef struct {
  const float *x;
  uint32_t per;
  uint32_t first, step;
  Result *out;
} Group;

static void *run_group(void *arg) {
  Group *g = (Group *)arg;
  for (uint32_t s = g->first; s < SLICES; s += g->step) g->out[s] = kernel(g->x + s * g->per, g->per);
  return 0;
}

int lanes(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame || frame->payload_length < SLICES * 16 || (frame->payload_length % (SLICES * 16))) {
    plugin_set_error("bad-samples", "samples must be a non-empty multiple of 128 bytes");
    return 3;
  }
  uint32_t n = frame->payload_length / 4;
  int threads = 1;
  const char *env = getenv("SDM_PARITY_THREADS");
  if (env) threads = atoi(env);
  if (threads < 1) threads = 1;
  if (threads > SLICES) threads = SLICES;
  Result out[SLICES];
  Group groups[SLICES];
  pthread_t tid[SLICES];
  for (int t = 0; t < threads; t++) {
    groups[t] = (Group){(const float *)frame->payload, n / SLICES, (uint32_t)t, (uint32_t)threads, out};
  }
  for (int t = 1; t < threads; t++) {
    if (pthread_create(&tid[t], 0, run_group, &groups[t]) != 0) {
      plugin_set_error("thread-spawn", "pthread_create failed");
      return 4;
    }
  }
  run_group(&groups[0]);
  for (int t = 1; t < threads; t++) pthread_join(tid[t], 0);
  return plugin_push_output("result", "CAT.fbs", "$CAT", (const uint8_t *)out, (uint32_t)sizeof out) < 0 ? 1 : 0;
}
#else
int lanes(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame || frame->payload_length < 16 || (frame->payload_length & 15u)) {
    plugin_set_error("bad-samples", "samples must be a non-empty multiple of 16 bytes");
    return 3;
  }
  float x[1024];
  uint32_t n = frame->payload_length / 4;
  if (n > 1024) n = 1024;
  memcpy(x, frame->payload, n * 4);
  Result r = kernel(x, n);
  return plugin_push_output("result", "CAT.fbs", "$CAT", (const uint8_t *)&r, (uint32_t)sizeof r) < 0 ? 1 : 0;
}
#endif
`;

function typeSet(setId, schemaName, fileIdentifier, rootTypeName) {
  return { setId, allowedTypes: [{ schemaName, fileIdentifier, rootTypeName, wireFormat: "flatbuffer" }] };
}
const SAMPLES_TYPE = { schemaName: "OMM.fbs", fileIdentifier: "$OMM", rootTypeName: "OMM", wireFormat: "flatbuffer" };

function manifestFor(name, extra = {}) {
  return {
    pluginId: `com.digitalarsenal.e2e.simd128-${name}`,
    name: `SIMD128 ${name}`,
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: [],
    externalInterfaces: [],
    invokeSurfaces: ["direct", "command"],
    runtimeTargets: ["browser", "wasmedge"],
    ...extra,
    methods: [{
      methodId: "lanes",
      displayName: "Lanes",
      inputPorts: [{ portId: "samples", acceptedTypeSets: [typeSet("omm", "OMM.fbs", "$OMM", "OMM")], minStreams: 1, maxStreams: 1, required: true }],
      outputPorts: [{ portId: "result", acceptedTypeSets: [typeSet("cat", "CAT.fbs", "$CAT", "CAT")], minStreams: 1, maxStreams: 1, required: true }],
      maxBatch: 1,
      drainPolicy: "single-shot",
    }],
  };
}
const SEQUENTIAL_MANIFEST = manifestFor("sequential", {
  sequentialJustification: { kind: "pure-transform", detail: "E2E fixture: one pure kernel call; it never spawns a thread." },
});
const THREADED_MANIFEST = manifestFor("threaded");

// Deterministic test input: 1024 float32 samples in [-8, 8) from a linear congruential generator.
function sampleBytes() {
  const samples = new Float32Array(1024);
  let state = 12345;
  for (let i = 0; i < samples.length; i += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    samples[i] = Math.fround((state / 0x100000000) * 16 - 8);
  }
  return Buffer.from(samples.buffer).toString("base64");
}

function wasmSections(bytes) {
  const parsed = parseWasmModuleSections(bytes);
  return { parsed, scan: scanWasmCode(parsed), features: readTargetFeatureEntries(bytes) ?? [] };
}

// Extract the baseline SDK's sources next to this tree's dependencies and load its compiler.
async function loadBaselineCompiler(dir) {
  try {
    await execFileAsync("git", ["-C", root, "cat-file", "-e", `${BASELINE_SDK}^{commit}`]);
  } catch {
    throw new Error(
      `The baseline SDK commit ${BASELINE_SDK} is not in this repository's history; the unchanged-build check cannot run. ` +
        "Fetch the full history (git fetch --unshallow) and rerun.",
    );
  }
  const baseline = path.join(dir, "baseline-sdk");
  await mkdir(baseline, { recursive: true });
  const archive = path.join(dir, "baseline-sdk.tar");
  await execFileAsync("git", ["-C", root, "archive", "-o", archive, BASELINE_SDK, "src", "package.json"]);
  await execFileAsync("tar", ["-xf", archive, "-C", baseline]);
  await symlink(path.join(root, "node_modules"), path.join(baseline, "node_modules"), "dir");
  return import(pathToFileURL(path.join(baseline, "src/compiler/compileModule.js")).href);
}

function responseOf(stdout, label) {
  const response = decodePluginInvokeResponse(stdout);
  assert.equal(response.statusCode, 0, `${label}: the module answered status ${response.statusCode} (${response.errorCode}: ${response.errorMessage})`);
  const payload = response.outputs?.[0]?.payload;
  assert.ok(payload, `${label}: the response carries no result frame`);
  return new Uint8Array(payload);
}

function resultHex(bytes, from, to) {
  return Buffer.from(bytes.subarray(from, to)).toString("hex");
}

async function main() {
  const started = Date.now();
  const dir = await mkdtemp(path.join(os.tmpdir(), "sdm-simd128-e2e-"));
  try {
    // --- preflight: the toolchain and both runtimes are the pinned ones ---------------------------------
    const toolchain = resolveWasiThreadsToolchain();
    const pin = loadWasmEdgePin();
    const wasmedge = await resolveWasmEdgeBinary();
    assertWasmEdgeVersionMatchesPin((await execFileAsync(wasmedge, ["--version"])).stdout, pin, `native binary ${wasmedge}`);
    await resolveHeadlessShell();
    console.log(`toolchain: ${toolchain.describe()}; WasmEdge ${pin.wasmedgeVersion} at ${wasmedge}`);

    const cacheDir = path.join(dir, "compile-cache");
    const build = (compiler, name, options) =>
      compiler({
        language: "c",
        sourceCode: KERNEL_SOURCE,
        outputPath: path.join(dir, `${name}.wasm`),
        compileCache: { dir: cacheDir },
        ...options,
      });
    const sequential = (simd128) => ({ manifest: SEQUENTIAL_MANIFEST, threadModel: "wasi-sequential", ...(simd128 ? { simd128: true } : {}) });
    const threaded = (simd128) => ({ manifest: THREADED_MANIFEST, threadModel: "emscripten-pthreads", defines: ["SDM_THREADED"], ...(simd128 ? { simd128: true } : {}) });

    // --- 1. the option: SIMD built, recorded, EH-free -----------------------------------------------------
    const simdSeq = await build(compileModuleFromSource, "simd-sequential", sequential(true));
    const simdMt = await build(compileModuleFromSource, "simd-threaded", threaded(true));
    const scalarSeq = await build(compileModuleFromSource, "scalar-sequential", sequential(false));
    const scalarMt = await build(compileModuleFromSource, "scalar-threaded", threaded(false));
    for (const [label, result, model] of [["sequential", simdSeq, "wasi-sequential"], ["threaded", simdMt, "emscripten-pthreads"]]) {
      assert.equal(result.threadModel, model);
      const record = result.simd128;
      assert.equal(record.requested, true, `${label}: the compile result does not record the request`);
      assert.equal(record.declared, true, `${label}: target_features does not declare simd128`);
      assert.equal(record.used, true, `${label}: the artifact holds no v128 instruction`);
      assert.ok(record.instructionCount > 0);
      assert.equal(record.relaxedInstructionCount, 0);
      assert.equal(record.undecodableFunctions, 0, `${label}: ${record.undecodableFunctions} function bodies did not decode`);
      assert.equal(result.guestLink.simd128, true, `${label}: the guest-link record does not carry simd128`);
      const guestDir = path.join(dir, `guest-link-${label}`);
      const written = await writeGuestLinkFiles(result, guestDir);
      assert.equal(written.simd128, true, `${label}: metadata.json does not carry simd128`);
      assert.equal(JSON.parse(await readFile(path.join(guestDir, "metadata.json"), "utf8")).simd128, true);
      const { parsed, scan, features } = wasmSections(result.wasmBytes);
      assert.ok(features.some((feature) => feature.name === "simd128" && feature.prefix !== "-"), `${label}: no simd128 in target_features`);
      assert.ok(!features.some((feature) => feature.name === "relaxed-simd" || feature.name === "exception-handling"), `${label}: a relaxed-simd or exception-handling feature is declared`);
      assert.equal(scan.exceptionHandling, 0, `${label}: the artifact holds exception-handling instructions`);
      assert.equal(scan.relaxedSimd, 0);
      assert.ok(!parsed.sections.some((section) => section.id === 13), `${label}: the artifact has a tag (exception) section`);
      assert.ok(WebAssembly.validate(result.wasmBytes), `${label}: this engine rejects the artifact`);
      console.log(`option: ${label} ${result.wasmBytes.length} B, ${record.instructionCount} v128 instructions, simd128 declared and recorded in the result and metadata.json, no exception handling, no relaxed-SIMD`);
    }
    assert.equal(analyzeWasmThreadFeatures(simdMt.wasmBytes).isIsomorphicPthreads, true, "the threaded SIMD artifact lost the wasi-threads contract");

    // --- 2. unchanged: no option, no change to the bytes -------------------------------------------------
    const baseline = await loadBaselineCompiler(dir);
    for (const [label, current, options, wasmName] of [
      ["sequential", scalarSeq, sequential(false), "baseline-sequential"],
      ["threaded", scalarMt, threaded(false), "baseline-threaded"],
    ]) {
      assert.deepEqual(current.simd128, {
        requested: false, declared: false, declaredRelaxed: false, used: false,
        instructionCount: 0, relaxedInstructionCount: 0, undecodableFunctions: 0,
      }, `${label}: a module without the option records SIMD`);
      assert.equal("simd128" in current.guestLink, false, `${label}: a module without the option has a simd128 guest-link record`);
      // Both sides compile with no cache so the toolchain really runs.
      const now = await build(compileModuleFromSource, `unchanged-${label}`, { ...options, compileCache: false });
      const before = await build(baseline.compileModuleFromSource, wasmName, { ...options, compileCache: false });
      assert.equal(Buffer.compare(Buffer.from(now.wasmBytes), Buffer.from(before.wasmBytes)), 0, `${label}: module.wasm differs from SDK ${BASELINE_SDK.slice(0, 10)}`);
      assert.equal(Buffer.compare(Buffer.from(now.guestLink.objectBytes), Buffer.from(before.guestLink.objectBytes)), 0, `${label}: the guest-link object differs`);
      assert.deepEqual({ ...now.guestLink, objectBytes: null }, { ...before.guestLink, objectBytes: null }, `${label}: the guest-link record differs`);
      const { scan, features } = wasmSections(now.wasmBytes);
      assert.equal(scan.simd + scan.relaxedSimd, 0);
      assert.ok(!features.some((feature) => feature.name === "simd128"), `${label}: simd128 declared without the option`);
      console.log(`unchanged: ${label} module.wasm (${now.wasmBytes.length} B) and guest-link object byte-identical to SDK ${BASELINE_SDK.slice(0, 10)}; no SIMD instruction, no simd128 declared`);
    }

    // --- 3. browser and native WasmEdge: byte-identical, successful responses ----------------------------
    const request = { methodId: "lanes", inputs: [{ portId: "samples", payloadBase64: sampleBytes(), typeRef: SAMPLES_TYPE }] };
    const runLanes = async (label, wasmPath, threadCounts) => {
      const plan = await normalizeParityFixture({ name: label, threadCounts, cases: [{ id: "lanes", request }] });
      const captured = [];
      const laneRunners = Object.fromEntries(["browser", "wasmedge"].map((lane) => [lane, async (context) => {
        const runs = await defaultParityLaneRunners[lane](context);
        captured.push(...runs.map((run) => ({ ...run, lane })));
        return runs;
      }]));
      const report = await runParityHarness({ wasmPath, plan, lanes: ["browser", "wasmedge"], laneRunners, log: (line) => console.error(line) });
      assert.equal(report.ok, true, formatParityReport(report));
      assert.deepEqual(report.lanes.map((lane) => lane.lane), ["browser", "wasmedge"]);
      const results = captured.map((run) => ({ lane: run.lane, threads: run.threadCount, spawned: run.spawnCount, payload: responseOf(run.stdout, `${label} ${run.lane}@t${run.threadCount}`) }));
      assert.equal(results.length, 2 * threadCounts.length);
      return { report, results, stdin: plan.cases[0].stdinBytes, stdout: captured.find((run) => run.lane === "wasmedge" && run.threadCount === threadCounts[0]).stdout };
    };
    const seqSimdRun = await runLanes("simd-sequential", simdSeq.outputPath, [1]);
    const seqScalarRun = await runLanes("scalar-sequential", scalarSeq.outputPath, [1]);
    const mtSimdRun = await runLanes("simd-threaded", simdMt.outputPath, [1, 2, 4]);
    const mtScalarRun = await runLanes("scalar-threaded", scalarMt.outputPath, [1, 2, 4]);
    for (const [label, run] of [["simd-sequential", seqSimdRun], ["simd-threaded", mtSimdRun]]) {
      console.log(`lanes: ${label} byte-identical in headless Chromium and native WasmEdge ${pin.wasmedgeVersion} (${run.report.comparisons} comparisons, response sha256 ${run.report.runs[0].stdoutSha256.slice(0, 12)})`);
    }
    // The threaded runs really spawned threads: 0 at one thread, T-1 at T.
    for (const run of mtSimdRun.results) assert.equal(run.spawned, run.threads - 1, `${run.lane}@t${run.threads}: spawned ${run.spawned} threads`);

    // --- 5. the same bits as the scalar build -----------------------------------------------------------
    const [seqSimd] = seqSimdRun.results;
    const [seqScalar] = seqScalarRun.results;
    assert.equal(seqSimd.payload.length, RESULT_BYTES);
    assert.equal(new DataView(seqSimd.payload.buffer, seqSimd.payload.byteOffset).getUint32(PATH_FLAG_OFFSET, true), 1, "the SIMD build did not run the v128 path");
    assert.equal(new DataView(seqScalar.payload.buffer, seqScalar.payload.byteOffset).getUint32(PATH_FLAG_OFFSET, true), 0, "the scalar build ran the v128 path");
    assert.equal(resultHex(seqSimd.payload, 0, PATH_FLAG_OFFSET), resultHex(seqScalar.payload, 0, PATH_FLAG_OFFSET), "sequential: SIMD results differ from scalar results");
    const view = new DataView(seqSimd.payload.buffer, seqSimd.payload.byteOffset);
    assert.ok(Number.isFinite(view.getFloat32(0, true)) && view.getFloat32(0, true) !== 0, "the kernel produced a degenerate result");
    for (const run of [...seqSimdRun.results, ...seqScalarRun.results]) {
      assert.equal(resultHex(run.payload, 0, PATH_FLAG_OFFSET), resultHex(seqSimd.payload, 0, PATH_FLAG_OFFSET), `${run.lane}: a lane's result differs`);
    }
    const slices = (payload) => Array.from({ length: SLICES }, (_, i) => resultHex(payload, i * RESULT_BYTES, i * RESULT_BYTES + PATH_FLAG_OFFSET));
    const reference = slices(mtSimdRun.results[0].payload);
    assert.equal(new Set(reference).size, SLICES, "the slices of the threaded kernel should differ from each other");
    for (const run of [...mtSimdRun.results, ...mtScalarRun.results]) {
      assert.equal(run.payload.length, SLICES * RESULT_BYTES);
      assert.deepEqual(slices(run.payload), reference, `threaded ${run.lane}@t${run.threads}: slices differ from the reference`);
    }
    console.log("same bits: SIMD results equal the scalar build's, byte for byte (flag excluded), in every lane, at 1, 2 and 4 threads");

    // --- 4. AOT: WasmEdge compiles the SIMD artifacts and the native code answers the same bytes ---------
    const aotExtension = process.platform === "darwin" ? "dylib" : "so";
    const aot = async (name, wasmPath) => {
      const out = path.join(dir, `${name}.aot.${aotExtension}`);
      await execFileAsync(wasmedge, ["compile", "--enable-threads", wasmPath, out], { maxBuffer: 32 * 1024 * 1024 });
      return out;
    };
    const aotSeq = await aot("simd-sequential", simdSeq.outputPath);
    const aotRun = await new Promise((resolve, reject) => {
      const child = execFile(wasmedge, ["--enable-threads", "--env", "SDM_PARITY_THREADS=1", aotSeq],
        { encoding: "buffer", maxBuffer: 32 * 1024 * 1024, env: { PATH: process.env.PATH ?? "" } },
        (error, stdout, stderr) => (error ? reject(new Error(`AOT run failed: ${error.message}\n${stderr}`)) : resolve(stdout)));
      child.stdin.end(Buffer.from(seqSimdRun.stdin));
    });
    assert.equal(Buffer.compare(Buffer.from(aotRun), Buffer.from(seqSimdRun.stdout)), 0, "the AOT-compiled artifact answers different bytes than the interpreter and the browser");
    await aot("simd-threaded", simdMt.outputPath);
    console.log(`aot: WasmEdge ${pin.wasmedgeVersion} AOT-compiled both SIMD artifacts; the sequential one ran as native code and answered the same ${aotRun.length} bytes as the browser`);

    // --- 6. the guard: SIMD only by opt-in, never relaxed --------------------------------------------------
    const bypass = [
      "typedef float f32x4 __attribute__((vector_size(16)));",
      '__attribute__((target("simd128"))) static float hsum(const float *p) { f32x4 v; __builtin_memcpy(&v, p, 16); return v[0] + v[1] + v[2] + v[3]; }',
      "int lanes(void) { float a[4] = {1, 2, 3, 4}; return (int)hsum(a); }",
    ].join("\n");
    const relaxed = [
      "typedef float f32x4 __attribute__((vector_size(16)));",
      '__attribute__((target("relaxed-simd"))) static f32x4 fma4(f32x4 a, f32x4 b, f32x4 c) { return __builtin_wasm_relaxed_madd_f32x4(a, b, c); }',
      "int lanes(void) { f32x4 a = {1, 2, 3, 4}; f32x4 r = fma4(a, a, a); return (int)r[0]; }",
    ].join("\n");
    const attempt = (sourceCode, options) => compileModuleFromSource({ manifest: SEQUENTIAL_MANIFEST, language: "c", sourceCode, threadModel: "wasi-sequential", compileCache: { dir: cacheDir }, ...options });
    await assert.rejects(attempt(bypass, {}), /did not opt in[\s\S]*simd128: true/, "SIMD without the option was not refused");
    const attribute = await attempt(bypass, { simd128: true });
    assert.equal(attribute.simd128.requested && attribute.simd128.declared, true);
    await assert.rejects(attempt(relaxed, { simd128: true }), /relaxed-SIMD[\s\S]*implementation-defined/, "relaxed-SIMD was not refused");
    await assert.rejects(attempt(relaxed, {}), /relaxed-SIMD/, "relaxed-SIMD without the option was not refused");
    await assert.rejects(attempt(bypass, { simd128: true, threadModel: "single-thread" }), /simd128 requires threadModel "wasi-sequential" or "emscripten-pthreads"/);
    await assert.rejects(attempt(bypass, { simd128: "yes" }), /simd128 must be true or false/);
    console.log("guard: SIMD without the option, relaxed-SIMD (with or without it), the legacy single-thread model and a non-boolean value are refused; the option admits the same attribute");

    console.log(`SIMD128-OPTION PASS in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.log(`SIMD128-OPTION FAIL: ${error?.stack ?? error}`);
  process.exit(1);
});
