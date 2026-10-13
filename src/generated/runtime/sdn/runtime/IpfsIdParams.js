var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class IpfsIdParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIpfsIdParams(bb, obj) {
    return (obj || new IpfsIdParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIpfsIdParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IpfsIdParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static startIpfsIdParams(builder) {
    builder.startObject(0);
  }
  static endIpfsIdParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createIpfsIdParams(builder) {
    IpfsIdParams.startIpfsIdParams(builder);
    return IpfsIdParams.endIpfsIdParams(builder);
  }
  unpack() {
    return new IpfsIdParamsT();
  }
  unpackTo(_o) {
  }
}
class IpfsIdParamsT {
  constructor() {
  }
  pack(builder) {
    return IpfsIdParams.createIpfsIdParams(builder);
  }
}
export {
  IpfsIdParams,
  IpfsIdParamsT
};
