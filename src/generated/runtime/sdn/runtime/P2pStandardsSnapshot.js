var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { P2pStandardEntry } from "./P2pStandardEntry.js";
class P2pStandardsSnapshot {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsP2pStandardsSnapshot(bb, obj) {
    return (obj || new P2pStandardsSnapshot()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsP2pStandardsSnapshot(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new P2pStandardsSnapshot()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  ENTRIES(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? (obj || new P2pStandardEntry()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  entriesLength() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  RECORDS(index) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  recordsLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  recordsArray() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startP2pStandardsSnapshot(builder) {
    builder.startObject(2);
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
  static addRecords(builder, RECORDSOffset) {
    builder.addFieldOffset(1, RECORDSOffset, 0);
  }
  static createRecordsVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startRecordsVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static endP2pStandardsSnapshot(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createP2pStandardsSnapshot(builder, ENTRIESOffset, RECORDSOffset) {
    P2pStandardsSnapshot.startP2pStandardsSnapshot(builder);
    P2pStandardsSnapshot.addEntries(builder, ENTRIESOffset);
    P2pStandardsSnapshot.addRecords(builder, RECORDSOffset);
    return P2pStandardsSnapshot.endP2pStandardsSnapshot(builder);
  }
  unpack() {
    return new P2pStandardsSnapshotT(
      this.bb.createObjList(this.ENTRIES.bind(this), this.entriesLength()),
      this.bb.createScalarList(this.RECORDS.bind(this), this.recordsLength())
    );
  }
  unpackTo(_o) {
    _o.ENTRIES = this.bb.createObjList(this.ENTRIES.bind(this), this.entriesLength());
    _o.RECORDS = this.bb.createScalarList(this.RECORDS.bind(this), this.recordsLength());
  }
}
class P2pStandardsSnapshotT {
  constructor(ENTRIES = [], RECORDS = []) {
    __publicField(this, "ENTRIES", ENTRIES);
    __publicField(this, "RECORDS", RECORDS);
  }
  pack(builder) {
    const ENTRIES = P2pStandardsSnapshot.createEntriesVector(builder, builder.createObjectOffsetList(this.ENTRIES));
    const RECORDS = P2pStandardsSnapshot.createRecordsVector(builder, this.RECORDS);
    return P2pStandardsSnapshot.createP2pStandardsSnapshot(
      builder,
      ENTRIES,
      RECORDS
    );
  }
}
export {
  P2pStandardsSnapshot,
  P2pStandardsSnapshotT
};
