var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { IpfsSwarmPeer } from "./IpfsSwarmPeer.js";
class IpfsSwarmPeers {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIpfsSwarmPeers(bb, obj) {
    return (obj || new IpfsSwarmPeers()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIpfsSwarmPeers(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IpfsSwarmPeers()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PEERS(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? (obj || new IpfsSwarmPeer()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  peersLength() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  static startIpfsSwarmPeers(builder) {
    builder.startObject(1);
  }
  static addPeers(builder, PEERSOffset) {
    builder.addFieldOffset(0, PEERSOffset, 0);
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
  static endIpfsSwarmPeers(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createIpfsSwarmPeers(builder, PEERSOffset) {
    IpfsSwarmPeers.startIpfsSwarmPeers(builder);
    IpfsSwarmPeers.addPeers(builder, PEERSOffset);
    return IpfsSwarmPeers.endIpfsSwarmPeers(builder);
  }
  unpack() {
    return new IpfsSwarmPeersT(
      this.bb.createObjList(this.PEERS.bind(this), this.peersLength())
    );
  }
  unpackTo(_o) {
    _o.PEERS = this.bb.createObjList(this.PEERS.bind(this), this.peersLength());
  }
}
class IpfsSwarmPeersT {
  constructor(PEERS = []) {
    __publicField(this, "PEERS", PEERS);
  }
  pack(builder) {
    const PEERS = IpfsSwarmPeers.createPeersVector(builder, builder.createObjectOffsetList(this.PEERS));
    return IpfsSwarmPeers.createIpfsSwarmPeers(
      builder,
      PEERS
    );
  }
}
export {
  IpfsSwarmPeers,
  IpfsSwarmPeersT
};
