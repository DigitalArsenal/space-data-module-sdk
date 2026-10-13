var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { BodyRef } from "./BodyRef.js";
import { P2pPnmRef } from "./P2pPnmRef.js";
class P2pServing {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsP2pServing(bb, obj) {
    return (obj || new P2pServing()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsP2pServing(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new P2pServing()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  BATCH_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PROVIDER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SOURCE_NAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  RECORD_COUNT() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  BYTE_COUNT() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  PARTS() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  PUBLISHED_MS() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  PNM(obj) {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? (obj || new P2pPnmRef()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  ETAG_FNV1A64(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  STREAM(index) {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  streamLength() {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  streamArray() {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  REF(obj) {
    const offset = this.bb.__offset(this.bb_pos, 24);
    return offset ? (obj || new BodyRef()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  static startP2pServing(builder) {
    builder.startObject(11);
  }
  static addBatchId(builder, BATCH_IDOffset) {
    builder.addFieldOffset(0, BATCH_IDOffset, 0);
  }
  static addProviderId(builder, PROVIDER_IDOffset) {
    builder.addFieldOffset(1, PROVIDER_IDOffset, 0);
  }
  static addSourceName(builder, SOURCE_NAMEOffset) {
    builder.addFieldOffset(2, SOURCE_NAMEOffset, 0);
  }
  static addRecordCount(builder, RECORD_COUNT) {
    builder.addFieldInt64(3, RECORD_COUNT, BigInt("0"));
  }
  static addByteCount(builder, BYTE_COUNT) {
    builder.addFieldInt64(4, BYTE_COUNT, BigInt("0"));
  }
  static addParts(builder, PARTS) {
    builder.addFieldInt32(5, PARTS, 0);
  }
  static addPublishedMs(builder, PUBLISHED_MS) {
    builder.addFieldInt64(6, PUBLISHED_MS, BigInt("0"));
  }
  static addPnm(builder, PNMOffset) {
    builder.addFieldOffset(7, PNMOffset, 0);
  }
  static addEtagFnv1A64(builder, ETAG_FNV1A64Offset) {
    builder.addFieldOffset(8, ETAG_FNV1A64Offset, 0);
  }
  static addStream(builder, STREAMOffset) {
    builder.addFieldOffset(9, STREAMOffset, 0);
  }
  static createStreamVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startStreamVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addRef(builder, REFOffset) {
    builder.addFieldOffset(10, REFOffset, 0);
  }
  static endP2pServing(builder) {
    const offset = builder.endObject();
    return offset;
  }
  unpack() {
    return new P2pServingT(
      this.BATCH_ID(),
      this.PROVIDER_ID(),
      this.SOURCE_NAME(),
      this.RECORD_COUNT(),
      this.BYTE_COUNT(),
      this.PARTS(),
      this.PUBLISHED_MS(),
      this.PNM() !== null ? this.PNM().unpack() : null,
      this.ETAG_FNV1A64(),
      this.bb.createScalarList(this.STREAM.bind(this), this.streamLength()),
      this.REF() !== null ? this.REF().unpack() : null
    );
  }
  unpackTo(_o) {
    _o.BATCH_ID = this.BATCH_ID();
    _o.PROVIDER_ID = this.PROVIDER_ID();
    _o.SOURCE_NAME = this.SOURCE_NAME();
    _o.RECORD_COUNT = this.RECORD_COUNT();
    _o.BYTE_COUNT = this.BYTE_COUNT();
    _o.PARTS = this.PARTS();
    _o.PUBLISHED_MS = this.PUBLISHED_MS();
    _o.PNM = this.PNM() !== null ? this.PNM().unpack() : null;
    _o.ETAG_FNV1A64 = this.ETAG_FNV1A64();
    _o.STREAM = this.bb.createScalarList(this.STREAM.bind(this), this.streamLength());
    _o.REF = this.REF() !== null ? this.REF().unpack() : null;
  }
}
class P2pServingT {
  constructor(BATCH_ID = null, PROVIDER_ID = null, SOURCE_NAME = null, RECORD_COUNT = BigInt("0"), BYTE_COUNT = BigInt("0"), PARTS = 0, PUBLISHED_MS = BigInt("0"), PNM = null, ETAG_FNV1A64 = null, STREAM = [], REF = null) {
    __publicField(this, "BATCH_ID", BATCH_ID);
    __publicField(this, "PROVIDER_ID", PROVIDER_ID);
    __publicField(this, "SOURCE_NAME", SOURCE_NAME);
    __publicField(this, "RECORD_COUNT", RECORD_COUNT);
    __publicField(this, "BYTE_COUNT", BYTE_COUNT);
    __publicField(this, "PARTS", PARTS);
    __publicField(this, "PUBLISHED_MS", PUBLISHED_MS);
    __publicField(this, "PNM", PNM);
    __publicField(this, "ETAG_FNV1A64", ETAG_FNV1A64);
    __publicField(this, "STREAM", STREAM);
    __publicField(this, "REF", REF);
  }
  pack(builder) {
    const BATCH_ID = this.BATCH_ID !== null ? builder.createString(this.BATCH_ID) : 0;
    const PROVIDER_ID = this.PROVIDER_ID !== null ? builder.createString(this.PROVIDER_ID) : 0;
    const SOURCE_NAME = this.SOURCE_NAME !== null ? builder.createString(this.SOURCE_NAME) : 0;
    const PNM = this.PNM !== null ? this.PNM.pack(builder) : 0;
    const ETAG_FNV1A64 = this.ETAG_FNV1A64 !== null ? builder.createString(this.ETAG_FNV1A64) : 0;
    const STREAM = P2pServing.createStreamVector(builder, this.STREAM);
    const REF = this.REF !== null ? this.REF.pack(builder) : 0;
    P2pServing.startP2pServing(builder);
    P2pServing.addBatchId(builder, BATCH_ID);
    P2pServing.addProviderId(builder, PROVIDER_ID);
    P2pServing.addSourceName(builder, SOURCE_NAME);
    P2pServing.addRecordCount(builder, this.RECORD_COUNT);
    P2pServing.addByteCount(builder, this.BYTE_COUNT);
    P2pServing.addParts(builder, this.PARTS);
    P2pServing.addPublishedMs(builder, this.PUBLISHED_MS);
    P2pServing.addPnm(builder, PNM);
    P2pServing.addEtagFnv1A64(builder, ETAG_FNV1A64);
    P2pServing.addStream(builder, STREAM);
    P2pServing.addRef(builder, REF);
    return P2pServing.endP2pServing(builder);
  }
}
export {
  P2pServing,
  P2pServingT
};
