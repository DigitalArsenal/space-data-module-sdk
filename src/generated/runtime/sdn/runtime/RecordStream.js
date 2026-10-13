var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { BodyRef } from "./BodyRef.js";
class RecordStream {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsRecordStream(bb, obj) {
    return (obj || new RecordStream()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsRecordStream(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new RecordStream()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  ROWS() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  COLUMNS() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  STREAM(index) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  streamLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  streamArray() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  REF(obj) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? (obj || new BodyRef()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  static startRecordStream(builder) {
    builder.startObject(4);
  }
  static addRows(builder, ROWS) {
    builder.addFieldInt64(0, ROWS, BigInt("0"));
  }
  static addColumns(builder, COLUMNS) {
    builder.addFieldInt32(1, COLUMNS, 0);
  }
  static addStream(builder, STREAMOffset) {
    builder.addFieldOffset(2, STREAMOffset, 0);
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
    builder.addFieldOffset(3, REFOffset, 0);
  }
  static endRecordStream(builder) {
    const offset = builder.endObject();
    return offset;
  }
  unpack() {
    return new RecordStreamT(
      this.ROWS(),
      this.COLUMNS(),
      this.bb.createScalarList(this.STREAM.bind(this), this.streamLength()),
      this.REF() !== null ? this.REF().unpack() : null
    );
  }
  unpackTo(_o) {
    _o.ROWS = this.ROWS();
    _o.COLUMNS = this.COLUMNS();
    _o.STREAM = this.bb.createScalarList(this.STREAM.bind(this), this.streamLength());
    _o.REF = this.REF() !== null ? this.REF().unpack() : null;
  }
}
class RecordStreamT {
  constructor(ROWS = BigInt("0"), COLUMNS = 0, STREAM = [], REF = null) {
    __publicField(this, "ROWS", ROWS);
    __publicField(this, "COLUMNS", COLUMNS);
    __publicField(this, "STREAM", STREAM);
    __publicField(this, "REF", REF);
  }
  pack(builder) {
    const STREAM = RecordStream.createStreamVector(builder, this.STREAM);
    const REF = this.REF !== null ? this.REF.pack(builder) : 0;
    RecordStream.startRecordStream(builder);
    RecordStream.addRows(builder, this.ROWS);
    RecordStream.addColumns(builder, this.COLUMNS);
    RecordStream.addStream(builder, STREAM);
    RecordStream.addRef(builder, REF);
    return RecordStream.endRecordStream(builder);
  }
}
export {
  RecordStream,
  RecordStreamT
};
