var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class WebsocketExchange {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsWebsocketExchange(bb, obj) {
    return (obj || new WebsocketExchange()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsWebsocketExchange(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new WebsocketExchange()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  URL(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PROTOCOL(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  EXTENSIONS(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * -1 = the socket did not close.
   */
  CLOSE_CODE() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readInt32(this.bb_pos + offset) : -1;
  }
  CLOSE_REASON(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  BODY(index) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  bodyLength() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  bodyArray() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  BODY_IS_TEXT() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  static startWebsocketExchange(builder) {
    builder.startObject(7);
  }
  static addUrl(builder, URLOffset) {
    builder.addFieldOffset(0, URLOffset, 0);
  }
  static addProtocol(builder, PROTOCOLOffset) {
    builder.addFieldOffset(1, PROTOCOLOffset, 0);
  }
  static addExtensions(builder, EXTENSIONSOffset) {
    builder.addFieldOffset(2, EXTENSIONSOffset, 0);
  }
  static addCloseCode(builder, CLOSE_CODE) {
    builder.addFieldInt32(3, CLOSE_CODE, -1);
  }
  static addCloseReason(builder, CLOSE_REASONOffset) {
    builder.addFieldOffset(4, CLOSE_REASONOffset, 0);
  }
  static addBody(builder, BODYOffset) {
    builder.addFieldOffset(5, BODYOffset, 0);
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
  static addBodyIsText(builder, BODY_IS_TEXT) {
    builder.addFieldInt8(6, +BODY_IS_TEXT, 0);
  }
  static endWebsocketExchange(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createWebsocketExchange(builder, URLOffset, PROTOCOLOffset, EXTENSIONSOffset, CLOSE_CODE, CLOSE_REASONOffset, BODYOffset, BODY_IS_TEXT) {
    WebsocketExchange.startWebsocketExchange(builder);
    WebsocketExchange.addUrl(builder, URLOffset);
    WebsocketExchange.addProtocol(builder, PROTOCOLOffset);
    WebsocketExchange.addExtensions(builder, EXTENSIONSOffset);
    WebsocketExchange.addCloseCode(builder, CLOSE_CODE);
    WebsocketExchange.addCloseReason(builder, CLOSE_REASONOffset);
    WebsocketExchange.addBody(builder, BODYOffset);
    WebsocketExchange.addBodyIsText(builder, BODY_IS_TEXT);
    return WebsocketExchange.endWebsocketExchange(builder);
  }
  unpack() {
    return new WebsocketExchangeT(
      this.URL(),
      this.PROTOCOL(),
      this.EXTENSIONS(),
      this.CLOSE_CODE(),
      this.CLOSE_REASON(),
      this.bb.createScalarList(this.BODY.bind(this), this.bodyLength()),
      this.BODY_IS_TEXT()
    );
  }
  unpackTo(_o) {
    _o.URL = this.URL();
    _o.PROTOCOL = this.PROTOCOL();
    _o.EXTENSIONS = this.EXTENSIONS();
    _o.CLOSE_CODE = this.CLOSE_CODE();
    _o.CLOSE_REASON = this.CLOSE_REASON();
    _o.BODY = this.bb.createScalarList(this.BODY.bind(this), this.bodyLength());
    _o.BODY_IS_TEXT = this.BODY_IS_TEXT();
  }
}
class WebsocketExchangeT {
  constructor(URL = null, PROTOCOL = null, EXTENSIONS = null, CLOSE_CODE = -1, CLOSE_REASON = null, BODY = [], BODY_IS_TEXT = false) {
    __publicField(this, "URL", URL);
    __publicField(this, "PROTOCOL", PROTOCOL);
    __publicField(this, "EXTENSIONS", EXTENSIONS);
    __publicField(this, "CLOSE_CODE", CLOSE_CODE);
    __publicField(this, "CLOSE_REASON", CLOSE_REASON);
    __publicField(this, "BODY", BODY);
    __publicField(this, "BODY_IS_TEXT", BODY_IS_TEXT);
  }
  pack(builder) {
    const URL = this.URL !== null ? builder.createString(this.URL) : 0;
    const PROTOCOL = this.PROTOCOL !== null ? builder.createString(this.PROTOCOL) : 0;
    const EXTENSIONS = this.EXTENSIONS !== null ? builder.createString(this.EXTENSIONS) : 0;
    const CLOSE_REASON = this.CLOSE_REASON !== null ? builder.createString(this.CLOSE_REASON) : 0;
    const BODY = WebsocketExchange.createBodyVector(builder, this.BODY);
    return WebsocketExchange.createWebsocketExchange(
      builder,
      URL,
      PROTOCOL,
      EXTENSIONS,
      this.CLOSE_CODE,
      CLOSE_REASON,
      BODY,
      this.BODY_IS_TEXT
    );
  }
}
export {
  WebsocketExchange,
  WebsocketExchangeT
};
