var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class FsRenameParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsFsRenameParams(bb, obj) {
    return (obj || new FsRenameParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsFsRenameParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new FsRenameParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  FROM_PATH(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  TO_PATH(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  static startFsRenameParams(builder) {
    builder.startObject(2);
  }
  static addFromPath(builder, FROM_PATHOffset) {
    builder.addFieldOffset(0, FROM_PATHOffset, 0);
  }
  static addToPath(builder, TO_PATHOffset) {
    builder.addFieldOffset(1, TO_PATHOffset, 0);
  }
  static endFsRenameParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    builder.requiredField(offset, 6);
    return offset;
  }
  static createFsRenameParams(builder, FROM_PATHOffset, TO_PATHOffset) {
    FsRenameParams.startFsRenameParams(builder);
    FsRenameParams.addFromPath(builder, FROM_PATHOffset);
    FsRenameParams.addToPath(builder, TO_PATHOffset);
    return FsRenameParams.endFsRenameParams(builder);
  }
  unpack() {
    return new FsRenameParamsT(
      this.FROM_PATH(),
      this.TO_PATH()
    );
  }
  unpackTo(_o) {
    _o.FROM_PATH = this.FROM_PATH();
    _o.TO_PATH = this.TO_PATH();
  }
}
class FsRenameParamsT {
  constructor(FROM_PATH = null, TO_PATH = null) {
    __publicField(this, "FROM_PATH", FROM_PATH);
    __publicField(this, "TO_PATH", TO_PATH);
  }
  pack(builder) {
    const FROM_PATH = this.FROM_PATH !== null ? builder.createString(this.FROM_PATH) : 0;
    const TO_PATH = this.TO_PATH !== null ? builder.createString(this.TO_PATH) : 0;
    return FsRenameParams.createFsRenameParams(
      builder,
      FROM_PATH,
      TO_PATH
    );
  }
}
export {
  FsRenameParams,
  FsRenameParamsT
};
