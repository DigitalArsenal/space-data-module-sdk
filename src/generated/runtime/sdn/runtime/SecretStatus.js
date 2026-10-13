var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class SecretStatus {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsSecretStatus(bb, obj) {
    return (obj || new SecretStatus()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsSecretStatus(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new SecretStatus()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  CONFIGURED() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  USERNAME_MASKED(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  UPDATED_MS() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  VERIFIED_MS() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  static startSecretStatus(builder) {
    builder.startObject(5);
  }
  static addId(builder, IDOffset) {
    builder.addFieldOffset(0, IDOffset, 0);
  }
  static addConfigured(builder, CONFIGURED) {
    builder.addFieldInt8(1, +CONFIGURED, 0);
  }
  static addUsernameMasked(builder, USERNAME_MASKEDOffset) {
    builder.addFieldOffset(2, USERNAME_MASKEDOffset, 0);
  }
  static addUpdatedMs(builder, UPDATED_MS) {
    builder.addFieldInt64(3, UPDATED_MS, BigInt("0"));
  }
  static addVerifiedMs(builder, VERIFIED_MS) {
    builder.addFieldInt64(4, VERIFIED_MS, BigInt("0"));
  }
  static endSecretStatus(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createSecretStatus(builder, IDOffset, CONFIGURED, USERNAME_MASKEDOffset, UPDATED_MS, VERIFIED_MS) {
    SecretStatus.startSecretStatus(builder);
    SecretStatus.addId(builder, IDOffset);
    SecretStatus.addConfigured(builder, CONFIGURED);
    SecretStatus.addUsernameMasked(builder, USERNAME_MASKEDOffset);
    SecretStatus.addUpdatedMs(builder, UPDATED_MS);
    SecretStatus.addVerifiedMs(builder, VERIFIED_MS);
    return SecretStatus.endSecretStatus(builder);
  }
  unpack() {
    return new SecretStatusT(
      this.ID(),
      this.CONFIGURED(),
      this.USERNAME_MASKED(),
      this.UPDATED_MS(),
      this.VERIFIED_MS()
    );
  }
  unpackTo(_o) {
    _o.ID = this.ID();
    _o.CONFIGURED = this.CONFIGURED();
    _o.USERNAME_MASKED = this.USERNAME_MASKED();
    _o.UPDATED_MS = this.UPDATED_MS();
    _o.VERIFIED_MS = this.VERIFIED_MS();
  }
}
class SecretStatusT {
  constructor(ID = null, CONFIGURED = false, USERNAME_MASKED = null, UPDATED_MS = BigInt("0"), VERIFIED_MS = BigInt("0")) {
    __publicField(this, "ID", ID);
    __publicField(this, "CONFIGURED", CONFIGURED);
    __publicField(this, "USERNAME_MASKED", USERNAME_MASKED);
    __publicField(this, "UPDATED_MS", UPDATED_MS);
    __publicField(this, "VERIFIED_MS", VERIFIED_MS);
  }
  pack(builder) {
    const ID = this.ID !== null ? builder.createString(this.ID) : 0;
    const USERNAME_MASKED = this.USERNAME_MASKED !== null ? builder.createString(this.USERNAME_MASKED) : 0;
    return SecretStatus.createSecretStatus(
      builder,
      ID,
      this.CONFIGURED,
      USERNAME_MASKED,
      this.UPDATED_MS,
      this.VERIFIED_MS
    );
  }
}
export {
  SecretStatus,
  SecretStatusT
};
