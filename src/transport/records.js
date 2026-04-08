import * as flatbuffers from "flatbuffers/mjs/flatbuffers.js";

import {
  ENC,
  ENCT,
  KDF,
  KeyExchange,
  SymmetricAlgo,
} from "spacedatastandards.org/lib/js/ENC/main.js";
import { PNM, PNMT } from "spacedatastandards.org/lib/js/PNM/main.js";
import { REC, RECT } from "spacedatastandards.org/lib/js/REC/REC.js";
import { Record, RecordT } from "spacedatastandards.org/lib/js/REC/Record.js";
import { RecordType } from "spacedatastandards.org/lib/js/REC/RecordType.js";

import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  toUint8Array,
} from "../utils/encoding.js";
import { sha256Bytes } from "../utils/wasmCrypto.js";

const TRAILER_MAGIC_TEXT = "$REC";
const TRAILER_MAGIC_BYTES = new TextEncoder().encode(TRAILER_MAGIC_TEXT);
const TRAILER_FOOTER_LENGTH = 8;
const DEFAULT_RECORD_COLLECTION_VERSION = "1.0.0";
const KEY_EXCHANGE_BY_NAME = Object.freeze({
  X25519: KeyExchange.X25519,
  SECP256K1: KeyExchange.Secp256k1,
  P256: KeyExchange.P256,
});
const KEY_EXCHANGE_NAME_BY_VALUE = Object.freeze(
  Object.fromEntries(
    Object.entries(KEY_EXCHANGE_BY_NAME).map(([name, value]) => [value, name]),
  ),
);
const SYMMETRIC_ALGO_BY_NAME = Object.freeze({
  AES_256_CTR: SymmetricAlgo.AES_256_CTR,
});
const SYMMETRIC_ALGO_NAME_BY_VALUE = Object.freeze(
  Object.fromEntries(
    Object.entries(SYMMETRIC_ALGO_BY_NAME).map(([name, value]) => [value, name]),
  ),
);
const KDF_BY_NAME = Object.freeze({
  HKDF_SHA256: KDF.HKDF_SHA256,
});
const KDF_NAME_BY_VALUE = Object.freeze(
  Object.fromEntries(
    Object.entries(KDF_BY_NAME).map(([name, value]) => [value, name]),
  ),
);
const RECORD_TYPE_BY_STANDARD = Object.freeze({
  ENC: RecordType.ENC,
  PNM: RecordType.PNM,
});
const STANDARD_BY_RECORD_TYPE = Object.freeze(
  Object.fromEntries(
    Object.entries(RECORD_TYPE_BY_STANDARD).map(([standard, value]) => [
      value,
      standard,
    ]),
  ),
);
const textEncoder = new TextEncoder();

function assertBounds(buffer, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > buffer.length
  ) {
    throw new Error(`${label} is out of bounds.`);
  }
}

function readUint16LE(buffer, offset, label) {
  assertBounds(buffer, offset, 2, label);
  return buffer[offset] | (buffer[offset + 1] << 8);
}

function getRecordValueType(recordTable) {
  if (typeof recordTable.valueType === "function") {
    return recordTable.valueType();
  }
  if (typeof recordTable.value_type === "function") {
    return recordTable.value_type();
  }
  throw new TypeError("REC record table does not expose a value type accessor.");
}

function readUint32LE(buffer, offset, label) {
  assertBounds(buffer, offset, 4, label);
  return (
    buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16) |
    (buffer[offset + 3] << 24)
  ) >>> 0;
}

function readInt32LE(buffer, offset, label) {
  return readUint32LE(buffer, offset, label) | 0;
}

function readTableFieldOffset(buffer, tableMeta, vtableFieldOffset) {
  const fieldEntryOffset = tableMeta.vtableStart + vtableFieldOffset;
  if (fieldEntryOffset + 2 > tableMeta.vtableEnd) {
    return 0;
  }
  return readUint16LE(buffer, fieldEntryOffset, `${tableMeta.label} field offset`);
}

function resolveRelativeOffset(buffer, offset, label) {
  const relativeOffset = readInt32LE(buffer, offset, label);
  const target = offset + relativeOffset;
  if (!Number.isSafeInteger(target) || target < 0 || target > buffer.length - 4) {
    throw new Error(`${label} points outside the FlatBuffer.`);
  }
  return target;
}

