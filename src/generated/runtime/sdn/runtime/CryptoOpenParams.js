var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class CryptoOpenParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsCryptoOpenParams(bb, obj) {
    return (obj || new CryptoOpenParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsCryptoOpenParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new CryptoOpenParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
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
  ENVELOPE(index) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  envelopeLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  envelopeArray() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startCryptoOpenParams(builder) {
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
  static addEnvelope(builder, ENVELOPEOffset) {
    builder.addFieldOffset(1, ENVELOPEOffset, 0);
  }
  static createEnvelopeVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startEnvelopeVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static endCryptoOpenParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createCryptoOpenParams(builder, PRIVATE_KEYOffset, ENVELOPEOffset) {
    CryptoOpenParams.startCryptoOpenParams(builder);
    CryptoOpenParams.addPrivateKey(builder, PRIVATE_KEYOffset);
    CryptoOpenParams.addEnvelope(builder, ENVELOPEOffset);
    return CryptoOpenParams.endCryptoOpenParams(builder);
  }
  unpack() {
    return new CryptoOpenParamsT(
      this.bb.createScalarList(this.PRIVATE_KEY.bind(this), this.privateKeyLength()),
      this.bb.createScalarList(this.ENVELOPE.bind(this), this.envelopeLength())
    );
  }
  unpackTo(_o) {
    _o.PRIVATE_KEY = this.bb.createScalarList(this.PRIVATE_KEY.bind(this), this.privateKeyLength());
    _o.ENVELOPE = this.bb.createScalarList(this.ENVELOPE.bind(this), this.envelopeLength());
  }
}
class CryptoOpenParamsT {
  constructor(PRIVATE_KEY = [], ENVELOPE = []) {
    __publicField(this, "PRIVATE_KEY", PRIVATE_KEY);
    __publicField(this, "ENVELOPE", ENVELOPE);
  }
  pack(builder) {
    const PRIVATE_KEY = CryptoOpenParams.createPrivateKeyVector(builder, this.PRIVATE_KEY);
    const ENVELOPE = CryptoOpenParams.createEnvelopeVector(builder, this.ENVELOPE);
    return CryptoOpenParams.createCryptoOpenParams(
      builder,
      PRIVATE_KEY,
      ENVELOPE
    );
  }
}
export {
  CryptoOpenParams,
  CryptoOpenParamsT
};
