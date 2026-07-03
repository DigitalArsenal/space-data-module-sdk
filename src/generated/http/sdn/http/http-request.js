var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { HttpHeader } from "./http-header.js";
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
    return bb.__has_identifier("$HTQ");
  }
  method(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  path(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  query(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * Request headers, sorted by NAME.
   */
  headers(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? (obj || new HttpHeader()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  headersLength() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  /**
   * Raw request body bytes (may be absent).
   */
  body(index) {
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
  remote(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startHttpRequest(builder) {
    builder.startObject(6);
  }
  static addMethod(builder, methodOffset) {
    builder.addFieldOffset(0, methodOffset, 0);
  }
  static addPath(builder, pathOffset) {
    builder.addFieldOffset(1, pathOffset, 0);
  }
  static addQuery(builder, queryOffset) {
    builder.addFieldOffset(2, queryOffset, 0);
  }
  static addHeaders(builder, headersOffset) {
    builder.addFieldOffset(3, headersOffset, 0);
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
    builder.addFieldOffset(4, bodyOffset, 0);
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
  static addRemote(builder, remoteOffset) {
    builder.addFieldOffset(5, remoteOffset, 0);
  }
  static endHttpRequest(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static finishHttpRequestBuffer(builder, offset) {
    builder.finish(offset, "$HTQ");
  }
  static finishSizePrefixedHttpRequestBuffer(builder, offset) {
    builder.finish(offset, "$HTQ", true);
  }
  static createHttpRequest(builder, methodOffset, pathOffset, queryOffset, headersOffset, bodyOffset, remoteOffset) {
    HttpRequest.startHttpRequest(builder);
    HttpRequest.addMethod(builder, methodOffset);
    HttpRequest.addPath(builder, pathOffset);
    HttpRequest.addQuery(builder, queryOffset);
    HttpRequest.addHeaders(builder, headersOffset);
    HttpRequest.addBody(builder, bodyOffset);
    HttpRequest.addRemote(builder, remoteOffset);
    return HttpRequest.endHttpRequest(builder);
  }
}
export {
  HttpRequest
};
