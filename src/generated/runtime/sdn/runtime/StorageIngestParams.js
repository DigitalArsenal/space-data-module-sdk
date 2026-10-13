var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { IngestRequest } from "./IngestRequest.js";
class StorageIngestParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsStorageIngestParams(bb, obj) {
    return (obj || new StorageIngestParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsStorageIngestParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new StorageIngestParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  REQUEST(obj) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? (obj || new IngestRequest()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  RECORDS(index) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  recordsLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  recordsArray() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  ARCHIVE_RAW(index) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  archiveRawLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  archiveRawArray() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startStorageIngestParams(builder) {
    builder.startObject(3);
  }
  static addRequest(builder, REQUESTOffset) {
    builder.addFieldOffset(0, REQUESTOffset, 0);
  }
  static addRecords(builder, RECORDSOffset) {
    builder.addFieldOffset(1, RECORDSOffset, 0);
  }
  static createRecordsVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startRecordsVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addArchiveRaw(builder, ARCHIVE_RAWOffset) {
    builder.addFieldOffset(2, ARCHIVE_RAWOffset, 0);
  }
  static createArchiveRawVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startArchiveRawVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static endStorageIngestParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createStorageIngestParams(builder, REQUESTOffset, RECORDSOffset, ARCHIVE_RAWOffset) {
    StorageIngestParams.startStorageIngestParams(builder);
    StorageIngestParams.addRequest(builder, REQUESTOffset);
    StorageIngestParams.addRecords(builder, RECORDSOffset);
    StorageIngestParams.addArchiveRaw(builder, ARCHIVE_RAWOffset);
    return StorageIngestParams.endStorageIngestParams(builder);
  }
  unpack() {
    return new StorageIngestParamsT(
      this.REQUEST() !== null ? this.REQUEST().unpack() : null,
      this.bb.createScalarList(this.RECORDS.bind(this), this.recordsLength()),
      this.bb.createScalarList(this.ARCHIVE_RAW.bind(this), this.archiveRawLength())
    );
  }
  unpackTo(_o) {
    _o.REQUEST = this.REQUEST() !== null ? this.REQUEST().unpack() : null;
    _o.RECORDS = this.bb.createScalarList(this.RECORDS.bind(this), this.recordsLength());
    _o.ARCHIVE_RAW = this.bb.createScalarList(this.ARCHIVE_RAW.bind(this), this.archiveRawLength());
  }
}
class StorageIngestParamsT {
  constructor(REQUEST = null, RECORDS = [], ARCHIVE_RAW = []) {
    __publicField(this, "REQUEST", REQUEST);
    __publicField(this, "RECORDS", RECORDS);
    __publicField(this, "ARCHIVE_RAW", ARCHIVE_RAW);
  }
  pack(builder) {
    const REQUEST = this.REQUEST !== null ? this.REQUEST.pack(builder) : 0;
    const RECORDS = StorageIngestParams.createRecordsVector(builder, this.RECORDS);
    const ARCHIVE_RAW = StorageIngestParams.createArchiveRawVector(builder, this.ARCHIVE_RAW);
    return StorageIngestParams.createStorageIngestParams(
      builder,
      REQUEST,
      RECORDS,
      ARCHIVE_RAW
    );
  }
}
export {
  StorageIngestParams,
  StorageIngestParamsT
};
