var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class StorageDeleteParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsStorageDeleteParams(bb, obj) {
    return (obj || new StorageDeleteParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsStorageDeleteParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new StorageDeleteParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  SCHEMA(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  CID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  static startStorageDeleteParams(builder) {
    builder.startObject(2);
  }
  static addSchema(builder, SCHEMAOffset) {
    builder.addFieldOffset(0, SCHEMAOffset, 0);
  }
  static addCid(builder, CIDOffset) {
    builder.addFieldOffset(1, CIDOffset, 0);
  }
  static endStorageDeleteParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 6);
    return offset;
  }
  static createStorageDeleteParams(builder, SCHEMAOffset, CIDOffset) {
    StorageDeleteParams.startStorageDeleteParams(builder);
    StorageDeleteParams.addSchema(builder, SCHEMAOffset);
    StorageDeleteParams.addCid(builder, CIDOffset);
    return StorageDeleteParams.endStorageDeleteParams(builder);
  }
  unpack() {
    return new StorageDeleteParamsT(
      this.SCHEMA(),
      this.CID()
    );
  }
  unpackTo(_o) {
    _o.SCHEMA = this.SCHEMA();
    _o.CID = this.CID();
  }
}
class StorageDeleteParamsT {
  constructor(SCHEMA = null, CID = null) {
    __publicField(this, "SCHEMA", SCHEMA);
    __publicField(this, "CID", CID);
  }
  pack(builder) {
    const SCHEMA = this.SCHEMA !== null ? builder.createString(this.SCHEMA) : 0;
    const CID = this.CID !== null ? builder.createString(this.CID) : 0;
    return StorageDeleteParams.createStorageDeleteParams(
      builder,
      SCHEMA,
      CID
    );
  }
}
export {
  StorageDeleteParams,
  StorageDeleteParamsT
};
