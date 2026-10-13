var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class CryptoKeyPair {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsCryptoKeyPair(bb, obj) {
    return (obj || new CryptoKeyPair()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsCryptoKeyPair(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new CryptoKeyPair()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PRIVATE_KEY(index) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  privateKeyLength() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  privateKeyArray() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
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
  static startCryptoKeyPair(builder) {
    builder.startObject(2);
  }
  static addPrivateKey(builder, PRIVATE_KEYOffset) {
    builder.addFieldOffset(0, PRIVATE_KEYOffset, 0);
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
  static endCryptoKeyPair(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createCryptoKeyPair(builder, PRIVATE_KEYOffset, PUBLIC_KEYOffset) {
    CryptoKeyPair.startCryptoKeyPair(builder);
    CryptoKeyPair.addPrivateKey(builder, PRIVATE_KEYOffset);
    CryptoKeyPair.addPublicKey(builder, PUBLIC_KEYOffset);
    return CryptoKeyPair.endCryptoKeyPair(builder);
  }
  unpack() {
    return new CryptoKeyPairT(
      this.bb.createScalarList(this.PRIVATE_KEY.bind(this), this.privateKeyLength()),
      this.bb.createScalarList(this.PUBLIC_KEY.bind(this), this.publicKeyLength())
    );
  }
  unpackTo(_o) {
    _o.PRIVATE_KEY = this.bb.createScalarList(this.PRIVATE_KEY.bind(this), this.privateKeyLength());
    _o.PUBLIC_KEY = this.bb.createScalarList(this.PUBLIC_KEY.bind(this), this.publicKeyLength());
  }
}
class CryptoKeyPairT {
  constructor(PRIVATE_KEY = [], PUBLIC_KEY = []) {
    __publicField(this, "PRIVATE_KEY", PRIVATE_KEY);
    __publicField(this, "PUBLIC_KEY", PUBLIC_KEY);
  }
  pack(builder) {
    const PRIVATE_KEY = CryptoKeyPair.createPrivateKeyVector(builder, this.PRIVATE_KEY);
    const PUBLIC_KEY = CryptoKeyPair.createPublicKeyVector(builder, this.PUBLIC_KEY);
    return CryptoKeyPair.createCryptoKeyPair(
      builder,
      PRIVATE_KEY,
      PUBLIC_KEY
    );
  }
}
export {
  CryptoKeyPair,
  CryptoKeyPairT
};
