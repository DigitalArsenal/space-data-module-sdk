var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { ConfigEntry } from "./ConfigEntry.js";
class ModuleConfig {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsModuleConfig(bb, obj) {
    return (obj || new ModuleConfig()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsModuleConfig(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new ModuleConfig()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static bufferHasIdentifier(bb) {
    return bb.__has_identifier("MCFG");
  }
  /**
   * Entries sorted by KEY.
   */
  ENTRIES(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? (obj || new ConfigEntry()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  entriesLength() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  static startModuleConfig(builder) {
    builder.startObject(1);
  }
  static addEntries(builder, ENTRIESOffset) {
    builder.addFieldOffset(0, ENTRIESOffset, 0);
  }
  static createEntriesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startEntriesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static endModuleConfig(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static finishModuleConfigBuffer(builder, offset) {
    builder.finish(offset, "MCFG");
  }
  static finishSizePrefixedModuleConfigBuffer(builder, offset) {
    builder.finish(offset, "MCFG", true);
  }
  static createModuleConfig(builder, ENTRIESOffset) {
    ModuleConfig.startModuleConfig(builder);
    ModuleConfig.addEntries(builder, ENTRIESOffset);
    return ModuleConfig.endModuleConfig(builder);
  }
  unpack() {
    return new ModuleConfigT(
      this.bb.createObjList(this.ENTRIES.bind(this), this.entriesLength())
    );
  }
  unpackTo(_o) {
    _o.ENTRIES = this.bb.createObjList(this.ENTRIES.bind(this), this.entriesLength());
  }
}
class ModuleConfigT {
  constructor(ENTRIES = []) {
    __publicField(this, "ENTRIES", ENTRIES);
  }
  pack(builder) {
    const ENTRIES = ModuleConfig.createEntriesVector(builder, builder.createObjectOffsetList(this.ENTRIES));
    return ModuleConfig.createModuleConfig(
      builder,
      ENTRIES
    );
  }
}
export {
  ModuleConfig,
  ModuleConfigT
};
