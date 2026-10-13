var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { deliverMode } from "./deliverMode.js";
class P2pParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsP2pParams(bb, obj) {
    return (obj || new P2pParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsP2pParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new P2pParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PEER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * 0 = unbounded.
   */
  LIMIT() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  STANDARD(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  DELIVER() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : deliverMode.Inline;
  }
  static startP2pParams(builder) {
    builder.startObject(4);
  }
  static addPeerId(builder, PEER_IDOffset) {
    builder.addFieldOffset(0, PEER_IDOffset, 0);
  }
  static addLimit(builder, LIMIT) {
    builder.addFieldInt32(1, LIMIT, 0);
  }
  static addStandard(builder, STANDARDOffset) {
    builder.addFieldOffset(2, STANDARDOffset, 0);
  }
  static addDeliver(builder, DELIVER) {
    builder.addFieldInt8(3, DELIVER, deliverMode.Inline);
  }
  static endP2pParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createP2pParams(builder, PEER_IDOffset, LIMIT, STANDARDOffset, DELIVER) {
    P2pParams.startP2pParams(builder);
    P2pParams.addPeerId(builder, PEER_IDOffset);
    P2pParams.addLimit(builder, LIMIT);
    P2pParams.addStandard(builder, STANDARDOffset);
    P2pParams.addDeliver(builder, DELIVER);
    return P2pParams.endP2pParams(builder);
  }
  unpack() {
    return new P2pParamsT(
      this.PEER_ID(),
      this.LIMIT(),
      this.STANDARD(),
      this.DELIVER()
    );
  }
  unpackTo(_o) {
    _o.PEER_ID = this.PEER_ID();
    _o.LIMIT = this.LIMIT();
    _o.STANDARD = this.STANDARD();
    _o.DELIVER = this.DELIVER();
  }
}
class P2pParamsT {
  constructor(PEER_ID = null, LIMIT = 0, STANDARD = null, DELIVER = deliverMode.Inline) {
    __publicField(this, "PEER_ID", PEER_ID);
    __publicField(this, "LIMIT", LIMIT);
    __publicField(this, "STANDARD", STANDARD);
    __publicField(this, "DELIVER", DELIVER);
  }
  pack(builder) {
    const PEER_ID = this.PEER_ID !== null ? builder.createString(this.PEER_ID) : 0;
    const STANDARD = this.STANDARD !== null ? builder.createString(this.STANDARD) : 0;
    return P2pParams.createP2pParams(
      builder,
      PEER_ID,
      this.LIMIT,
      STANDARD,
      this.DELIVER
    );
  }
}
export {
  P2pParams,
  P2pParamsT
};
