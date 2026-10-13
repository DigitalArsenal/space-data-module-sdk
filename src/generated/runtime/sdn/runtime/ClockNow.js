var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class ClockNow {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsClockNow(bb, obj) {
    return (obj || new ClockNow()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsClockNow(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new ClockNow()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  UNIX_MS() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  /**
   * Milliseconds from a host-chosen origin that never goes back.
   */
  MONOTONIC_MS() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  ISO(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startClockNow(builder) {
    builder.startObject(3);
  }
  static addUnixMs(builder, UNIX_MS) {
    builder.addFieldInt64(0, UNIX_MS, BigInt("0"));
  }
  static addMonotonicMs(builder, MONOTONIC_MS) {
    builder.addFieldFloat64(1, MONOTONIC_MS, 0);
  }
  static addIso(builder, ISOOffset) {
    builder.addFieldOffset(2, ISOOffset, 0);
  }
  static endClockNow(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createClockNow(builder, UNIX_MS, MONOTONIC_MS, ISOOffset) {
    ClockNow.startClockNow(builder);
    ClockNow.addUnixMs(builder, UNIX_MS);
    ClockNow.addMonotonicMs(builder, MONOTONIC_MS);
    ClockNow.addIso(builder, ISOOffset);
    return ClockNow.endClockNow(builder);
  }
  unpack() {
    return new ClockNowT(
      this.UNIX_MS(),
      this.MONOTONIC_MS(),
      this.ISO()
    );
  }
  unpackTo(_o) {
    _o.UNIX_MS = this.UNIX_MS();
    _o.MONOTONIC_MS = this.MONOTONIC_MS();
    _o.ISO = this.ISO();
  }
}
class ClockNowT {
  constructor(UNIX_MS = BigInt("0"), MONOTONIC_MS = 0, ISO = null) {
    __publicField(this, "UNIX_MS", UNIX_MS);
    __publicField(this, "MONOTONIC_MS", MONOTONIC_MS);
    __publicField(this, "ISO", ISO);
  }
  pack(builder) {
    const ISO = this.ISO !== null ? builder.createString(this.ISO) : 0;
    return ClockNow.createClockNow(
      builder,
      this.UNIX_MS,
      this.MONOTONIC_MS,
      ISO
    );
  }
}
export {
  ClockNow,
  ClockNowT
};
