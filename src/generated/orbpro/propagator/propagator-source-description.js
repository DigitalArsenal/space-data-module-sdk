var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import * as flatbuffers from "flatbuffers";
import { PropagatorSourceKind } from "../../orbpro/propagator/propagator-source-kind.js";
class PropagatorSourceDescription {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsPropagatorSourceDescription(bb, obj) {
    return (obj || new PropagatorSourceDescription()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsPropagatorSourceDescription(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new PropagatorSourceDescription()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  sourceHandle() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  sourceKind() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : PropagatorSourceKind.UNKNOWN;
  }
  objectName(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  objectId(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  noradCatId() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  epochJd() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  meanMotionRevPerDay() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  eccentricity() {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  inclinationDeg() {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  raOfAscNodeDeg() {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  argOfPericenterDeg() {
    const offset = this.bb.__offset(this.bb_pos, 24);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  meanAnomalyDeg() {
    const offset = this.bb.__offset(this.bb_pos, 26);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  ephemerisType() {
    const offset = this.bb.__offset(this.bb_pos, 28);
    return offset ? this.bb.readInt32(this.bb_pos + offset) : 0;
  }
  classificationType(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 30);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  elementSetNo() {
    const offset = this.bb.__offset(this.bb_pos, 32);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  revAtEpoch() {
    const offset = this.bb.__offset(this.bb_pos, 34);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  bstar() {
    const offset = this.bb.__offset(this.bb_pos, 36);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  meanMotionDotRevPerDay2() {
    const offset = this.bb.__offset(this.bb_pos, 38);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  meanMotionDdotRevPerDay3() {
    const offset = this.bb.__offset(this.bb_pos, 40);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  perigeeKm() {
    const offset = this.bb.__offset(this.bb_pos, 42);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  apogeeKm() {
    const offset = this.bb.__offset(this.bb_pos, 44);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  static startPropagatorSourceDescription(builder) {
    builder.startObject(21);
  }
  static addSourceHandle(builder, sourceHandle) {
    builder.addFieldInt32(0, sourceHandle, 0);
  }
  static addSourceKind(builder, sourceKind) {
    builder.addFieldInt8(1, sourceKind, PropagatorSourceKind.UNKNOWN);
  }
  static addObjectName(builder, objectNameOffset) {
    builder.addFieldOffset(2, objectNameOffset, 0);
  }
  static addObjectId(builder, objectIdOffset) {
    builder.addFieldOffset(3, objectIdOffset, 0);
  }
  static addNoradCatId(builder, noradCatId) {
    builder.addFieldInt32(4, noradCatId, 0);
  }
  static addEpochJd(builder, epochJd) {
    builder.addFieldFloat64(5, epochJd, 0);
  }
  static addMeanMotionRevPerDay(builder, meanMotionRevPerDay) {
    builder.addFieldFloat64(6, meanMotionRevPerDay, 0);
  }
  static addEccentricity(builder, eccentricity) {
    builder.addFieldFloat64(7, eccentricity, 0);
  }
  static addInclinationDeg(builder, inclinationDeg) {
    builder.addFieldFloat64(8, inclinationDeg, 0);
  }
  static addRaOfAscNodeDeg(builder, raOfAscNodeDeg) {
    builder.addFieldFloat64(9, raOfAscNodeDeg, 0);
  }
  static addArgOfPericenterDeg(builder, argOfPericenterDeg) {
    builder.addFieldFloat64(10, argOfPericenterDeg, 0);
  }
  static addMeanAnomalyDeg(builder, meanAnomalyDeg) {
    builder.addFieldFloat64(11, meanAnomalyDeg, 0);
  }
  static addEphemerisType(builder, ephemerisType) {
    builder.addFieldInt32(12, ephemerisType, 0);
  }
  static addClassificationType(builder, classificationTypeOffset) {
    builder.addFieldOffset(13, classificationTypeOffset, 0);
  }
  static addElementSetNo(builder, elementSetNo) {
    builder.addFieldInt32(14, elementSetNo, 0);
  }
  static addRevAtEpoch(builder, revAtEpoch) {
    builder.addFieldInt32(15, revAtEpoch, 0);
  }
  static addBstar(builder, bstar) {
    builder.addFieldFloat64(16, bstar, 0);
  }
  static addMeanMotionDotRevPerDay2(builder, meanMotionDotRevPerDay2) {
    builder.addFieldFloat64(17, meanMotionDotRevPerDay2, 0);
  }
  static addMeanMotionDdotRevPerDay3(builder, meanMotionDdotRevPerDay3) {
    builder.addFieldFloat64(18, meanMotionDdotRevPerDay3, 0);
  }
  static addPerigeeKm(builder, perigeeKm) {
    builder.addFieldFloat64(19, perigeeKm, 0);
  }
  static addApogeeKm(builder, apogeeKm) {
    builder.addFieldFloat64(20, apogeeKm, 0);
  }
  static endPropagatorSourceDescription(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createPropagatorSourceDescription(builder, sourceHandle, sourceKind, objectNameOffset, objectIdOffset, noradCatId, epochJd, meanMotionRevPerDay, eccentricity, inclinationDeg, raOfAscNodeDeg, argOfPericenterDeg, meanAnomalyDeg, ephemerisType, classificationTypeOffset, elementSetNo, revAtEpoch, bstar, meanMotionDotRevPerDay2, meanMotionDdotRevPerDay3, perigeeKm, apogeeKm) {
    PropagatorSourceDescription.startPropagatorSourceDescription(builder);
    PropagatorSourceDescription.addSourceHandle(builder, sourceHandle);
    PropagatorSourceDescription.addSourceKind(builder, sourceKind);
    PropagatorSourceDescription.addObjectName(builder, objectNameOffset);
    PropagatorSourceDescription.addObjectId(builder, objectIdOffset);
    PropagatorSourceDescription.addNoradCatId(builder, noradCatId);
    PropagatorSourceDescription.addEpochJd(builder, epochJd);
    PropagatorSourceDescription.addMeanMotionRevPerDay(builder, meanMotionRevPerDay);
    PropagatorSourceDescription.addEccentricity(builder, eccentricity);
    PropagatorSourceDescription.addInclinationDeg(builder, inclinationDeg);
    PropagatorSourceDescription.addRaOfAscNodeDeg(builder, raOfAscNodeDeg);
    PropagatorSourceDescription.addArgOfPericenterDeg(builder, argOfPericenterDeg);
    PropagatorSourceDescription.addMeanAnomalyDeg(builder, meanAnomalyDeg);
    PropagatorSourceDescription.addEphemerisType(builder, ephemerisType);
    PropagatorSourceDescription.addClassificationType(builder, classificationTypeOffset);
    PropagatorSourceDescription.addElementSetNo(builder, elementSetNo);
    PropagatorSourceDescription.addRevAtEpoch(builder, revAtEpoch);
    PropagatorSourceDescription.addBstar(builder, bstar);
    PropagatorSourceDescription.addMeanMotionDotRevPerDay2(builder, meanMotionDotRevPerDay2);
    PropagatorSourceDescription.addMeanMotionDdotRevPerDay3(builder, meanMotionDdotRevPerDay3);
    PropagatorSourceDescription.addPerigeeKm(builder, perigeeKm);
    PropagatorSourceDescription.addApogeeKm(builder, apogeeKm);
    return PropagatorSourceDescription.endPropagatorSourceDescription(builder);
  }
}
export {
  PropagatorSourceDescription
};
