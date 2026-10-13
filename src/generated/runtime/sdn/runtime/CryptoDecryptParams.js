var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { cryptoAlgorithm } from "./cryptoAlgorithm.js";
class CryptoDecryptParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsCryptoDecryptParams(bb, obj) {
    return (obj || new CryptoDecryptParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsCryptoDecryptParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new CryptoDecryptParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
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
  CIPHERTEXT(index) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  ciphertextLength() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  ciphertextArray() {
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
  static startCryptoDecryptParams(builder) {
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
  static addCiphertext(builder, CIPHERTEXTOffset) {
    builder.addFieldOffset(3, CIPHERTEXTOffset, 0);
  }
  static createCiphertextVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startCiphertextVector(builder, numElems) {
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
  static endCryptoDecryptParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createCryptoDecryptParams(builder, ALGORITHM, KEYOffset, NONCEOffset, CIPHERTEXTOffset, AADOffset) {
    CryptoDecryptParams.startCryptoDecryptParams(builder);
    CryptoDecryptParams.addAlgorithm(builder, ALGORITHM);
    CryptoDecryptParams.addKey(builder, KEYOffset);
    CryptoDecryptParams.addNonce(builder, NONCEOffset);
    CryptoDecryptParams.addCiphertext(builder, CIPHERTEXTOffset);
    CryptoDecryptParams.addAad(builder, AADOffset);
    return CryptoDecryptParams.endCryptoDecryptParams(builder);
  }
  unpack() {
    return new CryptoDecryptParamsT(
      this.ALGORITHM(),
      this.bb.createScalarList(this.KEY.bind(this), this.keyLength()),
      this.bb.createScalarList(this.NONCE.bind(this), this.nonceLength()),
      this.bb.createScalarList(this.CIPHERTEXT.bind(this), this.ciphertextLength()),
      this.bb.createScalarList(this.AAD.bind(this), this.aadLength())
    );
  }
  unpackTo(_o) {
    _o.ALGORITHM = this.ALGORITHM();
    _o.KEY = this.bb.createScalarList(this.KEY.bind(this), this.keyLength());
    _o.NONCE = this.bb.createScalarList(this.NONCE.bind(this), this.nonceLength());
    _o.CIPHERTEXT = this.bb.createScalarList(this.CIPHERTEXT.bind(this), this.ciphertextLength());
    _o.AAD = this.bb.createScalarList(this.AAD.bind(this), this.aadLength());
  }
}
class CryptoDecryptParamsT {
  constructor(ALGORITHM = cryptoAlgorithm.Aes256Gcm, KEY = [], NONCE = [], CIPHERTEXT = [], AAD = []) {
    __publicField(this, "ALGORITHM", ALGORITHM);
    __publicField(this, "KEY", KEY);
    __publicField(this, "NONCE", NONCE);
    __publicField(this, "CIPHERTEXT", CIPHERTEXT);
    __publicField(this, "AAD", AAD);
  }
  pack(builder) {
    const KEY = CryptoDecryptParams.createKeyVector(builder, this.KEY);
    const NONCE = CryptoDecryptParams.createNonceVector(builder, this.NONCE);
    const CIPHERTEXT = CryptoDecryptParams.createCiphertextVector(builder, this.CIPHERTEXT);
    const AAD = CryptoDecryptParams.createAadVector(builder, this.AAD);
    return CryptoDecryptParams.createCryptoDecryptParams(
      builder,
      this.ALGORITHM,
      KEY,
      NONCE,
      CIPHERTEXT,
      AAD
    );
  }
}
export {
  CryptoDecryptParams,
  CryptoDecryptParamsT
};
