var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import * as flatbuffers from "flatbuffers";
import { ReferenceFrame } from "../../orbpro/propagator/reference-frame.js";
import { StateVector } from "../../orbpro/propagator/state-vector.js";
class PropagatorSampleTrajectoryStatesResult {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsPropagatorSampleTrajectoryStatesResult(bb, obj) {
    return (obj || new PropagatorSampleTrajectoryStatesResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsPropagatorSampleTrajectoryStatesResult(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new PropagatorSampleTrajectoryStatesResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  catalogHandle() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  startJd() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  durationDays() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  sampleJds(index) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readFloat64(this.bb.__vector(this.bb_pos + offset) + index * 8) : 0;
  }
  sampleJdsLength() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  sampleJdsArray() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? new Float64Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  sourceHandles(index) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint32(this.bb.__vector(this.bb_pos + offset) + index * 4) : 0;
  }
  sourceHandlesLength() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  sourceHandlesArray() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? new Uint32Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  referenceFrame() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : ReferenceFrame.TEME;
  }
  states(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? (obj || new StateVector()).__init(this.bb.__vector(this.bb_pos + offset) + index * 64, this.bb) : null;
  }
  statesLength() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  static startPropagatorSampleTrajectoryStatesResult(builder) {
    builder.startObject(7);
  }
  static addCatalogHandle(builder, catalogHandle) {
    builder.addFieldInt32(0, catalogHandle, 0);
  }
  static addStartJd(builder, startJd) {
    builder.addFieldFloat64(1, startJd, 0);
  }
  static addDurationDays(builder, durationDays) {
    builder.addFieldFloat64(2, durationDays, 0);
  }
  static addSampleJds(builder, sampleJdsOffset) {
    builder.addFieldOffset(3, sampleJdsOffset, 0);
  }
  static createSampleJdsVector(builder, data) {
    builder.startVector(8, data.length, 8);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addFloat64(data[i]);
    }
    return builder.endVector();
  }
  static startSampleJdsVector(builder, numElems) {
    builder.startVector(8, numElems, 8);
  }
  static addSourceHandles(builder, sourceHandlesOffset) {
    builder.addFieldOffset(4, sourceHandlesOffset, 0);
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
  static addReferenceFrame(builder, referenceFrame) {
    builder.addFieldInt8(5, referenceFrame, ReferenceFrame.TEME);
  }
  static addStates(builder, statesOffset) {
    builder.addFieldOffset(6, statesOffset, 0);
  }
  static startStatesVector(builder, numElems) {
    builder.startVector(64, numElems, 8);
  }
  static endPropagatorSampleTrajectoryStatesResult(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createPropagatorSampleTrajectoryStatesResult(builder, catalogHandle, startJd, durationDays, sampleJdsOffset, sourceHandlesOffset, referenceFrame, statesOffset) {
    PropagatorSampleTrajectoryStatesResult.startPropagatorSampleTrajectoryStatesResult(builder);
    PropagatorSampleTrajectoryStatesResult.addCatalogHandle(builder, catalogHandle);
    PropagatorSampleTrajectoryStatesResult.addStartJd(builder, startJd);
    PropagatorSampleTrajectoryStatesResult.addDurationDays(builder, durationDays);
    PropagatorSampleTrajectoryStatesResult.addSampleJds(builder, sampleJdsOffset);
    PropagatorSampleTrajectoryStatesResult.addSourceHandles(builder, sourceHandlesOffset);
    PropagatorSampleTrajectoryStatesResult.addReferenceFrame(builder, referenceFrame);
    PropagatorSampleTrajectoryStatesResult.addStates(builder, statesOffset);
    return PropagatorSampleTrajectoryStatesResult.endPropagatorSampleTrajectoryStatesResult(builder);
  }
}
export {
  PropagatorSampleTrajectoryStatesResult
};
