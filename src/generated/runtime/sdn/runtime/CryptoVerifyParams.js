var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { cryptoAlgorithm } from "./cryptoAlgorithm.js";
class CryptoVerifyParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsCryptoVerifyParams(bb, obj) {
    return (obj || new CryptoVerifyParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsCryptoVerifyParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new CryptoVerifyParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  ALGORITHM() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : cryptoAlgorithm.Ed25519;
  }
  PUBLIC_KEY(index) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  publicKeyLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  publicKeyArray() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
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
  SIGNATURE(index) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  signatureLength() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  signatureArray() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startCryptoVerifyParams(builder) {
    builder.startObject(4);
  }
  static addAlgorithm(builder, ALGORITHM) {
    builder.addFieldInt8(0, ALGORITHM, cryptoAlgorithm.Ed25519);
  }
  static addPublicKey(builder, PUBLIC_KEYOffset) {
    builder.addFieldOffset(1, PUBLIC_KEYOffset, 0);
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
  static addSignature(builder, SIGNATUREOffset) {
    builder.addFieldOffset(3, SIGNATUREOffset, 0);
  }
  static createSignatureVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startSignatureVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static endCryptoVerifyParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createCryptoVerifyParams(builder, ALGORITHM, PUBLIC_KEYOffset, DATAOffset, SIGNATUREOffset) {
    CryptoVerifyParams.startCryptoVerifyParams(builder);
    CryptoVerifyParams.addAlgorithm(builder, ALGORITHM);
    CryptoVerifyParams.addPublicKey(builder, PUBLIC_KEYOffset);
    CryptoVerifyParams.addData(builder, DATAOffset);
    CryptoVerifyParams.addSignature(builder, SIGNATUREOffset);
    return CryptoVerifyParams.endCryptoVerifyParams(builder);
  }
  unpack() {
    return new CryptoVerifyParamsT(
      this.ALGORITHM(),
      this.bb.createScalarList(this.PUBLIC_KEY.bind(this), this.publicKeyLength()),
      this.bb.createScalarList(this.DATA.bind(this), this.dataLength()),
      this.bb.createScalarList(this.SIGNATURE.bind(this), this.signatureLength())
    );
  }
  unpackTo(_o) {
    _o.ALGORITHM = this.ALGORITHM();
    _o.PUBLIC_KEY = this.bb.createScalarList(this.PUBLIC_KEY.bind(this), this.publicKeyLength());
    _o.DATA = this.bb.createScalarList(this.DATA.bind(this), this.dataLength());
    _o.SIGNATURE = this.bb.createScalarList(this.SIGNATURE.bind(this), this.signatureLength());
  }
}
class CryptoVerifyParamsT {
  constructor(ALGORITHM = cryptoAlgorithm.Ed25519, PUBLIC_KEY = [], DATA = [], SIGNATURE = []) {
    __publicField(this, "ALGORITHM", ALGORITHM);
    __publicField(this, "PUBLIC_KEY", PUBLIC_KEY);
    __publicField(this, "DATA", DATA);
    __publicField(this, "SIGNATURE", SIGNATURE);
  }
  pack(builder) {
    const PUBLIC_KEY = CryptoVerifyParams.createPublicKeyVector(builder, this.PUBLIC_KEY);
    const DATA = CryptoVerifyParams.createDataVector(builder, this.DATA);
    const SIGNATURE = CryptoVerifyParams.createSignatureVector(builder, this.SIGNATURE);
    return CryptoVerifyParams.createCryptoVerifyParams(
      builder,
      this.ALGORITHM,
      PUBLIC_KEY,
      DATA,
      SIGNATURE
    );
  }
}
export {
  CryptoVerifyParams,
  CryptoVerifyParamsT
};
