var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class StorageExpireParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsStorageExpireParams(bb, obj) {
    return (obj || new StorageExpireParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsStorageExpireParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new StorageExpireParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  SCHEMA(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  PROVIDER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SOURCE_NAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  BEFORE_MS() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  /**
   * Index page size; 0 = 500.
   */
  BATCH() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  /**
   * 0 = 100000.
   */
  MAX_DELETES() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  static startStorageExpireParams(builder) {
    builder.startObject(6);
  }
  static addSchema(builder, SCHEMAOffset) {
    builder.addFieldOffset(0, SCHEMAOffset, 0);
  }
  static addProviderId(builder, PROVIDER_IDOffset) {
    builder.addFieldOffset(1, PROVIDER_IDOffset, 0);
  }
  static addSourceName(builder, SOURCE_NAMEOffset) {
    builder.addFieldOffset(2, SOURCE_NAMEOffset, 0);
  }
  static addBeforeMs(builder, BEFORE_MS) {
    builder.addFieldInt64(3, BEFORE_MS, BigInt("0"));
  }
  static addBatch(builder, BATCH) {
    builder.addFieldInt32(4, BATCH, 0);
  }
  static addMaxDeletes(builder, MAX_DELETES) {
    builder.addFieldInt32(5, MAX_DELETES, 0);
  }
  static endStorageExpireParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createStorageExpireParams(builder, SCHEMAOffset, PROVIDER_IDOffset, SOURCE_NAMEOffset, BEFORE_MS, BATCH, MAX_DELETES) {
    StorageExpireParams.startStorageExpireParams(builder);
    StorageExpireParams.addSchema(builder, SCHEMAOffset);
    StorageExpireParams.addProviderId(builder, PROVIDER_IDOffset);
    StorageExpireParams.addSourceName(builder, SOURCE_NAMEOffset);
    StorageExpireParams.addBeforeMs(builder, BEFORE_MS);
    StorageExpireParams.addBatch(builder, BATCH);
    StorageExpireParams.addMaxDeletes(builder, MAX_DELETES);
    return StorageExpireParams.endStorageExpireParams(builder);
  }
  unpack() {
    return new StorageExpireParamsT(
      this.SCHEMA(),
      this.PROVIDER_ID(),
      this.SOURCE_NAME(),
      this.BEFORE_MS(),
      this.BATCH(),
      this.MAX_DELETES()
    );
  }
  unpackTo(_o) {
    _o.SCHEMA = this.SCHEMA();
    _o.PROVIDER_ID = this.PROVIDER_ID();
    _o.SOURCE_NAME = this.SOURCE_NAME();
    _o.BEFORE_MS = this.BEFORE_MS();
    _o.BATCH = this.BATCH();
    _o.MAX_DELETES = this.MAX_DELETES();
  }
}
class StorageExpireParamsT {
  constructor(SCHEMA = null, PROVIDER_ID = null, SOURCE_NAME = null, BEFORE_MS = BigInt("0"), BATCH = 0, MAX_DELETES = 0) {
    __publicField(this, "SCHEMA", SCHEMA);
    __publicField(this, "PROVIDER_ID", PROVIDER_ID);
    __publicField(this, "SOURCE_NAME", SOURCE_NAME);
    __publicField(this, "BEFORE_MS", BEFORE_MS);
    __publicField(this, "BATCH", BATCH);
    __publicField(this, "MAX_DELETES", MAX_DELETES);
  }
  pack(builder) {
    const SCHEMA = this.SCHEMA !== null ? builder.createString(this.SCHEMA) : 0;
    const PROVIDER_ID = this.PROVIDER_ID !== null ? builder.createString(this.PROVIDER_ID) : 0;
    const SOURCE_NAME = this.SOURCE_NAME !== null ? builder.createString(this.SOURCE_NAME) : 0;
    return StorageExpireParams.createStorageExpireParams(
      builder,
      SCHEMA,
      PROVIDER_ID,
      SOURCE_NAME,
      this.BEFORE_MS,
      this.BATCH,
      this.MAX_DELETES
    );
  }
}
export {
  StorageExpireParams,
  StorageExpireParamsT
};
