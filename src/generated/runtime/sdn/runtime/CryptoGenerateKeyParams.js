var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { cryptoAlgorithm } from "./cryptoAlgorithm.js";
class CryptoGenerateKeyParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsCryptoGenerateKeyParams(bb, obj) {
    return (obj || new CryptoGenerateKeyParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsCryptoGenerateKeyParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new CryptoGenerateKeyParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  ALGORITHM() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : cryptoAlgorithm.Ed25519;
  }
  static startCryptoGenerateKeyParams(builder) {
    builder.startObject(1);
  }
  static addAlgorithm(builder, ALGORITHM) {
    builder.addFieldInt8(0, ALGORITHM, cryptoAlgorithm.Ed25519);
  }
  static endCryptoGenerateKeyParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createCryptoGenerateKeyParams(builder, ALGORITHM) {
    CryptoGenerateKeyParams.startCryptoGenerateKeyParams(builder);
    CryptoGenerateKeyParams.addAlgorithm(builder, ALGORITHM);
    return CryptoGenerateKeyParams.endCryptoGenerateKeyParams(builder);
  }
  unpack() {
    return new CryptoGenerateKeyParamsT(
      this.ALGORITHM()
    );
  }
  unpackTo(_o) {
    _o.ALGORITHM = this.ALGORITHM();
  }
}
class CryptoGenerateKeyParamsT {
  constructor(ALGORITHM = cryptoAlgorithm.Ed25519) {
    __publicField(this, "ALGORITHM", ALGORITHM);
  }
  pack(builder) {
    return CryptoGenerateKeyParams.createCryptoGenerateKeyParams(
      builder,
      this.ALGORITHM
    );
  }
}
export {
  CryptoGenerateKeyParams,
  CryptoGenerateKeyParamsT
};
