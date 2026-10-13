var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class FsPathParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsFsPathParams(bb, obj) {
    return (obj || new FsPathParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsFsPathParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new FsPathParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PATH(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startFsPathParams(builder) {
    builder.startObject(1);
  }
  static addPath(builder, PATHOffset) {
    builder.addFieldOffset(0, PATHOffset, 0);
  }
  static endFsPathParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createFsPathParams(builder, PATHOffset) {
    FsPathParams.startFsPathParams(builder);
    FsPathParams.addPath(builder, PATHOffset);
    return FsPathParams.endFsPathParams(builder);
  }
  unpack() {
    return new FsPathParamsT(
      this.PATH()
    );
  }
  unpackTo(_o) {
    _o.PATH = this.PATH();
  }
}
class FsPathParamsT {
  constructor(PATH = null) {
    __publicField(this, "PATH", PATH);
  }
  pack(builder) {
    const PATH = this.PATH !== null ? builder.createString(this.PATH) : 0;
    return FsPathParams.createFsPathParams(
      builder,
      PATH
    );
  }
}
export {
  FsPathParams,
  FsPathParamsT
};
