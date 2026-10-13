var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { cryptoAlgorithm } from "./cryptoAlgorithm.js";
class CryptoKdfParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsCryptoKdfParams(bb, obj) {
    return (obj || new CryptoKdfParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsCryptoKdfParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new CryptoKdfParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  ALGORITHM() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : cryptoAlgorithm.HkdfSha256;
  }
  IKM(index) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  ikmLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  ikmArray() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  SALT(index) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  saltLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  saltArray() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  INFO(index) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  infoLength() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  infoArray() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  LENGTH() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  static startCryptoKdfParams(builder) {
    builder.startObject(5);
  }
  static addAlgorithm(builder, ALGORITHM) {
    builder.addFieldInt8(0, ALGORITHM, cryptoAlgorithm.HkdfSha256);
  }
  static addIkm(builder, IKMOffset) {
    builder.addFieldOffset(1, IKMOffset, 0);
  }
  static createIkmVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startIkmVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addSalt(builder, SALTOffset) {
    builder.addFieldOffset(2, SALTOffset, 0);
  }
  static createSaltVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startSaltVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addInfo(builder, INFOOffset) {
    builder.addFieldOffset(3, INFOOffset, 0);
  }
  static createInfoVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startInfoVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addLength(builder, LENGTH) {
    builder.addFieldInt32(4, LENGTH, 0);
  }
  static endCryptoKdfParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createCryptoKdfParams(builder, ALGORITHM, IKMOffset, SALTOffset, INFOOffset, LENGTH) {
    CryptoKdfParams.startCryptoKdfParams(builder);
    CryptoKdfParams.addAlgorithm(builder, ALGORITHM);
    CryptoKdfParams.addIkm(builder, IKMOffset);
    CryptoKdfParams.addSalt(builder, SALTOffset);
    CryptoKdfParams.addInfo(builder, INFOOffset);
    CryptoKdfParams.addLength(builder, LENGTH);
    return CryptoKdfParams.endCryptoKdfParams(builder);
  }
  unpack() {
    return new CryptoKdfParamsT(
      this.ALGORITHM(),
      this.bb.createScalarList(this.IKM.bind(this), this.ikmLength()),
      this.bb.createScalarList(this.SALT.bind(this), this.saltLength()),
      this.bb.createScalarList(this.INFO.bind(this), this.infoLength()),
      this.LENGTH()
    );
  }
  unpackTo(_o) {
    _o.ALGORITHM = this.ALGORITHM();
    _o.IKM = this.bb.createScalarList(this.IKM.bind(this), this.ikmLength());
    _o.SALT = this.bb.createScalarList(this.SALT.bind(this), this.saltLength());
    _o.INFO = this.bb.createScalarList(this.INFO.bind(this), this.infoLength());
    _o.LENGTH = this.LENGTH();
  }
}
class CryptoKdfParamsT {
  constructor(ALGORITHM = cryptoAlgorithm.HkdfSha256, IKM = [], SALT = [], INFO = [], LENGTH = 0) {
    __publicField(this, "ALGORITHM", ALGORITHM);
    __publicField(this, "IKM", IKM);
    __publicField(this, "SALT", SALT);
    __publicField(this, "INFO", INFO);
    __publicField(this, "LENGTH", LENGTH);
  }
  pack(builder) {
    const IKM = CryptoKdfParams.createIkmVector(builder, this.IKM);
    const SALT = CryptoKdfParams.createSaltVector(builder, this.SALT);
    const INFO = CryptoKdfParams.createInfoVector(builder, this.INFO);
    return CryptoKdfParams.createCryptoKdfParams(
      builder,
      this.ALGORITHM,
      IKM,
      SALT,
      INFO,
      this.LENGTH
    );
  }
}
export {
  CryptoKdfParams,
  CryptoKdfParamsT
};
