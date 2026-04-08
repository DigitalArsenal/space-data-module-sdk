import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import {
  createFlatBufferStreamIngestor,
  createFlatSqlRuntimeStore,
} from "../src/index.js";

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

test("runtime-host stream ingestor appends chunked size-prefixed FlatBuffer frames into row storage", () => {
  const rows = createFlatSqlRuntimeStore();
  const ingestor = createFlatBufferStreamIngestor({ rows });
  const ommPayload = createFlatBufferPayload("OMM ");
  const entityPayload = createFlatBufferPayload("ENTM");
  const stream = concatUint8Arrays([
    createSizePrefixedFrame(ommPayload),
    createSizePrefixedFrame(entityPayload),
  ]);

  assert.equal(ingestor.pushBytes(stream.subarray(0, 5)), 0);
  assert.equal(ingestor.pushBytes(stream.subarray(5, 19)), 0);
  assert.equal(ingestor.pushBytes(stream.subarray(19)), 2);
  assert.equal(ingestor.finish(), 0);

  const storedRows = rows.listRows();
  assert.equal(storedRows.length, 2);
  assert.deepEqual(storedRows[0].handle, { schemaFileId: "OMM", rowId: 1 });
  assert.deepEqual(storedRows[1].handle, { schemaFileId: "ENTM", rowId: 1 });
  assert.ok(storedRows[0].payload instanceof Uint8Array);
  assert.ok(storedRows[1].payload instanceof Uint8Array);
  assert.deepEqual(storedRows[0].payload, ommPayload);
  assert.deepEqual(storedRows[1].payload, entityPayload);
  assert.equal(ingestor.stats.framesDecoded, 2);
  assert.equal(ingestor.stats.framesAppended, 2);
  assert.equal(ingestor.stats.framesRouted, 0);
});

test("runtime-host stream ingestor supports router interception with fallthrough", () => {
  const rows = createFlatSqlRuntimeStore();
  const routedPayloads = [];
  const ingestor = createFlatBufferStreamIngestor({
    rows,
    frameRouter: {
      "$REC"(payload, context) {
        routedPayloads.push({
          schemaFileId: context.schemaFileId,
          byteLength: payload.byteLength,
        });
        return true;
      },
      OMM() {
        return false;
      },
    },
  });
  const recordPayload = createFlatBufferPayload("$REC");
  const ommPayload = createFlatBufferPayload("OMM ");
  const stream = concatUint8Arrays([
    createSizePrefixedFrame(recordPayload),
    createSizePrefixedFrame(ommPayload),
  ]);

  assert.equal(ingestor.pushBytes(stream), 1);
  assert.equal(ingestor.finish(), 0);

  assert.deepEqual(routedPayloads, [
    {
      schemaFileId: "$REC",
      byteLength: recordPayload.byteLength,
    },
  ]);
  assert.deepEqual(rows.listRows().map((row) => row.handle), [
    { schemaFileId: "OMM", rowId: 1 },
  ]);
  assert.equal(ingestor.stats.framesDecoded, 2);
  assert.equal(ingestor.stats.framesRouted, 1);
  assert.equal(ingestor.stats.framesAppended, 1);
});

const maybeLargeVolumeTest =
  process.env.SPACE_DATA_MODULE_SDK_ENABLE_1GB_STREAM_TEST === "1"
    ? test
    : test.skip;

maybeLargeVolumeTest(
  "runtime-host stream ingestor benchmarks 1 GiB of framed FlatBuffer payloads",
  () => {
    const targetBytes = Number(
      process.env.SPACE_DATA_MODULE_SDK_STREAM_BENCH_BYTES ??
        1024 * 1024 * 1024,
    );
    const payloadSize = Number(
      process.env.SPACE_DATA_MODULE_SDK_STREAM_BENCH_PAYLOAD_BYTES ??
        64 * 1024,
    );
    const chunkSize = Number(
      process.env.SPACE_DATA_MODULE_SDK_STREAM_BENCH_CHUNK_BYTES ??
        256 * 1024,
    );
    const payload = createFlatBufferPayload("OMM ", payloadSize);
    const frame = createSizePrefixedFrame(payload);
    const totalFrames = Math.ceil(targetBytes / payload.byteLength);
    const ingestor = createFlatBufferStreamIngestor({
      appendFrame() {
        return undefined;
      },
    });

    let processedPayloadBytes = 0;
    let bufferedChunk = new Uint8Array(0);
    const startedAt = performance.now();

    while (processedPayloadBytes < targetBytes) {
      if (bufferedChunk.byteLength + frame.byteLength > chunkSize) {
        ingestor.pushBytes(bufferedChunk);
        bufferedChunk = new Uint8Array(0);
      }
      bufferedChunk = concatUint8Arrays([bufferedChunk, frame]);
      processedPayloadBytes += payload.byteLength;
    }

    if (bufferedChunk.byteLength > 0) {
      ingestor.pushBytes(bufferedChunk);
    }
    assert.equal(ingestor.finish(), 0);

    const elapsedMs = performance.now() - startedAt;
    const throughputMiBPerSec =
      processedPayloadBytes / (1024 * 1024) / Math.max(elapsedMs / 1000, 0.001);

    assert.equal(ingestor.stats.framesDecoded, totalFrames);
    assert.equal(ingestor.stats.framesAppended, totalFrames);
    assert.ok(elapsedMs > 0);
    assert.ok(Number.isFinite(throughputMiBPerSec));
    console.log(
      JSON.stringify({
        benchmark: "runtime-host-stream-ingest-1gib",
        payloadBytes: processedPayloadBytes,
        frames: ingestor.stats.framesDecoded,
        elapsedMs: Math.round(elapsedMs),
        throughputMiBPerSec: Number(throughputMiBPerSec.toFixed(2)),
      }),
    );
  },
);
