var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { BodyRef } from "./BodyRef.js";
import { SqlRow } from "./SqlRow.js";
import { sandboxWant } from "./sandboxWant.js";
class SandboxQueryResult {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsSandboxQueryResult(bb, obj) {
    return (obj || new SandboxQueryResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsSandboxQueryResult(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new SandboxQueryResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  KIND() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : sandboxWant.Stream;
  }
  ROWS() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  COLUMNS() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  STREAM(index) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  streamLength() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  streamArray() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  REF(obj) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? (obj || new BodyRef()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  COLUMN_NAMES(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  columnNamesLength() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  ROW_VALUES(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? (obj || new SqlRow()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  rowValuesLength() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  static startSandboxQueryResult(builder) {
    builder.startObject(7);
  }
  static addKind(builder, KIND) {
    builder.addFieldInt8(0, KIND, sandboxWant.Stream);
  }
  static addRows(builder, ROWS) {
    builder.addFieldInt64(1, ROWS, BigInt("0"));
  }
  static addColumns(builder, COLUMNS) {
    builder.addFieldInt32(2, COLUMNS, 0);
  }
  static addStream(builder, STREAMOffset) {
    builder.addFieldOffset(3, STREAMOffset, 0);
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
    builder.addFieldOffset(4, REFOffset, 0);
  }
  static addColumnNames(builder, COLUMN_NAMESOffset) {
    builder.addFieldOffset(5, COLUMN_NAMESOffset, 0);
  }
  static createColumnNamesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startColumnNamesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addRowValues(builder, ROW_VALUESOffset) {
    builder.addFieldOffset(6, ROW_VALUESOffset, 0);
  }
  static createRowValuesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startRowValuesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static endSandboxQueryResult(builder) {
    const offset = builder.endObject();
    return offset;
  }
  unpack() {
    return new SandboxQueryResultT(
      this.KIND(),
      this.ROWS(),
      this.COLUMNS(),
      this.bb.createScalarList(this.STREAM.bind(this), this.streamLength()),
      this.REF() !== null ? this.REF().unpack() : null,
      this.bb.createScalarList(this.COLUMN_NAMES.bind(this), this.columnNamesLength()),
      this.bb.createObjList(this.ROW_VALUES.bind(this), this.rowValuesLength())
    );
  }
  unpackTo(_o) {
    _o.KIND = this.KIND();
    _o.ROWS = this.ROWS();
    _o.COLUMNS = this.COLUMNS();
    _o.STREAM = this.bb.createScalarList(this.STREAM.bind(this), this.streamLength());
    _o.REF = this.REF() !== null ? this.REF().unpack() : null;
    _o.COLUMN_NAMES = this.bb.createScalarList(this.COLUMN_NAMES.bind(this), this.columnNamesLength());
    _o.ROW_VALUES = this.bb.createObjList(this.ROW_VALUES.bind(this), this.rowValuesLength());
  }
}
class SandboxQueryResultT {
  constructor(KIND = sandboxWant.Stream, ROWS = BigInt("0"), COLUMNS = 0, STREAM = [], REF = null, COLUMN_NAMES = [], ROW_VALUES = []) {
    __publicField(this, "KIND", KIND);
    __publicField(this, "ROWS", ROWS);
    __publicField(this, "COLUMNS", COLUMNS);
    __publicField(this, "STREAM", STREAM);
    __publicField(this, "REF", REF);
    __publicField(this, "COLUMN_NAMES", COLUMN_NAMES);
    __publicField(this, "ROW_VALUES", ROW_VALUES);
  }
  pack(builder) {
    const STREAM = SandboxQueryResult.createStreamVector(builder, this.STREAM);
    const REF = this.REF !== null ? this.REF.pack(builder) : 0;
    const COLUMN_NAMES = SandboxQueryResult.createColumnNamesVector(builder, builder.createObjectOffsetList(this.COLUMN_NAMES));
    const ROW_VALUES = SandboxQueryResult.createRowValuesVector(builder, builder.createObjectOffsetList(this.ROW_VALUES));
    SandboxQueryResult.startSandboxQueryResult(builder);
    SandboxQueryResult.addKind(builder, this.KIND);
    SandboxQueryResult.addRows(builder, this.ROWS);
    SandboxQueryResult.addColumns(builder, this.COLUMNS);
    SandboxQueryResult.addStream(builder, STREAM);
    SandboxQueryResult.addRef(builder, REF);
    SandboxQueryResult.addColumnNames(builder, COLUMN_NAMES);
    SandboxQueryResult.addRowValues(builder, ROW_VALUES);
    return SandboxQueryResult.endSandboxQueryResult(builder);
  }
}
export {
  SandboxQueryResult,
  SandboxQueryResultT
};
