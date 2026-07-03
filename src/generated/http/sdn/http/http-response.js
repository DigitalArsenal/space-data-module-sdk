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
  static startHttpResponse(builder) {
    builder.startObject(3);
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
  static createHttpResponse(builder, status, headersOffset, bodyOffset) {
    HttpResponse.startHttpResponse(builder);
    HttpResponse.addStatus(builder, status);
    HttpResponse.addHeaders(builder, headersOffset);
    HttpResponse.addBody(builder, bodyOffset);
    return HttpResponse.endHttpResponse(builder);
  }
}
export {
  HttpResponse
};
