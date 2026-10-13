var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class FsEntry {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsFsEntry(bb, obj) {
    return (obj || new FsEntry()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsFsEntry(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new FsEntry()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  NAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  IS_FILE() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  IS_DIRECTORY() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  static startFsEntry(builder) {
    builder.startObject(3);
  }
  static addName(builder, NAMEOffset) {
    builder.addFieldOffset(0, NAMEOffset, 0);
  }
  static addIsFile(builder, IS_FILE) {
    builder.addFieldInt8(1, +IS_FILE, 0);
  }
  static addIsDirectory(builder, IS_DIRECTORY) {
    builder.addFieldInt8(2, +IS_DIRECTORY, 0);
  }
  static endFsEntry(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createFsEntry(builder, NAMEOffset, IS_FILE, IS_DIRECTORY) {
    FsEntry.startFsEntry(builder);
    FsEntry.addName(builder, NAMEOffset);
    FsEntry.addIsFile(builder, IS_FILE);
    FsEntry.addIsDirectory(builder, IS_DIRECTORY);
    return FsEntry.endFsEntry(builder);
  }
  unpack() {
    return new FsEntryT(
      this.NAME(),
      this.IS_FILE(),
      this.IS_DIRECTORY()
    );
  }
  unpackTo(_o) {
    _o.NAME = this.NAME();
    _o.IS_FILE = this.IS_FILE();
    _o.IS_DIRECTORY = this.IS_DIRECTORY();
  }
}
class FsEntryT {
  constructor(NAME = null, IS_FILE = false, IS_DIRECTORY = false) {
    __publicField(this, "NAME", NAME);
    __publicField(this, "IS_FILE", IS_FILE);
    __publicField(this, "IS_DIRECTORY", IS_DIRECTORY);
  }
  pack(builder) {
    const NAME = this.NAME !== null ? builder.createString(this.NAME) : 0;
    return FsEntry.createFsEntry(
      builder,
      NAME,
      this.IS_FILE,
      this.IS_DIRECTORY
    );
  }
}
export {
  FsEntry,
  FsEntryT
};
