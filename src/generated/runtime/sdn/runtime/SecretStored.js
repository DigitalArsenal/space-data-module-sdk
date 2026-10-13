var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class SecretStored {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsSecretStored(bb, obj) {
    return (obj || new SecretStored()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsSecretStored(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new SecretStored()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  UPDATED_MS() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  static startSecretStored(builder) {
    builder.startObject(2);
  }
  static addId(builder, IDOffset) {
    builder.addFieldOffset(0, IDOffset, 0);
  }
  static addUpdatedMs(builder, UPDATED_MS) {
    builder.addFieldInt64(1, UPDATED_MS, BigInt("0"));
  }
  static endSecretStored(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createSecretStored(builder, IDOffset, UPDATED_MS) {
    SecretStored.startSecretStored(builder);
    SecretStored.addId(builder, IDOffset);
    SecretStored.addUpdatedMs(builder, UPDATED_MS);
    return SecretStored.endSecretStored(builder);
  }
  unpack() {
    return new SecretStoredT(
      this.ID(),
      this.UPDATED_MS()
    );
  }
  unpackTo(_o) {
    _o.ID = this.ID();
    _o.UPDATED_MS = this.UPDATED_MS();
  }
}
class SecretStoredT {
  constructor(ID = null, UPDATED_MS = BigInt("0")) {
    __publicField(this, "ID", ID);
    __publicField(this, "UPDATED_MS", UPDATED_MS);
  }
  pack(builder) {
    const ID = this.ID !== null ? builder.createString(this.ID) : 0;
    return SecretStored.createSecretStored(
      builder,
      ID,
      this.UPDATED_MS
    );
  }
}
export {
  SecretStored,
  SecretStoredT
};
