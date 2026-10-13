var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class CronField {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsCronField(bb, obj) {
    return (obj || new CronField()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsCronField(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new CronField()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  SOURCE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  VALUES(index) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readInt32(this.bb.__vector(this.bb_pos + offset) + index * 4) : 0;
  }
  valuesLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  valuesArray() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? new Int32Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  HAS_WILDCARD() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  static startCronField(builder) {
    builder.startObject(3);
  }
  static addSource(builder, SOURCEOffset) {
    builder.addFieldOffset(0, SOURCEOffset, 0);
  }
  static addValues(builder, VALUESOffset) {
    builder.addFieldOffset(1, VALUESOffset, 0);
  }
  static createValuesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt32(data[i]);
    }
    return builder.endVector();
  }
  static startValuesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addHasWildcard(builder, HAS_WILDCARD) {
    builder.addFieldInt8(2, +HAS_WILDCARD, 0);
  }
  static endCronField(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createCronField(builder, SOURCEOffset, VALUESOffset, HAS_WILDCARD) {
    CronField.startCronField(builder);
    CronField.addSource(builder, SOURCEOffset);
    CronField.addValues(builder, VALUESOffset);
    CronField.addHasWildcard(builder, HAS_WILDCARD);
    return CronField.endCronField(builder);
  }
  unpack() {
    return new CronFieldT(
      this.SOURCE(),
      this.bb.createScalarList(this.VALUES.bind(this), this.valuesLength()),
      this.HAS_WILDCARD()
    );
  }
  unpackTo(_o) {
    _o.SOURCE = this.SOURCE();
    _o.VALUES = this.bb.createScalarList(this.VALUES.bind(this), this.valuesLength());
    _o.HAS_WILDCARD = this.HAS_WILDCARD();
  }
}
class CronFieldT {
  constructor(SOURCE = null, VALUES = [], HAS_WILDCARD = false) {
    __publicField(this, "SOURCE", SOURCE);
    __publicField(this, "VALUES", VALUES);
    __publicField(this, "HAS_WILDCARD", HAS_WILDCARD);
  }
  pack(builder) {
    const SOURCE = this.SOURCE !== null ? builder.createString(this.SOURCE) : 0;
    const VALUES = CronField.createValuesVector(builder, this.VALUES);
    return CronField.createCronField(
      builder,
      SOURCE,
      VALUES,
      this.HAS_WILDCARD
    );
  }
}
export {
  CronField,
  CronFieldT
};
