var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { FsEntry } from "./FsEntry.js";
class FsEntries {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsFsEntries(bb, obj) {
    return (obj || new FsEntries()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsFsEntries(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new FsEntries()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  ENTRIES(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? (obj || new FsEntry()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  entriesLength() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  static startFsEntries(builder) {
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
  static endFsEntries(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createFsEntries(builder, ENTRIESOffset) {
    FsEntries.startFsEntries(builder);
    FsEntries.addEntries(builder, ENTRIESOffset);
    return FsEntries.endFsEntries(builder);
  }
  unpack() {
    return new FsEntriesT(
      this.bb.createObjList(this.ENTRIES.bind(this), this.entriesLength())
    );
  }
  unpackTo(_o) {
    _o.ENTRIES = this.bb.createObjList(this.ENTRIES.bind(this), this.entriesLength());
  }
}
class FsEntriesT {
  constructor(ENTRIES = []) {
    __publicField(this, "ENTRIES", ENTRIES);
  }
  pack(builder) {
    const ENTRIES = FsEntries.createEntriesVector(builder, builder.createObjectOffsetList(this.ENTRIES));
    return FsEntries.createFsEntries(
      builder,
      ENTRIES
    );
  }
}
export {
  FsEntries,
  FsEntriesT
};
