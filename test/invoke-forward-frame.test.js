import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanupCompilation,
  compileModuleFromSource,
  decodePluginInvokeRequest,
  encodePluginInvokeRequest,
  forwardOutputFrameAsInput,
} from "../src/index.js";
import { createBrowserModuleHarness } from "../src/testing/index.js";

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
    maxStreams: 1,
    required,
  };
}

function createManifest(pluginId, methodId, inputPortId, outputPortId) {
  return {
    pluginId,
    name: pluginId,
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: [],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    methods: [
      {
        methodId,
        displayName: methodId,
        inputPorts: [createPort(inputPortId, true)],
        outputPorts: [createPort(outputPortId, false)],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  };
}

// Module A: deterministically generates a payload of the requested size.
const PRODUCER_SOURCE = `#include <stdint.h>
#include <stdlib.h>
#include "space_data_module_invoke.h"

static uint8_t *buffer = 0;

int produce(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame || frame->payload_length < 4) {
    plugin_set_error("missing-frame", "Producer needs a 4-byte size input.");
    return 3;
  }
  uint32_t size = 0;
  for (int i = 3; i >= 0; i -= 1) {
    size = (size << 8) | frame->payload[i];
  }
  if (buffer) {
    free(buffer);
  }
  buffer = (uint8_t *)malloc(size);
  if (!buffer) {
    plugin_set_error("alloc-failed", "Producer allocation failed.");
    return 4;
  }
  uint32_t state = 0x9e3779b9u;
  for (uint32_t i = 0; i < size; i += 1) {
    state = state * 1664525u + 1013904223u;
    buffer[i] = (uint8_t)(state >> 24);
  }
  plugin_push_output("artifact", "Artifact.bin", "ARTF", buffer, size);
  return 0;
}
`;

// Module B: consumes forwarded bytes and reports FNV-1a hash + length so the
// host can prove the exact bytes module A produced were delivered.
const CONSUMER_SOURCE = `#include <stdint.h>
#include "space_data_module_invoke.h"

static uint8_t digest_out[12];

int consume(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) {
    plugin_set_error("missing-frame", "Consumer needs an artifact input.");
    return 3;
  }
  uint64_t hash = 14695981039346656037ull;
  for (uint32_t i = 0; i < frame->payload_length; i += 1) {
    hash ^= (uint64_t)frame->payload[i];
    hash *= 1099511628211ull;
  }
  for (int i = 0; i < 8; i += 1) {
    digest_out[i] = (uint8_t)(hash >> (8 * i));
  }
  uint32_t length = frame->payload_length;
  for (int i = 0; i < 4; i += 1) {
    digest_out[8 + i] = (uint8_t)(length >> (8 * i));
  }
  plugin_push_output("digest", "Digest.bin", "DGST", digest_out, 12);
  return 0;
}
`;

function fnv1a64(bytes) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash;
}

function digestToParts(digest) {
  let hash = 0n;
  for (let i = 7; i >= 0; i -= 1) {
    hash = (hash << 8n) | BigInt(digest[i]);
  }
  let length = 0;
  for (let i = 3; i >= 0; i -= 1) {
    length = (length << 8) | digest[8 + i];
  }
  return { hash, length };
}

test("module-to-module hop forwards producer bytes into the consumer without decode/encode", async () => {
  const producerCompilation = await compileModuleFromSource({
    manifest: createManifest(
      "com.digitalarsenal.examples.forward-producer",
      "produce",
      "size",
      "artifact",
    ),
    sourceCode: PRODUCER_SOURCE,
    language: "c",
  });
  const consumerCompilation = await compileModuleFromSource({
    manifest: createManifest(
      "com.digitalarsenal.examples.forward-consumer",
      "consume",
      "artifact",
      "digest",
    ),
    sourceCode: CONSUMER_SOURCE,
    language: "c",
  });

  try {
    const producer = await createBrowserModuleHarness({
      wasmSource: producerCompilation.wasmBytes,
      surface: "direct",
    });
    const consumer = await createBrowserModuleHarness({
      wasmSource: consumerCompilation.wasmBytes,
      surface: "direct",
    });

    const payloadSize = 512 * 1024 + 13;
    const sizeBytes = new Uint8Array(4);
    new DataView(sizeBytes.buffer).setUint32(0, payloadSize, true);

    const producedResponse = await producer.invoke({
      methodId: "produce",
      inputs: [{ portId: "size", payload: sizeBytes }],
    });
    assert.equal(producedResponse.statusCode, 0, producedResponse.errorMessage ?? "");
    const artifactFrame = producedResponse.outputs.find(
      (frame) => frame.portId === "artifact",
    );
    assert.ok(artifactFrame);
    assert.equal(artifactFrame.payload.length, payloadSize);

    // The hop: forward module A's output frame untouched. The descriptor
    // references the same bytes — no JSON/FlatBuffer decode, no re-encode.
    const forwarded = forwardOutputFrameAsInput(artifactFrame, {
      portId: "artifact",
    });
    assert.equal(forwarded.payload, artifactFrame.payload, "same byte view");

    // Host-side proof of byte-identical delivery into B's request arena.
    const consumerRequestBytes = encodePluginInvokeRequest({
      methodId: "consume",
      inputs: [forwarded],
    });
    const reDecoded = decodePluginInvokeRequest(consumerRequestBytes);
    assert.deepEqual(
      Buffer.from(reDecoded.inputs[0].payload),
      Buffer.from(artifactFrame.payload),
      "request arena bytes must equal producer output bytes",
    );

    // Guest-side proof: module B hashes exactly what module A emitted.
    const consumedResponse = await consumer.invoke({
      methodId: "consume",
      inputs: [forwarded],
    });
    assert.equal(consumedResponse.statusCode, 0, consumedResponse.errorMessage ?? "");
    const digestFrame = consumedResponse.outputs.find(
      (frame) => frame.portId === "digest",
    );
    assert.ok(digestFrame);
    const { hash, length } = digestToParts(digestFrame.payload);
    assert.equal(length, payloadSize);
    assert.equal(hash, fnv1a64(artifactFrame.payload));

    producer.destroy();
    consumer.destroy();
  } finally {
    await cleanupCompilation(producerCompilation);
    await cleanupCompilation(consumerCompilation);
  }
});

test("forwardOutputFrameAsInput preserves type metadata and rejects empty frames", () => {
  const frame = {
    portId: "states",
    payload: Uint8Array.from([1, 2, 3, 4]),
    typeRef: {
      schemaName: "HFC.fbs",
      fileIdentifier: "$HFC",
      wireFormat: "flatbuffer",
      rootTypeName: "HFC",
      fixedStringLength: 0,
      byteLength: 4,
      requiredAlignment: 0,
    },
    alignment: 8,
    generation: 2,
    traceId: 7n,
    streamId: 3,
    sequence: 11n,
    endOfStream: true,
  };

  const forwarded = forwardOutputFrameAsInput(frame, { portId: "trajectory" });
  assert.equal(forwarded.portId, "trajectory");
  assert.equal(forwarded.payload, frame.payload);
  assert.equal(forwarded.typeRef, frame.typeRef);
  assert.equal(forwarded.generation, 2);
  assert.equal(forwarded.endOfStream, true);

  assert.throws(() => forwardOutputFrameAsInput(null), /decoded output frame/);
  assert.throws(
    () => forwardOutputFrameAsInput({ portId: "x" }),
    /payload bytes/,
  );
});
