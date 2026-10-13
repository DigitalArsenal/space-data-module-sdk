var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class KeyslotUnwrapParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsKeyslotUnwrapParams(bb, obj) {
    return (obj || new KeyslotUnwrapParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsKeyslotUnwrapParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new KeyslotUnwrapParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  SLOT_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  EPHEMERAL_PUBLIC_KEY(index) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  ephemeralPublicKeyLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  ephemeralPublicKeyArray() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  NONCE(index) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  nonceLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  nonceArray() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  CIPHERTEXT(index) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  ciphertextLength() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  ciphertextArray() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startKeyslotUnwrapParams(builder) {
    builder.startObject(4);
  }
  static addSlotId(builder, SLOT_IDOffset) {
    builder.addFieldOffset(0, SLOT_IDOffset, 0);
  }
  static addEphemeralPublicKey(builder, EPHEMERAL_PUBLIC_KEYOffset) {
    builder.addFieldOffset(1, EPHEMERAL_PUBLIC_KEYOffset, 0);
  }
  static createEphemeralPublicKeyVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startEphemeralPublicKeyVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addNonce(builder, NONCEOffset) {
    builder.addFieldOffset(2, NONCEOffset, 0);
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
  static addCiphertext(builder, CIPHERTEXTOffset) {
    builder.addFieldOffset(3, CIPHERTEXTOffset, 0);
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
  static endKeyslotUnwrapParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createKeyslotUnwrapParams(builder, SLOT_IDOffset, EPHEMERAL_PUBLIC_KEYOffset, NONCEOffset, CIPHERTEXTOffset) {
    KeyslotUnwrapParams.startKeyslotUnwrapParams(builder);
    KeyslotUnwrapParams.addSlotId(builder, SLOT_IDOffset);
    KeyslotUnwrapParams.addEphemeralPublicKey(builder, EPHEMERAL_PUBLIC_KEYOffset);
    KeyslotUnwrapParams.addNonce(builder, NONCEOffset);
    KeyslotUnwrapParams.addCiphertext(builder, CIPHERTEXTOffset);
    return KeyslotUnwrapParams.endKeyslotUnwrapParams(builder);
  }
  unpack() {
    return new KeyslotUnwrapParamsT(
      this.SLOT_ID(),
      this.bb.createScalarList(this.EPHEMERAL_PUBLIC_KEY.bind(this), this.ephemeralPublicKeyLength()),
      this.bb.createScalarList(this.NONCE.bind(this), this.nonceLength()),
      this.bb.createScalarList(this.CIPHERTEXT.bind(this), this.ciphertextLength())
    );
  }
  unpackTo(_o) {
    _o.SLOT_ID = this.SLOT_ID();
    _o.EPHEMERAL_PUBLIC_KEY = this.bb.createScalarList(this.EPHEMERAL_PUBLIC_KEY.bind(this), this.ephemeralPublicKeyLength());
    _o.NONCE = this.bb.createScalarList(this.NONCE.bind(this), this.nonceLength());
    _o.CIPHERTEXT = this.bb.createScalarList(this.CIPHERTEXT.bind(this), this.ciphertextLength());
  }
}
class KeyslotUnwrapParamsT {
  constructor(SLOT_ID = null, EPHEMERAL_PUBLIC_KEY = [], NONCE = [], CIPHERTEXT = []) {
    __publicField(this, "SLOT_ID", SLOT_ID);
    __publicField(this, "EPHEMERAL_PUBLIC_KEY", EPHEMERAL_PUBLIC_KEY);
    __publicField(this, "NONCE", NONCE);
    __publicField(this, "CIPHERTEXT", CIPHERTEXT);
  }
  pack(builder) {
    const SLOT_ID = this.SLOT_ID !== null ? builder.createString(this.SLOT_ID) : 0;
    const EPHEMERAL_PUBLIC_KEY = KeyslotUnwrapParams.createEphemeralPublicKeyVector(builder, this.EPHEMERAL_PUBLIC_KEY);
    const NONCE = KeyslotUnwrapParams.createNonceVector(builder, this.NONCE);
    const CIPHERTEXT = KeyslotUnwrapParams.createCiphertextVector(builder, this.CIPHERTEXT);
    return KeyslotUnwrapParams.createKeyslotUnwrapParams(
      builder,
      SLOT_ID,
      EPHEMERAL_PUBLIC_KEY,
      NONCE,
      CIPHERTEXT
    );
  }
}
export {
  KeyslotUnwrapParams,
  KeyslotUnwrapParamsT
};
