var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class BodyRef {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsBodyRef(bb, obj) {
    return (obj || new BodyRef()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsBodyRef(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new BodyRef()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  TOKEN() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  SIZE() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  /**
   * Frames in the stream; -1 when unknown.
   */
  FRAMES() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readInt64(this.bb_pos + offset) : BigInt("-1");
  }
  FNV1A64(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startBodyRef(builder) {
    builder.startObject(4);
  }
  static addToken(builder, TOKEN) {
    builder.addFieldInt64(0, TOKEN, BigInt("0"));
  }
  static addSize(builder, SIZE) {
    builder.addFieldInt64(1, SIZE, BigInt("0"));
  }
  static addFrames(builder, FRAMES) {
    builder.addFieldInt64(2, FRAMES, BigInt("-1"));
  }
  static addFnv1A64(builder, FNV1A64Offset) {
    builder.addFieldOffset(3, FNV1A64Offset, 0);
  }
  static endBodyRef(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createBodyRef(builder, TOKEN, SIZE, FRAMES, FNV1A64Offset) {
    BodyRef.startBodyRef(builder);
    BodyRef.addToken(builder, TOKEN);
    BodyRef.addSize(builder, SIZE);
    BodyRef.addFrames(builder, FRAMES);
    BodyRef.addFnv1A64(builder, FNV1A64Offset);
    return BodyRef.endBodyRef(builder);
  }
  unpack() {
    return new BodyRefT(
      this.TOKEN(),
      this.SIZE(),
      this.FRAMES(),
      this.FNV1A64()
    );
  }
  unpackTo(_o) {
    _o.TOKEN = this.TOKEN();
    _o.SIZE = this.SIZE();
    _o.FRAMES = this.FRAMES();
    _o.FNV1A64 = this.FNV1A64();
  }
}
class BodyRefT {
  constructor(TOKEN = BigInt("0"), SIZE = BigInt("0"), FRAMES = BigInt("-1"), FNV1A64 = null) {
    __publicField(this, "TOKEN", TOKEN);
    __publicField(this, "SIZE", SIZE);
    __publicField(this, "FRAMES", FRAMES);
    __publicField(this, "FNV1A64", FNV1A64);
  }
  pack(builder) {
    const FNV1A64 = this.FNV1A64 !== null ? builder.createString(this.FNV1A64) : 0;
    return BodyRef.createBodyRef(
      builder,
      this.TOKEN,
      this.SIZE,
      this.FRAMES,
      FNV1A64
    );
  }
}
export {
  BodyRef,
  BodyRefT
};
