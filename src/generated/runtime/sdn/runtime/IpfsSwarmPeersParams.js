var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class IpfsSwarmPeersParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIpfsSwarmPeersParams(bb, obj) {
    return (obj || new IpfsSwarmPeersParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIpfsSwarmPeersParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IpfsSwarmPeersParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static startIpfsSwarmPeersParams(builder) {
    builder.startObject(0);
  }
  static endIpfsSwarmPeersParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createIpfsSwarmPeersParams(builder) {
    IpfsSwarmPeersParams.startIpfsSwarmPeersParams(builder);
    return IpfsSwarmPeersParams.endIpfsSwarmPeersParams(builder);
  }
  unpack() {
    return new IpfsSwarmPeersParamsT();
  }
  unpackTo(_o) {
  }
}
class IpfsSwarmPeersParamsT {
  constructor() {
  }
  pack(builder) {
    return IpfsSwarmPeersParams.createIpfsSwarmPeersParams(builder);
  }
}
export {
  IpfsSwarmPeersParams,
  IpfsSwarmPeersParamsT
};
