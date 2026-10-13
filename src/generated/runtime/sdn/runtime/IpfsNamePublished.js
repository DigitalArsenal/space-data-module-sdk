var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class IpfsNamePublished {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIpfsNamePublished(bb, obj) {
    return (obj || new IpfsNamePublished()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIpfsNamePublished(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IpfsNamePublished()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  NAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  VALUE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startIpfsNamePublished(builder) {
    builder.startObject(2);
  }
  static addName(builder, NAMEOffset) {
    builder.addFieldOffset(0, NAMEOffset, 0);
  }
  static addValue(builder, VALUEOffset) {
    builder.addFieldOffset(1, VALUEOffset, 0);
  }
  static endIpfsNamePublished(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createIpfsNamePublished(builder, NAMEOffset, VALUEOffset) {
    IpfsNamePublished.startIpfsNamePublished(builder);
    IpfsNamePublished.addName(builder, NAMEOffset);
    IpfsNamePublished.addValue(builder, VALUEOffset);
    return IpfsNamePublished.endIpfsNamePublished(builder);
  }
  unpack() {
    return new IpfsNamePublishedT(
      this.NAME(),
      this.VALUE()
    );
  }
  unpackTo(_o) {
    _o.NAME = this.NAME();
    _o.VALUE = this.VALUE();
  }
}
class IpfsNamePublishedT {
  constructor(NAME = null, VALUE = null) {
    __publicField(this, "NAME", NAME);
    __publicField(this, "VALUE", VALUE);
  }
  pack(builder) {
    const NAME = this.NAME !== null ? builder.createString(this.NAME) : 0;
    const VALUE = this.VALUE !== null ? builder.createString(this.VALUE) : 0;
    return IpfsNamePublished.createIpfsNamePublished(
      builder,
      NAME,
      VALUE
    );
  }
}
export {
  IpfsNamePublished,
  IpfsNamePublishedT
};
