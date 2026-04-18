import test from "node:test";
import assert from "node:assert/strict";

import * as flatbuffers from "flatbuffers";

import { ENC } from "spacedatastandards.org/lib/js/ENC/main.js";
import { REC } from "spacedatastandards.org/lib/js/REC/REC.js";
import { Record } from "spacedatastandards.org/lib/js/REC/Record.js";
import { RecordType } from "spacedatastandards.org/lib/js/REC/RecordType.js";

import {
  appendPublicationRecordCollection,
  createPublicationNotice,
  decodePublicationRecordCollection,
  encodePublicationRecordCollection,
  extractPublicationRecordCollection,
} from "../src/transport/records.js";

function createMblRecord() {
  return {
    bundleVersion: 1,
    moduleFormat: "space-data-module",
    canonicalization: {
      version: 1,
      strippedCustomSectionPrefix: "sds.",
      bundleSectionName: "rec.mbl",
      hashAlgorithm: "sha256",
    },
    canonicalModuleHash: Uint8Array.from({ length: 32 }, (_, index) => index),
    manifestHash: Uint8Array.from({ length: 32 }, (_, index) => 255 - index),
    manifestExportSymbol: "plugin_get_manifest_flatbuffer",
    manifestSizeSymbol: "plugin_get_manifest_flatbuffer_size",
    entries: [
      {
        entryId: "manifest",
        role: "manifest",
        sectionName: "sds.manifest",
        typeRef: { schemaName: "PluginManifest.fbs", fileIdentifier: "PMAN" },
        payloadEncoding: "flatbuffer",
        payload: Uint8Array.of(1, 2, 3, 4),
        description: "Canonical plugin manifest.",
      },
    ],
  };
}

function createEncRecord() {
  return {
    version: 1,
    keyExchange: "X25519",
    symmetric: "AES_256_CTR",
    keyDerivation: "HKDF_SHA256",
    ephemeralPublicKey: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    nonceStart: Uint8Array.from({ length: 12 }, (_, index) => 200 - index),
    recipientKeyId: Uint8Array.of(1, 2, 3, 4),
    context: "transport-records-test",
    schemaHash: Uint8Array.from({ length: 32 }, () => 7),
    rootType: "ModuleBundle",
    timestamp: 1_744_444_444_000,
  };
}

test("publication record collections round-trip through REC validation with MBL", async () => {
  const payloadBytes = Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);
  const pnm = await createPublicationNotice({
    payloadBytes,
    fileName: "module.wasm",
    fileId: "com.digitalarsenal.examples.transport-records",
  });
  const recordCollectionBytes = encodePublicationRecordCollection({
    mbl: createMblRecord(),
    enc: createEncRecord(),
    pnm,
  });
  const protectedBytes = appendPublicationRecordCollection(
    payloadBytes,
    recordCollectionBytes,
  );
  const parsed = extractPublicationRecordCollection(protectedBytes);
  assert.ok(parsed);
  assert.deepEqual(Array.from(parsed.payloadBytes), Array.from(payloadBytes));
  assert.deepEqual(
    parsed.records.map((record) => record.standard),
    ["MBL", "ENC", "PNM"],
  );
  assert.equal(parsed.enc?.context, "transport-records-test");
  assert.equal(parsed.pnm?.fileName, "module.wasm");
});

test("bogus trailing bytes with a REC identifier are rejected", () => {
  const payloadBytes = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
  const bogusRecordCollectionBytes = new Uint8Array(24);
  bogusRecordCollectionBytes.set(new TextEncoder().encode("$REC"), 4);
  const protectedBytes = appendPublicationRecordCollection(
    payloadBytes,
    bogusRecordCollectionBytes,
  );
  assert.equal(extractPublicationRecordCollection(protectedBytes), null);
  assert.throws(
    () => decodePublicationRecordCollection(bogusRecordCollectionBytes),
    /invalid|bounds|records|missing/i,
  );
});

test("corrupted ENC vector lengths invalidate the REC trailer", async () => {
  const payloadBytes = Uint8Array.of(9, 8, 7, 6, 5, 4, 3, 2);
  const pnm = await createPublicationNotice({
    payloadBytes,
    fileName: "module.wasm",
    fileId: "com.digitalarsenal.examples.transport-records",
  });
  const recordCollectionBytes = encodePublicationRecordCollection({
    enc: createEncRecord(),
    pnm,
  });
  const corrupted = new Uint8Array(recordCollectionBytes);
  const bb = new flatbuffers.ByteBuffer(corrupted);
  const record = REC.getRootAsREC(bb).RECORDS(0, new Record());
  assert.ok(record);
  const encTable = record.value(new ENC());
  assert.ok(encTable);
  const nonceFieldOffset = encTable.bb.__offset(encTable.bb_pos, 14);
  assert.ok(nonceFieldOffset > 0);
  const nonceFieldStart = encTable.bb_pos + nonceFieldOffset;
  const nonceVectorStart = nonceFieldStart + encTable.bb.readInt32(nonceFieldStart);
  corrupted[nonceVectorStart] = 0xff;
  corrupted[nonceVectorStart + 1] = 0xff;
  corrupted[nonceVectorStart + 2] = 0xff;
  corrupted[nonceVectorStart + 3] = 0x7f;
  assert.throws(
    () => decodePublicationRecordCollection(corrupted),
    /invalid|bounds|nonce/i,
  );
});

test("REC record standard and union type mismatches are rejected", async () => {
  const payloadBytes = Uint8Array.of(1, 3, 3, 7);
  const pnm = await createPublicationNotice({
    payloadBytes,
    fileName: "module.wasm",
    fileId: "com.digitalarsenal.examples.transport-records",
  });
  const recordCollectionBytes = encodePublicationRecordCollection({
    enc: createEncRecord(),
    pnm,
  });
  const corrupted = new Uint8Array(recordCollectionBytes);
  const bb = new flatbuffers.ByteBuffer(corrupted);
  const record = REC.getRootAsREC(bb).RECORDS(0, new Record());
  assert.ok(record);
  const valueTypeFieldOffset = record.bb.__offset(record.bb_pos, 4);
  assert.ok(valueTypeFieldOffset > 0);
  corrupted[record.bb_pos + valueTypeFieldOffset] = RecordType.PNM;
  assert.throws(
    () => decodePublicationRecordCollection(corrupted),
    /mismatch|invalid|payload/i,
  );
});