function assertFlatbufferIdentifier(buffer, identifier, label) {
  if (identifier.length !== flatbuffers.FILE_IDENTIFIER_LENGTH) {
    throw new Error(`FlatBuffer identifier "${identifier}" must be 4 bytes.`);
  }
  assertBounds(
    buffer,
    flatbuffers.SIZEOF_INT,
    flatbuffers.FILE_IDENTIFIER_LENGTH,
    `${label} identifier`,
  );
  for (let index = 0; index < identifier.length; index += 1) {
    if (buffer[flatbuffers.SIZEOF_INT + index] !== identifier.charCodeAt(index)) {
      throw new Error(`${label} is missing the ${identifier} file identifier.`);
    }
  }
}

function assertFlatbufferTable(buffer, tableStart, label) {
  assertBounds(buffer, tableStart, 4, `${label} table header`);
  const vtableDistance = readInt32LE(buffer, tableStart, `${label} vtable offset`);
  const vtableStart = tableStart - vtableDistance;
  if (
    !Number.isSafeInteger(vtableStart) ||
    vtableStart < 0 ||
    vtableStart > buffer.length - 4
  ) {
    throw new Error(`${label} vtable offset is invalid.`);
  }
  const vtableLength = readUint16LE(buffer, vtableStart, `${label} vtable length`);
  const objectLength = readUint16LE(
    buffer,
    vtableStart + 2,
    `${label} object length`,
  );
  if (vtableLength < 4 || (vtableLength & 1) !== 0) {
    throw new Error(`${label} vtable length is invalid.`);
  }
  if (objectLength < 4) {
    throw new Error(`${label} object length is invalid.`);
  }
  assertBounds(buffer, vtableStart, vtableLength, `${label} vtable`);
  assertBounds(buffer, tableStart, objectLength, `${label} object`);
  for (let entryOffset = vtableStart + 4; entryOffset < vtableStart + vtableLength; entryOffset += 2) {
    const fieldOffset = readUint16LE(buffer, entryOffset, `${label} field entry`);
    if (fieldOffset !== 0 && (fieldOffset < 4 || fieldOffset >= objectLength)) {
      throw new Error(`${label} field offset is invalid.`);
    }
  }
  return {
    label,
    tableStart,
    tableEnd: tableStart + objectLength,
    objectLength,
    vtableStart,
    vtableEnd: vtableStart + vtableLength,
    vtableLength,
  };
}

function assertRootFlatbufferTable(buffer, identifier, label) {
  assertFlatbufferIdentifier(buffer, identifier, label);
  const rootTableStart = readUint32LE(buffer, 0, `${label} root offset`);
  if (
    !Number.isSafeInteger(rootTableStart) ||
    rootTableStart < flatbuffers.SIZEOF_INT + flatbuffers.FILE_IDENTIFIER_LENGTH ||
    rootTableStart > buffer.length - 4
  ) {
    throw new Error(`${label} root offset is invalid.`);
  }
  return assertFlatbufferTable(buffer, rootTableStart, label);
}

function assertOptionalStringField(buffer, tableMeta, vtableFieldOffset, label) {
  const fieldOffset = readTableFieldOffset(buffer, tableMeta, vtableFieldOffset);
  if (fieldOffset === 0) {
    return null;
  }
  const fieldStart = tableMeta.tableStart + fieldOffset;
  const stringStart = resolveRelativeOffset(buffer, fieldStart, label);
  const stringLength = readUint32LE(buffer, stringStart, `${label} length`);
  assertBounds(buffer, stringStart + 4, stringLength, `${label} data`);
  return {
    fieldStart,
    stringStart,
    stringLength,
  };
}

function assertOptionalByteVectorField(
  buffer,
  tableMeta,
  vtableFieldOffset,
  label,
  { minLength = 0, maxLength = Number.MAX_SAFE_INTEGER } = {},
) {
  const fieldOffset = readTableFieldOffset(buffer, tableMeta, vtableFieldOffset);
  if (fieldOffset === 0) {
    return null;
  }
  const fieldStart = tableMeta.tableStart + fieldOffset;
  const vectorStart = resolveRelativeOffset(buffer, fieldStart, label);
  const vectorLength = readUint32LE(buffer, vectorStart, `${label} length`);
  if (vectorLength < minLength || vectorLength > maxLength) {
    throw new Error(`${label} length is invalid.`);
  }
  assertBounds(buffer, vectorStart + 4, vectorLength, `${label} data`);
  return {
    fieldStart,
    vectorStart,
    vectorLength,
  };
}

