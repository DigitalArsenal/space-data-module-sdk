var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class TimersDelayParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsTimersDelayParams(bb, obj) {
    return (obj || new TimersDelayParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsTimersDelayParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new TimersDelayParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  MS() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  static startTimersDelayParams(builder) {
    builder.startObject(1);
  }
  static addMs(builder, MS) {
    builder.addFieldInt32(0, MS, 0);
  }
  static endTimersDelayParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createTimersDelayParams(builder, MS) {
    TimersDelayParams.startTimersDelayParams(builder);
    TimersDelayParams.addMs(builder, MS);
    return TimersDelayParams.endTimersDelayParams(builder);
  }
  unpack() {
    return new TimersDelayParamsT(
      this.MS()
    );
  }
  unpackTo(_o) {
    _o.MS = this.MS();
  }
}
class TimersDelayParamsT {
  constructor(MS = 0) {
    __publicField(this, "MS", MS);
  }
  pack(builder) {
    return TimersDelayParams.createTimersDelayParams(
      builder,
      this.MS
    );
  }
}
export {
  TimersDelayParams,
  TimersDelayParamsT
};
