import * as flatbuffers from "flatbuffers/mjs/flatbuffers.js";

import { BPF, BPFT } from "spacedatastandards.org/lib/js/BPF/BPF.js";
import { BPFAttestationT } from "spacedatastandards.org/lib/js/BPF/BPFAttestation.js";
import { BPFModuleT } from "spacedatastandards.org/lib/js/BPF/BPFModule.js";
import { BPFPartT } from "spacedatastandards.org/lib/js/BPF/BPFPart.js";
import { BPFRuntimeLockT } from "spacedatastandards.org/lib/js/BPF/BPFRuntimeLock.js";
import { bpfLicenseMode } from "spacedatastandards.org/lib/js/BPF/bpfLicenseMode.js";
import { bpfPartKind } from "spacedatastandards.org/lib/js/BPF/bpfPartKind.js";
import { bpfProtectionTier } from "spacedatastandards.org/lib/js/BPF/bpfProtectionTier.js";
import {
  ENC,
  ENCT,
  KDF,
  KeyExchange,
  SymmetricAlgo,
} from "spacedatastandards.org/lib/js/ENC/main.js";
import { MBL } from "spacedatastandards.org/lib/js/MBL/main.js";
import { PNM, PNMT } from "spacedatastandards.org/lib/js/PNM/main.js";
import { REC, RECT } from "spacedatastandards.org/lib/js/REC/REC.js";
import { Record, RecordT } from "spacedatastandards.org/lib/js/REC/Record.js";
import { RecordType } from "spacedatastandards.org/lib/js/REC/RecordType.js";
import {
  decodeModuleBundleTable,
  encodeModuleBundle,
  moduleBundleTableFromObject,
} from "../bundle/codec.js";

