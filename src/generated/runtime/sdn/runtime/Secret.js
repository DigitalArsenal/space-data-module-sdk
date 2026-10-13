var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class Secret {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsSecret(bb, obj) {
    return (obj || new Secret()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsSecret(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new Secret()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  USERNAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SECRET(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startSecret(builder) {
    builder.startObject(3);
  }
  static addId(builder, IDOffset) {
    builder.addFieldOffset(0, IDOffset, 0);
  }
  static addUsername(builder, USERNAMEOffset) {
    builder.addFieldOffset(1, USERNAMEOffset, 0);
  }
  static addSecret(builder, SECRETOffset) {
    builder.addFieldOffset(2, SECRETOffset, 0);
  }
  static endSecret(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createSecret(builder, IDOffset, USERNAMEOffset, SECRETOffset) {
    Secret.startSecret(builder);
    Secret.addId(builder, IDOffset);
    Secret.addUsername(builder, USERNAMEOffset);
    Secret.addSecret(builder, SECRETOffset);
    return Secret.endSecret(builder);
  }
  unpack() {
    return new SecretT(
      this.ID(),
      this.USERNAME(),
      this.SECRET()
    );
  }
  unpackTo(_o) {
    _o.ID = this.ID();
    _o.USERNAME = this.USERNAME();
    _o.SECRET = this.SECRET();
  }
}
class SecretT {
  constructor(ID = null, USERNAME = null, SECRET = null) {
    __publicField(this, "ID", ID);
    __publicField(this, "USERNAME", USERNAME);
    __publicField(this, "SECRET", SECRET);
  }
  pack(builder) {
    const ID = this.ID !== null ? builder.createString(this.ID) : 0;
    const USERNAME = this.USERNAME !== null ? builder.createString(this.USERNAME) : 0;
    const SECRET = this.SECRET !== null ? builder.createString(this.SECRET) : 0;
    return Secret.createSecret(
      builder,
      ID,
      USERNAME,
      SECRET
    );
  }
}
export {
  Secret,
  SecretT
};
