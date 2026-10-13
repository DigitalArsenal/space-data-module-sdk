var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class PubsubTopicParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsPubsubTopicParams(bb, obj) {
    return (obj || new PubsubTopicParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsPubsubTopicParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new PubsubTopicParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  TOPIC(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  static startPubsubTopicParams(builder) {
    builder.startObject(1);
  }
  static addTopic(builder, TOPICOffset) {
    builder.addFieldOffset(0, TOPICOffset, 0);
  }
  static endPubsubTopicParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createPubsubTopicParams(builder, TOPICOffset) {
    PubsubTopicParams.startPubsubTopicParams(builder);
    PubsubTopicParams.addTopic(builder, TOPICOffset);
    return PubsubTopicParams.endPubsubTopicParams(builder);
  }
  unpack() {
    return new PubsubTopicParamsT(
      this.TOPIC()
    );
  }
  unpackTo(_o) {
    _o.TOPIC = this.TOPIC();
  }
}
class PubsubTopicParamsT {
  constructor(TOPIC = null) {
    __publicField(this, "TOPIC", TOPIC);
  }
  pack(builder) {
    const TOPIC = this.TOPIC !== null ? builder.createString(this.TOPIC) : 0;
    return PubsubTopicParams.createPubsubTopicParams(
      builder,
      TOPIC
    );
  }
}
export {
  PubsubTopicParams,
  PubsubTopicParamsT
};
