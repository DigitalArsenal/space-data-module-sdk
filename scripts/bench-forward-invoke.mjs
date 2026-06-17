#!/usr/bin/env node
/**
 * Benchmark: module-to-module hop — legacy host decode/re-encode round-trip
 * vs the zero-copy forwardOutputFrameAsInput path.
 *
 * Legacy hop (what chained flows did before):
 *   decodePluginInvokeResponse -> JSON.parse(payload) -> JSON.stringify
 *   -> TextEncoder.encode -> encodePluginInvokeRequest
 *   (2 payload codec passes + 2 byte<->string conversions per hop)
 *
 * Forward hop (after):
 *   decodePluginInvokeResponse -> forwardOutputFrameAsInput
 *   -> encodePluginInvokeRequest
 *   (0 payload decode/encode calls — the payload bytes are reused as-is and
 *   copied exactly once into the next request arena)
 *
 * Run: node scripts/bench-forward-invoke.mjs [payloadMegabytes]
 */

import { performance } from "node:perf_hooks";

import {
  decodePluginInvokeRequest,
  decodePluginInvokeResponse,
  encodePluginInvokeRequest,
  encodePluginInvokeResponse,
  forwardOutputFrameAsInput,
} from "../src/invoke/codec.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const targetMegabytes = Number(process.argv[2] ?? 32);
const iterations = 5;

// Build a realistic large JSON payload (trajectory-sample shaped).
function buildPayload(megabytes) {
  const samples = [];
  let index = 0;
  let estimate = 0;
  const target = megabytes * 1024 * 1024;
  while (estimate < target) {
    const sample = {
      id: `sample-${index}`,
      elapsedSeconds: index * 0.25,
      altitudeM: 120000 - index * 0.37,
      speedMps: 7600 - index * 0.011,
      massKg: 12000,
      flightPathAngleDeg: -1.4 - index * 1e-5,
      positionEcefM: [6371000 + index, index * 2.5, index * -1.25],
      velocityEcefMps: [7.5 * index, -3.25, 1.125],
    };
    samples.push(sample);
    estimate += 220;
    index += 1;
  }
  return textEncoder.encode(
    JSON.stringify({ provider: "bench-producer", trajectorySamples: samples }),
  );
}

function time(fn) {
  const start = performance.now();
  const value = fn();
  return { ms: performance.now() - start, value };
}

const payloadBytes = buildPayload(targetMegabytes);
console.log(
  `payload: ${(payloadBytes.length / 1024 / 1024).toFixed(1)} MiB JSON (${targetMegabytes} MiB requested), ${iterations} iterations`,
);

// Producer response as it would come back from module A.
const producerResponseBytes = encodePluginInvokeResponse({
  statusCode: 0,
  outputs: [{ portId: "response", payload: payloadBytes }],
});

const legacyCounters = { jsonParse: 0, jsonStringify: 0, textEncode: 0 };
const forwardCounters = { jsonParse: 0, jsonStringify: 0, textEncode: 0 };

function legacyHop() {
  const decoded = decodePluginInvokeResponse(producerResponseBytes);
  const frame = decoded.outputs.find((entry) => entry.portId === "response");
  // Legacy: payload decoded into an object, re-serialized, re-encoded.
  legacyCounters.jsonParse += 1;
  const object = JSON.parse(textDecoder.decode(frame.payload));
  legacyCounters.jsonStringify += 1;
  const reSerialized = JSON.stringify(object);
  legacyCounters.textEncode += 1;
  const reEncoded = textEncoder.encode(reSerialized);
  return encodePluginInvokeRequest({
    methodId: "consume",
    inputs: [{ portId: "trajectory", payload: reEncoded }],
  });
}

function forwardHop() {
  const decoded = decodePluginInvokeResponse(producerResponseBytes);
  const frame = decoded.outputs.find((entry) => entry.portId === "response");
  const forwarded = forwardOutputFrameAsInput(frame, { portId: "trajectory" });
  return encodePluginInvokeRequest({
    methodId: "consume",
    inputs: [forwarded],
  });
}

// Warm-up + verification: the forward path must deliver byte-identical bytes.
const verifyRequest = forwardHop();
const verifyDecoded = decodePluginInvokeRequest(verifyRequest);
const original = decodePluginInvokeResponse(producerResponseBytes).outputs[0]
  .payload;
if (Buffer.compare(Buffer.from(verifyDecoded.inputs[0].payload), Buffer.from(original)) !== 0) {
  console.error("FATAL: forward path payload is not byte-identical");
  process.exit(1);
}
legacyHop();

let legacyTotal = 0;
let forwardTotal = 0;
for (let index = 0; index < iterations; index += 1) {
  legacyTotal += time(legacyHop).ms;
  forwardTotal += time(forwardHop).ms;
}

const legacyMs = legacyTotal / iterations;
const forwardMs = forwardTotal / iterations;

console.log("\nper-hop averages:");
console.log(
  `  legacy  (decode->JSON.parse->JSON.stringify->encode): ${legacyMs.toFixed(1)} ms ` +
    `(payload codec calls/hop: ${legacyCounters.jsonParse / (iterations + 1)} parse, ` +
    `${legacyCounters.jsonStringify / (iterations + 1)} stringify, ` +
    `${legacyCounters.textEncode / (iterations + 1)} text-encode)`,
);
console.log(
  `  forward (decode->forwardOutputFrameAsInput->encode):  ${forwardMs.toFixed(1)} ms ` +
    `(payload codec calls/hop: ${forwardCounters.jsonParse} parse, ` +
    `${forwardCounters.jsonStringify} stringify, ` +
    `${forwardCounters.textEncode} text-encode)`,
);
console.log(`  speedup: ${(legacyMs / forwardMs).toFixed(2)}x`);
console.log(
  "  forward path: payload byte-identical, zero payload decode/serialize calls",
);
