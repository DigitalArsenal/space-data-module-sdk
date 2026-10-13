var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class StorageExpireResult {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsStorageExpireResult(bb, obj) {
    return (obj || new StorageExpireResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsStorageExpireResult(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new StorageExpireResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  DELETED() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  /**
   * Listed by the index, no longer stored.
   */
  MISSING() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  /**
   * Stopped at MAX_DELETES with more to go.
   */
  CAPPED() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  static startStorageExpireResult(builder) {
    builder.startObject(3);
  }
  static addDeleted(builder, DELETED) {
    builder.addFieldInt64(0, DELETED, BigInt("0"));
  }
  static addMissing(builder, MISSING) {
    builder.addFieldInt64(1, MISSING, BigInt("0"));
  }
  static addCapped(builder, CAPPED) {
    builder.addFieldInt8(2, +CAPPED, 0);
  }
  static endStorageExpireResult(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createStorageExpireResult(builder, DELETED, MISSING, CAPPED) {
    StorageExpireResult.startStorageExpireResult(builder);
    StorageExpireResult.addDeleted(builder, DELETED);
    StorageExpireResult.addMissing(builder, MISSING);
    StorageExpireResult.addCapped(builder, CAPPED);
    return StorageExpireResult.endStorageExpireResult(builder);
  }
  unpack() {
    return new StorageExpireResultT(
      this.DELETED(),
      this.MISSING(),
      this.CAPPED()
    );
  }
  unpackTo(_o) {
    _o.DELETED = this.DELETED();
    _o.MISSING = this.MISSING();
    _o.CAPPED = this.CAPPED();
  }
}
class StorageExpireResultT {
  constructor(DELETED = BigInt("0"), MISSING = BigInt("0"), CAPPED = false) {
    __publicField(this, "DELETED", DELETED);
    __publicField(this, "MISSING", MISSING);
    __publicField(this, "CAPPED", CAPPED);
  }
  pack(builder) {
    return StorageExpireResult.createStorageExpireResult(
      builder,
      this.DELETED,
      this.MISSING,
      this.CAPPED
    );
  }
}
export {
  StorageExpireResult,
  StorageExpireResultT
};
