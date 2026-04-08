import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  cleanupCompilation,
  compileModuleFromSource,
  createBrowserModuleHarness,
  createModuleFlatBufferStreamPump,
  encodePluginInvokeRequest,
} from "../src/index.js";

function createPort(portId, required = true) {
  return {
    portId,
    acceptedTypeSets: [
      {
        setId: `${portId}-any`,
        allowedTypes: [{ acceptsAnyFlatbuffer: true }],
      },
    ],
    minStreams: required ? 1 : 0,
    maxStreams: 1024,
    required,
  };
}

function createStreamingManifest() {
  return {
    pluginId: "com.digitalarsenal.examples.module-flatbuffer-stream-pump-test",
    name: "Module FlatBuffer Stream Pump Test Module",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: [],
    externalInterfaces: [],
    runtimeTargets: ["browser", "wasmedge"],
    invokeSurfaces: ["direct"],
    methods: [
      {
        methodId: "ingest_records",
        displayName: "ingest_records",
        inputPorts: [createPort("records", true)],
        outputPorts: [createPort("stats", false)],
        maxBatch: 1024,
        drainPolicy: "single-shot",
      },
    ],
  };
}

function createStreamingSource() {
  return `#include <stdint.h>
#include <stdio.h>
#include "space_data_module_invoke.h"

static uint32_t total_frames = 0;
static uint32_t total_bytes = 0;
static int saw_end_of_stream = 0;

int ingest_records(void) {
  uint32_t input_count = plugin_get_input_count();
  for (uint32_t index = 0; index < input_count; index += 1) {
    const plugin_input_frame_t *frame = plugin_get_input_frame(index);
    if (!frame) {
      continue;
    }
    total_frames += 1;
    total_bytes += frame->payload_length;
    if (frame->end_of_stream) {
      saw_end_of_stream = 1;
    }
  }

  char stats[96];
  int written = snprintf(
    stats,
    sizeof(stats),
    "%u:%u:%d",
    total_frames,
    total_bytes,
    saw_end_of_stream
  );
  if (written < 0) {
    plugin_set_error("stream-stats-format", "Failed to format stream stats.");
    return 3;
  }

  plugin_push_output(
    "stats",
    "StreamStats.fbs",
    "STAT",
    (const uint8_t *)stats,
    (uint32_t)written
  );
  return 0;
}
`;
}

function createFlatBufferPayload(fileIdentifier, byteLength = 24) {
  if (typeof fileIdentifier !== "string" || fileIdentifier.length !== 4) {
    throw new TypeError("fileIdentifier must be a four-character string");
  }
  const payload = new Uint8Array(Math.max(8, byteLength));
  payload[0] = 4;
  payload[1] = 0;
  payload[2] = 0;
  payload[3] = 0;
  payload[4] = fileIdentifier.charCodeAt(0);
  payload[5] = fileIdentifier.charCodeAt(1);
  payload[6] = fileIdentifier.charCodeAt(2);
  payload[7] = fileIdentifier.charCodeAt(3);
  for (let index = 8; index < payload.length; index += 1) {
    payload[index] = index % 251;
  }
  return payload;
}

function createSizePrefixedFrame(payload) {
  const frame = new Uint8Array(4 + payload.byteLength);
  const size = payload.byteLength >>> 0;
  frame[0] = size & 0xff;
  frame[1] = (size >>> 8) & 0xff;
  frame[2] = (size >>> 16) & 0xff;
  frame[3] = (size >>> 24) & 0xff;
  frame.set(payload, 4);
  return frame;
}

function concatUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

test("module flatbuffer stream pump batches frames into invoke requests without JSON envelopes", async () => {
  const requests = [];
  const pump = createModuleFlatBufferStreamPump({
    methodId: "ingest_records",
    portId: "records",
    maxFramesPerInvoke: 8,
    async invoke(request) {
      requests.push(request);
      return {
        statusCode: 0,
        outputs: [],
      };
    },
  });

  const ommPayload = createFlatBufferPayload("OMM ");
  const cdmPayload = createFlatBufferPayload("CDM ");
  const stream = concatUint8Arrays([
    createSizePrefixedFrame(ommPayload),
    createSizePrefixedFrame(cdmPayload),
  ]);

  assert.equal(await pump.pushBytes(stream.subarray(0, 9)), 0);
  assert.equal(await pump.pushBytes(stream.subarray(9)), 2);
  const finalResponse = await pump.finish();

  assert.equal(finalResponse.statusCode, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].methodId, "ingest_records");
  assert.equal(requests[0].inputs.length, 2);
  assert.equal(requests[0].inputs[0].portId, "records");
  assert.equal(requests[0].inputs[0].typeRef.fileIdentifier, "OMM");
  assert.equal(requests[0].inputs[0].typeRef.acceptsAnyFlatbuffer, true);
  assert.equal(requests[0].inputs[0].endOfStream, false);
  assert.equal(requests[0].inputs[0].sequence, 1);
  assert.equal(requests[0].inputs[1].typeRef.fileIdentifier, "CDM");
  assert.equal(requests[0].inputs[1].endOfStream, true);
  assert.equal(requests[0].inputs[1].sequence, 2);
  assert.equal(pump.stats.framesDecoded, 2);
  assert.equal(pump.stats.framesInvoked, 2);
  assert.equal(pump.stats.invokes, 1);
});

