var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class StorageQueryParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsStorageQueryParams(bb, obj) {
    return (obj || new StorageQueryParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsStorageQueryParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new StorageQueryParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  SCHEMA(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  DAY(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  ENTITY_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  NORAD_CAT_ID() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  /**
   * 0 = 100.
   */
  LIMIT() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  static startStorageQueryParams(builder) {
    builder.startObject(5);
  }
  static addSchema(builder, SCHEMAOffset) {
    builder.addFieldOffset(0, SCHEMAOffset, 0);
  }
  static addDay(builder, DAYOffset) {
    builder.addFieldOffset(1, DAYOffset, 0);
  }
  static addEntityId(builder, ENTITY_IDOffset) {
    builder.addFieldOffset(2, ENTITY_IDOffset, 0);
  }
  static addNoradCatId(builder, NORAD_CAT_ID) {
    builder.addFieldInt32(3, NORAD_CAT_ID, 0);
  }
  static addLimit(builder, LIMIT) {
    builder.addFieldInt32(4, LIMIT, 0);
  }
  static endStorageQueryParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createStorageQueryParams(builder, SCHEMAOffset, DAYOffset, ENTITY_IDOffset, NORAD_CAT_ID, LIMIT) {
    StorageQueryParams.startStorageQueryParams(builder);
    StorageQueryParams.addSchema(builder, SCHEMAOffset);
    StorageQueryParams.addDay(builder, DAYOffset);
    StorageQueryParams.addEntityId(builder, ENTITY_IDOffset);
    StorageQueryParams.addNoradCatId(builder, NORAD_CAT_ID);
    StorageQueryParams.addLimit(builder, LIMIT);
    return StorageQueryParams.endStorageQueryParams(builder);
  }
  unpack() {
    return new StorageQueryParamsT(
      this.SCHEMA(),
      this.DAY(),
      this.ENTITY_ID(),
      this.NORAD_CAT_ID(),
      this.LIMIT()
    );
  }
  unpackTo(_o) {
    _o.SCHEMA = this.SCHEMA();
    _o.DAY = this.DAY();
    _o.ENTITY_ID = this.ENTITY_ID();
    _o.NORAD_CAT_ID = this.NORAD_CAT_ID();
    _o.LIMIT = this.LIMIT();
  }
}
class StorageQueryParamsT {
  constructor(SCHEMA = null, DAY = null, ENTITY_ID = null, NORAD_CAT_ID = 0, LIMIT = 0) {
    __publicField(this, "SCHEMA", SCHEMA);
    __publicField(this, "DAY", DAY);
    __publicField(this, "ENTITY_ID", ENTITY_ID);
    __publicField(this, "NORAD_CAT_ID", NORAD_CAT_ID);
    __publicField(this, "LIMIT", LIMIT);
  }
  pack(builder) {
    const SCHEMA = this.SCHEMA !== null ? builder.createString(this.SCHEMA) : 0;
    const DAY = this.DAY !== null ? builder.createString(this.DAY) : 0;
    const ENTITY_ID = this.ENTITY_ID !== null ? builder.createString(this.ENTITY_ID) : 0;
    return StorageQueryParams.createStorageQueryParams(
      builder,
      SCHEMA,
      DAY,
      ENTITY_ID,
      this.NORAD_CAT_ID,
      this.LIMIT
    );
  }
}
export {
  StorageQueryParams,
  StorageQueryParamsT
};
