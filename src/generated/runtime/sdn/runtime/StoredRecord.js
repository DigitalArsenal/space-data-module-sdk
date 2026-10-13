var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { SourceTags } from "./SourceTags.js";
class StoredRecord {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsStoredRecord(bb, obj) {
    return (obj || new StoredRecord()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsStoredRecord(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new StoredRecord()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  CID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  ROW_ID() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readInt64(this.bb_pos + offset) : BigInt("0");
  }
  PEER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  TIMESTAMP_MS() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readInt64(this.bb_pos + offset) : BigInt("0");
  }
  DATA(index) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  dataLength() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  dataArray() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  SIGNATURE(index) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  signatureLength() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  signatureArray() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  TAGS(obj) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? (obj || new SourceTags()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  PRODUCER_PEER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PRODUCER_PUBLIC_KEY(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  MATERIALIZED_MS() {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? this.bb.readInt64(this.bb_pos + offset) : BigInt("0");
  }
  LENGTH() {
    const offset = this.bb.__offset(this.bb_pos, 24);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  static startStoredRecord(builder) {
    builder.startObject(11);
  }
  static addCid(builder, CIDOffset) {
    builder.addFieldOffset(0, CIDOffset, 0);
  }
  static addRowId(builder, ROW_ID) {
    builder.addFieldInt64(1, ROW_ID, BigInt("0"));
  }
  static addPeerId(builder, PEER_IDOffset) {
    builder.addFieldOffset(2, PEER_IDOffset, 0);
  }
  static addTimestampMs(builder, TIMESTAMP_MS) {
    builder.addFieldInt64(3, TIMESTAMP_MS, BigInt("0"));
  }
  static addData(builder, DATAOffset) {
    builder.addFieldOffset(4, DATAOffset, 0);
  }
  static createDataVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startDataVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addSignature(builder, SIGNATUREOffset) {
    builder.addFieldOffset(5, SIGNATUREOffset, 0);
  }
  static createSignatureVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startSignatureVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addTags(builder, TAGSOffset) {
    builder.addFieldOffset(6, TAGSOffset, 0);
  }
  static addProducerPeerId(builder, PRODUCER_PEER_IDOffset) {
    builder.addFieldOffset(7, PRODUCER_PEER_IDOffset, 0);
  }
  static addProducerPublicKey(builder, PRODUCER_PUBLIC_KEYOffset) {
    builder.addFieldOffset(8, PRODUCER_PUBLIC_KEYOffset, 0);
  }
  static addMaterializedMs(builder, MATERIALIZED_MS) {
    builder.addFieldInt64(9, MATERIALIZED_MS, BigInt("0"));
  }
  static addLength(builder, LENGTH) {
    builder.addFieldInt32(10, LENGTH, 0);
  }
  static endStoredRecord(builder) {
    const offset = builder.endObject();
    return offset;
  }
  unpack() {
    return new StoredRecordT(
      this.CID(),
      this.ROW_ID(),
      this.PEER_ID(),
      this.TIMESTAMP_MS(),
      this.bb.createScalarList(this.DATA.bind(this), this.dataLength()),
      this.bb.createScalarList(this.SIGNATURE.bind(this), this.signatureLength()),
      this.TAGS() !== null ? this.TAGS().unpack() : null,
      this.PRODUCER_PEER_ID(),
      this.PRODUCER_PUBLIC_KEY(),
      this.MATERIALIZED_MS(),
      this.LENGTH()
    );
  }
  unpackTo(_o) {
    _o.CID = this.CID();
    _o.ROW_ID = this.ROW_ID();
    _o.PEER_ID = this.PEER_ID();
    _o.TIMESTAMP_MS = this.TIMESTAMP_MS();
    _o.DATA = this.bb.createScalarList(this.DATA.bind(this), this.dataLength());
    _o.SIGNATURE = this.bb.createScalarList(this.SIGNATURE.bind(this), this.signatureLength());
    _o.TAGS = this.TAGS() !== null ? this.TAGS().unpack() : null;
    _o.PRODUCER_PEER_ID = this.PRODUCER_PEER_ID();
    _o.PRODUCER_PUBLIC_KEY = this.PRODUCER_PUBLIC_KEY();
    _o.MATERIALIZED_MS = this.MATERIALIZED_MS();
    _o.LENGTH = this.LENGTH();
  }
}
class StoredRecordT {
  constructor(CID = null, ROW_ID = BigInt("0"), PEER_ID = null, TIMESTAMP_MS = BigInt("0"), DATA = [], SIGNATURE = [], TAGS = null, PRODUCER_PEER_ID = null, PRODUCER_PUBLIC_KEY = null, MATERIALIZED_MS = BigInt("0"), LENGTH = 0) {
    __publicField(this, "CID", CID);
    __publicField(this, "ROW_ID", ROW_ID);
    __publicField(this, "PEER_ID", PEER_ID);
    __publicField(this, "TIMESTAMP_MS", TIMESTAMP_MS);
    __publicField(this, "DATA", DATA);
    __publicField(this, "SIGNATURE", SIGNATURE);
    __publicField(this, "TAGS", TAGS);
    __publicField(this, "PRODUCER_PEER_ID", PRODUCER_PEER_ID);
    __publicField(this, "PRODUCER_PUBLIC_KEY", PRODUCER_PUBLIC_KEY);
    __publicField(this, "MATERIALIZED_MS", MATERIALIZED_MS);
    __publicField(this, "LENGTH", LENGTH);
  }
  pack(builder) {
    const CID = this.CID !== null ? builder.createString(this.CID) : 0;
    const PEER_ID = this.PEER_ID !== null ? builder.createString(this.PEER_ID) : 0;
    const DATA = StoredRecord.createDataVector(builder, this.DATA);
    const SIGNATURE = StoredRecord.createSignatureVector(builder, this.SIGNATURE);
    const TAGS = this.TAGS !== null ? this.TAGS.pack(builder) : 0;
    const PRODUCER_PEER_ID = this.PRODUCER_PEER_ID !== null ? builder.createString(this.PRODUCER_PEER_ID) : 0;
    const PRODUCER_PUBLIC_KEY = this.PRODUCER_PUBLIC_KEY !== null ? builder.createString(this.PRODUCER_PUBLIC_KEY) : 0;
    StoredRecord.startStoredRecord(builder);
    StoredRecord.addCid(builder, CID);
    StoredRecord.addRowId(builder, this.ROW_ID);
    StoredRecord.addPeerId(builder, PEER_ID);
    StoredRecord.addTimestampMs(builder, this.TIMESTAMP_MS);
    StoredRecord.addData(builder, DATA);
    StoredRecord.addSignature(builder, SIGNATURE);
    StoredRecord.addTags(builder, TAGS);
    StoredRecord.addProducerPeerId(builder, PRODUCER_PEER_ID);
    StoredRecord.addProducerPublicKey(builder, PRODUCER_PUBLIC_KEY);
    StoredRecord.addMaterializedMs(builder, this.MATERIALIZED_MS);
    StoredRecord.addLength(builder, this.LENGTH);
    return StoredRecord.endStoredRecord(builder);
  }
}
export {
  StoredRecord,
  StoredRecordT
};
