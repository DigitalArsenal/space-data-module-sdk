var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class SurfaceTable {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsSurfaceTable(bb, obj) {
    return (obj || new SurfaceTable()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsSurfaceTable(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new SurfaceTable()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  NAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  KIND(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SOURCE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  COLUMNS(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  columnsLength() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  PLACEHOLDER_COLUMNS(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  placeholderColumnsLength() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  RECORDS() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readInt64(this.bb_pos + offset) : BigInt("0");
  }
  static startSurfaceTable(builder) {
    builder.startObject(6);
  }
  static addName(builder, NAMEOffset) {
    builder.addFieldOffset(0, NAMEOffset, 0);
  }
  static addKind(builder, KINDOffset) {
    builder.addFieldOffset(1, KINDOffset, 0);
  }
  static addSource(builder, SOURCEOffset) {
    builder.addFieldOffset(2, SOURCEOffset, 0);
  }
  static addColumns(builder, COLUMNSOffset) {
    builder.addFieldOffset(3, COLUMNSOffset, 0);
  }
  static createColumnsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startColumnsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addPlaceholderColumns(builder, PLACEHOLDER_COLUMNSOffset) {
    builder.addFieldOffset(4, PLACEHOLDER_COLUMNSOffset, 0);
  }
  static createPlaceholderColumnsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startPlaceholderColumnsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addRecords(builder, RECORDS) {
    builder.addFieldInt64(5, RECORDS, BigInt("0"));
  }
  static endSurfaceTable(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createSurfaceTable(builder, NAMEOffset, KINDOffset, SOURCEOffset, COLUMNSOffset, PLACEHOLDER_COLUMNSOffset, RECORDS) {
    SurfaceTable.startSurfaceTable(builder);
    SurfaceTable.addName(builder, NAMEOffset);
    SurfaceTable.addKind(builder, KINDOffset);
    SurfaceTable.addSource(builder, SOURCEOffset);
    SurfaceTable.addColumns(builder, COLUMNSOffset);
    SurfaceTable.addPlaceholderColumns(builder, PLACEHOLDER_COLUMNSOffset);
    SurfaceTable.addRecords(builder, RECORDS);
    return SurfaceTable.endSurfaceTable(builder);
  }
  unpack() {
    return new SurfaceTableT(
      this.NAME(),
      this.KIND(),
      this.SOURCE(),
      this.bb.createScalarList(this.COLUMNS.bind(this), this.columnsLength()),
      this.bb.createScalarList(this.PLACEHOLDER_COLUMNS.bind(this), this.placeholderColumnsLength()),
      this.RECORDS()
    );
  }
  unpackTo(_o) {
    _o.NAME = this.NAME();
    _o.KIND = this.KIND();
    _o.SOURCE = this.SOURCE();
    _o.COLUMNS = this.bb.createScalarList(this.COLUMNS.bind(this), this.columnsLength());
    _o.PLACEHOLDER_COLUMNS = this.bb.createScalarList(this.PLACEHOLDER_COLUMNS.bind(this), this.placeholderColumnsLength());
    _o.RECORDS = this.RECORDS();
  }
}
class SurfaceTableT {
  constructor(NAME = null, KIND = null, SOURCE = null, COLUMNS = [], PLACEHOLDER_COLUMNS = [], RECORDS = BigInt("0")) {
    __publicField(this, "NAME", NAME);
    __publicField(this, "KIND", KIND);
    __publicField(this, "SOURCE", SOURCE);
    __publicField(this, "COLUMNS", COLUMNS);
    __publicField(this, "PLACEHOLDER_COLUMNS", PLACEHOLDER_COLUMNS);
    __publicField(this, "RECORDS", RECORDS);
  }
  pack(builder) {
    const NAME = this.NAME !== null ? builder.createString(this.NAME) : 0;
    const KIND = this.KIND !== null ? builder.createString(this.KIND) : 0;
    const SOURCE = this.SOURCE !== null ? builder.createString(this.SOURCE) : 0;
    const COLUMNS = SurfaceTable.createColumnsVector(builder, builder.createObjectOffsetList(this.COLUMNS));
    const PLACEHOLDER_COLUMNS = SurfaceTable.createPlaceholderColumnsVector(builder, builder.createObjectOffsetList(this.PLACEHOLDER_COLUMNS));
    return SurfaceTable.createSurfaceTable(
      builder,
      NAME,
      KIND,
      SOURCE,
      COLUMNS,
      PLACEHOLDER_COLUMNS,
      this.RECORDS
    );
  }
}
export {
  SurfaceTable,
  SurfaceTableT
};
