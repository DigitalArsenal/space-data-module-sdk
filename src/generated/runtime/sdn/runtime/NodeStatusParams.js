var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class NodeStatusParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsNodeStatusParams(bb, obj) {
    return (obj || new NodeStatusParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsNodeStatusParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new NodeStatusParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static startNodeStatusParams(builder) {
    builder.startObject(0);
  }
  static endNodeStatusParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createNodeStatusParams(builder) {
    NodeStatusParams.startNodeStatusParams(builder);
    return NodeStatusParams.endNodeStatusParams(builder);
  }
  unpack() {
    return new NodeStatusParamsT();
  }
  unpackTo(_o) {
  }
}
class NodeStatusParamsT {
  constructor() {
  }
  pack(builder) {
    return NodeStatusParams.createNodeStatusParams(builder);
  }
}
export {
  NodeStatusParams,
  NodeStatusParamsT
};
