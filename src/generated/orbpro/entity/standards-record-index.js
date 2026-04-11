var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import * as flatbuffers from "flatbuffers";
class StandardsRecordIndex {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsStandardsRecordIndex(bb, obj) {
    return (obj || new StandardsRecordIndex()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsStandardsRecordIndex(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new StandardsRecordIndex()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static bufferHasIdentifier(bb) {
    return bb.__has_identifier("STRI");
  }
  recordKey(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  schemaName(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  schemaFileId(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  rowId() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  role(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  attachedVia(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  payloadKind(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  updatedAtMs() {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  static startStandardsRecordIndex(builder) {
    builder.startObject(8);
  }
  static addRecordKey(builder, recordKeyOffset) {
    builder.addFieldOffset(0, recordKeyOffset, 0);
  }
  static addSchemaName(builder, schemaNameOffset) {
    builder.addFieldOffset(1, schemaNameOffset, 0);
  }
  static addSchemaFileId(builder, schemaFileIdOffset) {
    builder.addFieldOffset(2, schemaFileIdOffset, 0);
  }
  static addRowId(builder, rowId) {
    builder.addFieldFloat64(3, rowId, 0);
  }
  static addRole(builder, roleOffset) {
    builder.addFieldOffset(4, roleOffset, 0);
  }
  static addAttachedVia(builder, attachedViaOffset) {
    builder.addFieldOffset(5, attachedViaOffset, 0);
  }
  static addPayloadKind(builder, payloadKindOffset) {
    builder.addFieldOffset(6, payloadKindOffset, 0);
  }
  static addUpdatedAtMs(builder, updatedAtMs) {
    builder.addFieldFloat64(7, updatedAtMs, 0);
  }
  static endStandardsRecordIndex(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    builder.requiredField(offset, 6);
    builder.requiredField(offset, 8);
    return offset;
  }
  static finishStandardsRecordIndexBuffer(builder, offset) {
    builder.finish(offset, "STRI");
  }
  static finishSizePrefixedStandardsRecordIndexBuffer(builder, offset) {
    builder.finish(offset, "STRI", true);
  }
  static createStandardsRecordIndex(builder, recordKeyOffset, schemaNameOffset, schemaFileIdOffset, rowId, roleOffset, attachedViaOffset, payloadKindOffset, updatedAtMs) {
    StandardsRecordIndex.startStandardsRecordIndex(builder);
    StandardsRecordIndex.addRecordKey(builder, recordKeyOffset);
    StandardsRecordIndex.addSchemaName(builder, schemaNameOffset);
    StandardsRecordIndex.addSchemaFileId(builder, schemaFileIdOffset);
    StandardsRecordIndex.addRowId(builder, rowId);
    StandardsRecordIndex.addRole(builder, roleOffset);
    StandardsRecordIndex.addAttachedVia(builder, attachedViaOffset);
    StandardsRecordIndex.addPayloadKind(builder, payloadKindOffset);
    StandardsRecordIndex.addUpdatedAtMs(builder, updatedAtMs);
    return StandardsRecordIndex.endStandardsRecordIndex(builder);
  }
}
export {
  StandardsRecordIndex
};
