var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { HostCallError } from "./HostCallError.js";
import { HostCallValue, unionToHostCallValue } from "./HostCallValue.js";
class HostCallResult {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsHostCallResult(bb, obj) {
    return (obj || new HostCallResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsHostCallResult(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new HostCallResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static bufferHasIdentifier(bb) {
    return bb.__has_identifier("HCLR");
  }
  OK() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  ERROR(obj) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? (obj || new HostCallError()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  VALUE_type() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : HostCallValue.NONE;
  }
  VALUE(obj) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__union(obj, this.bb_pos + offset) : null;
  }
  static startHostCallResult(builder) {
    builder.startObject(4);
  }
  static addOk(builder, OK) {
    builder.addFieldInt8(0, +OK, 0);
  }
  static addError(builder, ERROROffset) {
    builder.addFieldOffset(1, ERROROffset, 0);
  }
  static addValueType(builder, VALUE_type) {
    builder.addFieldInt8(2, VALUE_type, HostCallValue.NONE);
  }
  static addValue(builder, VALUEOffset) {
    builder.addFieldOffset(3, VALUEOffset, 0);
  }
  static endHostCallResult(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static finishHostCallResultBuffer(builder, offset) {
    builder.finish(offset, "HCLR");
  }
  static finishSizePrefixedHostCallResultBuffer(builder, offset) {
    builder.finish(offset, "HCLR", true);
  }
  unpack() {
    return new HostCallResultT(
      this.OK(),
      this.ERROR() !== null ? this.ERROR().unpack() : null,
      this.VALUE_type(),
      (() => {
        const temp = unionToHostCallValue(this.VALUE_type(), this.VALUE.bind(this));
        if (temp === null) {
          return null;
        }
        return temp.unpack();
      })()
    );
  }
  unpackTo(_o) {
    _o.OK = this.OK();
    _o.ERROR = this.ERROR() !== null ? this.ERROR().unpack() : null;
    _o.VALUE_type = this.VALUE_type();
    _o.VALUE = (() => {
      const temp = unionToHostCallValue(this.VALUE_type(), this.VALUE.bind(this));
      if (temp === null) {
        return null;
      }
      return temp.unpack();
    })();
  }
}
class HostCallResultT {
  constructor(OK = false, ERROR = null, VALUE_type = HostCallValue.NONE, VALUE = null) {
    __publicField(this, "OK", OK);
    __publicField(this, "ERROR", ERROR);
    __publicField(this, "VALUE_type", VALUE_type);
    __publicField(this, "VALUE", VALUE);
  }
  pack(builder) {
    const ERROR = this.ERROR !== null ? this.ERROR.pack(builder) : 0;
    const VALUE = builder.createObjectOffset(this.VALUE);
    HostCallResult.startHostCallResult(builder);
    HostCallResult.addOk(builder, this.OK);
    HostCallResult.addError(builder, ERROR);
    HostCallResult.addValueType(builder, this.VALUE_type);
    HostCallResult.addValue(builder, VALUE);
    return HostCallResult.endHostCallResult(builder);
  }
}
export {
  HostCallResult,
  HostCallResultT
};
