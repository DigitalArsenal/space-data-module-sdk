var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { SqlValue } from "./SqlValue.js";
import { deliverMode } from "./deliverMode.js";
import { sandboxWant } from "./sandboxWant.js";
class SandboxQueryParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsSandboxQueryParams(bb, obj) {
    return (obj || new SandboxQueryParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsSandboxQueryParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new SandboxQueryParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  SQL(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  PARAMS(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? (obj || new SqlValue()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  paramsLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  WANT() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : sandboxWant.Stream;
  }
  DELIVER() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : deliverMode.Inline;
  }
  static startSandboxQueryParams(builder) {
    builder.startObject(4);
  }
  static addSql(builder, SQLOffset) {
    builder.addFieldOffset(0, SQLOffset, 0);
  }
  static addParams(builder, PARAMSOffset) {
    builder.addFieldOffset(1, PARAMSOffset, 0);
  }
  static createParamsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startParamsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addWant(builder, WANT) {
    builder.addFieldInt8(2, WANT, sandboxWant.Stream);
  }
  static addDeliver(builder, DELIVER) {
    builder.addFieldInt8(3, DELIVER, deliverMode.Inline);
  }
  static endSandboxQueryParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createSandboxQueryParams(builder, SQLOffset, PARAMSOffset, WANT, DELIVER) {
    SandboxQueryParams.startSandboxQueryParams(builder);
    SandboxQueryParams.addSql(builder, SQLOffset);
    SandboxQueryParams.addParams(builder, PARAMSOffset);
    SandboxQueryParams.addWant(builder, WANT);
    SandboxQueryParams.addDeliver(builder, DELIVER);
    return SandboxQueryParams.endSandboxQueryParams(builder);
  }
  unpack() {
    return new SandboxQueryParamsT(
      this.SQL(),
      this.bb.createObjList(this.PARAMS.bind(this), this.paramsLength()),
      this.WANT(),
      this.DELIVER()
    );
  }
  unpackTo(_o) {
    _o.SQL = this.SQL();
    _o.PARAMS = this.bb.createObjList(this.PARAMS.bind(this), this.paramsLength());
    _o.WANT = this.WANT();
    _o.DELIVER = this.DELIVER();
  }
}
class SandboxQueryParamsT {
  constructor(SQL = null, PARAMS = [], WANT = sandboxWant.Stream, DELIVER = deliverMode.Inline) {
    __publicField(this, "SQL", SQL);
    __publicField(this, "PARAMS", PARAMS);
    __publicField(this, "WANT", WANT);
    __publicField(this, "DELIVER", DELIVER);
  }
  pack(builder) {
    const SQL = this.SQL !== null ? builder.createString(this.SQL) : 0;
    const PARAMS = SandboxQueryParams.createParamsVector(builder, builder.createObjectOffsetList(this.PARAMS));
    return SandboxQueryParams.createSandboxQueryParams(
      builder,
      SQL,
      PARAMS,
      this.WANT,
      this.DELIVER
    );
  }
}
export {
  SandboxQueryParams,
  SandboxQueryParamsT
};
