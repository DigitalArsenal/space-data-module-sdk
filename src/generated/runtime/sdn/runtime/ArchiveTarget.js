var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class ArchiveTarget {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsArchiveTarget(bb, obj) {
    return (obj || new ArchiveTarget()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsArchiveTarget(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new ArchiveTarget()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  SOURCE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  NAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startArchiveTarget(builder) {
    builder.startObject(2);
  }
  static addSource(builder, SOURCEOffset) {
    builder.addFieldOffset(0, SOURCEOffset, 0);
  }
  static addName(builder, NAMEOffset) {
    builder.addFieldOffset(1, NAMEOffset, 0);
  }
  static endArchiveTarget(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createArchiveTarget(builder, SOURCEOffset, NAMEOffset) {
    ArchiveTarget.startArchiveTarget(builder);
    ArchiveTarget.addSource(builder, SOURCEOffset);
    ArchiveTarget.addName(builder, NAMEOffset);
    return ArchiveTarget.endArchiveTarget(builder);
  }
  unpack() {
    return new ArchiveTargetT(
      this.SOURCE(),
      this.NAME()
    );
  }
  unpackTo(_o) {
    _o.SOURCE = this.SOURCE();
    _o.NAME = this.NAME();
  }
}
class ArchiveTargetT {
  constructor(SOURCE = null, NAME = null) {
    __publicField(this, "SOURCE", SOURCE);
    __publicField(this, "NAME", NAME);
  }
  pack(builder) {
    const SOURCE = this.SOURCE !== null ? builder.createString(this.SOURCE) : 0;
    const NAME = this.NAME !== null ? builder.createString(this.NAME) : 0;
    return ArchiveTarget.createArchiveTarget(
      builder,
      SOURCE,
      NAME
    );
  }
}
export {
  ArchiveTarget,
  ArchiveTargetT
};
