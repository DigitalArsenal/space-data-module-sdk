var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { cryptoAlgorithm } from "./cryptoAlgorithm.js";
class CryptoPublicKeyParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsCryptoPublicKeyParams(bb, obj) {
    return (obj || new CryptoPublicKeyParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsCryptoPublicKeyParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new CryptoPublicKeyParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  ALGORITHM() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : cryptoAlgorithm.Ed25519;
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
  static startCryptoPublicKeyParams(builder) {
    builder.startObject(2);
  }
  static addAlgorithm(builder, ALGORITHM) {
    builder.addFieldInt8(0, ALGORITHM, cryptoAlgorithm.Ed25519);
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
  static endCryptoPublicKeyParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createCryptoPublicKeyParams(builder, ALGORITHM, PRIVATE_KEYOffset) {
    CryptoPublicKeyParams.startCryptoPublicKeyParams(builder);
    CryptoPublicKeyParams.addAlgorithm(builder, ALGORITHM);
    CryptoPublicKeyParams.addPrivateKey(builder, PRIVATE_KEYOffset);
    return CryptoPublicKeyParams.endCryptoPublicKeyParams(builder);
  }
  unpack() {
    return new CryptoPublicKeyParamsT(
      this.ALGORITHM(),
      this.bb.createScalarList(this.PRIVATE_KEY.bind(this), this.privateKeyLength())
    );
  }
  unpackTo(_o) {
    _o.ALGORITHM = this.ALGORITHM();
    _o.PRIVATE_KEY = this.bb.createScalarList(this.PRIVATE_KEY.bind(this), this.privateKeyLength());
  }
}
class CryptoPublicKeyParamsT {
  constructor(ALGORITHM = cryptoAlgorithm.Ed25519, PRIVATE_KEY = []) {
    __publicField(this, "ALGORITHM", ALGORITHM);
    __publicField(this, "PRIVATE_KEY", PRIVATE_KEY);
  }
  pack(builder) {
    const PRIVATE_KEY = CryptoPublicKeyParams.createPrivateKeyVector(builder, this.PRIVATE_KEY);
    return CryptoPublicKeyParams.createCryptoPublicKeyParams(
      builder,
      this.ALGORITHM,
      PRIVATE_KEY
    );
  }
}
export {
  CryptoPublicKeyParams,
  CryptoPublicKeyParamsT
};
