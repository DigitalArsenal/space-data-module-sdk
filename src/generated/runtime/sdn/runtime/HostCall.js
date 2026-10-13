var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { HostCallParams, unionToHostCallParams } from "./HostCallParams.js";
class HostCall {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsHostCall(bb, obj) {
    return (obj || new HostCall()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsHostCall(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new HostCall()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static bufferHasIdentifier(bb) {
    return bb.__has_identifier("HCLQ");
  }
  OP(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  PARAMS_type() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : HostCallParams.NONE;
  }
  PARAMS(obj) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__union(obj, this.bb_pos + offset) : null;
  }
  static startHostCall(builder) {
    builder.startObject(3);
  }
  static addOp(builder, OPOffset) {
    builder.addFieldOffset(0, OPOffset, 0);
  }
  static addParamsType(builder, PARAMS_type) {
    builder.addFieldInt8(1, PARAMS_type, HostCallParams.NONE);
  }
  static addParams(builder, PARAMSOffset) {
    builder.addFieldOffset(2, PARAMSOffset, 0);
  }
  static endHostCall(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static finishHostCallBuffer(builder, offset) {
    builder.finish(offset, "HCLQ");
  }
  static finishSizePrefixedHostCallBuffer(builder, offset) {
    builder.finish(offset, "HCLQ", true);
  }
  static createHostCall(builder, OPOffset, PARAMS_type, PARAMSOffset) {
    HostCall.startHostCall(builder);
    HostCall.addOp(builder, OPOffset);
    HostCall.addParamsType(builder, PARAMS_type);
    HostCall.addParams(builder, PARAMSOffset);
    return HostCall.endHostCall(builder);
  }
  unpack() {
    return new HostCallT(
      this.OP(),
      this.PARAMS_type(),
      (() => {
        const temp = unionToHostCallParams(this.PARAMS_type(), this.PARAMS.bind(this));
        if (temp === null) {
          return null;
        }
        return temp.unpack();
      })()
    );
  }
  unpackTo(_o) {
    _o.OP = this.OP();
    _o.PARAMS_type = this.PARAMS_type();
    _o.PARAMS = (() => {
      const temp = unionToHostCallParams(this.PARAMS_type(), this.PARAMS.bind(this));
      if (temp === null) {
        return null;
      }
      return temp.unpack();
    })();
  }
}
class HostCallT {
  constructor(OP = null, PARAMS_type = HostCallParams.NONE, PARAMS = null) {
    __publicField(this, "OP", OP);
    __publicField(this, "PARAMS_type", PARAMS_type);
    __publicField(this, "PARAMS", PARAMS);
  }
  pack(builder) {
    const OP = this.OP !== null ? builder.createString(this.OP) : 0;
    const PARAMS = builder.createObjectOffset(this.PARAMS);
    return HostCall.createHostCall(
      builder,
      OP,
      this.PARAMS_type,
      PARAMS
    );
  }
}
export {
  HostCall,
  HostCallT
};
