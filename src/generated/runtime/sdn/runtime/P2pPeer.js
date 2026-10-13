var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class P2pPeer {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsP2pPeer(bb, obj) {
    return (obj || new P2pPeer()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsP2pPeer(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new P2pPeer()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PEER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  ADDRS(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  addrsLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  CONNECTED() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  SELF() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  STANDARDS(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  standardsLength() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  /**
   * Index of the peer's $EPM frame in RECORDS; -1 = none.
   */
  EPM_INDEX() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readInt32(this.bb_pos + offset) : -1;
  }
  AGENT_VERSION(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startP2pPeer(builder) {
    builder.startObject(7);
  }
  static addPeerId(builder, PEER_IDOffset) {
    builder.addFieldOffset(0, PEER_IDOffset, 0);
  }
  static addAddrs(builder, ADDRSOffset) {
    builder.addFieldOffset(1, ADDRSOffset, 0);
  }
  static createAddrsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startAddrsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addConnected(builder, CONNECTED) {
    builder.addFieldInt8(2, +CONNECTED, 0);
  }
  static addSelf(builder, SELF) {
    builder.addFieldInt8(3, +SELF, 0);
  }
  static addStandards(builder, STANDARDSOffset) {
    builder.addFieldOffset(4, STANDARDSOffset, 0);
  }
  static createStandardsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startStandardsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addEpmIndex(builder, EPM_INDEX) {
    builder.addFieldInt32(5, EPM_INDEX, -1);
  }
  static addAgentVersion(builder, AGENT_VERSIONOffset) {
    builder.addFieldOffset(6, AGENT_VERSIONOffset, 0);
  }
  static endP2pPeer(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createP2pPeer(builder, PEER_IDOffset, ADDRSOffset, CONNECTED, SELF, STANDARDSOffset, EPM_INDEX, AGENT_VERSIONOffset) {
    P2pPeer.startP2pPeer(builder);
    P2pPeer.addPeerId(builder, PEER_IDOffset);
    P2pPeer.addAddrs(builder, ADDRSOffset);
    P2pPeer.addConnected(builder, CONNECTED);
    P2pPeer.addSelf(builder, SELF);
    P2pPeer.addStandards(builder, STANDARDSOffset);
    P2pPeer.addEpmIndex(builder, EPM_INDEX);
    P2pPeer.addAgentVersion(builder, AGENT_VERSIONOffset);
    return P2pPeer.endP2pPeer(builder);
  }
  unpack() {
    return new P2pPeerT(
      this.PEER_ID(),
      this.bb.createScalarList(this.ADDRS.bind(this), this.addrsLength()),
      this.CONNECTED(),
      this.SELF(),
      this.bb.createScalarList(this.STANDARDS.bind(this), this.standardsLength()),
      this.EPM_INDEX(),
      this.AGENT_VERSION()
    );
  }
  unpackTo(_o) {
    _o.PEER_ID = this.PEER_ID();
    _o.ADDRS = this.bb.createScalarList(this.ADDRS.bind(this), this.addrsLength());
    _o.CONNECTED = this.CONNECTED();
    _o.SELF = this.SELF();
    _o.STANDARDS = this.bb.createScalarList(this.STANDARDS.bind(this), this.standardsLength());
    _o.EPM_INDEX = this.EPM_INDEX();
    _o.AGENT_VERSION = this.AGENT_VERSION();
  }
}
class P2pPeerT {
  constructor(PEER_ID = null, ADDRS = [], CONNECTED = false, SELF = false, STANDARDS = [], EPM_INDEX = -1, AGENT_VERSION = null) {
    __publicField(this, "PEER_ID", PEER_ID);
    __publicField(this, "ADDRS", ADDRS);
    __publicField(this, "CONNECTED", CONNECTED);
    __publicField(this, "SELF", SELF);
    __publicField(this, "STANDARDS", STANDARDS);
    __publicField(this, "EPM_INDEX", EPM_INDEX);
    __publicField(this, "AGENT_VERSION", AGENT_VERSION);
  }
  pack(builder) {
    const PEER_ID = this.PEER_ID !== null ? builder.createString(this.PEER_ID) : 0;
    const ADDRS = P2pPeer.createAddrsVector(builder, builder.createObjectOffsetList(this.ADDRS));
    const STANDARDS = P2pPeer.createStandardsVector(builder, builder.createObjectOffsetList(this.STANDARDS));
    const AGENT_VERSION = this.AGENT_VERSION !== null ? builder.createString(this.AGENT_VERSION) : 0;
    return P2pPeer.createP2pPeer(
      builder,
      PEER_ID,
      ADDRS,
      this.CONNECTED,
      this.SELF,
      STANDARDS,
      this.EPM_INDEX,
      AGENT_VERSION
    );
  }
}
export {
  P2pPeer,
  P2pPeerT
};
