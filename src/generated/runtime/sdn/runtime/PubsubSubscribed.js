var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class PubsubSubscribed {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsPubsubSubscribed(bb, obj) {
    return (obj || new PubsubSubscribed()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsPubsubSubscribed(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new PubsubSubscribed()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  TOPIC(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  ALREADY() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  static startPubsubSubscribed(builder) {
    builder.startObject(2);
  }
  static addTopic(builder, TOPICOffset) {
    builder.addFieldOffset(0, TOPICOffset, 0);
  }
  static addAlready(builder, ALREADY) {
    builder.addFieldInt8(1, +ALREADY, 0);
  }
  static endPubsubSubscribed(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createPubsubSubscribed(builder, TOPICOffset, ALREADY) {
    PubsubSubscribed.startPubsubSubscribed(builder);
    PubsubSubscribed.addTopic(builder, TOPICOffset);
    PubsubSubscribed.addAlready(builder, ALREADY);
    return PubsubSubscribed.endPubsubSubscribed(builder);
  }
  unpack() {
    return new PubsubSubscribedT(
      this.TOPIC(),
      this.ALREADY()
    );
  }
  unpackTo(_o) {
    _o.TOPIC = this.TOPIC();
    _o.ALREADY = this.ALREADY();
  }
}
class PubsubSubscribedT {
  constructor(TOPIC = null, ALREADY = false) {
    __publicField(this, "TOPIC", TOPIC);
    __publicField(this, "ALREADY", ALREADY);
  }
  pack(builder) {
    const TOPIC = this.TOPIC !== null ? builder.createString(this.TOPIC) : 0;
    return PubsubSubscribed.createPubsubSubscribed(
      builder,
      TOPIC,
      this.ALREADY
    );
  }
}
export {
  PubsubSubscribed,
  PubsubSubscribedT
};
