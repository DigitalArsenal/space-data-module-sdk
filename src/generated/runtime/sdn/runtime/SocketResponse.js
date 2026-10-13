var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class SocketResponse {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsSocketResponse(bb, obj) {
    return (obj || new SocketResponse()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsSocketResponse(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new SocketResponse()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  HOST(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PORT() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint16(this.bb_pos + offset) : 0;
  }
  LOCAL_ADDRESS(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  LOCAL_PORT() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint16(this.bb_pos + offset) : 0;
  }
  REMOTE_ADDRESS(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  REMOTE_PORT() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readUint16(this.bb_pos + offset) : 0;
  }
  BODY(index) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  bodyLength() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  bodyArray() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  AUTHORIZED() {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  AUTHORIZATION_ERROR(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startSocketResponse(builder) {
    builder.startObject(9);
  }
  static addHost(builder, HOSTOffset) {
    builder.addFieldOffset(0, HOSTOffset, 0);
  }
  static addPort(builder, PORT) {
    builder.addFieldInt16(1, PORT, 0);
  }
  static addLocalAddress(builder, LOCAL_ADDRESSOffset) {
    builder.addFieldOffset(2, LOCAL_ADDRESSOffset, 0);
  }
  static addLocalPort(builder, LOCAL_PORT) {
    builder.addFieldInt16(3, LOCAL_PORT, 0);
  }
  static addRemoteAddress(builder, REMOTE_ADDRESSOffset) {
    builder.addFieldOffset(4, REMOTE_ADDRESSOffset, 0);
  }
  static addRemotePort(builder, REMOTE_PORT) {
    builder.addFieldInt16(5, REMOTE_PORT, 0);
  }
  static addBody(builder, BODYOffset) {
    builder.addFieldOffset(6, BODYOffset, 0);
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
  static addAuthorized(builder, AUTHORIZED) {
    builder.addFieldInt8(7, +AUTHORIZED, 0);
  }
  static addAuthorizationError(builder, AUTHORIZATION_ERROROffset) {
    builder.addFieldOffset(8, AUTHORIZATION_ERROROffset, 0);
  }
  static endSocketResponse(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createSocketResponse(builder, HOSTOffset, PORT, LOCAL_ADDRESSOffset, LOCAL_PORT, REMOTE_ADDRESSOffset, REMOTE_PORT, BODYOffset, AUTHORIZED, AUTHORIZATION_ERROROffset) {
    SocketResponse.startSocketResponse(builder);
    SocketResponse.addHost(builder, HOSTOffset);
    SocketResponse.addPort(builder, PORT);
    SocketResponse.addLocalAddress(builder, LOCAL_ADDRESSOffset);
    SocketResponse.addLocalPort(builder, LOCAL_PORT);
    SocketResponse.addRemoteAddress(builder, REMOTE_ADDRESSOffset);
    SocketResponse.addRemotePort(builder, REMOTE_PORT);
    SocketResponse.addBody(builder, BODYOffset);
    SocketResponse.addAuthorized(builder, AUTHORIZED);
    SocketResponse.addAuthorizationError(builder, AUTHORIZATION_ERROROffset);
    return SocketResponse.endSocketResponse(builder);
  }
  unpack() {
    return new SocketResponseT(
      this.HOST(),
      this.PORT(),
      this.LOCAL_ADDRESS(),
      this.LOCAL_PORT(),
      this.REMOTE_ADDRESS(),
      this.REMOTE_PORT(),
      this.bb.createScalarList(this.BODY.bind(this), this.bodyLength()),
      this.AUTHORIZED(),
      this.AUTHORIZATION_ERROR()
    );
  }
  unpackTo(_o) {
    _o.HOST = this.HOST();
    _o.PORT = this.PORT();
    _o.LOCAL_ADDRESS = this.LOCAL_ADDRESS();
    _o.LOCAL_PORT = this.LOCAL_PORT();
    _o.REMOTE_ADDRESS = this.REMOTE_ADDRESS();
    _o.REMOTE_PORT = this.REMOTE_PORT();
    _o.BODY = this.bb.createScalarList(this.BODY.bind(this), this.bodyLength());
    _o.AUTHORIZED = this.AUTHORIZED();
    _o.AUTHORIZATION_ERROR = this.AUTHORIZATION_ERROR();
  }
}
class SocketResponseT {
  constructor(HOST = null, PORT = 0, LOCAL_ADDRESS = null, LOCAL_PORT = 0, REMOTE_ADDRESS = null, REMOTE_PORT = 0, BODY = [], AUTHORIZED = false, AUTHORIZATION_ERROR = null) {
    __publicField(this, "HOST", HOST);
    __publicField(this, "PORT", PORT);
    __publicField(this, "LOCAL_ADDRESS", LOCAL_ADDRESS);
    __publicField(this, "LOCAL_PORT", LOCAL_PORT);
    __publicField(this, "REMOTE_ADDRESS", REMOTE_ADDRESS);
    __publicField(this, "REMOTE_PORT", REMOTE_PORT);
    __publicField(this, "BODY", BODY);
    __publicField(this, "AUTHORIZED", AUTHORIZED);
    __publicField(this, "AUTHORIZATION_ERROR", AUTHORIZATION_ERROR);
  }
  pack(builder) {
    const HOST = this.HOST !== null ? builder.createString(this.HOST) : 0;
    const LOCAL_ADDRESS = this.LOCAL_ADDRESS !== null ? builder.createString(this.LOCAL_ADDRESS) : 0;
    const REMOTE_ADDRESS = this.REMOTE_ADDRESS !== null ? builder.createString(this.REMOTE_ADDRESS) : 0;
    const BODY = SocketResponse.createBodyVector(builder, this.BODY);
    const AUTHORIZATION_ERROR = this.AUTHORIZATION_ERROR !== null ? builder.createString(this.AUTHORIZATION_ERROR) : 0;
    return SocketResponse.createSocketResponse(
      builder,
      HOST,
      this.PORT,
      LOCAL_ADDRESS,
      this.LOCAL_PORT,
      REMOTE_ADDRESS,
      this.REMOTE_PORT,
      BODY,
      this.AUTHORIZED,
      AUTHORIZATION_ERROR
    );
  }
}
export {
  SocketResponse,
  SocketResponseT
};
