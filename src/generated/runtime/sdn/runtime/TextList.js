var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class TextList {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsTextList(bb, obj) {
    return (obj || new TextList()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsTextList(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new TextList()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  VALUES(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  valuesLength() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  static startTextList(builder) {
    builder.startObject(1);
  }
  static addValues(builder, VALUESOffset) {
    builder.addFieldOffset(0, VALUESOffset, 0);
  }
  static createValuesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startValuesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static endTextList(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createTextList(builder, VALUESOffset) {
    TextList.startTextList(builder);
    TextList.addValues(builder, VALUESOffset);
    return TextList.endTextList(builder);
  }
  unpack() {
    return new TextListT(
      this.bb.createScalarList(this.VALUES.bind(this), this.valuesLength())
    );
  }
  unpackTo(_o) {
    _o.VALUES = this.bb.createScalarList(this.VALUES.bind(this), this.valuesLength());
  }
}
class TextListT {
  constructor(VALUES = []) {
    __publicField(this, "VALUES", VALUES);
  }
  pack(builder) {
    const VALUES = TextList.createValuesVector(builder, builder.createObjectOffsetList(this.VALUES));
    return TextList.createTextList(
      builder,
      VALUES
    );
  }
}
export {
  TextList,
  TextListT
};