import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
  toUint8Array,
} from "../utils/encoding.js";
import {
  ed25519PublicKey,
  ed25519Sign,
  ed25519Verify,
  sha256Bytes,
} from "../utils/wasmCrypto.js";

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
// AES_256_GCM is not yet published in the spacedatastandards.org generated
// SymmetricAlgo enum (which only defines AES_256_CTR = 0). The SYMMETRIC field
// is a plain byte on the wire, so value 1 is encoded directly until the schema
// publishes the enum member.
const SYMMETRIC_ALGO_AES_256_GCM = 1;
const SYMMETRIC_ALGO_BY_NAME = Object.freeze({
  AES_256_CTR: SymmetricAlgo.AES_256_CTR,
  AES_256_GCM: SYMMETRIC_ALGO_AES_256_GCM,
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
  MBL: RecordType.MBL,
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
  const normalized = String(value ?? "AES_256_GCM")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase();
  const resolved = SYMMETRIC_ALGO_BY_NAME[normalized];
  if (resolved === undefined) {
    throw new Error(`Unsupported ENC symmetric algorithm "${value}".`);
  }
  return resolved;
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
  if (options.mbl) {
    records.push(
      new RecordT(
        RECORD_TYPE_BY_STANDARD.MBL,
        moduleBundleTableFromObject(options.mbl),
        "MBL",
      ),
    );
  }
  if (options.enc) {
    records.push(new RecordT(RECORD_TYPE_BY_STANDARD.ENC, encTableFromObject(options.enc), "ENC"));
  }
  if (options.pnm) {
    records.push(new RecordT(RECORD_TYPE_BY_STANDARD.PNM, pnmTableFromObject(options.pnm), "PNM"));
  }
  if (records.length === 0) {
    throw new Error("At least one MBL, ENC, or PNM record is required.");
  }
  const builder = new flatbuffers.Builder(1024);
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
  let mbl = null;
  let mblBytes = null;
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
      console.warn(
        `REC trailer record ${index} standard/type drift (${standard} from Record.standard vs ${expectedStandard} from local RecordType ${recordType}); decoding by Record.standard.`,
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
    if (standard === "MBL") {
      const mblTable = recordTable.value(new MBL());
      if (!mblTable) {
        throw new Error(`REC trailer record ${index} MBL payload is missing.`);
      }
      if (mbl) {
        throw new Error("REC trailer contains multiple MBL records.");
      }
      mbl = decodeModuleBundleTable(mblTable);
      mblBytes = encodeModuleBundle(mbl);
      value = mbl;
    } else if (standard === "ENC") {
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
    mbl,
    mblBytes,
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
      normalizeStringField(options.scheme) ?? "x25519-hkdf-aes-256-gcm-rec",
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

/* ------------------------------------------------------------------------ *
 * $BPF — Build Profile (SDS ordinal 227, published in
 * spacedatastandards.org 1.200.0).
 *
 * A build profile is the authoring-time CONFIGURATION of one composed build.
 * It names no licensee, carries no key material, and confers no rights — it
 * is not a grant ($LGR), not a license key ($PLK), and not a module manifest
 * ($PLG). Per-module references here are the identity triple MODULE_ID /
 * MODULE_VERSION / CONTENT_HASH; a descriptor is resolved through the
 * module's own published manifest (see `extractGrantModuleDescriptor` and
 * `decodePlgManifest`), never restated inside a profile.
 *
 * This route deliberately does NOT join `RECORD_TYPE_BY_STANDARD` above:
 * that trio is the $REC publication trailer appended to a protected module
 * artifact, which is a different transport than a portable profile export.
 * Profile containment is `encodeBuildProfileRecordCollection` /
 * `decodeBuildProfileRecordCollection`.
 *
 * SIGNING (owner dual-format signing law 2026-08-22; Themis 2026-08-30). A
 * signed profile carries BOTH ratified signatures in one `BPFAttestation`,
 * each verifying INDEPENDENTLY against the same literal Ed25519
 * `SIGNING_PUBLIC_KEY`:
 *   - `SIGNATURE`                — over the size-prefixed $BPF FlatBuffer
 *                                  with BOTH 64-byte signature payloads
 *                                  zeroed, vectors and offsets preserved.
 *   - `CANONICAL_JSON_SIGNATURE` — over canonical JSON in IDL field order and
 *                                  capitalization, no insignificant
 *                                  whitespace, with ONLY the two signature
 *                                  fields omitted (`SIGNING_PUBLIC_KEY` and
 *                                  `SIGNED_AT` are covered).
 * Presence of the attestation table IS the statement that a profile is
 * signed; there is no `SIGNED` boolean, because a self-asserted flag is
 * attacker-controlled. Verification FAILS CLOSED: a profile whose
 * attestation is incomplete, or either of whose signatures fails, is
 * REJECTED and is never downgraded to "unsigned and therefore acceptable" —
 * that downgrade is the laundering path.
 * ------------------------------------------------------------------------ */

const BUILD_PROFILE_FILE_IDENTIFIER = "$BPF";
const BUILD_PROFILE_SIGNATURE_LENGTH = 64;
const DEFAULT_RUNTIME_LOCK_TTL_DAYS = 180;
const MIN_RUNTIME_LOCK_TTL_DAYS = 1;
const MAX_RUNTIME_LOCK_TTL_DAYS = 365;
const UINT64_MAX = 18446744073709551615n;
const UINT32_MAX = 4294967295;
const LOWERCASE_SHA256_HEX = /^[a-f0-9]{64}$/;
const RFC3339_FIXED_MILLISECONDS =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DECIMAL_UINT = /^(?:0|[1-9][0-9]*)$/;

function buildEnumMaps(enumObject) {
  const byName = {};
  const byValue = {};
  for (const [name, value] of Object.entries(enumObject)) {
    if (typeof value !== "number") continue;
    byName[name] = value;
    byValue[value] = name;
  }
  return Object.freeze({
    byName: Object.freeze(byName),
    byValue: Object.freeze(byValue),
    names: Object.freeze(Object.keys(byName)),
  });
}

const BPF_PART_KIND = buildEnumMaps(bpfPartKind);
const BPF_PROTECTION_TIER = buildEnumMaps(bpfProtectionTier);
const BPF_LICENSE_MODE = buildEnumMaps(bpfLicenseMode);

function normalizeEnumName(value, maps, label, fallbackName) {
  if (value === undefined || value === null || value === "") {
    return fallbackName;
  }
  if (typeof value === "number") {
    const name = maps.byValue[value];
    if (name === undefined) {
      throw new TypeError(
        `${label} must be one of ${maps.names.join(", ")} (received ${value}).`,
      );
    }
    return name;
  }
  const name = String(value).trim();
  if (!Object.hasOwn(maps.byName, name)) {
    throw new TypeError(
      `${label} must be one of ${maps.names.join(", ")} (received ${JSON.stringify(String(value))}).`,
    );
  }
  return name;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalTrimmedString(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string when present.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireLowercaseSha256(value, label) {
  if (typeof value !== "string" || !LOWERCASE_SHA256_HEX.test(value)) {
    throw new TypeError(`${label} must be 64 lowercase hexadecimal characters.`);
  }
  return value;
}

function optionalLowercaseSha256(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireLowercaseSha256(value, label);
}

function optionalFixedMillisecondTimestamp(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !RFC3339_FIXED_MILLISECONDS.test(value)) {
    throw new TypeError(
      `${label} must be an RFC 3339 UTC timestamp with fixed milliseconds.`,
    );
  }
  return value;
}

function requireBoolean(value, label) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }
  return value;
}

function normalizeUint64(value, label) {
  if (value === undefined || value === null || value === "") {
    return 0n;
  }
  let normalized;
  if (typeof value === "bigint") {
    normalized = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(
        `${label} must be a safe integer, a bigint, or a decimal string.`,
      );
    }
    normalized = BigInt(value);
  } else if (typeof value === "string" && DECIMAL_UINT.test(value)) {
    normalized = BigInt(value);
  } else {
    throw new TypeError(
      `${label} must be a safe integer, a bigint, or a decimal string.`,
    );
  }
  if (normalized < 0n || normalized > UINT64_MAX) {
    throw new RangeError(`${label} must fit in uint64.`);
  }
  return normalized;
}

function normalizeStringVector(value, label, { requireLeadingDot = false } = {}) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array of strings.`);
  }
  const seen = new Set();
  const out = [];
  for (const [index, entry] of value.entries()) {
    const normalized = requireNonEmptyString(entry, `${label}[${index}]`);
    if (requireLeadingDot && !normalized.startsWith(".")) {
      throw new TypeError(
        `${label}[${index}] must be a dot-anchored suffix rule written with its leading dot.`,
      );
    }
    if (seen.has(normalized)) {
      throw new Error(`${label} contains the duplicate entry ${JSON.stringify(normalized)}.`);
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeSignaturePayload(value, label) {
  const bytes = toUint8Array(value ?? new Uint8Array(0));
  if (bytes.length !== BUILD_PROFILE_SIGNATURE_LENGTH) {
    throw new TypeError(
      `${label} must be exactly ${BUILD_PROFILE_SIGNATURE_LENGTH} bytes.`,
    );
  }
  return new Uint8Array(bytes);
}

function normalizeBuildProfilePart(part, index, seen) {
  if (part === null || typeof part !== "object" || Array.isArray(part)) {
    throw new TypeError(`BPF profile parts[${index}] must be an object.`);
  }
  const label = `BPF profile parts[${index}]`;
  const partId = requireNonEmptyString(part.partId, `${label}.partId`);
  if (seen.has(partId)) {
    throw new Error(
      `BPF profile contains the duplicate part id ${JSON.stringify(partId)}.`,
    );
  }
  seen.add(partId);
  return {
    partId,
    kind: normalizeEnumName(part.kind, BPF_PART_KIND, `${label}.kind`, "UNSPECIFIED"),
    included: requireBoolean(part.included, `${label}.included`),
    contentSha256: optionalLowercaseSha256(part.contentSha256, `${label}.contentSha256`),
    byteLength: normalizeUint64(part.byteLength, `${label}.byteLength`),
    description: optionalTrimmedString(part.description, `${label}.description`),
  };
}

function normalizeBuildProfileModule(module, index, seen) {
  if (module === null || typeof module !== "object" || Array.isArray(module)) {
    throw new TypeError(`BPF profile modules[${index}] must be an object.`);
  }
  const label = `BPF profile modules[${index}]`;
  const moduleId = requireNonEmptyString(module.moduleId, `${label}.moduleId`);
  if (seen.has(moduleId)) {
    throw new Error(
      `BPF profile contains the duplicate module id ${JSON.stringify(moduleId)}.`,
    );
  }
  seen.add(moduleId);
  return {
    moduleId,
    moduleVersion: optionalTrimmedString(module.moduleVersion, `${label}.moduleVersion`),
    included: requireBoolean(module.included, `${label}.included`),
    protection: normalizeEnumName(
      module.protection,
      BPF_PROTECTION_TIER,
      `${label}.protection`,
      "UNSPECIFIED",
    ),
    contentHash: optionalLowercaseSha256(module.contentHash, `${label}.contentHash`),
  };
}

function normalizeBuildProfileRuntimeLock(lock) {
  if (lock === undefined || lock === null) {
    throw new TypeError(
      "BPF profile runtimeLock is required: an absent lock is never read as an unlocked one.",
    );
  }
  if (typeof lock !== "object" || Array.isArray(lock)) {
    throw new TypeError("BPF profile runtimeLock must be an object.");
  }
  const ttlDays =
    lock.ttlDays === undefined || lock.ttlDays === null || lock.ttlDays === ""
      ? DEFAULT_RUNTIME_LOCK_TTL_DAYS
      : lock.ttlDays;
  if (
    !Number.isSafeInteger(ttlDays) ||
    ttlDays < MIN_RUNTIME_LOCK_TTL_DAYS ||
    ttlDays > MAX_RUNTIME_LOCK_TTL_DAYS ||
    ttlDays > UINT32_MAX
  ) {
    throw new RangeError(
      `BPF profile runtimeLock.ttlDays must be an integer ${MIN_RUNTIME_LOCK_TTL_DAYS} through ${MAX_RUNTIME_LOCK_TTL_DAYS} inclusive; an out-of-range lifetime is rejected, never clamped.`,
    );
  }
  return {
    allowedDomains: normalizeStringVector(
      lock.allowedDomains,
      "BPF profile runtimeLock.allowedDomains",
    ),
    allowedTlds: normalizeStringVector(
      lock.allowedTlds,
      "BPF profile runtimeLock.allowedTlds",
      { requireLeadingDot: true },
    ),
    devDomains: normalizeStringVector(
      lock.devDomains,
      "BPF profile runtimeLock.devDomains",
    ),
    ttlDays,
    compiledAtMs: normalizeUint64(
      lock.compiledAtMs,
      "BPF profile runtimeLock.compiledAtMs",
    ),
  };
}

function normalizeBuildProfileAttestation(attestation) {
  if (attestation === undefined || attestation === null) {
    return null;
  }
  if (typeof attestation !== "object" || Array.isArray(attestation)) {
    throw new TypeError("BPF profile attestation must be an object when present.");
  }
  return {
    signingPublicKey: requireLowercaseSha256(
      attestation.signingPublicKey,
      "BPF profile attestation.signingPublicKey",
    ),
    signedAt: optionalFixedMillisecondTimestamp(
      attestation.signedAt,
      "BPF profile attestation.signedAt",
    ),
    signature: normalizeSignaturePayload(
      attestation.signature,
      "BPF profile attestation.signature",
    ),
    canonicalJsonSignature: normalizeSignaturePayload(
      attestation.canonicalJsonSignature,
      "BPF profile attestation.canonicalJsonSignature",
    ),
  };
}

/**
 * Validate a build profile and return its NORMALIZED canonical JS shape:
 * every default applied, every uint64 a BigInt, absent optional strings
 * `null`, and the keyed `PARTS`/`MODULES` vectors sorted by their IDL key so
 * that one field set always encodes to one byte sequence.
 */
export function validateBuildProfile(profile) {
  if (profile === null || typeof profile !== "object" || Array.isArray(profile)) {
    throw new TypeError("BPF profile must be an object.");
  }
  const parts = profile.parts ?? [];
  const modules = profile.modules ?? [];
  if (!Array.isArray(parts)) {
    throw new TypeError("BPF profile parts must be an array.");
  }
  if (!Array.isArray(modules)) {
    throw new TypeError("BPF profile modules must be an array.");
  }
  const partIds = new Set();
  const moduleIds = new Set();
  return {
    profileId: requireNonEmptyString(profile.profileId, "BPF profile profileId"),
    name: requireNonEmptyString(profile.name, "BPF profile name"),
    description: optionalTrimmedString(profile.description, "BPF profile description"),
    createdAt: optionalFixedMillisecondTimestamp(
      profile.createdAt,
      "BPF profile createdAt",
    ),
    updatedAt: optionalFixedMillisecondTimestamp(
      profile.updatedAt,
      "BPF profile updatedAt",
    ),
    templateSha256: requireLowercaseSha256(
      profile.templateSha256,
      "BPF profile templateSha256",
    ),
    parts: parts
      .map((part, index) => normalizeBuildProfilePart(part, index, partIds))
      .sort((left, right) => (left.partId < right.partId ? -1 : left.partId > right.partId ? 1 : 0)),
    modules: modules
      .map((module, index) => normalizeBuildProfileModule(module, index, moduleIds))
      .sort((left, right) =>
        left.moduleId < right.moduleId ? -1 : left.moduleId > right.moduleId ? 1 : 0,
      ),
    runtimeLock: normalizeBuildProfileRuntimeLock(profile.runtimeLock),
    licenseMode: normalizeEnumName(
      profile.licenseMode,
      BPF_LICENSE_MODE,
      "BPF profile licenseMode",
      "UNSPECIFIED",
    ),
    attestation: normalizeBuildProfileAttestation(profile.attestation),
  };
}

function buildProfileTableFromObject(profile) {
  return new BPFT(
    profile.profileId,
    profile.name,
    profile.description,
    profile.createdAt,
    profile.updatedAt,
    profile.templateSha256,
    profile.parts.map(
      (part) =>
        new BPFPartT(
          part.partId,
          BPF_PART_KIND.byName[part.kind],
          part.included,
          part.contentSha256,
          part.byteLength,
          part.description,
        ),
    ),
    profile.modules.map(
      (module) =>
        new BPFModuleT(
          module.moduleId,
          module.moduleVersion,
          module.included,
          BPF_PROTECTION_TIER.byName[module.protection],
          module.contentHash,
          // MODULE_DESCRIPTOR is never written: a per-module reference is the
          // identity triple, and a profile never restates a module manifest.
          null,
        ),
    ),
    new BPFRuntimeLockT(
      profile.runtimeLock.allowedDomains,
      profile.runtimeLock.allowedTlds,
      profile.runtimeLock.devDomains,
      profile.runtimeLock.ttlDays,
      profile.runtimeLock.compiledAtMs,
    ),
    BPF_LICENSE_MODE.byName[profile.licenseMode],
    profile.attestation
      ? new BPFAttestationT(
          profile.attestation.signingPublicKey,
          profile.attestation.signedAt,
          Array.from(profile.attestation.signature),
          Array.from(profile.attestation.canonicalJsonSignature),
        )
      : null,
  );
}

/** Encode a validated build profile as canonical size-prefixed SDS `$BPF` bytes. */
export function encodeBuildProfile(profile) {
  const normalized = validateBuildProfile(profile);
  const builder = new flatbuffers.Builder(1024);
  const root = buildProfileTableFromObject(normalized).pack(builder);
  BPF.finishSizePrefixedBPFBuffer(builder, root);
  return new Uint8Array(builder.asUint8Array());
}

function decodeBuildProfilePart(table, index) {
  return {
    partId: table.PART_ID(),
    kind:
      BPF_PART_KIND.byValue[table.KIND()] ??
      (() => {
        throw new Error(`BPF profile parts[${index}] KIND ${table.KIND()} is unknown.`);
      })(),
    included: table.INCLUDED(),
    contentSha256: optionalLowercaseSha256(
      table.CONTENT_SHA256(),
      `BPF profile parts[${index}].contentSha256`,
    ),
    byteLength: normalizeUint64(
      table.BYTE_LENGTH(),
      `BPF profile parts[${index}].byteLength`,
    ),
    description: optionalTrimmedString(
      table.DESCRIPTION(),
      `BPF profile parts[${index}].description`,
    ),
  };
}

function decodeBuildProfileModule(table, index) {
  if (table.MODULE_DESCRIPTOR()) {
    throw new Error(
      `BPF profile modules[${index}] carries an embedded MODULE_DESCRIPTOR. This route models a ` +
        "module reference as the identity triple MODULE_ID / MODULE_VERSION / CONTENT_HASH and " +
        "cannot canonically project a descriptor it does not model, so it refuses the record " +
        "rather than silently dropping signed bytes. Resolve the descriptor from the module's " +
        "own published manifest.",
    );
  }
  return {
    moduleId: table.MODULE_ID(),
    moduleVersion: optionalTrimmedString(
      table.MODULE_VERSION(),
      `BPF profile modules[${index}].moduleVersion`,
    ),
    included: table.INCLUDED(),
    protection:
      BPF_PROTECTION_TIER.byValue[table.PROTECTION()] ??
      (() => {
        throw new Error(
          `BPF profile modules[${index}] PROTECTION ${table.PROTECTION()} is unknown.`,
        );
      })(),
    contentHash: optionalLowercaseSha256(
      table.CONTENT_HASH(),
      `BPF profile modules[${index}].contentHash`,
    ),
  };
}

function decodeBuildProfileRuntimeLock(table) {
  if (!table) {
    throw new Error(
      "BPF record is missing RUNTIME_LOCK: an absent lock is never read as an unlocked one.",
    );
  }
  const readVector = (length, read) => {
    const out = [];
    for (let index = 0; index < length; index += 1) {
      out.push(read(index));
    }
    return out;
  };
  return {
    allowedDomains: readVector(table.allowedDomainsLength(), (index) =>
      table.ALLOWED_DOMAINS(index),
    ),
    allowedTlds: readVector(table.allowedTldsLength(), (index) => table.ALLOWED_TLDS(index)),
    devDomains: readVector(table.devDomainsLength(), (index) => table.DEV_DOMAINS(index)),
    ttlDays: table.TTL_DAYS(),
    compiledAtMs: normalizeUint64(
      table.COMPILED_AT_MS(),
      "BPF profile runtimeLock.compiledAtMs",
    ),
  };
}

function decodeBuildProfileAttestation(table) {
  if (!table) {
    // PRESENCE IS THE STATEMENT: an absent attestation table means unsigned.
    // There is no `SIGNED` boolean to consult and none is synthesized.
    return null;
  }
  // FAIL CLOSED on an incomplete attestation. The lengths are read BEFORE the
  // array views are taken: an absent vector reports offset 0, and asking the
  // generated accessor for a view at that offset would read wherever the
  // vtable pointer happens to aim rather than refusing the record.
  for (const [length, field] of [
    [table.signatureLength(), "signature"],
    [table.canonicalJsonSignatureLength(), "canonicalJsonSignature"],
  ]) {
    if (length !== BUILD_PROFILE_SIGNATURE_LENGTH) {
      throw new TypeError(
        `BPF profile attestation.${field} must be exactly ${BUILD_PROFILE_SIGNATURE_LENGTH} bytes; an attestation missing either payload is REJECTED, never read as unsigned.`,
      );
    }
  }
  return {
    signingPublicKey: requireLowercaseSha256(
      table.SIGNING_PUBLIC_KEY(),
      "BPF profile attestation.signingPublicKey",
    ),
    signedAt: optionalFixedMillisecondTimestamp(
      table.SIGNED_AT(),
      "BPF profile attestation.signedAt",
    ),
    signature: normalizeSignaturePayload(
      table.signatureArray(),
      "BPF profile attestation.signature",
    ),
    canonicalJsonSignature: normalizeSignaturePayload(
      table.canonicalJsonSignatureArray(),
      "BPF profile attestation.canonicalJsonSignature",
    ),
  };
}

function decodeBuildProfileTable(table) {
  const parts = [];
  for (let index = 0; index < table.partsLength(); index += 1) {
    parts.push(decodeBuildProfilePart(table.PARTS(index), index));
  }
  const modules = [];
  for (let index = 0; index < table.modulesLength(); index += 1) {
    modules.push(decodeBuildProfileModule(table.MODULES(index), index));
  }
  return validateBuildProfile({
    profileId: table.PROFILE_ID(),
    name: table.NAME(),
    description: table.DESCRIPTION(),
    createdAt: table.CREATED_AT(),
    updatedAt: table.UPDATED_AT(),
    templateSha256: table.TEMPLATE_SHA256(),
    parts,
    modules,
    runtimeLock: decodeBuildProfileRuntimeLock(table.RUNTIME_LOCK()),
    licenseMode: normalizeEnumName(
      table.LICENSE_MODE(),
      BPF_LICENSE_MODE,
      "BPF profile licenseMode",
      "UNSPECIFIED",
    ),
    attestation: decodeBuildProfileAttestation(table.ATTESTATION()),
  });
}

function assertSizePrefixedBuildProfileBuffer(bytes) {
  const buffer = toUint8Array(bytes);
  if (buffer.length < flatbuffers.SIZE_PREFIX_LENGTH + 12) {
    throw new TypeError("BPF record expects non-truncated size-prefixed FlatBuffer bytes.");
  }
  const declaredLength = readUint32LE(buffer, 0, "BPF record size prefix");
  if (declaredLength !== buffer.length - flatbuffers.SIZE_PREFIX_LENGTH) {
    throw new Error("BPF record size prefix does not match the buffer length.");
  }
  // Past the 4-byte size prefix the layout is an ordinary root FlatBuffer, so
  // the existing structural hardening applies verbatim to the subarray.
  assertRootFlatbufferTable(
    buffer.subarray(flatbuffers.SIZE_PREFIX_LENGTH),
    BUILD_PROFILE_FILE_IDENTIFIER,
    "BPF record",
  );
  return buffer;
}

/** Decode and revalidate canonical size-prefixed SDS `$BPF` bytes. */
export function decodeBuildProfile(bytes) {
  const buffer = assertSizePrefixedBuildProfileBuffer(bytes);
  const table = BPF.getSizePrefixedRootAsBPF(new flatbuffers.ByteBuffer(buffer));
  return decodeBuildProfileTable(table);
}

function canonicalJsonObject(entries) {
  const fields = [];
  for (const [key, serialized] of entries) {
    if (serialized === undefined) continue;
    fields.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${fields.join(",")}}`;
}

function canonicalJsonStringVector(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(",")}]`;
}

function canonicalJsonOptionalString(value) {
  return value === null || value === undefined ? undefined : JSON.stringify(value);
}

/**
 * Project a build profile to its canonical JSON signing form: IDL field
 * order, IDL capitalization, no insignificant whitespace, uint64 fields as
 * decimal strings, and ONLY the two signature payloads omitted —
 * `SIGNING_PUBLIC_KEY` and `SIGNED_AT` are covered by the signature.
 */
export function canonicalBuildProfileJson(profile) {
  const normalized = validateBuildProfile(profile);
  return canonicalJsonObject([
    ["PROFILE_ID", JSON.stringify(normalized.profileId)],
    ["NAME", JSON.stringify(normalized.name)],
    ["DESCRIPTION", canonicalJsonOptionalString(normalized.description)],
    ["CREATED_AT", canonicalJsonOptionalString(normalized.createdAt)],
    ["UPDATED_AT", canonicalJsonOptionalString(normalized.updatedAt)],
    ["TEMPLATE_SHA256", JSON.stringify(normalized.templateSha256)],
    [
      "PARTS",
      `[${normalized.parts
        .map((part) =>
          canonicalJsonObject([
            ["PART_ID", JSON.stringify(part.partId)],
            ["KIND", JSON.stringify(part.kind)],
            ["INCLUDED", part.included ? "true" : "false"],
            ["CONTENT_SHA256", canonicalJsonOptionalString(part.contentSha256)],
            ["BYTE_LENGTH", JSON.stringify(part.byteLength.toString())],
            ["DESCRIPTION", canonicalJsonOptionalString(part.description)],
          ]),
        )
        .join(",")}]`,
    ],
    [
      "MODULES",
      `[${normalized.modules
        .map((module) =>
          canonicalJsonObject([
            ["MODULE_ID", JSON.stringify(module.moduleId)],
            ["MODULE_VERSION", canonicalJsonOptionalString(module.moduleVersion)],
            ["INCLUDED", module.included ? "true" : "false"],
            ["PROTECTION", JSON.stringify(module.protection)],
            ["CONTENT_HASH", canonicalJsonOptionalString(module.contentHash)],
          ]),
        )
        .join(",")}]`,
    ],
    [
      "RUNTIME_LOCK",
      canonicalJsonObject([
        ["ALLOWED_DOMAINS", canonicalJsonStringVector(normalized.runtimeLock.allowedDomains)],
        ["ALLOWED_TLDS", canonicalJsonStringVector(normalized.runtimeLock.allowedTlds)],
        ["DEV_DOMAINS", canonicalJsonStringVector(normalized.runtimeLock.devDomains)],
        ["TTL_DAYS", String(normalized.runtimeLock.ttlDays)],
        ["COMPILED_AT_MS", JSON.stringify(normalized.runtimeLock.compiledAtMs.toString())],
      ]),
    ],
    ["LICENSE_MODE", JSON.stringify(normalized.licenseMode)],
    [
      "ATTESTATION",
      normalized.attestation === null
        ? undefined
        : canonicalJsonObject([
            ["SIGNING_PUBLIC_KEY", JSON.stringify(normalized.attestation.signingPublicKey)],
            ["SIGNED_AT", canonicalJsonOptionalString(normalized.attestation.signedAt)],
          ]),
    ],
  ]);
}

/**
 * Build the `SIGNATURE` preimage: a COPY of the size-prefixed `$BPF` bytes
 * with both 64-byte signature payloads zeroed, vectors and offsets preserved.
 */
export function zeroBuildProfileSignaturePayloads(bytes) {
  const clone = new Uint8Array(assertSizePrefixedBuildProfileBuffer(bytes));
  const attestation = BPF.getSizePrefixedRootAsBPF(
    new flatbuffers.ByteBuffer(clone),
  ).ATTESTATION();
  if (attestation) {
    attestation.signatureArray().fill(0);
    attestation.canonicalJsonSignatureArray().fill(0);
  }
  return clone;
}

/**
 * Resolve the signer AND the key it publishes together, because publishing a
 * `SIGNING_PUBLIC_KEY` that does not belong to the signer produces a record
 * whose signatures can never verify — a silent authoring failure that only
 * surfaces at the importer. There are exactly two shapes and neither can
 * guess the other's half:
 *   - `signingSeed` — the SDK signs and derives the published key itself.
 *   - `sign`        — an external signer (a wallet, a keyslot); the caller
 *                     MUST state the `signingPublicKey` that signer holds.
 */
async function resolveBuildProfileSigner(options) {
  const declaredPublicKey = optionalTrimmedString(
    options.signingPublicKey,
    "signBuildProfile signingPublicKey",
  );
  const hasSeed = options.signingSeed !== undefined && options.signingSeed !== null;
  const hasSignFunction = typeof options.sign === "function";
  if (hasSeed && hasSignFunction) {
    throw new TypeError(
      "signBuildProfile takes options.signingSeed OR options.sign, never both: the published key must belong to the signer that produced the signatures.",
    );
  }
  if (hasSignFunction) {
    if (!declaredPublicKey) {
      throw new TypeError(
        "signBuildProfile with options.sign requires options.signingPublicKey: the SDK cannot derive an external signer's public key, and publishing the wrong one yields a record that never verifies.",
      );
    }
    return {
      sign: async (message) => toUint8Array(await options.sign(message)),
      signingPublicKey: requireLowercaseSha256(
        declaredPublicKey,
        "signBuildProfile signingPublicKey",
      ),
    };
  }
  if (!hasSeed) {
    throw new TypeError(
      "signBuildProfile requires either options.signingSeed (an Ed25519 seed) or options.sign with options.signingPublicKey.",
    );
  }
  const seed = toUint8Array(options.signingSeed);
  const derivedPublicKey = bytesToHex(await ed25519PublicKey(seed));
  if (declaredPublicKey && declaredPublicKey !== derivedPublicKey) {
    throw new Error(
      "signBuildProfile signingPublicKey does not belong to options.signingSeed; the attestation would publish a key that cannot verify its own signatures.",
    );
  }
  return {
    sign: async (message) => toUint8Array(await ed25519Sign(message, seed)),
    signingPublicKey: requireLowercaseSha256(
      derivedPublicKey,
      "signBuildProfile signingPublicKey",
    ),
  };
}

/**
 * Sign a build profile in BOTH ratified forms and return the signed profile
 * plus its canonical size-prefixed `$BPF` bytes.
 */
export async function signBuildProfile(profile, options = {}) {
  const { sign, signingPublicKey } = await resolveBuildProfileSigner(options);
  const signedAt =
    optionalFixedMillisecondTimestamp(options.signedAt, "signBuildProfile signedAt") ??
    new Date().toISOString();
  const zeroSignature = new Uint8Array(BUILD_PROFILE_SIGNATURE_LENGTH);
  const unsignedProfile = validateBuildProfile({
    ...validateBuildProfile(profile),
    attestation: {
      signingPublicKey,
      signedAt,
      signature: zeroSignature,
      canonicalJsonSignature: zeroSignature,
    },
  });

  const canonicalJson = canonicalBuildProfileJson(unsignedProfile);
  const canonicalJsonSignature = normalizeSignaturePayload(
    await sign(textEncoder.encode(canonicalJson)),
    "signBuildProfile canonical JSON signature",
  );

  const bytes = encodeBuildProfile(unsignedProfile);
  const signature = normalizeSignaturePayload(
    await sign(zeroBuildProfileSignaturePayloads(bytes)),
    "signBuildProfile FlatBuffer signature",
  );

  // Write both payloads into the existing 64-byte vectors: the layout the
  // signature was taken over is preserved byte for byte.
  const attestation = BPF.getSizePrefixedRootAsBPF(
    new flatbuffers.ByteBuffer(bytes),
  ).ATTESTATION();
  attestation.signatureArray().set(signature);
  attestation.canonicalJsonSignatureArray().set(canonicalJsonSignature);

  return { profile: decodeBuildProfile(bytes), bytes, canonicalJson };
}

function resolveBuildProfileVerifier(options) {
  if (typeof options.verify === "function") {
    return options.verify;
  }
  return (message, signature, publicKey) => ed25519Verify(message, signature, publicKey);
}

/**
 * Verify the FlatBuffer form on its own: the size-prefixed `$BPF` bytes with
 * both signature payloads zeroed, against the record's literal
 * `SIGNING_PUBLIC_KEY`.
 */
export async function verifyBuildProfileFlatbufferSignature(bytes, options = {}) {
  const profile = decodeBuildProfile(bytes);
  if (!profile.attestation) {
    return false;
  }
  const verify = resolveBuildProfileVerifier(options);
  return (
    (await verify(
      zeroBuildProfileSignaturePayloads(bytes),
      profile.attestation.signature,
      hexToBytes(profile.attestation.signingPublicKey),
    )) === true
  );
}

/**
 * Verify the canonical-JSON form on its own — a holder of the JSON projection
 * and the signature needs no FlatBuffer to check it.
 */
export async function verifyBuildProfileCanonicalJsonSignature(profile, options = {}) {
  const normalized = validateBuildProfile(profile);
  if (!normalized.attestation) {
    return false;
  }
  const verify = resolveBuildProfileVerifier(options);
  return (
    (await verify(
      textEncoder.encode(canonicalBuildProfileJson(normalized)),
      normalized.attestation.canonicalJsonSignature,
      hexToBytes(normalized.attestation.signingPublicKey),
    )) === true
  );
}

/**
 * Fail-closed verification of a `$BPF` buffer. An unsigned profile decodes as
 * `{ signed: false }`; a SIGNED profile whose either signature fails to
 * verify THROWS — it is never downgraded to unsigned and therefore
 * acceptable.
 */
export async function verifyBuildProfile(bytes, options = {}) {
  const profile = decodeBuildProfile(bytes);
  if (!profile.attestation) {
    return { profile, signed: false };
  }
  if (!(await verifyBuildProfileFlatbufferSignature(bytes, options))) {
    throw new Error(
      "BPF attestation SIGNATURE failed to verify against SIGNING_PUBLIC_KEY; the record is REJECTED, never read as unsigned.",
    );
  }
  if (!(await verifyBuildProfileCanonicalJsonSignature(profile, options))) {
    throw new Error(
      "BPF attestation CANONICAL_JSON_SIGNATURE failed to verify against SIGNING_PUBLIC_KEY; the record is REJECTED, never read as unsigned.",
    );
  }
  return { profile, signed: true };
}

/**
 * Encode the portable export unit: a `$REC` collection carrying exactly one
 * `$BPF` record.
 */
export function encodeBuildProfileRecordCollection(profile, options = {}) {
  const normalized = validateBuildProfile(profile);
  const builder = new flatbuffers.Builder(2048);
  const root = new RECT(
    normalizeStringField(options.version) ?? DEFAULT_RECORD_COLLECTION_VERSION,
    [new RecordT(RecordType.BPF, buildProfileTableFromObject(normalized), "BPF")],
  ).pack(builder);
  REC.finishRECBuffer(builder, root);
  return builder.asUint8Array();
}

/**
 * Decode a `$REC` collection carrying a build profile. EXACTLY ONE `$BPF`
 * record is admitted: zero and two-or-more are both REJECTED. Any other
 * record travelling with it — an `$APP` launcher manifest, for example — is
 * advisory metadata carrying no authority, so its presence is recorded and
 * its absence is not an error.
 */
export function decodeBuildProfileRecordCollection(bytes) {
  const buffer = toUint8Array(bytes);
  assertRootFlatbufferTable(buffer, TRAILER_MAGIC_TEXT, "BPF record collection");
  const bb = new flatbuffers.ByteBuffer(buffer);
  const collectionTable = REC.getRootAsREC(bb);
  const collectionMeta = assertFlatbufferTable(
    buffer,
    collectionTable.bb_pos,
    "BPF record collection",
  );
  assertOptionalStringField(buffer, collectionMeta, 4, "BPF record collection version");
  const recordTables = assertTableVectorField(
    buffer,
    collectionMeta,
    6,
    "BPF record collection records",
  );
  if (recordTables.length === 0) {
    throw new Error("BPF record collection does not contain any records.");
  }
  const records = [];
  let profile = null;
  for (let index = 0; index < recordTables.length; index += 1) {
    const recordTable = collectionTable.RECORDS(index, new Record()) ?? null;
    if (!recordTable) {
      throw new Error(`BPF record collection record ${index} could not be loaded.`);
    }
    const recordMeta = assertFlatbufferTable(
      buffer,
      recordTable.bb_pos,
      `BPF record collection record ${index}`,
    );
    assertOptionalStringField(
      buffer,
      recordMeta,
      8,
      `BPF record collection record ${index} standard`,
    );
    const recordType = getRecordValueType(recordTable);
    const standard = normalizeStringField(recordTable.standard()) ?? null;
    if (
      !assertUnionTableField(
        buffer,
        recordMeta,
        6,
        `BPF record collection record ${index} value`,
      )
    ) {
      throw new Error(`BPF record collection record ${index} is missing a value.`);
    }
    if (recordType === RecordType.BPF) {
      if (profile) {
        throw new Error(
          "BPF record collection contains more than one BPF record; exactly one is admitted.",
        );
      }
      const table = recordTable.value(new BPF());
      if (!table) {
        throw new Error(`BPF record collection record ${index} BPF payload is missing.`);
      }
      profile = decodeBuildProfileTable(table);
    }
    records.push({ standard, recordType });
  }
  if (!profile) {
    throw new Error(
      "BPF record collection contains no BPF record; exactly one is admitted.",
    );
  }
  return {
    version:
      normalizeStringField(collectionTable.version()) ?? DEFAULT_RECORD_COLLECTION_VERSION,
    profile,
    profileBytes: encodeBuildProfile(profile),
    records,
    recordCollectionBytes: buffer,
  };
}

export {
  BUILD_PROFILE_FILE_IDENTIFIER,
  BUILD_PROFILE_SIGNATURE_LENGTH,
  DEFAULT_RUNTIME_LOCK_TTL_DAYS,
  MAX_RUNTIME_LOCK_TTL_DAYS,
  MIN_RUNTIME_LOCK_TTL_DAYS,
};
