var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class IpfsSwarmPeer {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIpfsSwarmPeer(bb, obj) {
    return (obj || new IpfsSwarmPeer()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIpfsSwarmPeer(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IpfsSwarmPeer()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PEER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  ADDRESS(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  LATENCY_MS() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  static startIpfsSwarmPeer(builder) {
    builder.startObject(3);
  }
  static addPeerId(builder, PEER_IDOffset) {
    builder.addFieldOffset(0, PEER_IDOffset, 0);
  }
  static addAddress(builder, ADDRESSOffset) {
    builder.addFieldOffset(1, ADDRESSOffset, 0);
  }
  static addLatencyMs(builder, LATENCY_MS) {
    builder.addFieldFloat64(2, LATENCY_MS, 0);
  }
  static endIpfsSwarmPeer(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createIpfsSwarmPeer(builder, PEER_IDOffset, ADDRESSOffset, LATENCY_MS) {
    IpfsSwarmPeer.startIpfsSwarmPeer(builder);
    IpfsSwarmPeer.addPeerId(builder, PEER_IDOffset);
    IpfsSwarmPeer.addAddress(builder, ADDRESSOffset);
    IpfsSwarmPeer.addLatencyMs(builder, LATENCY_MS);
    return IpfsSwarmPeer.endIpfsSwarmPeer(builder);
  }
  unpack() {
    return new IpfsSwarmPeerT(
      this.PEER_ID(),
      this.ADDRESS(),
      this.LATENCY_MS()
    );
  }
  unpackTo(_o) {
    _o.PEER_ID = this.PEER_ID();
    _o.ADDRESS = this.ADDRESS();
    _o.LATENCY_MS = this.LATENCY_MS();
  }
}
class IpfsSwarmPeerT {
  constructor(PEER_ID = null, ADDRESS = null, LATENCY_MS = 0) {
    __publicField(this, "PEER_ID", PEER_ID);
    __publicField(this, "ADDRESS", ADDRESS);
    __publicField(this, "LATENCY_MS", LATENCY_MS);
  }
  pack(builder) {
    const PEER_ID = this.PEER_ID !== null ? builder.createString(this.PEER_ID) : 0;
    const ADDRESS = this.ADDRESS !== null ? builder.createString(this.ADDRESS) : 0;
    return IpfsSwarmPeer.createIpfsSwarmPeer(
      builder,
      PEER_ID,
      ADDRESS,
      this.LATENCY_MS
    );
  }
}
export {
  IpfsSwarmPeer,
  IpfsSwarmPeerT
};