test("module flatbuffer stream pump rejects partial trailing frames", async () => {
  const pump = createModuleFlatBufferStreamPump({
    methodId: "ingest_records",
    portId: "records",
    async invoke() {
      return {
        statusCode: 0,
        outputs: [],
      };
    },
  });

  const payload = createFlatBufferPayload("OMM ");
  const frame = createSizePrefixedFrame(payload);
  await pump.pushBytes(frame.subarray(0, frame.byteLength - 3));

  await assert.rejects(
    () => pump.finish(),
    /partial frame/i,
  );
});

test("module flatbuffer stream pump can feed a persistent browser direct-surface module", async (t) => {
  const compilation = await compileModuleFromSource({
    manifest: createStreamingManifest(),
    sourceCode: createStreamingSource(),
    language: "c",
  });
  t.after(async () => {
    await cleanupCompilation(compilation);
  });

  const harness = await createBrowserModuleHarness({
    wasmSource: compilation.wasmBytes,
    surface: "direct",
  });
  t.after(() => {
    harness.destroy();
  });

  const responses = [];
  const payloadA = createFlatBufferPayload("OMM ", 21);
  const payloadB = createFlatBufferPayload("CDM ", 34);
  const payloadC = createFlatBufferPayload("OEM ", 13);
  const totalPayloadBytes =
    payloadA.byteLength + payloadB.byteLength + payloadC.byteLength;
  const stream = concatUint8Arrays([
    createSizePrefixedFrame(payloadA),
    createSizePrefixedFrame(payloadB),
    createSizePrefixedFrame(payloadC),
  ]);
  const pump = createModuleFlatBufferStreamPump({
    harness,
    methodId: "ingest_records",
    portId: "records",
    maxFramesPerInvoke: 2,
    async onResponse(response) {
      responses.push(response);
    },
  });

  assert.equal(await pump.pushBytes(stream.subarray(0, 11)), 0);
  assert.equal(await pump.pushBytes(stream.subarray(11, 47)), 1);
  assert.equal(await pump.pushBytes(stream.subarray(47)), 2);
  const finalResponse = await pump.finish();

  assert.equal(responses.length, 2);
  assert.equal(
    new TextDecoder().decode(responses[0].outputs[0].payload),
    `2:${payloadA.byteLength + payloadB.byteLength}:0`,
  );
  assert.equal(
    new TextDecoder().decode(finalResponse.outputs[0].payload),
    `3:${totalPayloadBytes}:1`,
  );
  assert.equal(pump.stats.framesDecoded, 3);
  assert.equal(pump.stats.framesInvoked, 3);
  assert.equal(pump.stats.invokes, 2);
});

const maybeLargeVolumeTest =
  process.env.SPACE_DATA_MODULE_SDK_ENABLE_1GB_MODULE_STREAM_TEST === "1"
    ? test
    : test.skip;

maybeLargeVolumeTest(
  "module flatbuffer stream pump benchmarks 1 GiB total chunked module ingress",
  async () => {
    const targetBytes = Number(
      process.env.SPACE_DATA_MODULE_SDK_MODULE_STREAM_BENCH_BYTES ??
        1024 * 1024 * 1024,
    );
    const payloadSize = Number(
      process.env.SPACE_DATA_MODULE_SDK_MODULE_STREAM_BENCH_PAYLOAD_BYTES ??
        64 * 1024,
    );
    const chunkSize = Number(
      process.env.SPACE_DATA_MODULE_SDK_MODULE_STREAM_BENCH_CHUNK_BYTES ??
        256 * 1024,
    );
    const maxFramesPerInvoke = Number(
      process.env.SPACE_DATA_MODULE_SDK_MODULE_STREAM_BENCH_BATCH_FRAMES ?? 32,
    );

    const payload = createFlatBufferPayload("OMM ", payloadSize);
    const frame = createSizePrefixedFrame(payload);
    const totalFrames = Math.ceil(targetBytes / payload.byteLength);
    const pump = createModuleFlatBufferStreamPump({
      methodId: "ingest_records",
      portId: "records",
      maxFramesPerInvoke,
      async invoke(request) {
        encodePluginInvokeRequest(request);
        return {
          statusCode: 0,
          outputs: [],
        };
      },
    });

    let processedPayloadBytes = 0;
    let bufferedChunk = new Uint8Array(0);
    const startedAt = performance.now();

    while (processedPayloadBytes < targetBytes) {
      if (bufferedChunk.byteLength + frame.byteLength > chunkSize) {
        await pump.pushBytes(bufferedChunk);
        bufferedChunk = new Uint8Array(0);
      }
      bufferedChunk = concatUint8Arrays([bufferedChunk, frame]);
      processedPayloadBytes += payload.byteLength;
    }

    if (bufferedChunk.byteLength > 0) {
      await pump.pushBytes(bufferedChunk);
    }
    await pump.finish();

    const elapsedMs = performance.now() - startedAt;
    const throughputMiBPerSec =
      processedPayloadBytes / (1024 * 1024) / Math.max(elapsedMs / 1000, 0.001);

    assert.equal(pump.stats.framesDecoded, totalFrames);
    assert.equal(pump.stats.framesInvoked, totalFrames);
    assert.ok(pump.stats.invokes > 0);
    assert.ok(elapsedMs > 0);
    assert.ok(Number.isFinite(throughputMiBPerSec));
    console.log(
      JSON.stringify({
        benchmark: "module-flatbuffer-stream-pump-1gib",
        payloadBytes: processedPayloadBytes,
        frames: pump.stats.framesDecoded,
        invokes: pump.stats.invokes,
        elapsedMs: Math.round(elapsedMs),
        throughputMiBPerSec: Number(throughputMiBPerSec.toFixed(2)),
      }),
    );
  },
);
