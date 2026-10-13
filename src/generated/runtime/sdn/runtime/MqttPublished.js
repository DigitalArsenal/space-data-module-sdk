var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class MqttPublished {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsMqttPublished(bb, obj) {
    return (obj || new MqttPublished()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsMqttPublished(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new MqttPublished()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  HOST(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PORT() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint16(this.bb_pos + offset) : 0;
  }
  CLIENT_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  TOPIC(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PAYLOAD_BYTES() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  static startMqttPublished(builder) {
    builder.startObject(5);
  }
  static addHost(builder, HOSTOffset) {
    builder.addFieldOffset(0, HOSTOffset, 0);
  }
  static addPort(builder, PORT) {
    builder.addFieldInt16(1, PORT, 0);
  }
  static addClientId(builder, CLIENT_IDOffset) {
    builder.addFieldOffset(2, CLIENT_IDOffset, 0);
  }
  static addTopic(builder, TOPICOffset) {
    builder.addFieldOffset(3, TOPICOffset, 0);
  }
  static addPayloadBytes(builder, PAYLOAD_BYTES) {
    builder.addFieldInt64(4, PAYLOAD_BYTES, BigInt("0"));
  }
  static endMqttPublished(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createMqttPublished(builder, HOSTOffset, PORT, CLIENT_IDOffset, TOPICOffset, PAYLOAD_BYTES) {
    MqttPublished.startMqttPublished(builder);
    MqttPublished.addHost(builder, HOSTOffset);
    MqttPublished.addPort(builder, PORT);
    MqttPublished.addClientId(builder, CLIENT_IDOffset);
    MqttPublished.addTopic(builder, TOPICOffset);
    MqttPublished.addPayloadBytes(builder, PAYLOAD_BYTES);
    return MqttPublished.endMqttPublished(builder);
  }
  unpack() {
    return new MqttPublishedT(
      this.HOST(),
      this.PORT(),
      this.CLIENT_ID(),
      this.TOPIC(),
      this.PAYLOAD_BYTES()
    );
  }
  unpackTo(_o) {
    _o.HOST = this.HOST();
    _o.PORT = this.PORT();
    _o.CLIENT_ID = this.CLIENT_ID();
    _o.TOPIC = this.TOPIC();
    _o.PAYLOAD_BYTES = this.PAYLOAD_BYTES();
  }
}
class MqttPublishedT {
  constructor(HOST = null, PORT = 0, CLIENT_ID = null, TOPIC = null, PAYLOAD_BYTES = BigInt("0")) {
    __publicField(this, "HOST", HOST);
    __publicField(this, "PORT", PORT);
    __publicField(this, "CLIENT_ID", CLIENT_ID);
    __publicField(this, "TOPIC", TOPIC);
    __publicField(this, "PAYLOAD_BYTES", PAYLOAD_BYTES);
  }
  pack(builder) {
    const HOST = this.HOST !== null ? builder.createString(this.HOST) : 0;
    const CLIENT_ID = this.CLIENT_ID !== null ? builder.createString(this.CLIENT_ID) : 0;
    const TOPIC = this.TOPIC !== null ? builder.createString(this.TOPIC) : 0;
    return MqttPublished.createMqttPublished(
      builder,
      HOST,
      this.PORT,
      CLIENT_ID,
      TOPIC,
      this.PAYLOAD_BYTES
    );
  }
}
export {
  MqttPublished,
  MqttPublishedT
};
