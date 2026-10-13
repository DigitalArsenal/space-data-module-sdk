var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class TimeValue {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsTimeValue(bb, obj) {
    return (obj || new TimeValue()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsTimeValue(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new TimeValue()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  UNIX_MS() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  static startTimeValue(builder) {
    builder.startObject(1);
  }
  static addUnixMs(builder, UNIX_MS) {
    builder.addFieldInt64(0, UNIX_MS, BigInt("0"));
  }
  static endTimeValue(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createTimeValue(builder, UNIX_MS) {
    TimeValue.startTimeValue(builder);
    TimeValue.addUnixMs(builder, UNIX_MS);
    return TimeValue.endTimeValue(builder);
  }
  unpack() {
    return new TimeValueT(
      this.UNIX_MS()
    );
  }
  unpackTo(_o) {
    _o.UNIX_MS = this.UNIX_MS();
  }
}
class TimeValueT {
  constructor(UNIX_MS = BigInt("0")) {
    __publicField(this, "UNIX_MS", UNIX_MS);
  }
  pack(builder) {
    return TimeValue.createTimeValue(
      builder,
      this.UNIX_MS
    );
  }
}
export {
  TimeValue,
  TimeValueT
};
