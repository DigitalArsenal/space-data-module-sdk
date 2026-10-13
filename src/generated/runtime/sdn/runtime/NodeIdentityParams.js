var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class NodeIdentityParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsNodeIdentityParams(bb, obj) {
    return (obj || new NodeIdentityParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsNodeIdentityParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new NodeIdentityParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static startNodeIdentityParams(builder) {
    builder.startObject(0);
  }
  static endNodeIdentityParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createNodeIdentityParams(builder) {
    NodeIdentityParams.startNodeIdentityParams(builder);
    return NodeIdentityParams.endNodeIdentityParams(builder);
  }
  unpack() {
    return new NodeIdentityParamsT();
  }
  unpackTo(_o) {
  }
}
class NodeIdentityParamsT {
  constructor() {
  }
  pack(builder) {
    return NodeIdentityParams.createNodeIdentityParams(builder);
  }
}
export {
  NodeIdentityParams,
  NodeIdentityParamsT
};
