var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class SocketRequestParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsSocketRequestParams(bb, obj) {
    return (obj || new SocketRequestParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsSocketRequestParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new SocketRequestParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  HOST(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  PORT() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint16(this.bb_pos + offset) : 0;
  }
  DATA(index) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  dataLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  dataArray() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  TIMEOUT_MS() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  EXPECT_RESPONSE() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : true;
  }
  BIND_ADDRESS(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  BIND_PORT() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.readUint16(this.bb_pos + offset) : 0;
  }
  UDP_TYPE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  CA(index) {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  caLength() {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  caArray() {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  CERT(index) {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  certLength() {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  certArray() {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  KEY(index) {
    const offset = this.bb.__offset(this.bb_pos, 24);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  keyLength() {
    const offset = this.bb.__offset(this.bb_pos, 24);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  keyArray() {
    const offset = this.bb.__offset(this.bb_pos, 24);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  REJECT_UNAUTHORIZED() {
    const offset = this.bb.__offset(this.bb_pos, 26);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : true;
  }
  SERVER_NAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 28);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startSocketRequestParams(builder) {
    builder.startObject(13);
  }
  static addHost(builder, HOSTOffset) {
    builder.addFieldOffset(0, HOSTOffset, 0);
  }
  static addPort(builder, PORT) {
    builder.addFieldInt16(1, PORT, 0);
  }
  static addData(builder, DATAOffset) {
    builder.addFieldOffset(2, DATAOffset, 0);
  }
  static createDataVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startDataVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addTimeoutMs(builder, TIMEOUT_MS) {
    builder.addFieldInt32(3, TIMEOUT_MS, 0);
  }
  static addExpectResponse(builder, EXPECT_RESPONSE) {
    builder.addFieldInt8(4, +EXPECT_RESPONSE, 1);
  }
  static addBindAddress(builder, BIND_ADDRESSOffset) {
    builder.addFieldOffset(5, BIND_ADDRESSOffset, 0);
  }
  static addBindPort(builder, BIND_PORT) {
    builder.addFieldInt16(6, BIND_PORT, 0);
  }
  static addUdpType(builder, UDP_TYPEOffset) {
    builder.addFieldOffset(7, UDP_TYPEOffset, 0);
  }
  static addCa(builder, CAOffset) {
    builder.addFieldOffset(8, CAOffset, 0);
  }
  static createCaVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startCaVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addCert(builder, CERTOffset) {
    builder.addFieldOffset(9, CERTOffset, 0);
  }
  static createCertVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startCertVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addKey(builder, KEYOffset) {
    builder.addFieldOffset(10, KEYOffset, 0);
  }
  static createKeyVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startKeyVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addRejectUnauthorized(builder, REJECT_UNAUTHORIZED) {
    builder.addFieldInt8(11, +REJECT_UNAUTHORIZED, 1);
  }
  static addServerName(builder, SERVER_NAMEOffset) {
    builder.addFieldOffset(12, SERVER_NAMEOffset, 0);
  }
  static endSocketRequestParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createSocketRequestParams(builder, HOSTOffset, PORT, DATAOffset, TIMEOUT_MS, EXPECT_RESPONSE, BIND_ADDRESSOffset, BIND_PORT, UDP_TYPEOffset, CAOffset, CERTOffset, KEYOffset, REJECT_UNAUTHORIZED, SERVER_NAMEOffset) {
    SocketRequestParams.startSocketRequestParams(builder);
    SocketRequestParams.addHost(builder, HOSTOffset);
    SocketRequestParams.addPort(builder, PORT);
    SocketRequestParams.addData(builder, DATAOffset);
    SocketRequestParams.addTimeoutMs(builder, TIMEOUT_MS);
    SocketRequestParams.addExpectResponse(builder, EXPECT_RESPONSE);
    SocketRequestParams.addBindAddress(builder, BIND_ADDRESSOffset);
    SocketRequestParams.addBindPort(builder, BIND_PORT);
    SocketRequestParams.addUdpType(builder, UDP_TYPEOffset);
    SocketRequestParams.addCa(builder, CAOffset);
    SocketRequestParams.addCert(builder, CERTOffset);
    SocketRequestParams.addKey(builder, KEYOffset);
    SocketRequestParams.addRejectUnauthorized(builder, REJECT_UNAUTHORIZED);
    SocketRequestParams.addServerName(builder, SERVER_NAMEOffset);
    return SocketRequestParams.endSocketRequestParams(builder);
  }
  unpack() {
    return new SocketRequestParamsT(
      this.HOST(),
      this.PORT(),
      this.bb.createScalarList(this.DATA.bind(this), this.dataLength()),
      this.TIMEOUT_MS(),
      this.EXPECT_RESPONSE(),
      this.BIND_ADDRESS(),
      this.BIND_PORT(),
      this.UDP_TYPE(),
      this.bb.createScalarList(this.CA.bind(this), this.caLength()),
      this.bb.createScalarList(this.CERT.bind(this), this.certLength()),
      this.bb.createScalarList(this.KEY.bind(this), this.keyLength()),
      this.REJECT_UNAUTHORIZED(),
      this.SERVER_NAME()
    );
  }
  unpackTo(_o) {
    _o.HOST = this.HOST();
    _o.PORT = this.PORT();
    _o.DATA = this.bb.createScalarList(this.DATA.bind(this), this.dataLength());
    _o.TIMEOUT_MS = this.TIMEOUT_MS();
    _o.EXPECT_RESPONSE = this.EXPECT_RESPONSE();
    _o.BIND_ADDRESS = this.BIND_ADDRESS();
    _o.BIND_PORT = this.BIND_PORT();
    _o.UDP_TYPE = this.UDP_TYPE();
    _o.CA = this.bb.createScalarList(this.CA.bind(this), this.caLength());
    _o.CERT = this.bb.createScalarList(this.CERT.bind(this), this.certLength());
    _o.KEY = this.bb.createScalarList(this.KEY.bind(this), this.keyLength());
    _o.REJECT_UNAUTHORIZED = this.REJECT_UNAUTHORIZED();
    _o.SERVER_NAME = this.SERVER_NAME();
  }
}
class SocketRequestParamsT {
  constructor(HOST = null, PORT = 0, DATA = [], TIMEOUT_MS = 0, EXPECT_RESPONSE = true, BIND_ADDRESS = null, BIND_PORT = 0, UDP_TYPE = null, CA = [], CERT = [], KEY = [], REJECT_UNAUTHORIZED = true, SERVER_NAME = null) {
    __publicField(this, "HOST", HOST);
    __publicField(this, "PORT", PORT);
    __publicField(this, "DATA", DATA);
    __publicField(this, "TIMEOUT_MS", TIMEOUT_MS);
    __publicField(this, "EXPECT_RESPONSE", EXPECT_RESPONSE);
    __publicField(this, "BIND_ADDRESS", BIND_ADDRESS);
    __publicField(this, "BIND_PORT", BIND_PORT);
    __publicField(this, "UDP_TYPE", UDP_TYPE);
    __publicField(this, "CA", CA);
    __publicField(this, "CERT", CERT);
    __publicField(this, "KEY", KEY);
    __publicField(this, "REJECT_UNAUTHORIZED", REJECT_UNAUTHORIZED);
    __publicField(this, "SERVER_NAME", SERVER_NAME);
  }
  pack(builder) {
    const HOST = this.HOST !== null ? builder.createString(this.HOST) : 0;
    const DATA = SocketRequestParams.createDataVector(builder, this.DATA);
    const BIND_ADDRESS = this.BIND_ADDRESS !== null ? builder.createString(this.BIND_ADDRESS) : 0;
    const UDP_TYPE = this.UDP_TYPE !== null ? builder.createString(this.UDP_TYPE) : 0;
    const CA = SocketRequestParams.createCaVector(builder, this.CA);
    const CERT = SocketRequestParams.createCertVector(builder, this.CERT);
    const KEY = SocketRequestParams.createKeyVector(builder, this.KEY);
    const SERVER_NAME = this.SERVER_NAME !== null ? builder.createString(this.SERVER_NAME) : 0;
    return SocketRequestParams.createSocketRequestParams(
      builder,
      HOST,
      this.PORT,
      DATA,
      this.TIMEOUT_MS,
      this.EXPECT_RESPONSE,
      BIND_ADDRESS,
      this.BIND_PORT,
      UDP_TYPE,
      CA,
      CERT,
      KEY,
      this.REJECT_UNAUTHORIZED,
      SERVER_NAME
    );
  }
}
export {
  SocketRequestParams,
  SocketRequestParamsT
};
