var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class NodeBandwidthSample {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsNodeBandwidthSample(bb, obj) {
    return (obj || new NodeBandwidthSample()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsNodeBandwidthSample(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new NodeBandwidthSample()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  TS_MS() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  TOTAL_IN_BYTES() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  TOTAL_OUT_BYTES() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  RATE_IN_BPS() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  RATE_OUT_BPS() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  static startNodeBandwidthSample(builder) {
    builder.startObject(5);
  }
  static addTsMs(builder, TS_MS) {
    builder.addFieldInt64(0, TS_MS, BigInt("0"));
  }
  static addTotalInBytes(builder, TOTAL_IN_BYTES) {
    builder.addFieldInt64(1, TOTAL_IN_BYTES, BigInt("0"));
  }
  static addTotalOutBytes(builder, TOTAL_OUT_BYTES) {
    builder.addFieldInt64(2, TOTAL_OUT_BYTES, BigInt("0"));
  }
  static addRateInBps(builder, RATE_IN_BPS) {
    builder.addFieldFloat64(3, RATE_IN_BPS, 0);
  }
  static addRateOutBps(builder, RATE_OUT_BPS) {
    builder.addFieldFloat64(4, RATE_OUT_BPS, 0);
  }
  static endNodeBandwidthSample(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createNodeBandwidthSample(builder, TS_MS, TOTAL_IN_BYTES, TOTAL_OUT_BYTES, RATE_IN_BPS, RATE_OUT_BPS) {
    NodeBandwidthSample.startNodeBandwidthSample(builder);
    NodeBandwidthSample.addTsMs(builder, TS_MS);
    NodeBandwidthSample.addTotalInBytes(builder, TOTAL_IN_BYTES);
    NodeBandwidthSample.addTotalOutBytes(builder, TOTAL_OUT_BYTES);
    NodeBandwidthSample.addRateInBps(builder, RATE_IN_BPS);
    NodeBandwidthSample.addRateOutBps(builder, RATE_OUT_BPS);
    return NodeBandwidthSample.endNodeBandwidthSample(builder);
  }
  unpack() {
    return new NodeBandwidthSampleT(
      this.TS_MS(),
      this.TOTAL_IN_BYTES(),
      this.TOTAL_OUT_BYTES(),
      this.RATE_IN_BPS(),
      this.RATE_OUT_BPS()
    );
  }
  unpackTo(_o) {
    _o.TS_MS = this.TS_MS();
    _o.TOTAL_IN_BYTES = this.TOTAL_IN_BYTES();
    _o.TOTAL_OUT_BYTES = this.TOTAL_OUT_BYTES();
    _o.RATE_IN_BPS = this.RATE_IN_BPS();
    _o.RATE_OUT_BPS = this.RATE_OUT_BPS();
  }
}
class NodeBandwidthSampleT {
  constructor(TS_MS = BigInt("0"), TOTAL_IN_BYTES = BigInt("0"), TOTAL_OUT_BYTES = BigInt("0"), RATE_IN_BPS = 0, RATE_OUT_BPS = 0) {
    __publicField(this, "TS_MS", TS_MS);
    __publicField(this, "TOTAL_IN_BYTES", TOTAL_IN_BYTES);
    __publicField(this, "TOTAL_OUT_BYTES", TOTAL_OUT_BYTES);
    __publicField(this, "RATE_IN_BPS", RATE_IN_BPS);
    __publicField(this, "RATE_OUT_BPS", RATE_OUT_BPS);
  }
  pack(builder) {
    return NodeBandwidthSample.createNodeBandwidthSample(
      builder,
      this.TS_MS,
      this.TOTAL_IN_BYTES,
      this.TOTAL_OUT_BYTES,
      this.RATE_IN_BPS,
      this.RATE_OUT_BPS
    );
  }
}
export {
  NodeBandwidthSample,
  NodeBandwidthSampleT
};
