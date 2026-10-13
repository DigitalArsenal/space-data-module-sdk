var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { cryptoAlgorithm } from "./cryptoAlgorithm.js";
class KeyslotSignParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsKeyslotSignParams(bb, obj) {
    return (obj || new KeyslotSignParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsKeyslotSignParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new KeyslotSignParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  SLOT_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  ALGORITHM() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : cryptoAlgorithm.Ed25519;
  }
  PAYLOAD(index) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  payloadLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  payloadArray() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startKeyslotSignParams(builder) {
    builder.startObject(3);
  }
  static addSlotId(builder, SLOT_IDOffset) {
    builder.addFieldOffset(0, SLOT_IDOffset, 0);
  }
  static addAlgorithm(builder, ALGORITHM) {
    builder.addFieldInt8(1, ALGORITHM, cryptoAlgorithm.Ed25519);
  }
  static addPayload(builder, PAYLOADOffset) {
    builder.addFieldOffset(2, PAYLOADOffset, 0);
  }
  static createPayloadVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startPayloadVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static endKeyslotSignParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createKeyslotSignParams(builder, SLOT_IDOffset, ALGORITHM, PAYLOADOffset) {
    KeyslotSignParams.startKeyslotSignParams(builder);
    KeyslotSignParams.addSlotId(builder, SLOT_IDOffset);
    KeyslotSignParams.addAlgorithm(builder, ALGORITHM);
    KeyslotSignParams.addPayload(builder, PAYLOADOffset);
    return KeyslotSignParams.endKeyslotSignParams(builder);
  }
  unpack() {
    return new KeyslotSignParamsT(
      this.SLOT_ID(),
      this.ALGORITHM(),
      this.bb.createScalarList(this.PAYLOAD.bind(this), this.payloadLength())
    );
  }
  unpackTo(_o) {
    _o.SLOT_ID = this.SLOT_ID();
    _o.ALGORITHM = this.ALGORITHM();
    _o.PAYLOAD = this.bb.createScalarList(this.PAYLOAD.bind(this), this.payloadLength());
  }
}
class KeyslotSignParamsT {
  constructor(SLOT_ID = null, ALGORITHM = cryptoAlgorithm.Ed25519, PAYLOAD = []) {
    __publicField(this, "SLOT_ID", SLOT_ID);
    __publicField(this, "ALGORITHM", ALGORITHM);
    __publicField(this, "PAYLOAD", PAYLOAD);
  }
  pack(builder) {
    const SLOT_ID = this.SLOT_ID !== null ? builder.createString(this.SLOT_ID) : 0;
    const PAYLOAD = KeyslotSignParams.createPayloadVector(builder, this.PAYLOAD);
    return KeyslotSignParams.createKeyslotSignParams(
      builder,
      SLOT_ID,
      this.ALGORITHM,
      PAYLOAD
    );
  }
}
export {
  KeyslotSignParams,
  KeyslotSignParamsT
};
