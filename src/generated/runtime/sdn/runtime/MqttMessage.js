var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class MqttMessage {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsMqttMessage(bb, obj) {
    return (obj || new MqttMessage()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsMqttMessage(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new MqttMessage()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
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
  BODY(index) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  bodyLength() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  bodyArray() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startMqttMessage(builder) {
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
  static addBody(builder, BODYOffset) {
    builder.addFieldOffset(4, BODYOffset, 0);
  }
  static createBodyVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startBodyVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static endMqttMessage(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createMqttMessage(builder, HOSTOffset, PORT, CLIENT_IDOffset, TOPICOffset, BODYOffset) {
    MqttMessage.startMqttMessage(builder);
    MqttMessage.addHost(builder, HOSTOffset);
    MqttMessage.addPort(builder, PORT);
    MqttMessage.addClientId(builder, CLIENT_IDOffset);
    MqttMessage.addTopic(builder, TOPICOffset);
    MqttMessage.addBody(builder, BODYOffset);
    return MqttMessage.endMqttMessage(builder);
  }
  unpack() {
    return new MqttMessageT(
      this.HOST(),
      this.PORT(),
      this.CLIENT_ID(),
      this.TOPIC(),
      this.bb.createScalarList(this.BODY.bind(this), this.bodyLength())
    );
  }
  unpackTo(_o) {
    _o.HOST = this.HOST();
    _o.PORT = this.PORT();
    _o.CLIENT_ID = this.CLIENT_ID();
    _o.TOPIC = this.TOPIC();
    _o.BODY = this.bb.createScalarList(this.BODY.bind(this), this.bodyLength());
  }
}
class MqttMessageT {
  constructor(HOST = null, PORT = 0, CLIENT_ID = null, TOPIC = null, BODY = []) {
    __publicField(this, "HOST", HOST);
    __publicField(this, "PORT", PORT);
    __publicField(this, "CLIENT_ID", CLIENT_ID);
    __publicField(this, "TOPIC", TOPIC);
    __publicField(this, "BODY", BODY);
  }
  pack(builder) {
    const HOST = this.HOST !== null ? builder.createString(this.HOST) : 0;
    const CLIENT_ID = this.CLIENT_ID !== null ? builder.createString(this.CLIENT_ID) : 0;
    const TOPIC = this.TOPIC !== null ? builder.createString(this.TOPIC) : 0;
    const BODY = MqttMessage.createBodyVector(builder, this.BODY);
    return MqttMessage.createMqttMessage(
      builder,
      HOST,
      this.PORT,
      CLIENT_ID,
      TOPIC,
      BODY
    );
  }
}
export {
  MqttMessage,
  MqttMessageT
};
