var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class MqttParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsMqttParams(bb, obj) {
    return (obj || new MqttParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsMqttParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new MqttParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  HOST(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
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
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  PAYLOAD(index) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  payloadLength() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  payloadArray() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  USERNAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PASSWORD(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * 0 = 30.
   */
  KEEP_ALIVE_S() {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.readUint16(this.bb_pos + offset) : 0;
  }
  TIMEOUT_MS() {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  /**
   * 0 = 1.
   */
  PACKET_ID() {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? this.bb.readUint16(this.bb_pos + offset) : 0;
  }
  static startMqttParams(builder) {
    builder.startObject(10);
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
  static addPayload(builder, PAYLOADOffset) {
    builder.addFieldOffset(4, PAYLOADOffset, 0);
  }
  static createPayloadVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startPayloadVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addUsername(builder, USERNAMEOffset) {
    builder.addFieldOffset(5, USERNAMEOffset, 0);
  }
  static addPassword(builder, PASSWORDOffset) {
    builder.addFieldOffset(6, PASSWORDOffset, 0);
  }
  static addKeepAliveS(builder, KEEP_ALIVE_S) {
    builder.addFieldInt16(7, KEEP_ALIVE_S, 0);
  }
  static addTimeoutMs(builder, TIMEOUT_MS) {
    builder.addFieldInt32(8, TIMEOUT_MS, 0);
  }
  static addPacketId(builder, PACKET_ID) {
    builder.addFieldInt16(9, PACKET_ID, 0);
  }
  static endMqttParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    builder.requiredField(offset, 10);
    return offset;
  }
  static createMqttParams(builder, HOSTOffset, PORT, CLIENT_IDOffset, TOPICOffset, PAYLOADOffset, USERNAMEOffset, PASSWORDOffset, KEEP_ALIVE_S, TIMEOUT_MS, PACKET_ID) {
    MqttParams.startMqttParams(builder);
    MqttParams.addHost(builder, HOSTOffset);
    MqttParams.addPort(builder, PORT);
    MqttParams.addClientId(builder, CLIENT_IDOffset);
    MqttParams.addTopic(builder, TOPICOffset);
    MqttParams.addPayload(builder, PAYLOADOffset);
    MqttParams.addUsername(builder, USERNAMEOffset);
    MqttParams.addPassword(builder, PASSWORDOffset);
    MqttParams.addKeepAliveS(builder, KEEP_ALIVE_S);
    MqttParams.addTimeoutMs(builder, TIMEOUT_MS);
    MqttParams.addPacketId(builder, PACKET_ID);
    return MqttParams.endMqttParams(builder);
  }
  unpack() {
    return new MqttParamsT(
      this.HOST(),
      this.PORT(),
      this.CLIENT_ID(),
      this.TOPIC(),
      this.bb.createScalarList(this.PAYLOAD.bind(this), this.payloadLength()),
      this.USERNAME(),
      this.PASSWORD(),
      this.KEEP_ALIVE_S(),
      this.TIMEOUT_MS(),
      this.PACKET_ID()
    );
  }
  unpackTo(_o) {
    _o.HOST = this.HOST();
    _o.PORT = this.PORT();
    _o.CLIENT_ID = this.CLIENT_ID();
    _o.TOPIC = this.TOPIC();
    _o.PAYLOAD = this.bb.createScalarList(this.PAYLOAD.bind(this), this.payloadLength());
    _o.USERNAME = this.USERNAME();
    _o.PASSWORD = this.PASSWORD();
    _o.KEEP_ALIVE_S = this.KEEP_ALIVE_S();
    _o.TIMEOUT_MS = this.TIMEOUT_MS();
    _o.PACKET_ID = this.PACKET_ID();
  }
}
class MqttParamsT {
  constructor(HOST = null, PORT = 0, CLIENT_ID = null, TOPIC = null, PAYLOAD = [], USERNAME = null, PASSWORD = null, KEEP_ALIVE_S = 0, TIMEOUT_MS = 0, PACKET_ID = 0) {
    __publicField(this, "HOST", HOST);
    __publicField(this, "PORT", PORT);
    __publicField(this, "CLIENT_ID", CLIENT_ID);
    __publicField(this, "TOPIC", TOPIC);
    __publicField(this, "PAYLOAD", PAYLOAD);
    __publicField(this, "USERNAME", USERNAME);
    __publicField(this, "PASSWORD", PASSWORD);
    __publicField(this, "KEEP_ALIVE_S", KEEP_ALIVE_S);
    __publicField(this, "TIMEOUT_MS", TIMEOUT_MS);
    __publicField(this, "PACKET_ID", PACKET_ID);
  }
  pack(builder) {
    const HOST = this.HOST !== null ? builder.createString(this.HOST) : 0;
    const CLIENT_ID = this.CLIENT_ID !== null ? builder.createString(this.CLIENT_ID) : 0;
    const TOPIC = this.TOPIC !== null ? builder.createString(this.TOPIC) : 0;
    const PAYLOAD = MqttParams.createPayloadVector(builder, this.PAYLOAD);
    const USERNAME = this.USERNAME !== null ? builder.createString(this.USERNAME) : 0;
    const PASSWORD = this.PASSWORD !== null ? builder.createString(this.PASSWORD) : 0;
    return MqttParams.createMqttParams(
      builder,
      HOST,
      this.PORT,
      CLIENT_ID,
      TOPIC,
      PAYLOAD,
      USERNAME,
      PASSWORD,
      this.KEEP_ALIVE_S,
      this.TIMEOUT_MS,
      this.PACKET_ID
    );
  }
}
export {
  MqttParams,
  MqttParamsT
};
