var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { deliverMode } from "./deliverMode.js";
class EpochStreamParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsEpochStreamParams(bb, obj) {
    return (obj || new EpochStreamParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsEpochStreamParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new EpochStreamParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  SCHEMA(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SOURCE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PROFILE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * Unix seconds.
   */
  EPOCH() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readFloat64(this.bb_pos + offset) : 0;
  }
  /**
   * 0 = 50000.
   */
  LIMIT() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  DELIVER() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : deliverMode.Inline;
  }
  static startEpochStreamParams(builder) {
    builder.startObject(6);
  }
  static addSchema(builder, SCHEMAOffset) {
    builder.addFieldOffset(0, SCHEMAOffset, 0);
  }
  static addSource(builder, SOURCEOffset) {
    builder.addFieldOffset(1, SOURCEOffset, 0);
  }
  static addProfile(builder, PROFILEOffset) {
    builder.addFieldOffset(2, PROFILEOffset, 0);
  }
  static addEpoch(builder, EPOCH) {
    builder.addFieldFloat64(3, EPOCH, 0);
  }
  static addLimit(builder, LIMIT) {
    builder.addFieldInt32(4, LIMIT, 0);
  }
  static addDeliver(builder, DELIVER) {
    builder.addFieldInt8(5, DELIVER, deliverMode.Inline);
  }
  static endEpochStreamParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createEpochStreamParams(builder, SCHEMAOffset, SOURCEOffset, PROFILEOffset, EPOCH, LIMIT, DELIVER) {
    EpochStreamParams.startEpochStreamParams(builder);
    EpochStreamParams.addSchema(builder, SCHEMAOffset);
    EpochStreamParams.addSource(builder, SOURCEOffset);
    EpochStreamParams.addProfile(builder, PROFILEOffset);
    EpochStreamParams.addEpoch(builder, EPOCH);
    EpochStreamParams.addLimit(builder, LIMIT);
    EpochStreamParams.addDeliver(builder, DELIVER);
    return EpochStreamParams.endEpochStreamParams(builder);
  }
  unpack() {
    return new EpochStreamParamsT(
      this.SCHEMA(),
      this.SOURCE(),
      this.PROFILE(),
      this.EPOCH(),
      this.LIMIT(),
      this.DELIVER()
    );
  }
  unpackTo(_o) {
    _o.SCHEMA = this.SCHEMA();
    _o.SOURCE = this.SOURCE();
    _o.PROFILE = this.PROFILE();
    _o.EPOCH = this.EPOCH();
    _o.LIMIT = this.LIMIT();
    _o.DELIVER = this.DELIVER();
  }
}
class EpochStreamParamsT {
  constructor(SCHEMA = null, SOURCE = null, PROFILE = null, EPOCH = 0, LIMIT = 0, DELIVER = deliverMode.Inline) {
    __publicField(this, "SCHEMA", SCHEMA);
    __publicField(this, "SOURCE", SOURCE);
    __publicField(this, "PROFILE", PROFILE);
    __publicField(this, "EPOCH", EPOCH);
    __publicField(this, "LIMIT", LIMIT);
    __publicField(this, "DELIVER", DELIVER);
  }
  pack(builder) {
    const SCHEMA = this.SCHEMA !== null ? builder.createString(this.SCHEMA) : 0;
    const SOURCE = this.SOURCE !== null ? builder.createString(this.SOURCE) : 0;
    const PROFILE = this.PROFILE !== null ? builder.createString(this.PROFILE) : 0;
    return EpochStreamParams.createEpochStreamParams(
      builder,
      SCHEMA,
      SOURCE,
      PROFILE,
      this.EPOCH,
      this.LIMIT,
      this.DELIVER
    );
  }
}
export {
  EpochStreamParams,
  EpochStreamParamsT
};
