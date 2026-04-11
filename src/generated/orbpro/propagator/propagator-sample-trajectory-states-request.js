var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import * as flatbuffers from "flatbuffers";
class PropagatorSampleTrajectoryStatesRequest {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsPropagatorSampleTrajectoryStatesRequest(bb, obj) {
    return (obj || new PropagatorSampleTrajectoryStatesRequest()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsPropagatorSampleTrajectoryStatesRequest(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new PropagatorSampleTrajectoryStatesRequest()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
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
  startJd() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  durationDays() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  profile(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startPropagatorSampleTrajectoryStatesRequest(builder) {
    builder.startObject(5);
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
  static addStartJd(builder, startJd) {
    builder.addFieldFloat64(2, startJd, 0);
  }
  static addDurationDays(builder, durationDays) {
    builder.addFieldFloat64(3, durationDays, 0);
  }
  static addProfile(builder, profileOffset) {
    builder.addFieldOffset(4, profileOffset, 0);
  }
  static endPropagatorSampleTrajectoryStatesRequest(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createPropagatorSampleTrajectoryStatesRequest(builder, catalogHandle, sourceHandlesOffset, startJd, durationDays, profileOffset) {
    PropagatorSampleTrajectoryStatesRequest.startPropagatorSampleTrajectoryStatesRequest(builder);
    PropagatorSampleTrajectoryStatesRequest.addCatalogHandle(builder, catalogHandle);
    PropagatorSampleTrajectoryStatesRequest.addSourceHandles(builder, sourceHandlesOffset);
    PropagatorSampleTrajectoryStatesRequest.addStartJd(builder, startJd);
    PropagatorSampleTrajectoryStatesRequest.addDurationDays(builder, durationDays);
    PropagatorSampleTrajectoryStatesRequest.addProfile(builder, profileOffset);
    return PropagatorSampleTrajectoryStatesRequest.endPropagatorSampleTrajectoryStatesRequest(builder);
  }
}
export {
  PropagatorSampleTrajectoryStatesRequest
};
