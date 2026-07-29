import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanupCompilation,
  compileModuleFromSource,
  createInvokeArenaLease,
  decodePluginInvokeRequest,
  decodePluginInvokeResponse,
  encodePluginInvokeRequest,
  encodePluginInvokeResponse,
  forwardOutputFrameAsInput,
} from "../src/index.js";
import { createBrowserModuleHarness } from "../src/testing/index.js";
import { BufferMutability } from "../src/generated/orbpro/stream/buffer-mutability.js";
import { BufferOwnership } from "../src/generated/orbpro/stream/buffer-ownership.js";

const ATM_TYPE = Object.freeze({
  schemaName: "ATM.fbs",
  fileIdentifier: "$ATM",
  rootTypeName: "ATM",
  byteLength: 8,
  requiredAlignment: 4,
});

const GRV_TYPE = Object.freeze({
  schemaName: "GRV.fbs",
  fileIdentifier: "$GRV",
  rootTypeName: "GRV",
  byteLength: 72,
  requiredAlignment: 8,
});

function createPort(portId, type, required = true) {
  return {
    portId,
    acceptedTypeSets: [
      {
        setId: `${portId}-${type.rootTypeName.toLowerCase()}`,
        allowedTypes: [
          {
            schemaName: type.schemaName,
            fileIdentifier: type.fileIdentifier,
            rootTypeName: type.rootTypeName,
            wireFormat: "flatbuffer",
          },
          {
            ...type,
            wireFormat: "aligned-binary",
          },
        ],
      },
    ],
    minStreams: required ? 1 : 0,
    maxStreams: 1,
    required,
  };
}

