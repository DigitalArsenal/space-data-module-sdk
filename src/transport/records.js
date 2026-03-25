import * as flatbuffers from "flatbuffers";

import { ENC, ENCT, KDF, KeyExchange, SymmetricAlgo } from "spacedatastandards.org/lib/js/ENC/main.js";
import { PNM, PNMT } from "spacedatastandards.org/lib/js/PNM/main.js";
import { REC, RECT } from "spacedatastandards.org/lib/js/REC/REC.js";
import { RecordT } from "spacedatastandards.org/lib/js/REC/Record.js";
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
  return toUint8Array(value);
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

function normalizeEncTable(table) {
  if (!table) {
    return null;
  }
  return {
    version: Number(table.VERSION ?? 1),
    keyExchange:
      KEY_EXCHANGE_NAME_BY_VALUE[table.KEY_EXCHANGE] ?? String(table.KEY_EXCHANGE),
    symmetric:
      SYMMETRIC_ALGO_NAME_BY_VALUE[table.SYMMETRIC] ?? String(table.SYMMETRIC),
    keyDerivation:
      KDF_NAME_BY_VALUE[table.KEY_DERIVATION] ?? String(table.KEY_DERIVATION),
    ephemeralPublicKey: normalizeByteField(table.EPHEMERAL_PUBLIC_KEY),
    nonceStart: normalizeByteField(table.NONCE_START),
    recipientKeyId: normalizeByteField(table.RECIPIENT_KEY_ID),
    context: normalizeStringField(table.CONTEXT),
    schemaHash: normalizeByteField(table.SCHEMA_HASH),
    rootType: normalizeStringField(table.ROOT_TYPE),
    timestamp:
      table.TIMESTAMP === undefined || table.TIMESTAMP === null
        ? 0
        : Number(table.TIMESTAMP),
  };
}

function normalizePnmTable(table) {
  if (!table) {
    return null;
  }
  return {
    multiformatAddress: normalizeStringField(table.MULTIFORMAT_ADDRESS),
    publishTimestamp: normalizeStringField(table.PUBLISH_TIMESTAMP),
    cid: normalizeStringField(table.CID),
    fileName: normalizeStringField(table.FILE_NAME),
    fileId: normalizeStringField(table.FILE_ID),
    signature: normalizeStringField(table.SIGNATURE),
    timestampSignature: normalizeStringField(table.TIMESTAMP_SIGNATURE),
    signatureType: normalizeStringField(table.SIGNATURE_TYPE),
    timestampSignatureType: normalizeStringField(table.TIMESTAMP_SIGNATURE_TYPE),
  };
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
  const bb = new flatbuffers.ByteBuffer(toUint8Array(bytes));
  if (!ENC.bufferHasIdentifier(bb)) {
    throw new Error("ENC record is missing the $ENC file identifier.");
  }
  const record = ENC.getRootAsENC(bb).unpack();
  return normalizeEncTable(record);
}

export function encodePnmRecord(record = {}) {
  const builder = new flatbuffers.Builder(256);
  const table = pnmTableFromObject(record);
  const root = table.pack(builder);
  PNM.finishPNMBuffer(builder, root);
  return builder.asUint8Array();
}

export function decodePnmRecord(bytes) {
  const bb = new flatbuffers.ByteBuffer(toUint8Array(bytes));
  if (!PNM.bufferHasIdentifier(bb)) {
    throw new Error("PNM record is missing the $PNM file identifier.");
  }
  const record = PNM.getRootAsPNM(bb).unpack();
  return normalizePnmTable(record);
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
  const bb = new flatbuffers.ByteBuffer(buffer);
  if (!REC.bufferHasIdentifier(bb)) {
    throw new Error("REC trailer is missing the $REC file identifier.");
  }
  const collection = REC.getRootAsREC(bb).unpack();
  const records = [];
  let enc = null;
  let pnm = null;
  for (const unpackedRecord of Array.isArray(collection.RECORDS) ? collection.RECORDS : []) {
    const standard =
      normalizeStringField(unpackedRecord.standard) ??
      STANDARD_BY_RECORD_TYPE[unpackedRecord.value_type] ??
      null;
    if (standard === "ENC") {
      enc = normalizeEncTable(unpackedRecord.value);
    } else if (standard === "PNM") {
      pnm = normalizePnmTable(unpackedRecord.value);
    }
    records.push({
      standard,
      recordType: unpackedRecord.value_type,
      value:
        standard === "ENC"
          ? enc
          : standard === "PNM"
            ? pnm
            : unpackedRecord.value,
    });
  }
  return {
    version: normalizeStringField(collection.version) ?? DEFAULT_RECORD_COLLECTION_VERSION,
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
