var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { HttpHeader } from "./http-header.js";
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
    return bb.__has_identifier("$HTR");
  }
  /**
   * HTTP status code (200, 304, 400, 404, 502, ...).
   */
  status() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint16(this.bb_pos + offset) : 0;
  }
  /**
   * Response headers, sorted by NAME. All content-type / caching / count
   * headers are decided inside the module.
   */
  headers(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? (obj || new HttpHeader()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  headersLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  /**
   * Raw response body bytes (empty for 304).
   */
  body(index) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  bodyLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  bodyArray() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  /**
   * OPTIONAL out-of-band body reference (near-zero-copy egress, loop C.5c).
   * When BODY_REF_SIZE > 0 (and BODY is absent), the body bytes do NOT
   * travel through the flow's linear memory: the module passes through the
   * opaque token it received from a capability hostcall that answered in
   * reference mode (e.g. storage.flatsql_*_stream with "deliver":"ref"),
   * and the host substitutes the exact byte buffer it registered under
   * that token. Still the dumb-pipe contract: the module DECIDED the body
   * (it made the query and forwarded the result reference); the host only
   * resolves its own token — a descriptor read, never a decision. Tokens
   * are scoped to the module instance's hostcall bridge and to the current
   * exchange.
   */
  bodyRefToken() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  /**
   * Byte length of the referenced body (0 = no reference present).
   */
  bodyRefSize() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  static startHttpResponse(builder) {
    builder.startObject(5);
  }
  static addStatus(builder, status) {
    builder.addFieldInt16(0, status, 0);
  }
  static addHeaders(builder, headersOffset) {
    builder.addFieldOffset(1, headersOffset, 0);
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
  static addBody(builder, bodyOffset) {
    builder.addFieldOffset(2, bodyOffset, 0);
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
  static addBodyRefToken(builder, bodyRefToken) {
    builder.addFieldInt64(3, bodyRefToken, BigInt("0"));
  }
  static addBodyRefSize(builder, bodyRefSize) {
    builder.addFieldInt64(4, bodyRefSize, BigInt("0"));
  }
  static endHttpResponse(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static finishHttpResponseBuffer(builder, offset) {
    builder.finish(offset, "$HTR");
  }
  static finishSizePrefixedHttpResponseBuffer(builder, offset) {
    builder.finish(offset, "$HTR", true);
  }
  static createHttpResponse(builder, status, headersOffset, bodyOffset, bodyRefToken, bodyRefSize) {
    HttpResponse.startHttpResponse(builder);
    HttpResponse.addStatus(builder, status);
    HttpResponse.addHeaders(builder, headersOffset);
    HttpResponse.addBody(builder, bodyOffset);
    HttpResponse.addBodyRefToken(builder, bodyRefToken);
    HttpResponse.addBodyRefSize(builder, bodyRefSize);
    return HttpResponse.endHttpResponse(builder);
  }
}
export {
  HttpResponse
};
