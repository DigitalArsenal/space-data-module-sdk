var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class CryptoCiphertext {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsCryptoCiphertext(bb, obj) {
    return (obj || new CryptoCiphertext()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsCryptoCiphertext(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new CryptoCiphertext()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  CIPHERTEXT(index) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  ciphertextLength() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  ciphertextArray() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  NONCE(index) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  nonceLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  nonceArray() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startCryptoCiphertext(builder) {
    builder.startObject(2);
  }
  static addCiphertext(builder, CIPHERTEXTOffset) {
    builder.addFieldOffset(0, CIPHERTEXTOffset, 0);
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
  static addNonce(builder, NONCEOffset) {
    builder.addFieldOffset(1, NONCEOffset, 0);
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
  static endCryptoCiphertext(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createCryptoCiphertext(builder, CIPHERTEXTOffset, NONCEOffset) {
    CryptoCiphertext.startCryptoCiphertext(builder);
    CryptoCiphertext.addCiphertext(builder, CIPHERTEXTOffset);
    CryptoCiphertext.addNonce(builder, NONCEOffset);
    return CryptoCiphertext.endCryptoCiphertext(builder);
  }
  unpack() {
    return new CryptoCiphertextT(
      this.bb.createScalarList(this.CIPHERTEXT.bind(this), this.ciphertextLength()),
      this.bb.createScalarList(this.NONCE.bind(this), this.nonceLength())
    );
  }
  unpackTo(_o) {
    _o.CIPHERTEXT = this.bb.createScalarList(this.CIPHERTEXT.bind(this), this.ciphertextLength());
    _o.NONCE = this.bb.createScalarList(this.NONCE.bind(this), this.nonceLength());
  }
}
class CryptoCiphertextT {
  constructor(CIPHERTEXT = [], NONCE = []) {
    __publicField(this, "CIPHERTEXT", CIPHERTEXT);
    __publicField(this, "NONCE", NONCE);
  }
  pack(builder) {
    const CIPHERTEXT = CryptoCiphertext.createCiphertextVector(builder, this.CIPHERTEXT);
    const NONCE = CryptoCiphertext.createNonceVector(builder, this.NONCE);
    return CryptoCiphertext.createCryptoCiphertext(
      builder,
      CIPHERTEXT,
      NONCE
    );
  }
}
export {
  CryptoCiphertext,
  CryptoCiphertextT
};
