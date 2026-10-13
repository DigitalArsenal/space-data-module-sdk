var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class HostInfoParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsHostInfoParams(bb, obj) {
    return (obj || new HostInfoParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsHostInfoParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new HostInfoParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static startHostInfoParams(builder) {
    builder.startObject(0);
  }
  static endHostInfoParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createHostInfoParams(builder) {
    HostInfoParams.startHostInfoParams(builder);
    return HostInfoParams.endHostInfoParams(builder);
  }
  unpack() {
    return new HostInfoParamsT();
  }
  unpackTo(_o) {
  }
}
class HostInfoParamsT {
  constructor() {
  }
  pack(builder) {
    return HostInfoParams.createHostInfoParams(builder);
  }
}
export {
  HostInfoParams,
  HostInfoParamsT
};
