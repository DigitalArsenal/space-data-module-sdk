var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class StorageWriteResult {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsStorageWriteResult(bb, obj) {
    return (obj || new StorageWriteResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsStorageWriteResult(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new StorageWriteResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  CID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startStorageWriteResult(builder) {
    builder.startObject(1);
  }
  static addCid(builder, CIDOffset) {
    builder.addFieldOffset(0, CIDOffset, 0);
  }
  static endStorageWriteResult(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createStorageWriteResult(builder, CIDOffset) {
    StorageWriteResult.startStorageWriteResult(builder);
    StorageWriteResult.addCid(builder, CIDOffset);
    return StorageWriteResult.endStorageWriteResult(builder);
  }
  unpack() {
    return new StorageWriteResultT(
      this.CID()
    );
  }
  unpackTo(_o) {
    _o.CID = this.CID();
  }
}
class StorageWriteResultT {
  constructor(CID = null) {
    __publicField(this, "CID", CID);
  }
  pack(builder) {
    const CID = this.CID !== null ? builder.createString(this.CID) : 0;
    return StorageWriteResult.createStorageWriteResult(
      builder,
      CID
    );
  }
}
export {
  StorageWriteResult,
  StorageWriteResultT
};
