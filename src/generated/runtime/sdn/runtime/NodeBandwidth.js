var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { NodeBandwidthSample } from "./NodeBandwidthSample.js";
class NodeBandwidth {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsNodeBandwidth(bb, obj) {
    return (obj || new NodeBandwidth()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsNodeBandwidth(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new NodeBandwidth()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  TOTAL_IN_BYTES() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  TOTAL_OUT_BYTES() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  RATE_IN_BPS() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  RATE_OUT_BPS() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  HISTORY(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? (obj || new NodeBandwidthSample()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  historyLength() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  static startNodeBandwidth(builder) {
    builder.startObject(5);
  }
  static addTotalInBytes(builder, TOTAL_IN_BYTES) {
    builder.addFieldInt64(0, TOTAL_IN_BYTES, BigInt("0"));
  }
  static addTotalOutBytes(builder, TOTAL_OUT_BYTES) {
    builder.addFieldInt64(1, TOTAL_OUT_BYTES, BigInt("0"));
  }
  static addRateInBps(builder, RATE_IN_BPS) {
    builder.addFieldFloat64(2, RATE_IN_BPS, 0);
  }
  static addRateOutBps(builder, RATE_OUT_BPS) {
    builder.addFieldFloat64(3, RATE_OUT_BPS, 0);
  }
  static addHistory(builder, HISTORYOffset) {
    builder.addFieldOffset(4, HISTORYOffset, 0);
  }
  static createHistoryVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startHistoryVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static endNodeBandwidth(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createNodeBandwidth(builder, TOTAL_IN_BYTES, TOTAL_OUT_BYTES, RATE_IN_BPS, RATE_OUT_BPS, HISTORYOffset) {
    NodeBandwidth.startNodeBandwidth(builder);
    NodeBandwidth.addTotalInBytes(builder, TOTAL_IN_BYTES);
    NodeBandwidth.addTotalOutBytes(builder, TOTAL_OUT_BYTES);
    NodeBandwidth.addRateInBps(builder, RATE_IN_BPS);
    NodeBandwidth.addRateOutBps(builder, RATE_OUT_BPS);
    NodeBandwidth.addHistory(builder, HISTORYOffset);
    return NodeBandwidth.endNodeBandwidth(builder);
  }
  unpack() {
    return new NodeBandwidthT(
      this.TOTAL_IN_BYTES(),
      this.TOTAL_OUT_BYTES(),
      this.RATE_IN_BPS(),
      this.RATE_OUT_BPS(),
      this.bb.createObjList(this.HISTORY.bind(this), this.historyLength())
    );
  }
  unpackTo(_o) {
    _o.TOTAL_IN_BYTES = this.TOTAL_IN_BYTES();
    _o.TOTAL_OUT_BYTES = this.TOTAL_OUT_BYTES();
    _o.RATE_IN_BPS = this.RATE_IN_BPS();
    _o.RATE_OUT_BPS = this.RATE_OUT_BPS();
    _o.HISTORY = this.bb.createObjList(this.HISTORY.bind(this), this.historyLength());
  }
}
class NodeBandwidthT {
  constructor(TOTAL_IN_BYTES = BigInt("0"), TOTAL_OUT_BYTES = BigInt("0"), RATE_IN_BPS = 0, RATE_OUT_BPS = 0, HISTORY = []) {
    __publicField(this, "TOTAL_IN_BYTES", TOTAL_IN_BYTES);
    __publicField(this, "TOTAL_OUT_BYTES", TOTAL_OUT_BYTES);
    __publicField(this, "RATE_IN_BPS", RATE_IN_BPS);
    __publicField(this, "RATE_OUT_BPS", RATE_OUT_BPS);
    __publicField(this, "HISTORY", HISTORY);
  }
  pack(builder) {
    const HISTORY = NodeBandwidth.createHistoryVector(builder, builder.createObjectOffsetList(this.HISTORY));
    return NodeBandwidth.createNodeBandwidth(
      builder,
      this.TOTAL_IN_BYTES,
      this.TOTAL_OUT_BYTES,
      this.RATE_IN_BPS,
      this.RATE_OUT_BPS,
      HISTORY
    );
  }
}
export {
  NodeBandwidth,
  NodeBandwidthT
};
