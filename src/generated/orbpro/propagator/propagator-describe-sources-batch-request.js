var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import * as flatbuffers from "flatbuffers";
class PropagatorDescribeSourcesBatchRequest {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsPropagatorDescribeSourcesBatchRequest(bb, obj) {
    return (obj || new PropagatorDescribeSourcesBatchRequest()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsPropagatorDescribeSourcesBatchRequest(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new PropagatorDescribeSourcesBatchRequest()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  catalogHandle() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  sourceHandles(index) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint32(this.bb.__vector(this.bb_pos + offset) + index * 4) : 0;
  }
  sourceHandlesLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  sourceHandlesArray() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? new Uint32Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startPropagatorDescribeSourcesBatchRequest(builder) {
    builder.startObject(2);
  }
  static addCatalogHandle(builder, catalogHandle) {
    builder.addFieldInt32(0, catalogHandle, 0);
  }
  static addSourceHandles(builder, sourceHandlesOffset) {
    builder.addFieldOffset(1, sourceHandlesOffset, 0);
  }
  static createSourceHandlesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt32(data[i]);
    }
    return builder.endVector();
  }
  static startSourceHandlesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static endPropagatorDescribeSourcesBatchRequest(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static finishPropagatorDescribeSourcesBatchRequestBuffer(builder, offset) {
    builder.finish(offset);
  }
  static finishSizePrefixedPropagatorDescribeSourcesBatchRequestBuffer(builder, offset) {
    builder.finish(offset, void 0, true);
  }
  static createPropagatorDescribeSourcesBatchRequest(builder, catalogHandle, sourceHandlesOffset) {
    PropagatorDescribeSourcesBatchRequest.startPropagatorDescribeSourcesBatchRequest(builder);
    PropagatorDescribeSourcesBatchRequest.addCatalogHandle(builder, catalogHandle);
    PropagatorDescribeSourcesBatchRequest.addSourceHandles(builder, sourceHandlesOffset);
    return PropagatorDescribeSourcesBatchRequest.endPropagatorDescribeSourcesBatchRequest(builder);
  }
}
export {
  PropagatorDescribeSourcesBatchRequest
};
