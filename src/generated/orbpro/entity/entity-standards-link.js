var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import * as flatbuffers from "flatbuffers";
class EntityStandardsLink {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsEntityStandardsLink(bb, obj) {
    return (obj || new EntityStandardsLink()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsEntityStandardsLink(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new EntityStandardsLink()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static bufferHasIdentifier(bb) {
    return bb.__has_identifier("ESTL");
  }
  linkKey(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  entityId(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  entityRecordKey(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  entitySchemaFileId(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  entityRowId() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  recordKey(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  schemaName(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  recordSchemaFileId(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  recordRowId() {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  cascadeDelete() {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : true;
  }
  updatedAtMs() {
    const offset = this.bb.__offset(this.bb_pos, 24);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  static startEntityStandardsLink(builder) {
    builder.startObject(11);
  }
  static addLinkKey(builder, linkKeyOffset) {
    builder.addFieldOffset(0, linkKeyOffset, 0);
  }
  static addEntityId(builder, entityIdOffset) {
    builder.addFieldOffset(1, entityIdOffset, 0);
  }
  static addEntityRecordKey(builder, entityRecordKeyOffset) {
    builder.addFieldOffset(2, entityRecordKeyOffset, 0);
  }
  static addEntitySchemaFileId(builder, entitySchemaFileIdOffset) {
    builder.addFieldOffset(3, entitySchemaFileIdOffset, 0);
  }
  static addEntityRowId(builder, entityRowId) {
    builder.addFieldFloat64(4, entityRowId, 0);
  }
  static addRecordKey(builder, recordKeyOffset) {
    builder.addFieldOffset(5, recordKeyOffset, 0);
  }
  static addSchemaName(builder, schemaNameOffset) {
    builder.addFieldOffset(6, schemaNameOffset, 0);
  }
  static addRecordSchemaFileId(builder, recordSchemaFileIdOffset) {
    builder.addFieldOffset(7, recordSchemaFileIdOffset, 0);
  }
  static addRecordRowId(builder, recordRowId) {
    builder.addFieldFloat64(8, recordRowId, 0);
  }
  static addCascadeDelete(builder, cascadeDelete) {
    builder.addFieldInt8(9, +cascadeDelete, 1);
  }
  static addUpdatedAtMs(builder, updatedAtMs) {
    builder.addFieldFloat64(10, updatedAtMs, 0);
  }
  static endEntityStandardsLink(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    builder.requiredField(offset, 6);
    builder.requiredField(offset, 8);
    builder.requiredField(offset, 10);
    builder.requiredField(offset, 14);
    builder.requiredField(offset, 16);
    builder.requiredField(offset, 18);
    return offset;
  }
  static finishEntityStandardsLinkBuffer(builder, offset) {
    builder.finish(offset, "ESTL");
  }
  static finishSizePrefixedEntityStandardsLinkBuffer(builder, offset) {
    builder.finish(offset, "ESTL", true);
  }
  static createEntityStandardsLink(builder, linkKeyOffset, entityIdOffset, entityRecordKeyOffset, entitySchemaFileIdOffset, entityRowId, recordKeyOffset, schemaNameOffset, recordSchemaFileIdOffset, recordRowId, cascadeDelete, updatedAtMs) {
    EntityStandardsLink.startEntityStandardsLink(builder);
    EntityStandardsLink.addLinkKey(builder, linkKeyOffset);
    EntityStandardsLink.addEntityId(builder, entityIdOffset);
    EntityStandardsLink.addEntityRecordKey(builder, entityRecordKeyOffset);
    EntityStandardsLink.addEntitySchemaFileId(builder, entitySchemaFileIdOffset);
    EntityStandardsLink.addEntityRowId(builder, entityRowId);
    EntityStandardsLink.addRecordKey(builder, recordKeyOffset);
    EntityStandardsLink.addSchemaName(builder, schemaNameOffset);
    EntityStandardsLink.addRecordSchemaFileId(builder, recordSchemaFileIdOffset);
    EntityStandardsLink.addRecordRowId(builder, recordRowId);
    EntityStandardsLink.addCascadeDelete(builder, cascadeDelete);
    EntityStandardsLink.addUpdatedAtMs(builder, updatedAtMs);
    return EntityStandardsLink.endEntityStandardsLink(builder);
  }
}
export {
  EntityStandardsLink
};