function assertTableVectorField(buffer, tableMeta, vtableFieldOffset, label) {
  const fieldOffset = readTableFieldOffset(buffer, tableMeta, vtableFieldOffset);
  if (fieldOffset === 0) {
    return [];
  }
  const fieldStart = tableMeta.tableStart + fieldOffset;
  const vectorStart = resolveRelativeOffset(buffer, fieldStart, label);
  const vectorLength = readUint32LE(buffer, vectorStart, `${label} length`);
  const vectorDataStart = vectorStart + 4;
  assertBounds(
    buffer,
    vectorDataStart,
    vectorLength * 4,
    `${label} offsets`,
  );
  const elements = [];
  for (let index = 0; index < vectorLength; index += 1) {
    const elementOffset = vectorDataStart + index * 4;
    const tableStart = resolveRelativeOffset(
      buffer,
      elementOffset,
      `${label}[${index}]`,
    );
    elements.push(
      assertFlatbufferTable(buffer, tableStart, `${label}[${index}]`),
    );
  }
  return elements;
}

function assertUnionTableField(buffer, tableMeta, vtableFieldOffset, label) {
  const fieldOffset = readTableFieldOffset(buffer, tableMeta, vtableFieldOffset);
  if (fieldOffset === 0) {
    return null;
  }
  const fieldStart = tableMeta.tableStart + fieldOffset;
  const tableStart = resolveRelativeOffset(buffer, fieldStart, label);
  return assertFlatbufferTable(buffer, tableStart, label);
}

function validateEncTable(table, buffer, label) {
  const tableMeta = assertFlatbufferTable(buffer, table.bb_pos, label);
  assertOptionalByteVectorField(buffer, tableMeta, 12, `${label} ephemeral public key`, {
    minLength: 1,
    maxLength: 65,
  });
  assertOptionalByteVectorField(buffer, tableMeta, 14, `${label} nonce start`, {
    minLength: 12,
    maxLength: 12,
  });
  assertOptionalByteVectorField(buffer, tableMeta, 16, `${label} recipient key id`, {
    maxLength: 32,
  });
  assertOptionalStringField(buffer, tableMeta, 18, `${label} context`);
  assertOptionalByteVectorField(buffer, tableMeta, 20, `${label} schema hash`, {
    maxLength: 32,
  });
  assertOptionalStringField(buffer, tableMeta, 22, `${label} root type`);
  const timestamp = table.TIMESTAMP();
  const record = {
    version: Number(table.VERSION()),
    keyExchange:
      KEY_EXCHANGE_NAME_BY_VALUE[table.KEY_EXCHANGE()] ??
      String(table.KEY_EXCHANGE()),
    symmetric:
      SYMMETRIC_ALGO_NAME_BY_VALUE[table.SYMMETRIC()] ??
      String(table.SYMMETRIC()),
    keyDerivation:
      KDF_NAME_BY_VALUE[table.KEY_DERIVATION()] ??
      String(table.KEY_DERIVATION()),
    ephemeralPublicKey: normalizeByteField(table.ephemeralPublicKeyArray()),
    nonceStart: normalizeByteField(table.nonceStartArray()),
    recipientKeyId: normalizeByteField(table.recipientKeyIdArray()),
    context: normalizeStringField(table.CONTEXT()),
    schemaHash: normalizeByteField(table.schemaHashArray()),
    rootType: normalizeStringField(table.ROOT_TYPE()),
    timestamp:
      timestamp === undefined || timestamp === null ? 0 : Number(timestamp),
  };
  if (!record.ephemeralPublicKey?.length) {
    throw new Error(`${label} is missing the ephemeral public key.`);
  }
  if (!record.nonceStart || record.nonceStart.length !== 12) {
    throw new Error(`${label} nonce start must be 12 bytes.`);
  }
  if (
    record.keyExchange === "X25519" &&
    record.ephemeralPublicKey.length !== 32
  ) {
    throw new Error(`${label} X25519 ephemeral public key must be 32 bytes.`);
  }
  if (
    record.keyExchange !== "X25519" &&
    (record.ephemeralPublicKey.length < 32 || record.ephemeralPublicKey.length > 65)
  ) {
    throw new Error(`${label} ephemeral public key length is invalid.`);
  }
  if (record.recipientKeyId && record.recipientKeyId.length > 32) {
    throw new Error(`${label} recipient key id is too large.`);
  }
  if (record.schemaHash && record.schemaHash.length !== 32) {
    throw new Error(`${label} schema hash must be 32 bytes when present.`);
  }
  return record;
}

