var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import * as flatbuffers from "flatbuffers";
import { PropagatorSourceDescription } from "../../orbpro/propagator/propagator-source-description.js";
class PropagatorDescribeSourcesBatchResult {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsPropagatorDescribeSourcesBatchResult(bb, obj) {
    return (obj || new PropagatorDescribeSourcesBatchResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsPropagatorDescribeSourcesBatchResult(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new PropagatorDescribeSourcesBatchResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  catalogHandle() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  sources(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? (obj || new PropagatorSourceDescription()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  sourcesLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  static startPropagatorDescribeSourcesBatchResult(builder) {
    builder.startObject(2);
  }
  static addCatalogHandle(builder, catalogHandle) {
    builder.addFieldInt32(0, catalogHandle, 0);
  }
  static addSources(builder, sourcesOffset) {
    builder.addFieldOffset(1, sourcesOffset, 0);
  }
  static createSourcesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startSourcesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static endPropagatorDescribeSourcesBatchResult(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createPropagatorDescribeSourcesBatchResult(builder, catalogHandle, sourcesOffset) {
    PropagatorDescribeSourcesBatchResult.startPropagatorDescribeSourcesBatchResult(builder);
    PropagatorDescribeSourcesBatchResult.addCatalogHandle(builder, catalogHandle);
    PropagatorDescribeSourcesBatchResult.addSources(builder, sourcesOffset);
    return PropagatorDescribeSourcesBatchResult.endPropagatorDescribeSourcesBatchResult(builder);
  }
}
export {
  PropagatorDescribeSourcesBatchResult
};
