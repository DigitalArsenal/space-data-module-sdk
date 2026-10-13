var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { Header } from "./Header.js";
class HttpResponse {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsHttpResponse(bb, obj) {
    return (obj || new HttpResponse()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsHttpResponse(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new HttpResponse()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static bufferHasIdentifier(bb) {
    return bb.__has_identifier("HRSP");
  }
  URL(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * HTTP status; 0 when the request failed before a status (ERROR says why).
   */
  STATUS() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readInt32(this.bb_pos + offset) : 0;
  }
  /**
   * Response headers, sorted by NAME.
   */
  HEADERS(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? (obj || new Header()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  headersLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  /**
   * The body verbatim (never re-encoded).
   */
  BODY(index) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  bodyLength() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  bodyArray() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  /**
   * The request's CONTEXT, verbatim.
   */
  CONTEXT(index) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  contextLength() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  contextArray() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  ERROR(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * When the body was received, Unix milliseconds UTC.
   */
  RETRIEVED_MS() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  static startHttpResponse(builder) {
    builder.startObject(7);
  }
  static addUrl(builder, URLOffset) {
    builder.addFieldOffset(0, URLOffset, 0);
  }
  static addStatus(builder, STATUS) {
    builder.addFieldInt32(1, STATUS, 0);
  }
  static addHeaders(builder, HEADERSOffset) {
    builder.addFieldOffset(2, HEADERSOffset, 0);
  }
  static createHeadersVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startHeadersVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addBody(builder, BODYOffset) {
    builder.addFieldOffset(3, BODYOffset, 0);
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
  static addContext(builder, CONTEXTOffset) {
    builder.addFieldOffset(4, CONTEXTOffset, 0);
  }
  static createContextVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startContextVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addError(builder, ERROROffset) {
    builder.addFieldOffset(5, ERROROffset, 0);
  }
  static addRetrievedMs(builder, RETRIEVED_MS) {
    builder.addFieldInt64(6, RETRIEVED_MS, BigInt("0"));
  }
  static endHttpResponse(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static finishHttpResponseBuffer(builder, offset) {
    builder.finish(offset, "HRSP");
  }
  static finishSizePrefixedHttpResponseBuffer(builder, offset) {
    builder.finish(offset, "HRSP", true);
  }
  static createHttpResponse(builder, URLOffset, STATUS, HEADERSOffset, BODYOffset, CONTEXTOffset, ERROROffset, RETRIEVED_MS) {
    HttpResponse.startHttpResponse(builder);
    HttpResponse.addUrl(builder, URLOffset);
    HttpResponse.addStatus(builder, STATUS);
    HttpResponse.addHeaders(builder, HEADERSOffset);
    HttpResponse.addBody(builder, BODYOffset);
    HttpResponse.addContext(builder, CONTEXTOffset);
    HttpResponse.addError(builder, ERROROffset);
    HttpResponse.addRetrievedMs(builder, RETRIEVED_MS);
    return HttpResponse.endHttpResponse(builder);
  }
  unpack() {
    return new HttpResponseT(
      this.URL(),
      this.STATUS(),
      this.bb.createObjList(this.HEADERS.bind(this), this.headersLength()),
      this.bb.createScalarList(this.BODY.bind(this), this.bodyLength()),
      this.bb.createScalarList(this.CONTEXT.bind(this), this.contextLength()),
      this.ERROR(),
      this.RETRIEVED_MS()
    );
  }
  unpackTo(_o) {
    _o.URL = this.URL();
    _o.STATUS = this.STATUS();
    _o.HEADERS = this.bb.createObjList(this.HEADERS.bind(this), this.headersLength());
    _o.BODY = this.bb.createScalarList(this.BODY.bind(this), this.bodyLength());
    _o.CONTEXT = this.bb.createScalarList(this.CONTEXT.bind(this), this.contextLength());
    _o.ERROR = this.ERROR();
    _o.RETRIEVED_MS = this.RETRIEVED_MS();
  }
}
class HttpResponseT {
  constructor(URL = null, STATUS = 0, HEADERS = [], BODY = [], CONTEXT = [], ERROR = null, RETRIEVED_MS = BigInt("0")) {
    __publicField(this, "URL", URL);
    __publicField(this, "STATUS", STATUS);
    __publicField(this, "HEADERS", HEADERS);
    __publicField(this, "BODY", BODY);
    __publicField(this, "CONTEXT", CONTEXT);
    __publicField(this, "ERROR", ERROR);
    __publicField(this, "RETRIEVED_MS", RETRIEVED_MS);
  }
  pack(builder) {
    const URL = this.URL !== null ? builder.createString(this.URL) : 0;
    const HEADERS = HttpResponse.createHeadersVector(builder, builder.createObjectOffsetList(this.HEADERS));
    const BODY = HttpResponse.createBodyVector(builder, this.BODY);
    const CONTEXT = HttpResponse.createContextVector(builder, this.CONTEXT);
    const ERROR = this.ERROR !== null ? builder.createString(this.ERROR) : 0;
    return HttpResponse.createHttpResponse(
      builder,
      URL,
      this.STATUS,
      HEADERS,
      BODY,
      CONTEXT,
      ERROR,
      this.RETRIEVED_MS
    );
  }
}
export {
  HttpResponse,
  HttpResponseT
};
