var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class TimerTick {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsTimerTick(bb, obj) {
    return (obj || new TimerTick()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsTimerTick(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new TimerTick()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static bufferHasIdentifier(bb) {
    return bb.__has_identifier("TICK");
  }
  TRIGGER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * When it was due, Unix milliseconds UTC.
   */
  SCHEDULED_MS() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  /**
   * When the host fired it, Unix milliseconds UTC.
   */
  FIRED_MS() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  /**
   * How many times this trigger has fired since the flow started (0-based).
   */
  SEQUENCE() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  static startTimerTick(builder) {
    builder.startObject(4);
  }
  static addTriggerId(builder, TRIGGER_IDOffset) {
    builder.addFieldOffset(0, TRIGGER_IDOffset, 0);
  }
  static addScheduledMs(builder, SCHEDULED_MS) {
    builder.addFieldInt64(1, SCHEDULED_MS, BigInt("0"));
  }
  static addFiredMs(builder, FIRED_MS) {
    builder.addFieldInt64(2, FIRED_MS, BigInt("0"));
  }
  static addSequence(builder, SEQUENCE) {
    builder.addFieldInt64(3, SEQUENCE, BigInt("0"));
  }
  static endTimerTick(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static finishTimerTickBuffer(builder, offset) {
    builder.finish(offset, "TICK");
  }
  static finishSizePrefixedTimerTickBuffer(builder, offset) {
    builder.finish(offset, "TICK", true);
  }
  static createTimerTick(builder, TRIGGER_IDOffset, SCHEDULED_MS, FIRED_MS, SEQUENCE) {
    TimerTick.startTimerTick(builder);
    TimerTick.addTriggerId(builder, TRIGGER_IDOffset);
    TimerTick.addScheduledMs(builder, SCHEDULED_MS);
    TimerTick.addFiredMs(builder, FIRED_MS);
    TimerTick.addSequence(builder, SEQUENCE);
    return TimerTick.endTimerTick(builder);
  }
  unpack() {
    return new TimerTickT(
      this.TRIGGER_ID(),
      this.SCHEDULED_MS(),
      this.FIRED_MS(),
      this.SEQUENCE()
    );
  }
  unpackTo(_o) {
    _o.TRIGGER_ID = this.TRIGGER_ID();
    _o.SCHEDULED_MS = this.SCHEDULED_MS();
    _o.FIRED_MS = this.FIRED_MS();
    _o.SEQUENCE = this.SEQUENCE();
  }
}
class TimerTickT {
  constructor(TRIGGER_ID = null, SCHEDULED_MS = BigInt("0"), FIRED_MS = BigInt("0"), SEQUENCE = BigInt("0")) {
    __publicField(this, "TRIGGER_ID", TRIGGER_ID);
    __publicField(this, "SCHEDULED_MS", SCHEDULED_MS);
    __publicField(this, "FIRED_MS", FIRED_MS);
    __publicField(this, "SEQUENCE", SEQUENCE);
  }
  pack(builder) {
    const TRIGGER_ID = this.TRIGGER_ID !== null ? builder.createString(this.TRIGGER_ID) : 0;
    return TimerTick.createTimerTick(
      builder,
      TRIGGER_ID,
      this.SCHEDULED_MS,
      this.FIRED_MS,
      this.SEQUENCE
    );
  }
}
export {
  TimerTick,
  TimerTickT
};
