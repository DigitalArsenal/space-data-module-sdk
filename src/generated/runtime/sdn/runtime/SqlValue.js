var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { sqlValueKind } from "./sqlValueKind.js";
class SqlValue {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsSqlValue(bb, obj) {
    return (obj || new SqlValue()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsSqlValue(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new SqlValue()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  KIND() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : sqlValueKind.Null;
  }
  BOOL_VALUE() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  I64_VALUE() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readInt64(this.bb_pos + offset) : BigInt("0");
  }
  F64_VALUE() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  STR_VALUE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  BYTES_VALUE(index) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  bytesValueLength() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  bytesValueArray() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startSqlValue(builder) {
    builder.startObject(6);
  }
  static addKind(builder, KIND) {
    builder.addFieldInt8(0, KIND, sqlValueKind.Null);
  }
  static addBoolValue(builder, BOOL_VALUE) {
    builder.addFieldInt8(1, +BOOL_VALUE, 0);
  }
  static addI64Value(builder, I64_VALUE) {
    builder.addFieldInt64(2, I64_VALUE, BigInt("0"));
  }
  static addF64Value(builder, F64_VALUE) {
    builder.addFieldFloat64(3, F64_VALUE, 0);
  }
  static addStrValue(builder, STR_VALUEOffset) {
    builder.addFieldOffset(4, STR_VALUEOffset, 0);
  }
  static addBytesValue(builder, BYTES_VALUEOffset) {
    builder.addFieldOffset(5, BYTES_VALUEOffset, 0);
  }
  static createBytesValueVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startBytesValueVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static endSqlValue(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createSqlValue(builder, KIND, BOOL_VALUE, I64_VALUE, F64_VALUE, STR_VALUEOffset, BYTES_VALUEOffset) {
    SqlValue.startSqlValue(builder);
    SqlValue.addKind(builder, KIND);
    SqlValue.addBoolValue(builder, BOOL_VALUE);
    SqlValue.addI64Value(builder, I64_VALUE);
    SqlValue.addF64Value(builder, F64_VALUE);
    SqlValue.addStrValue(builder, STR_VALUEOffset);
    SqlValue.addBytesValue(builder, BYTES_VALUEOffset);
    return SqlValue.endSqlValue(builder);
  }
  unpack() {
    return new SqlValueT(
      this.KIND(),
      this.BOOL_VALUE(),
      this.I64_VALUE(),
      this.F64_VALUE(),
      this.STR_VALUE(),
      this.bb.createScalarList(this.BYTES_VALUE.bind(this), this.bytesValueLength())
    );
  }
  unpackTo(_o) {
    _o.KIND = this.KIND();
    _o.BOOL_VALUE = this.BOOL_VALUE();
    _o.I64_VALUE = this.I64_VALUE();
    _o.F64_VALUE = this.F64_VALUE();
    _o.STR_VALUE = this.STR_VALUE();
    _o.BYTES_VALUE = this.bb.createScalarList(this.BYTES_VALUE.bind(this), this.bytesValueLength());
  }
}
class SqlValueT {
  constructor(KIND = sqlValueKind.Null, BOOL_VALUE = false, I64_VALUE = BigInt("0"), F64_VALUE = 0, STR_VALUE = null, BYTES_VALUE = []) {
    __publicField(this, "KIND", KIND);
    __publicField(this, "BOOL_VALUE", BOOL_VALUE);
    __publicField(this, "I64_VALUE", I64_VALUE);
    __publicField(this, "F64_VALUE", F64_VALUE);
    __publicField(this, "STR_VALUE", STR_VALUE);
    __publicField(this, "BYTES_VALUE", BYTES_VALUE);
  }
  pack(builder) {
    const STR_VALUE = this.STR_VALUE !== null ? builder.createString(this.STR_VALUE) : 0;
    const BYTES_VALUE = SqlValue.createBytesValueVector(builder, this.BYTES_VALUE);
    return SqlValue.createSqlValue(
      builder,
      this.KIND,
      this.BOOL_VALUE,
      this.I64_VALUE,
      this.F64_VALUE,
      STR_VALUE,
      BYTES_VALUE
    );
  }
}
export {
  SqlValue,
  SqlValueT
};
