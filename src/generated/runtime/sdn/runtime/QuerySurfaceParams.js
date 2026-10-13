var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class QuerySurfaceParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsQuerySurfaceParams(bb, obj) {
    return (obj || new QuerySurfaceParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsQuerySurfaceParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new QuerySurfaceParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static startQuerySurfaceParams(builder) {
    builder.startObject(0);
  }
  static endQuerySurfaceParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createQuerySurfaceParams(builder) {
    QuerySurfaceParams.startQuerySurfaceParams(builder);
    return QuerySurfaceParams.endQuerySurfaceParams(builder);
  }
  unpack() {
    return new QuerySurfaceParamsT();
  }
  unpackTo(_o) {
  }
}
class QuerySurfaceParamsT {
  constructor() {
  }
  pack(builder) {
    return QuerySurfaceParams.createQuerySurfaceParams(builder);
  }
}
export {
  QuerySurfaceParams,
  QuerySurfaceParamsT
};