function createManifest(
  pluginId,
  methodId,
  inputPortId,
  inputType,
  outputPortId,
  outputType,
) {
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
        inputPorts: [createPort(inputPortId, inputType, true)],
        outputPorts: [createPort(outputPortId, outputType, false)],
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
  plugin_push_output_typed(
    "artifact",
    "GRV.fbs",
    "$GRV",
    PLUGIN_PAYLOAD_WIRE_FORMAT_FLATBUFFER,
    "GRV",
    0,
    0,
    0,
    buffer,
    size
  );
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
  plugin_push_output_typed(
    "digest",
    "ATM.fbs",
    "$ATM",
    PLUGIN_PAYLOAD_WIRE_FORMAT_FLATBUFFER,
    "ATM",
    0,
    0,
    0,
    digest_out,
    12
  );
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

function canonicalAtmType() {
  return {
    schemaName: ATM_TYPE.schemaName,
    fileIdentifier: ATM_TYPE.fileIdentifier,
    rootTypeName: ATM_TYPE.rootTypeName,
    wireFormat: "flatbuffer",
  };
}

test("decoded immutable frames capture a live arena lease generation for forwarding", () => {
  const frameId = 0x123456789abcdef0n;
  const decoded = decodePluginInvokeResponse(
    encodePluginInvokeResponse({
      outputs: [
        {
          portId: "atmosphere",
          typeRef: canonicalAtmType(),
          ownership: "host-owned",
          mutability: "immutable",
          frameId,
          payload: Uint8Array.from([1, 2, 3, 4]),
        },
      ],
    }),
  );
  const [frame] = decoded.outputs;

  assert.equal(frame.arenaLease, decoded.arenaLease);
  assert.equal(frame.generation, decoded.arenaLease.generation);
  const forwarded = forwardOutputFrameAsInput(frame, { portId: "next" });
  assert.equal(forwarded.payload, frame.payload);
  assert.equal(forwarded.frameId, frameId);
  assert.equal(forwarded.ownership, BufferOwnership.HOST_OWNED);
  assert.equal(forwarded.mutability, BufferMutability.IMMUTABLE);
});

test("forwarding rejects frames after their arena lease closes or advances", () => {
  const arena = new Uint8Array(16);
  const lease = createInvokeArenaLease(arena, { generation: 7 });
  const frame = {
    portId: "atmosphere",
    typeRef: canonicalAtmType(),
    payload: arena.subarray(0, 8),
    ownership: "host-owned",
    mutability: "immutable",
    arenaLease: lease,
    generation: lease.generation,
  };

  lease.advance();
  assert.throws(
    () => forwardOutputFrameAsInput(frame),
    /stale arena lease generation/i,
  );

  const current = { ...frame, generation: lease.generation };
  lease.close();
  assert.throws(
    () => forwardOutputFrameAsInput(current),
    /arena lease is closed/i,
  );
});

test("producer-owned or mutable aliases require one compatible single-use transfer token", () => {
  const arena = new Uint8Array(72);
  const lease = createInvokeArenaLease(arena);
  const frame = {
    portId: "gravity",
    typeRef: {
      ...GRV_TYPE,
      wireFormat: "aligned-binary",
    },
    payload: arena,
    ownership: "producer-owned",
    mutability: "mutable",
    frameId: 99n,
    arenaLease: lease,
    generation: lease.generation,
  };

  assert.throws(
    () => forwardOutputFrameAsInput(frame),
    /producer-owned or mutable.*transfer token/i,
  );
  assert.throws(
    () =>
      encodePluginInvokeRequest({
        methodId: "consume",
        inputs: [frame],
      }),
    /producer-owned or mutable.*transfer/i,
  );
  assert.throws(
    () =>
      encodePluginInvokeRequest({
        methodId: "consume",
        inputs: [{ ...frame, ownership: "transferred" }],
      }),
    /mutable.*transfer/i,
  );

  const transfer = lease.createTransferToken(frame, {
    ownership: "transferred",
    mutability: "mutable",
  });
  const forwarded = forwardOutputFrameAsInput(frame, {
    arenaTransfer: transfer,
  });
  assert.equal(forwarded.payload, frame.payload);
  assert.equal(forwarded.ownership, BufferOwnership.SHARED);
  assert.equal(forwarded.mutability, BufferMutability.MUTABLE);
  assert.equal(forwarded.frameId, 99n);
  assert.doesNotThrow(() =>
    encodePluginInvokeRequest({ methodId: "consume", inputs: [forwarded] }),
  );
  assert.throws(
    () => forwardOutputFrameAsInput(frame, { arenaTransfer: transfer }),
    /transfer token.*already consumed/i,
  );
});

test("explicit canonical copy forwarding does not require a live source lease", () => {
  const payload = Uint8Array.from([7, 6, 5, 4]);
  const forwarded = forwardOutputFrameAsInput(
    {
      portId: "atmosphere",
      typeRef: canonicalAtmType(),
      payload,
      ownership: "producer-owned",
      mutability: "mutable",
      frameId: 44n,
    },
    { copyCanonical: true },
  );

  assert.notEqual(forwarded.payload, payload);
  assert.deepEqual(forwarded.payload, payload);
  assert.equal(forwarded.ownership, BufferOwnership.HOST_OWNED);
  assert.equal(forwarded.mutability, BufferMutability.IMMUTABLE);
  assert.equal(forwarded.frameId, 44n);

  assert.throws(
    () =>
      forwardOutputFrameAsInput(
        {
          portId: "gravity",
          typeRef: { ...GRV_TYPE, wireFormat: "aligned-binary" },
          payload: new Uint8Array(72),
        },
        { copyCanonical: true },
      ),
    /canonical copy.*aligned-binary/i,
  );
});

test("module-to-module hop forwards producer bytes into the consumer without decode/encode", async () => {
  const producerCompilation = await compileModuleFromSource({
    manifest: createManifest(
      "com.digitalarsenal.examples.forward-producer",
      "produce",
      "size",
      ATM_TYPE,
      "artifact",
      GRV_TYPE,
    ),
    sourceCode: PRODUCER_SOURCE,
    language: "c",
  });
  const consumerCompilation = await compileModuleFromSource({
    manifest: createManifest(
      "com.digitalarsenal.examples.forward-consumer",
      "consume",
      "artifact",
      GRV_TYPE,
      "digest",
      ATM_TYPE,
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
      inputs: [
        {
          portId: "size",
          typeRef: {
            schemaName: ATM_TYPE.schemaName,
            fileIdentifier: ATM_TYPE.fileIdentifier,
            rootTypeName: ATM_TYPE.rootTypeName,
            wireFormat: "flatbuffer",
          },
          payload: sizeBytes,
        },
      ],
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
      {
        schemaName: reDecoded.inputs[0].typeRef.schemaName,
        fileIdentifier: reDecoded.inputs[0].typeRef.fileIdentifier,
        rootTypeName: reDecoded.inputs[0].typeRef.rootTypeName,
        schemaVersion: reDecoded.inputs[0].typeRef.schemaVersion,
        schemaHash: reDecoded.inputs[0].typeRef.schemaHash,
        wireFormat: reDecoded.inputs[0].typeRef.wireFormat,
        fixedStringLength: reDecoded.inputs[0].typeRef.fixedStringLength,
        byteLength: reDecoded.inputs[0].typeRef.byteLength,
        requiredAlignment: reDecoded.inputs[0].typeRef.requiredAlignment,
      },
      {
        schemaName: "GRV.fbs",
        fileIdentifier: "$GRV",
        rootTypeName: "GRV",
        schemaVersion: null,
        schemaHash: undefined,
        wireFormat: "flatbuffer",
        fixedStringLength: 0,
        byteLength: 0,
        requiredAlignment: 0,
      },
    );
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
  const payload = Uint8Array.from([1, 2, 3, 4]);
  const arenaLease = createInvokeArenaLease(payload, { generation: 2 });
  const frame = {
    portId: "states",
    payload,
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
    ownership: "host-owned",
    mutability: "immutable",
    arenaLease,
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
  assert.equal(forwarded.arenaLease, arenaLease);
  assert.equal(forwarded.generation, 2);
  assert.equal(forwarded.ownership, BufferOwnership.HOST_OWNED);
  assert.equal(forwarded.mutability, BufferMutability.IMMUTABLE);
  assert.equal(forwarded.frameId, 23n);
  assert.equal(forwarded.endOfStream, true);

  assert.throws(() => forwardOutputFrameAsInput(null), /decoded output frame/);
  assert.throws(
    () => forwardOutputFrameAsInput({ portId: "x" }),
    /payload bytes/,
  );
});