function validatePnmTable(table, buffer, label) {
  const tableMeta = assertFlatbufferTable(buffer, table.bb_pos, label);
  assertOptionalStringField(buffer, tableMeta, 4, `${label} multiformat address`);
  assertOptionalStringField(buffer, tableMeta, 6, `${label} publish timestamp`);
  assertOptionalStringField(buffer, tableMeta, 8, `${label} cid`);
  assertOptionalStringField(buffer, tableMeta, 10, `${label} file name`);
  assertOptionalStringField(buffer, tableMeta, 12, `${label} file id`);
  assertOptionalStringField(buffer, tableMeta, 14, `${label} signature`);
  assertOptionalStringField(buffer, tableMeta, 16, `${label} timestamp signature`);
  assertOptionalStringField(buffer, tableMeta, 18, `${label} signature type`);
  assertOptionalStringField(buffer, tableMeta, 20, `${label} timestamp signature type`);
  const record = {
    multiformatAddress: normalizeStringField(table.MULTIFORMAT_ADDRESS()),
    publishTimestamp: normalizeStringField(table.PUBLISH_TIMESTAMP()),
    cid: normalizeStringField(table.CID()),
    fileName: normalizeStringField(table.FILE_NAME()),
    fileId: normalizeStringField(table.FILE_ID()),
    signature: normalizeStringField(table.SIGNATURE()),
    timestampSignature: normalizeStringField(table.TIMESTAMP_SIGNATURE()),
    signatureType: normalizeStringField(table.SIGNATURE_TYPE()),
    timestampSignatureType: normalizeStringField(table.TIMESTAMP_SIGNATURE_TYPE()),
  };
  if (
    !record.multiformatAddress &&
    !record.publishTimestamp &&
    !record.cid &&
    !record.fileName &&
    !record.fileId &&
    !record.signature &&
    !record.timestampSignature &&
    !record.signatureType &&
    !record.timestampSignatureType
  ) {
    throw new Error(`${label} must contain at least one populated field.`);
  }
  return record;
}

