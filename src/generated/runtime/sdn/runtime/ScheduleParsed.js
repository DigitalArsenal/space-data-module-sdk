var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { CronField } from "./CronField.js";
class ScheduleParsed {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsScheduleParsed(bb, obj) {
    return (obj || new ScheduleParsed()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsScheduleParsed(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new ScheduleParsed()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  EXPRESSION(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  MINUTE(obj) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? (obj || new CronField()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  HOUR(obj) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? (obj || new CronField()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  DAY_OF_MONTH(obj) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? (obj || new CronField()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  MONTH(obj) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? (obj || new CronField()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  DAY_OF_WEEK(obj) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? (obj || new CronField()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  static startScheduleParsed(builder) {
    builder.startObject(6);
  }
  static addExpression(builder, EXPRESSIONOffset) {
    builder.addFieldOffset(0, EXPRESSIONOffset, 0);
  }
  static addMinute(builder, MINUTEOffset) {
    builder.addFieldOffset(1, MINUTEOffset, 0);
  }
  static addHour(builder, HOUROffset) {
    builder.addFieldOffset(2, HOUROffset, 0);
  }
  static addDayOfMonth(builder, DAY_OF_MONTHOffset) {
    builder.addFieldOffset(3, DAY_OF_MONTHOffset, 0);
  }
  static addMonth(builder, MONTHOffset) {
    builder.addFieldOffset(4, MONTHOffset, 0);
  }
  static addDayOfWeek(builder, DAY_OF_WEEKOffset) {
    builder.addFieldOffset(5, DAY_OF_WEEKOffset, 0);
  }
  static endScheduleParsed(builder) {
    const offset = builder.endObject();
    return offset;
  }
  unpack() {
    return new ScheduleParsedT(
      this.EXPRESSION(),
      this.MINUTE() !== null ? this.MINUTE().unpack() : null,
      this.HOUR() !== null ? this.HOUR().unpack() : null,
      this.DAY_OF_MONTH() !== null ? this.DAY_OF_MONTH().unpack() : null,
      this.MONTH() !== null ? this.MONTH().unpack() : null,
      this.DAY_OF_WEEK() !== null ? this.DAY_OF_WEEK().unpack() : null
    );
  }
  unpackTo(_o) {
    _o.EXPRESSION = this.EXPRESSION();
    _o.MINUTE = this.MINUTE() !== null ? this.MINUTE().unpack() : null;
    _o.HOUR = this.HOUR() !== null ? this.HOUR().unpack() : null;
    _o.DAY_OF_MONTH = this.DAY_OF_MONTH() !== null ? this.DAY_OF_MONTH().unpack() : null;
    _o.MONTH = this.MONTH() !== null ? this.MONTH().unpack() : null;
    _o.DAY_OF_WEEK = this.DAY_OF_WEEK() !== null ? this.DAY_OF_WEEK().unpack() : null;
  }
}
class ScheduleParsedT {
  constructor(EXPRESSION = null, MINUTE = null, HOUR = null, DAY_OF_MONTH = null, MONTH = null, DAY_OF_WEEK = null) {
    __publicField(this, "EXPRESSION", EXPRESSION);
    __publicField(this, "MINUTE", MINUTE);
    __publicField(this, "HOUR", HOUR);
    __publicField(this, "DAY_OF_MONTH", DAY_OF_MONTH);
    __publicField(this, "MONTH", MONTH);
    __publicField(this, "DAY_OF_WEEK", DAY_OF_WEEK);
  }
  pack(builder) {
    const EXPRESSION = this.EXPRESSION !== null ? builder.createString(this.EXPRESSION) : 0;
    const MINUTE = this.MINUTE !== null ? this.MINUTE.pack(builder) : 0;
    const HOUR = this.HOUR !== null ? this.HOUR.pack(builder) : 0;
    const DAY_OF_MONTH = this.DAY_OF_MONTH !== null ? this.DAY_OF_MONTH.pack(builder) : 0;
    const MONTH = this.MONTH !== null ? this.MONTH.pack(builder) : 0;
    const DAY_OF_WEEK = this.DAY_OF_WEEK !== null ? this.DAY_OF_WEEK.pack(builder) : 0;
    ScheduleParsed.startScheduleParsed(builder);
    ScheduleParsed.addExpression(builder, EXPRESSION);
    ScheduleParsed.addMinute(builder, MINUTE);
    ScheduleParsed.addHour(builder, HOUR);
    ScheduleParsed.addDayOfMonth(builder, DAY_OF_MONTH);
    ScheduleParsed.addMonth(builder, MONTH);
    ScheduleParsed.addDayOfWeek(builder, DAY_OF_WEEK);
    return ScheduleParsed.endScheduleParsed(builder);
  }
}
export {
  ScheduleParsed,
  ScheduleParsedT
};
