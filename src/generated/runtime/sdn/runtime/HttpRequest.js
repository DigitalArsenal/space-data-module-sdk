var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { Header } from "./Header.js";
class HttpRequest {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsHttpRequest(bb, obj) {
    return (obj || new HttpRequest()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsHttpRequest(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new HttpRequest()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static bufferHasIdentifier(bb) {
    return bb.__has_identifier("HREQ");
  }
  METHOD(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  URL(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  /**
   * Request headers, sorted by NAME (e.g. "range": "bytes=0-1023").
   */
  HEADERS(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? (obj || new Header()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  headersLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
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
   * Give up after this many milliseconds; 0 = the host's default.
   */
  TIMEOUT_MS() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  /**
   * Response body budget in bytes: the host errors past it, never truncates; 0 = the host's limit.
   */
  MAX_BYTES() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  /**
   * The module's own state for this request, echoed verbatim in the HttpResponse: one size-prefixed
   * FlatBuffer, identified by its own file identifier (an SDS record such as a $WXF header naming the wanted
   * field, or another runtime type). Never JSON.
   */
  CONTEXT(index) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  contextLength() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  contextArray() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  /**
   * Follow redirects (the host's default is to follow).
   */
  FOLLOW_REDIRECTS() {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : true;
  }
  static startHttpRequest(builder) {
    builder.startObject(8);
  }
  static addMethod(builder, METHODOffset) {
    builder.addFieldOffset(0, METHODOffset, 0);
  }
  static addUrl(builder, URLOffset) {
    builder.addFieldOffset(1, URLOffset, 0);
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
  static addTimeoutMs(builder, TIMEOUT_MS) {
    builder.addFieldInt32(4, TIMEOUT_MS, 0);
  }
  static addMaxBytes(builder, MAX_BYTES) {
    builder.addFieldInt64(5, MAX_BYTES, BigInt("0"));
  }
  static addContext(builder, CONTEXTOffset) {
    builder.addFieldOffset(6, CONTEXTOffset, 0);
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
  static addFollowRedirects(builder, FOLLOW_REDIRECTS) {
    builder.addFieldInt8(7, +FOLLOW_REDIRECTS, 1);
  }
  static endHttpRequest(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 6);
    return offset;
  }
  static finishHttpRequestBuffer(builder, offset) {
    builder.finish(offset, "HREQ");
  }
  static finishSizePrefixedHttpRequestBuffer(builder, offset) {
    builder.finish(offset, "HREQ", true);
  }
  static createHttpRequest(builder, METHODOffset, URLOffset, HEADERSOffset, BODYOffset, TIMEOUT_MS, MAX_BYTES, CONTEXTOffset, FOLLOW_REDIRECTS) {
    HttpRequest.startHttpRequest(builder);
    HttpRequest.addMethod(builder, METHODOffset);
    HttpRequest.addUrl(builder, URLOffset);
    HttpRequest.addHeaders(builder, HEADERSOffset);
    HttpRequest.addBody(builder, BODYOffset);
    HttpRequest.addTimeoutMs(builder, TIMEOUT_MS);
    HttpRequest.addMaxBytes(builder, MAX_BYTES);
    HttpRequest.addContext(builder, CONTEXTOffset);
    HttpRequest.addFollowRedirects(builder, FOLLOW_REDIRECTS);
    return HttpRequest.endHttpRequest(builder);
  }
  unpack() {
    return new HttpRequestT(
      this.METHOD(),
      this.URL(),
      this.bb.createObjList(this.HEADERS.bind(this), this.headersLength()),
      this.bb.createScalarList(this.BODY.bind(this), this.bodyLength()),
      this.TIMEOUT_MS(),
      this.MAX_BYTES(),
      this.bb.createScalarList(this.CONTEXT.bind(this), this.contextLength()),
      this.FOLLOW_REDIRECTS()
    );
  }
  unpackTo(_o) {
    _o.METHOD = this.METHOD();
    _o.URL = this.URL();
    _o.HEADERS = this.bb.createObjList(this.HEADERS.bind(this), this.headersLength());
    _o.BODY = this.bb.createScalarList(this.BODY.bind(this), this.bodyLength());
    _o.TIMEOUT_MS = this.TIMEOUT_MS();
    _o.MAX_BYTES = this.MAX_BYTES();
    _o.CONTEXT = this.bb.createScalarList(this.CONTEXT.bind(this), this.contextLength());
    _o.FOLLOW_REDIRECTS = this.FOLLOW_REDIRECTS();
  }
}
class HttpRequestT {
  constructor(METHOD = null, URL = null, HEADERS = [], BODY = [], TIMEOUT_MS = 0, MAX_BYTES = BigInt("0"), CONTEXT = [], FOLLOW_REDIRECTS = true) {
    __publicField(this, "METHOD", METHOD);
    __publicField(this, "URL", URL);
    __publicField(this, "HEADERS", HEADERS);
    __publicField(this, "BODY", BODY);
    __publicField(this, "TIMEOUT_MS", TIMEOUT_MS);
    __publicField(this, "MAX_BYTES", MAX_BYTES);
    __publicField(this, "CONTEXT", CONTEXT);
    __publicField(this, "FOLLOW_REDIRECTS", FOLLOW_REDIRECTS);
  }
  pack(builder) {
    const METHOD = this.METHOD !== null ? builder.createString(this.METHOD) : 0;
    const URL = this.URL !== null ? builder.createString(this.URL) : 0;
    const HEADERS = HttpRequest.createHeadersVector(builder, builder.createObjectOffsetList(this.HEADERS));
    const BODY = HttpRequest.createBodyVector(builder, this.BODY);
    const CONTEXT = HttpRequest.createContextVector(builder, this.CONTEXT);
    return HttpRequest.createHttpRequest(
      builder,
      METHOD,
      URL,
      HEADERS,
      BODY,
      this.TIMEOUT_MS,
      this.MAX_BYTES,
      CONTEXT,
      this.FOLLOW_REDIRECTS
    );
  }
}
export {
  HttpRequest,
  HttpRequestT
};