function concatBytes(chunks) {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function normalizeByteField(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = toUint8Array(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeStringField(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeKeyExchange(value) {
  if (typeof value === "number") {
    return value;
  }
  return KEY_EXCHANGE_BY_NAME[
    String(value ?? "X25519")
      .trim()
      .replace(/[^A-Za-z0-9]+/g, "_")
      .toUpperCase()
  ] ?? KeyExchange.X25519;
}

function normalizeSymmetricAlgorithm(value) {
  if (typeof value === "number") {
    return value;
  }
  return SYMMETRIC_ALGO_BY_NAME[
    String(value ?? "AES_256_CTR")
      .trim()
      .replace(/[^A-Za-z0-9]+/g, "_")
      .toUpperCase()
  ] ?? SymmetricAlgo.AES_256_CTR;
}

function normalizeKdf(value) {
  if (typeof value === "number") {
    return value;
  }
  return KDF_BY_NAME[
    String(value ?? "HKDF_SHA256")
      .trim()
      .replace(/[^A-Za-z0-9]+/g, "_")
      .toUpperCase()
  ] ?? KDF.HKDF_SHA256;
}

function encTableFromObject(record = {}) {
  return new ENCT(
    Number(record.version ?? 1),
    normalizeKeyExchange(record.keyExchange),
    normalizeSymmetricAlgorithm(record.symmetric),
    normalizeKdf(record.keyDerivation),
    Array.from(toUint8Array(record.ephemeralPublicKey)),
    Array.from(toUint8Array(record.nonceStart)),
    Array.from(normalizeByteField(record.recipientKeyId) ?? []),
    normalizeStringField(record.context),
    Array.from(normalizeByteField(record.schemaHash) ?? []),
    normalizeStringField(record.rootType),
    BigInt(record.timestamp ?? 0),
  );
}

function pnmTableFromObject(record = {}) {
  return new PNMT(
    normalizeStringField(record.multiformatAddress),
    normalizeStringField(record.publishTimestamp),
    normalizeStringField(record.cid),
    normalizeStringField(record.fileName),
    normalizeStringField(record.fileId),
    normalizeStringField(record.signature),
    normalizeStringField(record.timestampSignature),
    normalizeStringField(record.signatureType),
    normalizeStringField(record.timestampSignatureType),
  );
}

function readFooterLength(bytes) {
  const view = toUint8Array(bytes);
  if (view.length < TRAILER_FOOTER_LENGTH) {
    return null;
  }
  const footerOffset = view.length - TRAILER_FOOTER_LENGTH;
  for (let index = 0; index < TRAILER_MAGIC_BYTES.length; index += 1) {
    if (view[footerOffset + 4 + index] !== TRAILER_MAGIC_BYTES[index]) {
      return null;
    }
  }
  return new DataView(
    view.buffer,
    view.byteOffset + footerOffset,
    TRAILER_FOOTER_LENGTH,
  ).getUint32(0, true);
}

function encodeFooter(recordCollectionLength) {
  if (
    !Number.isSafeInteger(recordCollectionLength) ||
    recordCollectionLength < 0 ||
    recordCollectionLength > 0xffff_ffff
  ) {
    throw new RangeError("REC trailer length must fit in uint32.");
  }
  const footer = new Uint8Array(TRAILER_FOOTER_LENGTH);
  const view = new DataView(footer.buffer);
  view.setUint32(0, recordCollectionLength, true);
  footer.set(TRAILER_MAGIC_BYTES, 4);
  return footer;
}

function toBase32Lower(bytes) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of toUint8Array(bytes)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += alphabet[(value << (5 - bits)) & 31];
  }
  return out;
}

export async function createCidV1Raw(payloadBytes) {
  const digest = await sha256Bytes(payloadBytes);
  const cidBytes = concatBytes([
    Uint8Array.of(0x01), // cidv1
    Uint8Array.of(0x55), // raw
    Uint8Array.of(0x12, digest.length), // sha2-256 multihash
    digest,
  ]);
  return `b${toBase32Lower(cidBytes)}`;
}

export function encodeEncRecord(record = {}) {
  const builder = new flatbuffers.Builder(256);
  const table = encTableFromObject(record);
  const root = table.pack(builder);
  ENC.finishENCBuffer(builder, root);
  return builder.asUint8Array();
}

export function decodeEncRecord(bytes) {
  const buffer = toUint8Array(bytes);
  assertRootFlatbufferTable(buffer, "$ENC", "ENC record");
  const bb = new flatbuffers.ByteBuffer(buffer);
  return validateEncTable(ENC.getRootAsENC(bb), buffer, "ENC record");
}

export function encodePnmRecord(record = {}) {
  const builder = new flatbuffers.Builder(256);
  const table = pnmTableFromObject(record);
  const root = table.pack(builder);
  PNM.finishPNMBuffer(builder, root);
  return builder.asUint8Array();
}

export function decodePnmRecord(bytes) {
  const buffer = toUint8Array(bytes);
  assertRootFlatbufferTable(buffer, "$PNM", "PNM record");
  const bb = new flatbuffers.ByteBuffer(buffer);
  return validatePnmTable(PNM.getRootAsPNM(bb), buffer, "PNM record");
}

export function encodePublicationRecordCollection(options = {}) {
  const records = [];
  if (options.enc) {
    records.push(new RecordT(RECORD_TYPE_BY_STANDARD.ENC, encTableFromObject(options.enc), "ENC"));
  }
  if (options.pnm) {
    records.push(new RecordT(RECORD_TYPE_BY_STANDARD.PNM, pnmTableFromObject(options.pnm), "PNM"));
  }
  if (records.length === 0) {
    throw new Error("At least one ENC or PNM record is required.");
  }
  const builder = new flatbuffers.Builder(512);
  const root = new RECT(
    normalizeStringField(options.version) ?? DEFAULT_RECORD_COLLECTION_VERSION,
    records,
  ).pack(builder);
  REC.finishRECBuffer(builder, root);
  return builder.asUint8Array();
}

export function decodePublicationRecordCollection(bytes) {
  const buffer = toUint8Array(bytes);
  assertRootFlatbufferTable(buffer, "$REC", "REC trailer");
  const bb = new flatbuffers.ByteBuffer(buffer);
  const collectionTable = REC.getRootAsREC(bb);
  const collectionMeta = assertFlatbufferTable(
    buffer,
    collectionTable.bb_pos,
    "REC trailer",
  );
  assertOptionalStringField(buffer, collectionMeta, 4, "REC trailer version");
  const recordTables = assertTableVectorField(
    buffer,
    collectionMeta,
    6,
    "REC trailer records",
  );
  if (recordTables.length === 0) {
    throw new Error("REC trailer does not contain any records.");
  }
  const records = [];
  let enc = null;
  let pnm = null;
  for (let index = 0; index < recordTables.length; index += 1) {
    const recordTable =
      collectionTable.RECORDS(index, new Record()) ?? null;
    if (!recordTable) {
      throw new Error(`REC trailer record ${index} could not be loaded.`);
    }
    const recordMeta = assertFlatbufferTable(
      buffer,
      recordTable.bb_pos,
      `REC trailer record ${index}`,
    );
    assertOptionalStringField(
      buffer,
      recordMeta,
      8,
      `REC trailer record ${index} standard`,
    );
    const recordType = getRecordValueType(recordTable);
    const standard =
      normalizeStringField(recordTable.standard()) ??
      STANDARD_BY_RECORD_TYPE[recordType] ??
      null;
    const expectedStandard =
      STANDARD_BY_RECORD_TYPE[recordType] ?? null;
    if (standard && expectedStandard && standard !== expectedStandard) {
      throw new Error(
        `REC trailer record ${index} standard/type mismatch (${standard} vs ${expectedStandard}).`,
      );
    }
    const valueMeta = assertUnionTableField(
      buffer,
      recordMeta,
      6,
      `REC trailer record ${index} value`,
    );
    if (!valueMeta) {
      throw new Error(`REC trailer record ${index} is missing a value.`);
    }
    let value = null;
    if (standard === "ENC") {
      const encTable = recordTable.value(new ENC());
      if (!encTable) {
        throw new Error(`REC trailer record ${index} ENC payload is missing.`);
      }
      if (enc) {
        throw new Error("REC trailer contains multiple ENC records.");
      }
      enc = validateEncTable(
        encTable,
        buffer,
        `REC trailer record ${index} ENC payload`,
      );
      value = enc;
    } else if (standard === "PNM") {
      const pnmTable = recordTable.value(new PNM());
      if (!pnmTable) {
        throw new Error(`REC trailer record ${index} PNM payload is missing.`);
      }
      if (pnm) {
        throw new Error("REC trailer contains multiple PNM records.");
      }
      pnm = validatePnmTable(
        pnmTable,
        buffer,
        `REC trailer record ${index} PNM payload`,
      );
      value = pnm;
    }
    records.push({
      standard,
      recordType,
      value,
    });
  }
  return {
    version:
      normalizeStringField(collectionTable.version()) ??
      DEFAULT_RECORD_COLLECTION_VERSION,
    records,
    enc,
    pnm,
    recordCollectionBytes: buffer,
  };
}

export function appendPublicationRecordCollection(
  payloadBytes,
  recordCollectionBytes,
) {
  const payload = toUint8Array(payloadBytes);
  const recordCollection = toUint8Array(recordCollectionBytes);
  return concatBytes([
    payload,
    recordCollection,
    encodeFooter(recordCollection.length),
  ]);
}

export function stripPublicationRecordCollection(bytes) {
  const parsed = extractPublicationRecordCollection(bytes);
  return parsed?.payloadBytes ?? toUint8Array(bytes);
}

export function extractPublicationRecordCollection(bytes) {
  const buffer = toUint8Array(bytes);
  const recordCollectionLength = readFooterLength(buffer);
  if (recordCollectionLength === null) {
    return null;
  }
  const footerOffset = buffer.length - TRAILER_FOOTER_LENGTH;
  const recordCollectionOffset = footerOffset - recordCollectionLength;
  if (recordCollectionOffset < 0) {
    return null;
  }
  const recordCollectionBytes = buffer.subarray(
    recordCollectionOffset,
    footerOffset,
  );
  try {
    const decoded = decodePublicationRecordCollection(recordCollectionBytes);
    return {
      ...decoded,
      payloadBytes: buffer.subarray(0, recordCollectionOffset),
      protectedBytes: buffer,
      footerBytes: buffer.subarray(footerOffset),
      footerMagic: TRAILER_MAGIC_TEXT,
      recordCollectionLength,
    };
  } catch {
    return null;
  }
}

export async function createPublicationNotice(options = {}) {
  const payloadBytes = toUint8Array(options.payloadBytes);
  const cid = normalizeStringField(options.cid) ?? (await createCidV1Raw(payloadBytes));
  const publishTimestamp =
    normalizeStringField(options.publishTimestamp) ??
    new Date(
      Number.isFinite(options.publishTimestampMs)
        ? options.publishTimestampMs
        : Date.now(),
    ).toISOString();
  const fileName =
    normalizeStringField(options.fileName) ??
    normalizeStringField(options.artifactId) ??
    "module.wasm";
  const fileId =
    normalizeStringField(options.fileId) ??
    normalizeStringField(options.programId) ??
    normalizeStringField(options.artifactId) ??
    "module";
  const multiformatAddress =
    normalizeStringField(options.multiformatAddress) ?? `/ipfs/${cid}`;

  let signature = normalizeStringField(options.signature);
  let timestampSignature = normalizeStringField(options.timestampSignature);
  let signatureType = normalizeStringField(options.signatureType);
  let timestampSignatureType = normalizeStringField(options.timestampSignatureType);
  if (options.signer && typeof options.signer.sign === "function") {
    signature = bytesToHex(await options.signer.sign(textEncoder.encode(cid)));
    timestampSignature = bytesToHex(
      await options.signer.sign(textEncoder.encode(publishTimestamp)),
    );
    signatureType =
      signatureType ??
      normalizeStringField(options.signer.algorithm) ??
      "unknown";
    timestampSignatureType =
      timestampSignatureType ??
      normalizeStringField(options.signer.algorithm) ??
      "unknown";
  }

  return {
    multiformatAddress,
    publishTimestamp,
    cid,
    fileName,
    fileId,
    signature,
    timestampSignature,
    signatureType,
    timestampSignatureType,
  };
}

export function createEncryptedEnvelopePayload(options = {}) {
  const protectedBlob = toUint8Array(options.protectedBlobBytes);
  const parsed =
    options.parsedProtectedBlob ?? extractPublicationRecordCollection(protectedBlob);
  const enc = options.enc ?? parsed?.enc ?? null;
  const envelope = {
    version: Number(options.version ?? 2),
    scheme:
      normalizeStringField(options.scheme) ?? "x25519-hkdf-aes-256-ctr-rec",
    context: normalizeStringField(options.context ?? enc?.context) ?? "",
    protectedBlobBase64: bytesToBase64(protectedBlob),
    recordCollectionBase64: parsed
      ? bytesToBase64(parsed.recordCollectionBytes)
      : null,
    ciphertextBase64: parsed ? bytesToBase64(parsed.payloadBytes) : null,
  };
  if (enc?.ephemeralPublicKey) {
    envelope.senderPublicKeyBase64 = bytesToBase64(enc.ephemeralPublicKey);
  }
  if (enc?.nonceStart) {
    envelope.nonceStartBase64 = bytesToBase64(enc.nonceStart);
  }
  if (enc?.recipientKeyId) {
    envelope.recipientKeyIdBase64 = bytesToBase64(enc.recipientKeyId);
  }
  if (enc) {
    envelope.encRecordBase64 = bytesToBase64(encodeEncRecord(enc));
  }
  if (parsed?.pnm) {
    envelope.pnmRecordBase64 = bytesToBase64(encodePnmRecord(parsed.pnm));
  }
  return envelope;
}

export function decodeProtectedBlobBase64(base64) {
  const bytes = base64ToBytes(base64);
  return extractPublicationRecordCollection(bytes);
}

export { TRAILER_MAGIC_TEXT, TRAILER_FOOTER_LENGTH };
