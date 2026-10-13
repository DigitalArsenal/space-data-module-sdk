var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { cryptoAlgorithm } from "./cryptoAlgorithm.js";
class CryptoHashParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsCryptoHashParams(bb, obj) {
    return (obj || new CryptoHashParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsCryptoHashParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new CryptoHashParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  ALGORITHM() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : cryptoAlgorithm.Sha256;
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
  static startCryptoHashParams(builder) {
    builder.startObject(2);
  }
  static addAlgorithm(builder, ALGORITHM) {
    builder.addFieldInt8(0, ALGORITHM, cryptoAlgorithm.Sha256);
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
  static endCryptoHashParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createCryptoHashParams(builder, ALGORITHM, DATAOffset) {
    CryptoHashParams.startCryptoHashParams(builder);
    CryptoHashParams.addAlgorithm(builder, ALGORITHM);
    CryptoHashParams.addData(builder, DATAOffset);
    return CryptoHashParams.endCryptoHashParams(builder);
  }
  unpack() {
    return new CryptoHashParamsT(
      this.ALGORITHM(),
      this.bb.createScalarList(this.DATA.bind(this), this.dataLength())
    );
  }
  unpackTo(_o) {
    _o.ALGORITHM = this.ALGORITHM();
    _o.DATA = this.bb.createScalarList(this.DATA.bind(this), this.dataLength());
  }
}
class CryptoHashParamsT {
  constructor(ALGORITHM = cryptoAlgorithm.Sha256, DATA = []) {
    __publicField(this, "ALGORITHM", ALGORITHM);
    __publicField(this, "DATA", DATA);
  }
  pack(builder) {
    const DATA = CryptoHashParams.createDataVector(builder, this.DATA);
    return CryptoHashParams.createCryptoHashParams(
      builder,
      this.ALGORITHM,
      DATA
    );
  }
}
export {
  CryptoHashParams,
  CryptoHashParamsT
};
