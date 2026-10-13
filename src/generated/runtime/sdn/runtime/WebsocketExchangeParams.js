var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class WebsocketExchangeParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsWebsocketExchangeParams(bb, obj) {
    return (obj || new WebsocketExchangeParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsWebsocketExchangeParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new WebsocketExchangeParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  URL(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  PROTOCOLS(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  protocolsLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  MESSAGE(index) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  messageLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  messageArray() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  MESSAGE_IS_TEXT() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  TIMEOUT_MS() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  EXPECT_RESPONSE() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : true;
  }
  static startWebsocketExchangeParams(builder) {
    builder.startObject(6);
  }
  static addUrl(builder, URLOffset) {
    builder.addFieldOffset(0, URLOffset, 0);
  }
  static addProtocols(builder, PROTOCOLSOffset) {
    builder.addFieldOffset(1, PROTOCOLSOffset, 0);
  }
  static createProtocolsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startProtocolsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addMessage(builder, MESSAGEOffset) {
    builder.addFieldOffset(2, MESSAGEOffset, 0);
  }
  static createMessageVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startMessageVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addMessageIsText(builder, MESSAGE_IS_TEXT) {
    builder.addFieldInt8(3, +MESSAGE_IS_TEXT, 0);
  }
  static addTimeoutMs(builder, TIMEOUT_MS) {
    builder.addFieldInt32(4, TIMEOUT_MS, 0);
  }
  static addExpectResponse(builder, EXPECT_RESPONSE) {
    builder.addFieldInt8(5, +EXPECT_RESPONSE, 1);
  }
  static endWebsocketExchangeParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createWebsocketExchangeParams(builder, URLOffset, PROTOCOLSOffset, MESSAGEOffset, MESSAGE_IS_TEXT, TIMEOUT_MS, EXPECT_RESPONSE) {
    WebsocketExchangeParams.startWebsocketExchangeParams(builder);
    WebsocketExchangeParams.addUrl(builder, URLOffset);
    WebsocketExchangeParams.addProtocols(builder, PROTOCOLSOffset);
    WebsocketExchangeParams.addMessage(builder, MESSAGEOffset);
    WebsocketExchangeParams.addMessageIsText(builder, MESSAGE_IS_TEXT);
    WebsocketExchangeParams.addTimeoutMs(builder, TIMEOUT_MS);
    WebsocketExchangeParams.addExpectResponse(builder, EXPECT_RESPONSE);
    return WebsocketExchangeParams.endWebsocketExchangeParams(builder);
  }
  unpack() {
    return new WebsocketExchangeParamsT(
      this.URL(),
      this.bb.createScalarList(this.PROTOCOLS.bind(this), this.protocolsLength()),
      this.bb.createScalarList(this.MESSAGE.bind(this), this.messageLength()),
      this.MESSAGE_IS_TEXT(),
      this.TIMEOUT_MS(),
      this.EXPECT_RESPONSE()
    );
  }
  unpackTo(_o) {
    _o.URL = this.URL();
    _o.PROTOCOLS = this.bb.createScalarList(this.PROTOCOLS.bind(this), this.protocolsLength());
    _o.MESSAGE = this.bb.createScalarList(this.MESSAGE.bind(this), this.messageLength());
    _o.MESSAGE_IS_TEXT = this.MESSAGE_IS_TEXT();
    _o.TIMEOUT_MS = this.TIMEOUT_MS();
    _o.EXPECT_RESPONSE = this.EXPECT_RESPONSE();
  }
}
class WebsocketExchangeParamsT {
  constructor(URL = null, PROTOCOLS = [], MESSAGE = [], MESSAGE_IS_TEXT = false, TIMEOUT_MS = 0, EXPECT_RESPONSE = true) {
    __publicField(this, "URL", URL);
    __publicField(this, "PROTOCOLS", PROTOCOLS);
    __publicField(this, "MESSAGE", MESSAGE);
    __publicField(this, "MESSAGE_IS_TEXT", MESSAGE_IS_TEXT);
    __publicField(this, "TIMEOUT_MS", TIMEOUT_MS);
    __publicField(this, "EXPECT_RESPONSE", EXPECT_RESPONSE);
  }
  pack(builder) {
    const URL = this.URL !== null ? builder.createString(this.URL) : 0;
    const PROTOCOLS = WebsocketExchangeParams.createProtocolsVector(builder, builder.createObjectOffsetList(this.PROTOCOLS));
    const MESSAGE = WebsocketExchangeParams.createMessageVector(builder, this.MESSAGE);
    return WebsocketExchangeParams.createWebsocketExchangeParams(
      builder,
      URL,
      PROTOCOLS,
      MESSAGE,
      this.MESSAGE_IS_TEXT,
      this.TIMEOUT_MS,
      this.EXPECT_RESPONSE
    );
  }
}
export {
  WebsocketExchangeParams,
  WebsocketExchangeParamsT
};
