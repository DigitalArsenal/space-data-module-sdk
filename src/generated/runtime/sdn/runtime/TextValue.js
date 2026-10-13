var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class TextValue {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsTextValue(bb, obj) {
    return (obj || new TextValue()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsTextValue(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new TextValue()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  VALUE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startTextValue(builder) {
    builder.startObject(1);
  }
  static addValue(builder, VALUEOffset) {
    builder.addFieldOffset(0, VALUEOffset, 0);
  }
  static endTextValue(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createTextValue(builder, VALUEOffset) {
    TextValue.startTextValue(builder);
    TextValue.addValue(builder, VALUEOffset);
    return TextValue.endTextValue(builder);
  }
  unpack() {
    return new TextValueT(
      this.VALUE()
    );
  }
  unpackTo(_o) {
    _o.VALUE = this.VALUE();
  }
}
class TextValueT {
  constructor(VALUE = null) {
    __publicField(this, "VALUE", VALUE);
  }
  pack(builder) {
    const VALUE = this.VALUE !== null ? builder.createString(this.VALUE) : 0;
    return TextValue.createTextValue(
      builder,
      VALUE
    );
  }
}
export {
  TextValue,
  TextValueT
};
