var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { P2pPeer } from "./P2pPeer.js";
class P2pPeersSnapshot {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsP2pPeersSnapshot(bb, obj) {
    return (obj || new P2pPeersSnapshot()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsP2pPeersSnapshot(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new P2pPeersSnapshot()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  SELF(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PEERS(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? (obj || new P2pPeer()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  peersLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  RECORDS(index) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  recordsLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  recordsArray() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startP2pPeersSnapshot(builder) {
    builder.startObject(3);
  }
  static addSelf(builder, SELFOffset) {
    builder.addFieldOffset(0, SELFOffset, 0);
  }
  static addPeers(builder, PEERSOffset) {
    builder.addFieldOffset(1, PEERSOffset, 0);
  }
  static createPeersVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startPeersVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addRecords(builder, RECORDSOffset) {
    builder.addFieldOffset(2, RECORDSOffset, 0);
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
  static endP2pPeersSnapshot(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createP2pPeersSnapshot(builder, SELFOffset, PEERSOffset, RECORDSOffset) {
    P2pPeersSnapshot.startP2pPeersSnapshot(builder);
    P2pPeersSnapshot.addSelf(builder, SELFOffset);
    P2pPeersSnapshot.addPeers(builder, PEERSOffset);
    P2pPeersSnapshot.addRecords(builder, RECORDSOffset);
    return P2pPeersSnapshot.endP2pPeersSnapshot(builder);
  }
  unpack() {
    return new P2pPeersSnapshotT(
      this.SELF(),
      this.bb.createObjList(this.PEERS.bind(this), this.peersLength()),
      this.bb.createScalarList(this.RECORDS.bind(this), this.recordsLength())
    );
  }
  unpackTo(_o) {
    _o.SELF = this.SELF();
    _o.PEERS = this.bb.createObjList(this.PEERS.bind(this), this.peersLength());
    _o.RECORDS = this.bb.createScalarList(this.RECORDS.bind(this), this.recordsLength());
  }
}
class P2pPeersSnapshotT {
  constructor(SELF = null, PEERS = [], RECORDS = []) {
    __publicField(this, "SELF", SELF);
    __publicField(this, "PEERS", PEERS);
    __publicField(this, "RECORDS", RECORDS);
  }
  pack(builder) {
    const SELF = this.SELF !== null ? builder.createString(this.SELF) : 0;
    const PEERS = P2pPeersSnapshot.createPeersVector(builder, builder.createObjectOffsetList(this.PEERS));
    const RECORDS = P2pPeersSnapshot.createRecordsVector(builder, this.RECORDS);
    return P2pPeersSnapshot.createP2pPeersSnapshot(
      builder,
      SELF,
      PEERS,
      RECORDS
    );
  }
}
export {
  P2pPeersSnapshot,
  P2pPeersSnapshotT
};
