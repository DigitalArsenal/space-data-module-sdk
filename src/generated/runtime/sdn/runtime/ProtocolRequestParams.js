var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class ProtocolRequestParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsProtocolRequestParams(bb, obj) {
    return (obj || new ProtocolRequestParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsProtocolRequestParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new ProtocolRequestParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  TARGET(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  PROTOCOL_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  PAYLOAD(index) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  payloadLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  payloadArray() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  /**
   * 0 = 15000.
   */
  TIMEOUT_MS() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  static startProtocolRequestParams(builder) {
    builder.startObject(4);
  }
  static addTarget(builder, TARGETOffset) {
    builder.addFieldOffset(0, TARGETOffset, 0);
  }
  static addProtocolId(builder, PROTOCOL_IDOffset) {
    builder.addFieldOffset(1, PROTOCOL_IDOffset, 0);
  }
  static addPayload(builder, PAYLOADOffset) {
    builder.addFieldOffset(2, PAYLOADOffset, 0);
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
  static addTimeoutMs(builder, TIMEOUT_MS) {
    builder.addFieldInt32(3, TIMEOUT_MS, 0);
  }
  static endProtocolRequestParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    builder.requiredField(offset, 6);
    return offset;
  }
  static createProtocolRequestParams(builder, TARGETOffset, PROTOCOL_IDOffset, PAYLOADOffset, TIMEOUT_MS) {
    ProtocolRequestParams.startProtocolRequestParams(builder);
    ProtocolRequestParams.addTarget(builder, TARGETOffset);
    ProtocolRequestParams.addProtocolId(builder, PROTOCOL_IDOffset);
    ProtocolRequestParams.addPayload(builder, PAYLOADOffset);
    ProtocolRequestParams.addTimeoutMs(builder, TIMEOUT_MS);
    return ProtocolRequestParams.endProtocolRequestParams(builder);
  }
  unpack() {
    return new ProtocolRequestParamsT(
      this.TARGET(),
      this.PROTOCOL_ID(),
      this.bb.createScalarList(this.PAYLOAD.bind(this), this.payloadLength()),
      this.TIMEOUT_MS()
    );
  }
  unpackTo(_o) {
    _o.TARGET = this.TARGET();
    _o.PROTOCOL_ID = this.PROTOCOL_ID();
    _o.PAYLOAD = this.bb.createScalarList(this.PAYLOAD.bind(this), this.payloadLength());
    _o.TIMEOUT_MS = this.TIMEOUT_MS();
  }
}
class ProtocolRequestParamsT {
  constructor(TARGET = null, PROTOCOL_ID = null, PAYLOAD = [], TIMEOUT_MS = 0) {
    __publicField(this, "TARGET", TARGET);
    __publicField(this, "PROTOCOL_ID", PROTOCOL_ID);
    __publicField(this, "PAYLOAD", PAYLOAD);
    __publicField(this, "TIMEOUT_MS", TIMEOUT_MS);
  }
  pack(builder) {
    const TARGET = this.TARGET !== null ? builder.createString(this.TARGET) : 0;
    const PROTOCOL_ID = this.PROTOCOL_ID !== null ? builder.createString(this.PROTOCOL_ID) : 0;
    const PAYLOAD = ProtocolRequestParams.createPayloadVector(builder, this.PAYLOAD);
    return ProtocolRequestParams.createProtocolRequestParams(
      builder,
      TARGET,
      PROTOCOL_ID,
      PAYLOAD,
      this.TIMEOUT_MS
    );
  }
}
export {
  ProtocolRequestParams,
  ProtocolRequestParamsT
};
