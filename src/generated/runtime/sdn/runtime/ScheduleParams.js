var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class ScheduleParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsScheduleParams(bb, obj) {
    return (obj || new ScheduleParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsScheduleParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new ScheduleParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  EXPRESSION(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  AT_MS() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  static startScheduleParams(builder) {
    builder.startObject(2);
  }
  static addExpression(builder, EXPRESSIONOffset) {
    builder.addFieldOffset(0, EXPRESSIONOffset, 0);
  }
  static addAtMs(builder, AT_MS) {
    builder.addFieldInt64(1, AT_MS, BigInt("0"));
  }
  static endScheduleParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createScheduleParams(builder, EXPRESSIONOffset, AT_MS) {
    ScheduleParams.startScheduleParams(builder);
    ScheduleParams.addExpression(builder, EXPRESSIONOffset);
    ScheduleParams.addAtMs(builder, AT_MS);
    return ScheduleParams.endScheduleParams(builder);
  }
  unpack() {
    return new ScheduleParamsT(
      this.EXPRESSION(),
      this.AT_MS()
    );
  }
  unpackTo(_o) {
    _o.EXPRESSION = this.EXPRESSION();
    _o.AT_MS = this.AT_MS();
  }
}
class ScheduleParamsT {
  constructor(EXPRESSION = null, AT_MS = BigInt("0")) {
    __publicField(this, "EXPRESSION", EXPRESSION);
    __publicField(this, "AT_MS", AT_MS);
  }
  pack(builder) {
    const EXPRESSION = this.EXPRESSION !== null ? builder.createString(this.EXPRESSION) : 0;
    return ScheduleParams.createScheduleParams(
      builder,
      EXPRESSION,
      this.AT_MS
    );
  }
}
export {
  ScheduleParams,
  ScheduleParamsT
};
