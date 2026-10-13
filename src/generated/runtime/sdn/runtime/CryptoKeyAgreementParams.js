var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { cryptoAlgorithm } from "./cryptoAlgorithm.js";
class CryptoKeyAgreementParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsCryptoKeyAgreementParams(bb, obj) {
    return (obj || new CryptoKeyAgreementParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsCryptoKeyAgreementParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new CryptoKeyAgreementParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  ALGORITHM() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : cryptoAlgorithm.X25519;
  }
  PRIVATE_KEY(index) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  privateKeyLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  privateKeyArray() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  PUBLIC_KEY(index) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  publicKeyLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  publicKeyArray() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startCryptoKeyAgreementParams(builder) {
    builder.startObject(3);
  }
  static addAlgorithm(builder, ALGORITHM) {
    builder.addFieldInt8(0, ALGORITHM, cryptoAlgorithm.X25519);
  }
  static addPrivateKey(builder, PRIVATE_KEYOffset) {
    builder.addFieldOffset(1, PRIVATE_KEYOffset, 0);
  }
  static createPrivateKeyVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startPrivateKeyVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addPublicKey(builder, PUBLIC_KEYOffset) {
    builder.addFieldOffset(2, PUBLIC_KEYOffset, 0);
  }
  static createPublicKeyVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startPublicKeyVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static endCryptoKeyAgreementParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createCryptoKeyAgreementParams(builder, ALGORITHM, PRIVATE_KEYOffset, PUBLIC_KEYOffset) {
    CryptoKeyAgreementParams.startCryptoKeyAgreementParams(builder);
    CryptoKeyAgreementParams.addAlgorithm(builder, ALGORITHM);
    CryptoKeyAgreementParams.addPrivateKey(builder, PRIVATE_KEYOffset);
    CryptoKeyAgreementParams.addPublicKey(builder, PUBLIC_KEYOffset);
    return CryptoKeyAgreementParams.endCryptoKeyAgreementParams(builder);
  }
  unpack() {
    return new CryptoKeyAgreementParamsT(
      this.ALGORITHM(),
      this.bb.createScalarList(this.PRIVATE_KEY.bind(this), this.privateKeyLength()),
      this.bb.createScalarList(this.PUBLIC_KEY.bind(this), this.publicKeyLength())
    );
  }
  unpackTo(_o) {
    _o.ALGORITHM = this.ALGORITHM();
    _o.PRIVATE_KEY = this.bb.createScalarList(this.PRIVATE_KEY.bind(this), this.privateKeyLength());
    _o.PUBLIC_KEY = this.bb.createScalarList(this.PUBLIC_KEY.bind(this), this.publicKeyLength());
  }
}
class CryptoKeyAgreementParamsT {
  constructor(ALGORITHM = cryptoAlgorithm.X25519, PRIVATE_KEY = [], PUBLIC_KEY = []) {
    __publicField(this, "ALGORITHM", ALGORITHM);
    __publicField(this, "PRIVATE_KEY", PRIVATE_KEY);
    __publicField(this, "PUBLIC_KEY", PUBLIC_KEY);
  }
  pack(builder) {
    const PRIVATE_KEY = CryptoKeyAgreementParams.createPrivateKeyVector(builder, this.PRIVATE_KEY);
    const PUBLIC_KEY = CryptoKeyAgreementParams.createPublicKeyVector(builder, this.PUBLIC_KEY);
    return CryptoKeyAgreementParams.createCryptoKeyAgreementParams(
      builder,
      this.ALGORITHM,
      PRIVATE_KEY,
      PUBLIC_KEY
    );
  }
}
export {
  CryptoKeyAgreementParams,
  CryptoKeyAgreementParamsT
};
