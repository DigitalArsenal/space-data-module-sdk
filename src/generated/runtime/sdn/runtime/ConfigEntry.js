var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { ConfigTable } from "./ConfigTable.js";
import { configValueKind } from "./configValueKind.js";
class ConfigEntry {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsConfigEntry(bb, obj) {
    return (obj || new ConfigEntry()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsConfigEntry(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new ConfigEntry()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  KEY(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  KIND() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : configValueKind.String;
  }
  STRING_VALUE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  NUMBER_VALUE() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  BOOL_VALUE() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  STRINGS(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  stringsLength() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  NUMBERS(index) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.readFloat64(this.bb.__vector(this.bb_pos + offset) + index * 8) : 0;
  }
  numbersLength() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  numbersArray() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? new Float64Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  TABLES(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? (obj || new ConfigTable()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  tablesLength() {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  static startConfigEntry(builder) {
    builder.startObject(8);
  }
  static addKey(builder, KEYOffset) {
    builder.addFieldOffset(0, KEYOffset, 0);
  }
  static addKind(builder, KIND) {
    builder.addFieldInt8(1, KIND, configValueKind.String);
  }
  static addStringValue(builder, STRING_VALUEOffset) {
    builder.addFieldOffset(2, STRING_VALUEOffset, 0);
  }
  static addNumberValue(builder, NUMBER_VALUE) {
    builder.addFieldFloat64(3, NUMBER_VALUE, 0);
  }
  static addBoolValue(builder, BOOL_VALUE) {
    builder.addFieldInt8(4, +BOOL_VALUE, 0);
  }
  static addStrings(builder, STRINGSOffset) {
    builder.addFieldOffset(5, STRINGSOffset, 0);
  }
  static createStringsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startStringsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addNumbers(builder, NUMBERSOffset) {
    builder.addFieldOffset(6, NUMBERSOffset, 0);
  }
  static createNumbersVector(builder, data) {
    builder.startVector(8, data.length, 8);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addFloat64(data[i]);
    }
    return builder.endVector();
  }
  static startNumbersVector(builder, numElems) {
    builder.startVector(8, numElems, 8);
  }
  static addTables(builder, TABLESOffset) {
    builder.addFieldOffset(7, TABLESOffset, 0);
  }
  static createTablesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startTablesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static endConfigEntry(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createConfigEntry(builder, KEYOffset, KIND, STRING_VALUEOffset, NUMBER_VALUE, BOOL_VALUE, STRINGSOffset, NUMBERSOffset, TABLESOffset) {
    ConfigEntry.startConfigEntry(builder);
    ConfigEntry.addKey(builder, KEYOffset);
    ConfigEntry.addKind(builder, KIND);
    ConfigEntry.addStringValue(builder, STRING_VALUEOffset);
    ConfigEntry.addNumberValue(builder, NUMBER_VALUE);
    ConfigEntry.addBoolValue(builder, BOOL_VALUE);
    ConfigEntry.addStrings(builder, STRINGSOffset);
    ConfigEntry.addNumbers(builder, NUMBERSOffset);
    ConfigEntry.addTables(builder, TABLESOffset);
    return ConfigEntry.endConfigEntry(builder);
  }
  unpack() {
    return new ConfigEntryT(
      this.KEY(),
      this.KIND(),
      this.STRING_VALUE(),
      this.NUMBER_VALUE(),
      this.BOOL_VALUE(),
      this.bb.createScalarList(this.STRINGS.bind(this), this.stringsLength()),
      this.bb.createScalarList(this.NUMBERS.bind(this), this.numbersLength()),
      this.bb.createObjList(this.TABLES.bind(this), this.tablesLength())
    );
  }
  unpackTo(_o) {
    _o.KEY = this.KEY();
    _o.KIND = this.KIND();
    _o.STRING_VALUE = this.STRING_VALUE();
    _o.NUMBER_VALUE = this.NUMBER_VALUE();
    _o.BOOL_VALUE = this.BOOL_VALUE();
    _o.STRINGS = this.bb.createScalarList(this.STRINGS.bind(this), this.stringsLength());
    _o.NUMBERS = this.bb.createScalarList(this.NUMBERS.bind(this), this.numbersLength());
    _o.TABLES = this.bb.createObjList(this.TABLES.bind(this), this.tablesLength());
  }
}
class ConfigEntryT {
  constructor(KEY = null, KIND = configValueKind.String, STRING_VALUE = null, NUMBER_VALUE = 0, BOOL_VALUE = false, STRINGS = [], NUMBERS = [], TABLES = []) {
    __publicField(this, "KEY", KEY);
    __publicField(this, "KIND", KIND);
    __publicField(this, "STRING_VALUE", STRING_VALUE);
    __publicField(this, "NUMBER_VALUE", NUMBER_VALUE);
    __publicField(this, "BOOL_VALUE", BOOL_VALUE);
    __publicField(this, "STRINGS", STRINGS);
    __publicField(this, "NUMBERS", NUMBERS);
    __publicField(this, "TABLES", TABLES);
  }
  pack(builder) {
    const KEY = this.KEY !== null ? builder.createString(this.KEY) : 0;
    const STRING_VALUE = this.STRING_VALUE !== null ? builder.createString(this.STRING_VALUE) : 0;
    const STRINGS = ConfigEntry.createStringsVector(builder, builder.createObjectOffsetList(this.STRINGS));
    const NUMBERS = ConfigEntry.createNumbersVector(builder, this.NUMBERS);
    const TABLES = ConfigEntry.createTablesVector(builder, builder.createObjectOffsetList(this.TABLES));
    return ConfigEntry.createConfigEntry(
      builder,
      KEY,
      this.KIND,
      STRING_VALUE,
      this.NUMBER_VALUE,
      this.BOOL_VALUE,
      STRINGS,
      NUMBERS,
      TABLES
    );
  }
}
export {
  ConfigEntry,
  ConfigEntryT
};
