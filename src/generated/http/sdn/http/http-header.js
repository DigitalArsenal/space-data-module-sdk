var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class HttpHeader {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsHttpHeader(bb, obj) {
    return (obj || new HttpHeader()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsHttpHeader(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new HttpHeader()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  name(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  value(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startHttpHeader(builder) {
    builder.startObject(2);
  }
  static addName(builder, nameOffset) {
    builder.addFieldOffset(0, nameOffset, 0);
  }
  static addValue(builder, valueOffset) {
    builder.addFieldOffset(1, valueOffset, 0);
  }
  static endHttpHeader(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createHttpHeader(builder, nameOffset, valueOffset) {
    HttpHeader.startHttpHeader(builder);
    HttpHeader.addName(builder, nameOffset);
    HttpHeader.addValue(builder, valueOffset);
    return HttpHeader.endHttpHeader(builder);
  }
}
export {
  HttpHeader
};
