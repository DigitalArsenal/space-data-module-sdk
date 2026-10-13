var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class ContextParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsContextParams(bb, obj) {
    return (obj || new ContextParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsContextParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new ContextParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  SCOPE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  KEY(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  VALUE(index) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  valueLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  valueArray() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startContextParams(builder) {
    builder.startObject(3);
  }
  static addScope(builder, SCOPEOffset) {
    builder.addFieldOffset(0, SCOPEOffset, 0);
  }
  static addKey(builder, KEYOffset) {
    builder.addFieldOffset(1, KEYOffset, 0);
  }
  static addValue(builder, VALUEOffset) {
    builder.addFieldOffset(2, VALUEOffset, 0);
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
  static endContextParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createContextParams(builder, SCOPEOffset, KEYOffset, VALUEOffset) {
    ContextParams.startContextParams(builder);
    ContextParams.addScope(builder, SCOPEOffset);
    ContextParams.addKey(builder, KEYOffset);
    ContextParams.addValue(builder, VALUEOffset);
    return ContextParams.endContextParams(builder);
  }
  unpack() {
    return new ContextParamsT(
      this.SCOPE(),
      this.KEY(),
      this.bb.createScalarList(this.VALUE.bind(this), this.valueLength())
    );
  }
  unpackTo(_o) {
    _o.SCOPE = this.SCOPE();
    _o.KEY = this.KEY();
    _o.VALUE = this.bb.createScalarList(this.VALUE.bind(this), this.valueLength());
  }
}
class ContextParamsT {
  constructor(SCOPE = null, KEY = null, VALUE = []) {
    __publicField(this, "SCOPE", SCOPE);
    __publicField(this, "KEY", KEY);
    __publicField(this, "VALUE", VALUE);
  }
  pack(builder) {
    const SCOPE = this.SCOPE !== null ? builder.createString(this.SCOPE) : 0;
    const KEY = this.KEY !== null ? builder.createString(this.KEY) : 0;
    const VALUE = ContextParams.createValueVector(builder, this.VALUE);
    return ContextParams.createContextParams(
      builder,
      SCOPE,
      KEY,
      VALUE
    );
  }
}
export {
  ContextParams,
  ContextParamsT
};
