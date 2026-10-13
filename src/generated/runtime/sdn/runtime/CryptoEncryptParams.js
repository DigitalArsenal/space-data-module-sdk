var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { cryptoAlgorithm } from "./cryptoAlgorithm.js";
class CryptoEncryptParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsCryptoEncryptParams(bb, obj) {
    return (obj || new CryptoEncryptParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsCryptoEncryptParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new CryptoEncryptParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  ALGORITHM() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : cryptoAlgorithm.Aes256Gcm;
  }
  KEY(index) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  keyLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  keyArray() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  NONCE(index) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  nonceLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  nonceArray() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  DATA(index) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  dataLength() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  dataArray() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  AAD(index) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  aadLength() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  aadArray() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startCryptoEncryptParams(builder) {
    builder.startObject(5);
  }
  static addAlgorithm(builder, ALGORITHM) {
    builder.addFieldInt8(0, ALGORITHM, cryptoAlgorithm.Aes256Gcm);
  }
  static addKey(builder, KEYOffset) {
    builder.addFieldOffset(1, KEYOffset, 0);
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
  static addNonce(builder, NONCEOffset) {
    builder.addFieldOffset(2, NONCEOffset, 0);
  }
  static createNonceVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startNonceVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addData(builder, DATAOffset) {
    builder.addFieldOffset(3, DATAOffset, 0);
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
  static addAad(builder, AADOffset) {
    builder.addFieldOffset(4, AADOffset, 0);
  }
  static createAadVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startAadVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static endCryptoEncryptParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createCryptoEncryptParams(builder, ALGORITHM, KEYOffset, NONCEOffset, DATAOffset, AADOffset) {
    CryptoEncryptParams.startCryptoEncryptParams(builder);
    CryptoEncryptParams.addAlgorithm(builder, ALGORITHM);
    CryptoEncryptParams.addKey(builder, KEYOffset);
    CryptoEncryptParams.addNonce(builder, NONCEOffset);
    CryptoEncryptParams.addData(builder, DATAOffset);
    CryptoEncryptParams.addAad(builder, AADOffset);
    return CryptoEncryptParams.endCryptoEncryptParams(builder);
  }
  unpack() {
    return new CryptoEncryptParamsT(
      this.ALGORITHM(),
      this.bb.createScalarList(this.KEY.bind(this), this.keyLength()),
      this.bb.createScalarList(this.NONCE.bind(this), this.nonceLength()),
      this.bb.createScalarList(this.DATA.bind(this), this.dataLength()),
      this.bb.createScalarList(this.AAD.bind(this), this.aadLength())
    );
  }
  unpackTo(_o) {
    _o.ALGORITHM = this.ALGORITHM();
    _o.KEY = this.bb.createScalarList(this.KEY.bind(this), this.keyLength());
    _o.NONCE = this.bb.createScalarList(this.NONCE.bind(this), this.nonceLength());
    _o.DATA = this.bb.createScalarList(this.DATA.bind(this), this.dataLength());
    _o.AAD = this.bb.createScalarList(this.AAD.bind(this), this.aadLength());
  }
}
class CryptoEncryptParamsT {
  constructor(ALGORITHM = cryptoAlgorithm.Aes256Gcm, KEY = [], NONCE = [], DATA = [], AAD = []) {
    __publicField(this, "ALGORITHM", ALGORITHM);
    __publicField(this, "KEY", KEY);
    __publicField(this, "NONCE", NONCE);
    __publicField(this, "DATA", DATA);
    __publicField(this, "AAD", AAD);
  }
  pack(builder) {
    const KEY = CryptoEncryptParams.createKeyVector(builder, this.KEY);
    const NONCE = CryptoEncryptParams.createNonceVector(builder, this.NONCE);
    const DATA = CryptoEncryptParams.createDataVector(builder, this.DATA);
    const AAD = CryptoEncryptParams.createAadVector(builder, this.AAD);
    return CryptoEncryptParams.createCryptoEncryptParams(
      builder,
      this.ALGORITHM,
      KEY,
      NONCE,
      DATA,
      AAD
    );
  }
}
export {
  CryptoEncryptParams,
  CryptoEncryptParamsT
};
