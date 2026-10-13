var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class IpfsPinLsParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIpfsPinLsParams(bb, obj) {
    return (obj || new IpfsPinLsParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIpfsPinLsParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IpfsPinLsParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  TYPE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startIpfsPinLsParams(builder) {
    builder.startObject(1);
  }
  static addType(builder, TYPEOffset) {
    builder.addFieldOffset(0, TYPEOffset, 0);
  }
  static endIpfsPinLsParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createIpfsPinLsParams(builder, TYPEOffset) {
    IpfsPinLsParams.startIpfsPinLsParams(builder);
    IpfsPinLsParams.addType(builder, TYPEOffset);
    return IpfsPinLsParams.endIpfsPinLsParams(builder);
  }
  unpack() {
    return new IpfsPinLsParamsT(
      this.TYPE()
    );
  }
  unpackTo(_o) {
    _o.TYPE = this.TYPE();
  }
}
class IpfsPinLsParamsT {
  constructor(TYPE = null) {
    __publicField(this, "TYPE", TYPE);
  }
  pack(builder) {
    const TYPE = this.TYPE !== null ? builder.createString(this.TYPE) : 0;
    return IpfsPinLsParams.createIpfsPinLsParams(
      builder,
      TYPE
    );
  }
}
export {
  IpfsPinLsParams,
  IpfsPinLsParamsT
};
