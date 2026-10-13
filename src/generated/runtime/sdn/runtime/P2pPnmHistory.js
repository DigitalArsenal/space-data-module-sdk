var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { P2pPnmEntry } from "./P2pPnmEntry.js";
class P2pPnmHistory {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsP2pPnmHistory(bb, obj) {
    return (obj || new P2pPnmHistory()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsP2pPnmHistory(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new P2pPnmHistory()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PEER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PUBLISHER_KEY_AVAILABLE() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  GOSSIP_ONLY_EXCLUDED() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  ENTRIES(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? (obj || new P2pPnmEntry()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  entriesLength() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  RECORDS(index) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  recordsLength() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  recordsArray() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startP2pPnmHistory(builder) {
    builder.startObject(5);
  }
  static addPeerId(builder, PEER_IDOffset) {
    builder.addFieldOffset(0, PEER_IDOffset, 0);
  }
  static addPublisherKeyAvailable(builder, PUBLISHER_KEY_AVAILABLE) {
    builder.addFieldInt8(1, +PUBLISHER_KEY_AVAILABLE, 0);
  }
  static addGossipOnlyExcluded(builder, GOSSIP_ONLY_EXCLUDED) {
    builder.addFieldInt32(2, GOSSIP_ONLY_EXCLUDED, 0);
  }
  static addEntries(builder, ENTRIESOffset) {
    builder.addFieldOffset(3, ENTRIESOffset, 0);
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
    builder.addFieldOffset(4, RECORDSOffset, 0);
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
  static endP2pPnmHistory(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createP2pPnmHistory(builder, PEER_IDOffset, PUBLISHER_KEY_AVAILABLE, GOSSIP_ONLY_EXCLUDED, ENTRIESOffset, RECORDSOffset) {
    P2pPnmHistory.startP2pPnmHistory(builder);
    P2pPnmHistory.addPeerId(builder, PEER_IDOffset);
    P2pPnmHistory.addPublisherKeyAvailable(builder, PUBLISHER_KEY_AVAILABLE);
    P2pPnmHistory.addGossipOnlyExcluded(builder, GOSSIP_ONLY_EXCLUDED);
    P2pPnmHistory.addEntries(builder, ENTRIESOffset);
    P2pPnmHistory.addRecords(builder, RECORDSOffset);
    return P2pPnmHistory.endP2pPnmHistory(builder);
  }
  unpack() {
    return new P2pPnmHistoryT(
      this.PEER_ID(),
      this.PUBLISHER_KEY_AVAILABLE(),
      this.GOSSIP_ONLY_EXCLUDED(),
      this.bb.createObjList(this.ENTRIES.bind(this), this.entriesLength()),
      this.bb.createScalarList(this.RECORDS.bind(this), this.recordsLength())
    );
  }
  unpackTo(_o) {
    _o.PEER_ID = this.PEER_ID();
    _o.PUBLISHER_KEY_AVAILABLE = this.PUBLISHER_KEY_AVAILABLE();
    _o.GOSSIP_ONLY_EXCLUDED = this.GOSSIP_ONLY_EXCLUDED();
    _o.ENTRIES = this.bb.createObjList(this.ENTRIES.bind(this), this.entriesLength());
    _o.RECORDS = this.bb.createScalarList(this.RECORDS.bind(this), this.recordsLength());
  }
}
class P2pPnmHistoryT {
  constructor(PEER_ID = null, PUBLISHER_KEY_AVAILABLE = false, GOSSIP_ONLY_EXCLUDED = 0, ENTRIES = [], RECORDS = []) {
    __publicField(this, "PEER_ID", PEER_ID);
    __publicField(this, "PUBLISHER_KEY_AVAILABLE", PUBLISHER_KEY_AVAILABLE);
    __publicField(this, "GOSSIP_ONLY_EXCLUDED", GOSSIP_ONLY_EXCLUDED);
    __publicField(this, "ENTRIES", ENTRIES);
    __publicField(this, "RECORDS", RECORDS);
  }
  pack(builder) {
    const PEER_ID = this.PEER_ID !== null ? builder.createString(this.PEER_ID) : 0;
    const ENTRIES = P2pPnmHistory.createEntriesVector(builder, builder.createObjectOffsetList(this.ENTRIES));
    const RECORDS = P2pPnmHistory.createRecordsVector(builder, this.RECORDS);
    return P2pPnmHistory.createP2pPnmHistory(
      builder,
      PEER_ID,
      this.PUBLISHER_KEY_AVAILABLE,
      this.GOSSIP_ONLY_EXCLUDED,
      ENTRIES,
      RECORDS
    );
  }
}
export {
  P2pPnmHistory,
  P2pPnmHistoryT
};
