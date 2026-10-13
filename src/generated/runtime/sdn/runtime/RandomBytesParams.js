var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class RandomBytesParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsRandomBytesParams(bb, obj) {
    return (obj || new RandomBytesParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsRandomBytesParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new RandomBytesParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  /**
   * 1..8192; 0 = 32. More than 8192 is refused (never clamped).
   */
  LENGTH() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  static startRandomBytesParams(builder) {
    builder.startObject(1);
  }
  static addLength(builder, LENGTH) {
    builder.addFieldInt32(0, LENGTH, 0);
  }
  static endRandomBytesParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createRandomBytesParams(builder, LENGTH) {
    RandomBytesParams.startRandomBytesParams(builder);
    RandomBytesParams.addLength(builder, LENGTH);
    return RandomBytesParams.endRandomBytesParams(builder);
  }
  unpack() {
    return new RandomBytesParamsT(
      this.LENGTH()
    );
  }
  unpackTo(_o) {
    _o.LENGTH = this.LENGTH();
  }
}
class RandomBytesParamsT {
  constructor(LENGTH = 0) {
    __publicField(this, "LENGTH", LENGTH);
  }
  pack(builder) {
    return RandomBytesParams.createRandomBytesParams(
      builder,
      this.LENGTH
    );
  }
}
export {
  RandomBytesParams,
  RandomBytesParamsT
};
