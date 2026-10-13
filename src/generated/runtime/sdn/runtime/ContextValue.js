var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class ContextValue {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsContextValue(bb, obj) {
    return (obj || new ContextValue()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsContextValue(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new ContextValue()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  FOUND() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  VALUE(index) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  valueLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  valueArray() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startContextValue(builder) {
    builder.startObject(2);
  }
  static addFound(builder, FOUND) {
    builder.addFieldInt8(0, +FOUND, 0);
  }
  static addValue(builder, VALUEOffset) {
    builder.addFieldOffset(1, VALUEOffset, 0);
  }
  static createValueVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startValueVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static endContextValue(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createContextValue(builder, FOUND, VALUEOffset) {
    ContextValue.startContextValue(builder);
    ContextValue.addFound(builder, FOUND);
    ContextValue.addValue(builder, VALUEOffset);
    return ContextValue.endContextValue(builder);
  }
  unpack() {
    return new ContextValueT(
      this.FOUND(),
      this.bb.createScalarList(this.VALUE.bind(this), this.valueLength())
    );
  }
  unpackTo(_o) {
    _o.FOUND = this.FOUND();
    _o.VALUE = this.bb.createScalarList(this.VALUE.bind(this), this.valueLength());
  }
}
class ContextValueT {
  constructor(FOUND = false, VALUE = []) {
    __publicField(this, "FOUND", FOUND);
    __publicField(this, "VALUE", VALUE);
  }
  pack(builder) {
    const VALUE = ContextValue.createValueVector(builder, this.VALUE);
    return ContextValue.createContextValue(
      builder,
      this.FOUND,
      VALUE
    );
  }
}
export {
  ContextValue,
  ContextValueT
};
