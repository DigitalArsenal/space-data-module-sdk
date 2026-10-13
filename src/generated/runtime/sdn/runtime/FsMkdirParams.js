var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class FsMkdirParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsFsMkdirParams(bb, obj) {
    return (obj || new FsMkdirParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsFsMkdirParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new FsMkdirParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PATH(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  RECURSIVE() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : true;
  }
  static startFsMkdirParams(builder) {
    builder.startObject(2);
  }
  static addPath(builder, PATHOffset) {
    builder.addFieldOffset(0, PATHOffset, 0);
  }
  static addRecursive(builder, RECURSIVE) {
    builder.addFieldInt8(1, +RECURSIVE, 1);
  }
  static endFsMkdirParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createFsMkdirParams(builder, PATHOffset, RECURSIVE) {
    FsMkdirParams.startFsMkdirParams(builder);
    FsMkdirParams.addPath(builder, PATHOffset);
    FsMkdirParams.addRecursive(builder, RECURSIVE);
    return FsMkdirParams.endFsMkdirParams(builder);
  }
  unpack() {
    return new FsMkdirParamsT(
      this.PATH(),
      this.RECURSIVE()
    );
  }
  unpackTo(_o) {
    _o.PATH = this.PATH();
    _o.RECURSIVE = this.RECURSIVE();
  }
}
class FsMkdirParamsT {
  constructor(PATH = null, RECURSIVE = true) {
    __publicField(this, "PATH", PATH);
    __publicField(this, "RECURSIVE", RECURSIVE);
  }
  pack(builder) {
    const PATH = this.PATH !== null ? builder.createString(this.PATH) : 0;
    return FsMkdirParams.createFsMkdirParams(
      builder,
      PATH,
      this.RECURSIVE
    );
  }
}
export {
  FsMkdirParams,
  FsMkdirParamsT
};
