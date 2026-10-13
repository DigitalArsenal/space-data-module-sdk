var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class CryptoSealParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsCryptoSealParams(bb, obj) {
    return (obj || new CryptoSealParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsCryptoSealParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new CryptoSealParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  RECIPIENT_PUBLIC_KEY(index) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  recipientPublicKeyLength() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  recipientPublicKeyArray() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  DATA(index) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  dataLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  dataArray() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startCryptoSealParams(builder) {
    builder.startObject(2);
  }
  static addRecipientPublicKey(builder, RECIPIENT_PUBLIC_KEYOffset) {
    builder.addFieldOffset(0, RECIPIENT_PUBLIC_KEYOffset, 0);
  }
  static createRecipientPublicKeyVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startRecipientPublicKeyVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addData(builder, DATAOffset) {
    builder.addFieldOffset(1, DATAOffset, 0);
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
  static endCryptoSealParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createCryptoSealParams(builder, RECIPIENT_PUBLIC_KEYOffset, DATAOffset) {
    CryptoSealParams.startCryptoSealParams(builder);
    CryptoSealParams.addRecipientPublicKey(builder, RECIPIENT_PUBLIC_KEYOffset);
    CryptoSealParams.addData(builder, DATAOffset);
    return CryptoSealParams.endCryptoSealParams(builder);
  }
  unpack() {
    return new CryptoSealParamsT(
      this.bb.createScalarList(this.RECIPIENT_PUBLIC_KEY.bind(this), this.recipientPublicKeyLength()),
      this.bb.createScalarList(this.DATA.bind(this), this.dataLength())
    );
  }
  unpackTo(_o) {
    _o.RECIPIENT_PUBLIC_KEY = this.bb.createScalarList(this.RECIPIENT_PUBLIC_KEY.bind(this), this.recipientPublicKeyLength());
    _o.DATA = this.bb.createScalarList(this.DATA.bind(this), this.dataLength());
  }
}
class CryptoSealParamsT {
  constructor(RECIPIENT_PUBLIC_KEY = [], DATA = []) {
    __publicField(this, "RECIPIENT_PUBLIC_KEY", RECIPIENT_PUBLIC_KEY);
    __publicField(this, "DATA", DATA);
  }
  pack(builder) {
    const RECIPIENT_PUBLIC_KEY = CryptoSealParams.createRecipientPublicKeyVector(builder, this.RECIPIENT_PUBLIC_KEY);
    const DATA = CryptoSealParams.createDataVector(builder, this.DATA);
    return CryptoSealParams.createCryptoSealParams(
      builder,
      RECIPIENT_PUBLIC_KEY,
      DATA
    );
  }
}
export {
  CryptoSealParams,
  CryptoSealParamsT
};
