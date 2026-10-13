var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class FsStat {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsFsStat(bb, obj) {
    return (obj || new FsStat()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsFsStat(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new FsStat()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PATH(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SIZE() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  IS_FILE() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  IS_DIRECTORY() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  CTIME_MS() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  MTIME_MS() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  static startFsStat(builder) {
    builder.startObject(6);
  }
  static addPath(builder, PATHOffset) {
    builder.addFieldOffset(0, PATHOffset, 0);
  }
  static addSize(builder, SIZE) {
    builder.addFieldInt64(1, SIZE, BigInt("0"));
  }
  static addIsFile(builder, IS_FILE) {
    builder.addFieldInt8(2, +IS_FILE, 0);
  }
  static addIsDirectory(builder, IS_DIRECTORY) {
    builder.addFieldInt8(3, +IS_DIRECTORY, 0);
  }
  static addCtimeMs(builder, CTIME_MS) {
    builder.addFieldFloat64(4, CTIME_MS, 0);
  }
  static addMtimeMs(builder, MTIME_MS) {
    builder.addFieldFloat64(5, MTIME_MS, 0);
  }
  static endFsStat(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createFsStat(builder, PATHOffset, SIZE, IS_FILE, IS_DIRECTORY, CTIME_MS, MTIME_MS) {
    FsStat.startFsStat(builder);
    FsStat.addPath(builder, PATHOffset);
    FsStat.addSize(builder, SIZE);
    FsStat.addIsFile(builder, IS_FILE);
    FsStat.addIsDirectory(builder, IS_DIRECTORY);
    FsStat.addCtimeMs(builder, CTIME_MS);
    FsStat.addMtimeMs(builder, MTIME_MS);
    return FsStat.endFsStat(builder);
  }
  unpack() {
    return new FsStatT(
      this.PATH(),
      this.SIZE(),
      this.IS_FILE(),
      this.IS_DIRECTORY(),
      this.CTIME_MS(),
      this.MTIME_MS()
    );
  }
  unpackTo(_o) {
    _o.PATH = this.PATH();
    _o.SIZE = this.SIZE();
    _o.IS_FILE = this.IS_FILE();
    _o.IS_DIRECTORY = this.IS_DIRECTORY();
    _o.CTIME_MS = this.CTIME_MS();
    _o.MTIME_MS = this.MTIME_MS();
  }
}
class FsStatT {
  constructor(PATH = null, SIZE = BigInt("0"), IS_FILE = false, IS_DIRECTORY = false, CTIME_MS = 0, MTIME_MS = 0) {
    __publicField(this, "PATH", PATH);
    __publicField(this, "SIZE", SIZE);
    __publicField(this, "IS_FILE", IS_FILE);
    __publicField(this, "IS_DIRECTORY", IS_DIRECTORY);
    __publicField(this, "CTIME_MS", CTIME_MS);
    __publicField(this, "MTIME_MS", MTIME_MS);
  }
  pack(builder) {
    const PATH = this.PATH !== null ? builder.createString(this.PATH) : 0;
    return FsStat.createFsStat(
      builder,
      PATH,
      this.SIZE,
      this.IS_FILE,
      this.IS_DIRECTORY,
      this.CTIME_MS,
      this.MTIME_MS
    );
  }
}
export {
  FsStat,
  FsStatT
};
