var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class GetConfigParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsGetConfigParams(bb, obj) {
    return (obj || new GetConfigParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsGetConfigParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new GetConfigParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static startGetConfigParams(builder) {
    builder.startObject(0);
  }
  static endGetConfigParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createGetConfigParams(builder) {
    GetConfigParams.startGetConfigParams(builder);
    return GetConfigParams.endGetConfigParams(builder);
  }
  unpack() {
    return new GetConfigParamsT();
  }
  unpackTo(_o) {
  }
}
class GetConfigParamsT {
  constructor() {
  }
  pack(builder) {
    return GetConfigParams.createGetConfigParams(builder);
  }
}
export {
  GetConfigParams,
  GetConfigParamsT
};
