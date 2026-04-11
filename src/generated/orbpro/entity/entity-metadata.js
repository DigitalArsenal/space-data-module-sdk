var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import * as flatbuffers from "flatbuffers";
import { EntityKind } from "../../orbpro/entity/entity-kind.js";
class EntityMetadata {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsEntityMetadata(bb, obj) {
    return (obj || new EntityMetadata()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsEntityMetadata(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new EntityMetadata()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static bufferHasIdentifier(bb) {
    return bb.__has_identifier("ENTM");
  }
  entityId(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  name(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  entityKind() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : EntityKind.ENTITY;
  }
  subtype(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  parentEntityId(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  primarySchemaFileId(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  primaryRowId() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  wasmHandle() {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  positionRegionId() {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  positionRecordIndex() {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  velocityRegionId() {
    const offset = this.bb.__offset(this.bb_pos, 24);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  velocityRecordIndex() {
    const offset = this.bb.__offset(this.bb_pos, 26);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  visibilityRegionId() {
    const offset = this.bb.__offset(this.bb_pos, 28);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  visibilityRecordIndex() {
    const offset = this.bb.__offset(this.bb_pos, 30);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  noradCatId() {
    const offset = this.bb.__offset(this.bb_pos, 32);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  objectName(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 34);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  objectId(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 36);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  catObjectName(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 38);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  catObjectId(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 40);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  facilityType(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 42);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  searchText(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 44);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  owner(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 46);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  statusCode(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 48);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  launchDate(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 50);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  launchYear(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 52);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  orbitRegime(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 54);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  period() {
    const offset = this.bb.__offset(this.bb_pos, 56);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  inclination() {
    const offset = this.bb.__offset(this.bb_pos, 58);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  apogee() {
    const offset = this.bb.__offset(this.bb_pos, 60);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  perigee() {
    const offset = this.bb.__offset(this.bb_pos, 62);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  meanMotion() {
    const offset = this.bb.__offset(this.bb_pos, 64);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  eccentricity() {
    const offset = this.bb.__offset(this.bb_pos, 66);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  bstar() {
    const offset = this.bb.__offset(this.bb_pos, 68);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  hasGp() {
    const offset = this.bb.__offset(this.bb_pos, 70);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  static startEntityMetadata(builder) {
    builder.startObject(34);
  }
  static addEntityId(builder, entityIdOffset) {
    builder.addFieldOffset(0, entityIdOffset, 0);
  }
  static addName(builder, nameOffset) {
    builder.addFieldOffset(1, nameOffset, 0);
  }
  static addEntityKind(builder, entityKind) {
    builder.addFieldInt8(2, entityKind, EntityKind.ENTITY);
  }
  static addSubtype(builder, subtypeOffset) {
    builder.addFieldOffset(3, subtypeOffset, 0);
  }
  static addParentEntityId(builder, parentEntityIdOffset) {
    builder.addFieldOffset(4, parentEntityIdOffset, 0);
  }
  static addPrimarySchemaFileId(builder, primarySchemaFileIdOffset) {
    builder.addFieldOffset(5, primarySchemaFileIdOffset, 0);
  }
  static addPrimaryRowId(builder, primaryRowId) {
    builder.addFieldFloat64(6, primaryRowId, 0);
  }
  static addWasmHandle(builder, wasmHandle) {
    builder.addFieldInt32(7, wasmHandle, 0);
  }
  static addPositionRegionId(builder, positionRegionId) {
    builder.addFieldInt32(8, positionRegionId, 0);
  }
  static addPositionRecordIndex(builder, positionRecordIndex) {
    builder.addFieldInt32(9, positionRecordIndex, 0);
  }
  static addVelocityRegionId(builder, velocityRegionId) {
    builder.addFieldInt32(10, velocityRegionId, 0);
  }
  static addVelocityRecordIndex(builder, velocityRecordIndex) {
    builder.addFieldInt32(11, velocityRecordIndex, 0);
  }
  static addVisibilityRegionId(builder, visibilityRegionId) {
    builder.addFieldInt32(12, visibilityRegionId, 0);
  }
  static addVisibilityRecordIndex(builder, visibilityRecordIndex) {
    builder.addFieldInt32(13, visibilityRecordIndex, 0);
  }
  static addNoradCatId(builder, noradCatId) {
    builder.addFieldInt32(14, noradCatId, 0);
  }
  static addObjectName(builder, objectNameOffset) {
    builder.addFieldOffset(15, objectNameOffset, 0);
  }
  static addObjectId(builder, objectIdOffset) {
    builder.addFieldOffset(16, objectIdOffset, 0);
  }
  static addCatObjectName(builder, catObjectNameOffset) {
    builder.addFieldOffset(17, catObjectNameOffset, 0);
  }
  static addCatObjectId(builder, catObjectIdOffset) {
    builder.addFieldOffset(18, catObjectIdOffset, 0);
  }
  static addFacilityType(builder, facilityTypeOffset) {
    builder.addFieldOffset(19, facilityTypeOffset, 0);
  }
  static addSearchText(builder, searchTextOffset) {
    builder.addFieldOffset(20, searchTextOffset, 0);
  }
  static addOwner(builder, ownerOffset) {
    builder.addFieldOffset(21, ownerOffset, 0);
  }
  static addStatusCode(builder, statusCodeOffset) {
    builder.addFieldOffset(22, statusCodeOffset, 0);
  }
  static addLaunchDate(builder, launchDateOffset) {
    builder.addFieldOffset(23, launchDateOffset, 0);
  }
  static addLaunchYear(builder, launchYearOffset) {
    builder.addFieldOffset(24, launchYearOffset, 0);
  }
  static addOrbitRegime(builder, orbitRegimeOffset) {
    builder.addFieldOffset(25, orbitRegimeOffset, 0);
  }
  static addPeriod(builder, period) {
    builder.addFieldFloat64(26, period, 0);
  }
  static addInclination(builder, inclination) {
    builder.addFieldFloat64(27, inclination, 0);
  }
  static addApogee(builder, apogee) {
    builder.addFieldFloat64(28, apogee, 0);
  }
  static addPerigee(builder, perigee) {
    builder.addFieldFloat64(29, perigee, 0);
  }
  static addMeanMotion(builder, meanMotion) {
    builder.addFieldFloat64(30, meanMotion, 0);
  }
  static addEccentricity(builder, eccentricity) {
    builder.addFieldFloat64(31, eccentricity, 0);
  }
  static addBstar(builder, bstar) {
    builder.addFieldFloat64(32, bstar, 0);
  }
  static addHasGp(builder, hasGp) {
    builder.addFieldInt8(33, +hasGp, 0);
  }
  static endEntityMetadata(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static finishEntityMetadataBuffer(builder, offset) {
    builder.finish(offset, "ENTM");
  }
  static finishSizePrefixedEntityMetadataBuffer(builder, offset) {
    builder.finish(offset, "ENTM", true);
  }
  static createEntityMetadata(builder, entityIdOffset, nameOffset, entityKind, subtypeOffset, parentEntityIdOffset, primarySchemaFileIdOffset, primaryRowId, wasmHandle, positionRegionId, positionRecordIndex, velocityRegionId, velocityRecordIndex, visibilityRegionId, visibilityRecordIndex, noradCatId, objectNameOffset, objectIdOffset, catObjectNameOffset, catObjectIdOffset, facilityTypeOffset, searchTextOffset, ownerOffset, statusCodeOffset, launchDateOffset, launchYearOffset, orbitRegimeOffset, period, inclination, apogee, perigee, meanMotion, eccentricity, bstar, hasGp) {
    EntityMetadata.startEntityMetadata(builder);
    EntityMetadata.addEntityId(builder, entityIdOffset);
    EntityMetadata.addName(builder, nameOffset);
    EntityMetadata.addEntityKind(builder, entityKind);
    EntityMetadata.addSubtype(builder, subtypeOffset);
    EntityMetadata.addParentEntityId(builder, parentEntityIdOffset);
    EntityMetadata.addPrimarySchemaFileId(builder, primarySchemaFileIdOffset);
    EntityMetadata.addPrimaryRowId(builder, primaryRowId);
    EntityMetadata.addWasmHandle(builder, wasmHandle);
    EntityMetadata.addPositionRegionId(builder, positionRegionId);
    EntityMetadata.addPositionRecordIndex(builder, positionRecordIndex);
    EntityMetadata.addVelocityRegionId(builder, velocityRegionId);
    EntityMetadata.addVelocityRecordIndex(builder, velocityRecordIndex);
    EntityMetadata.addVisibilityRegionId(builder, visibilityRegionId);
    EntityMetadata.addVisibilityRecordIndex(builder, visibilityRecordIndex);
    EntityMetadata.addNoradCatId(builder, noradCatId);
    EntityMetadata.addObjectName(builder, objectNameOffset);
    EntityMetadata.addObjectId(builder, objectIdOffset);
    EntityMetadata.addCatObjectName(builder, catObjectNameOffset);
    EntityMetadata.addCatObjectId(builder, catObjectIdOffset);
    EntityMetadata.addFacilityType(builder, facilityTypeOffset);
    EntityMetadata.addSearchText(builder, searchTextOffset);
    EntityMetadata.addOwner(builder, ownerOffset);
    EntityMetadata.addStatusCode(builder, statusCodeOffset);
    EntityMetadata.addLaunchDate(builder, launchDateOffset);
    EntityMetadata.addLaunchYear(builder, launchYearOffset);
    EntityMetadata.addOrbitRegime(builder, orbitRegimeOffset);
    EntityMetadata.addPeriod(builder, period);
    EntityMetadata.addInclination(builder, inclination);
    EntityMetadata.addApogee(builder, apogee);
    EntityMetadata.addPerigee(builder, perigee);
    EntityMetadata.addMeanMotion(builder, meanMotion);
    EntityMetadata.addEccentricity(builder, eccentricity);
    EntityMetadata.addBstar(builder, bstar);
    EntityMetadata.addHasGp(builder, hasGp);
    return EntityMetadata.endEntityMetadata(builder);
  }
}
export {
  EntityMetadata
};
