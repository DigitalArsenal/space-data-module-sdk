var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class NodeActivityEvent {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsNodeActivityEvent(bb, obj) {
    return (obj || new NodeActivityEvent()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsNodeActivityEvent(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new NodeActivityEvent()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  TS_MS() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  KIND(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  DETAIL(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PEER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startNodeActivityEvent(builder) {
    builder.startObject(4);
  }
  static addTsMs(builder, TS_MS) {
    builder.addFieldInt64(0, TS_MS, BigInt("0"));
  }
  static addKind(builder, KINDOffset) {
    builder.addFieldOffset(1, KINDOffset, 0);
  }
  static addDetail(builder, DETAILOffset) {
    builder.addFieldOffset(2, DETAILOffset, 0);
  }
  static addPeerId(builder, PEER_IDOffset) {
    builder.addFieldOffset(3, PEER_IDOffset, 0);
  }
  static endNodeActivityEvent(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createNodeActivityEvent(builder, TS_MS, KINDOffset, DETAILOffset, PEER_IDOffset) {
    NodeActivityEvent.startNodeActivityEvent(builder);
    NodeActivityEvent.addTsMs(builder, TS_MS);
    NodeActivityEvent.addKind(builder, KINDOffset);
    NodeActivityEvent.addDetail(builder, DETAILOffset);
    NodeActivityEvent.addPeerId(builder, PEER_IDOffset);
    return NodeActivityEvent.endNodeActivityEvent(builder);
  }
  unpack() {
    return new NodeActivityEventT(
      this.TS_MS(),
      this.KIND(),
      this.DETAIL(),
      this.PEER_ID()
    );
  }
  unpackTo(_o) {
    _o.TS_MS = this.TS_MS();
    _o.KIND = this.KIND();
    _o.DETAIL = this.DETAIL();
    _o.PEER_ID = this.PEER_ID();
  }
}
class NodeActivityEventT {
  constructor(TS_MS = BigInt("0"), KIND = null, DETAIL = null, PEER_ID = null) {
    __publicField(this, "TS_MS", TS_MS);
    __publicField(this, "KIND", KIND);
    __publicField(this, "DETAIL", DETAIL);
    __publicField(this, "PEER_ID", PEER_ID);
  }
  pack(builder) {
    const KIND = this.KIND !== null ? builder.createString(this.KIND) : 0;
    const DETAIL = this.DETAIL !== null ? builder.createString(this.DETAIL) : 0;
    const PEER_ID = this.PEER_ID !== null ? builder.createString(this.PEER_ID) : 0;
    return NodeActivityEvent.createNodeActivityEvent(
      builder,
      this.TS_MS,
      KIND,
      DETAIL,
      PEER_ID
    );
  }
}
export {
  NodeActivityEvent,
  NodeActivityEventT
};
