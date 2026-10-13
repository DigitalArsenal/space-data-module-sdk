var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class SecretPutParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsSecretPutParams(bb, obj) {
    return (obj || new SecretPutParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsSecretPutParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new SecretPutParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  USERNAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SECRET(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startSecretPutParams(builder) {
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
  static endSecretPutParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createSecretPutParams(builder, IDOffset, USERNAMEOffset, SECRETOffset) {
    SecretPutParams.startSecretPutParams(builder);
    SecretPutParams.addId(builder, IDOffset);
    SecretPutParams.addUsername(builder, USERNAMEOffset);
    SecretPutParams.addSecret(builder, SECRETOffset);
    return SecretPutParams.endSecretPutParams(builder);
  }
  unpack() {
    return new SecretPutParamsT(
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
class SecretPutParamsT {
  constructor(ID = null, USERNAME = null, SECRET = null) {
    __publicField(this, "ID", ID);
    __publicField(this, "USERNAME", USERNAME);
    __publicField(this, "SECRET", SECRET);
  }
  pack(builder) {
    const ID = this.ID !== null ? builder.createString(this.ID) : 0;
    const USERNAME = this.USERNAME !== null ? builder.createString(this.USERNAME) : 0;
    const SECRET = this.SECRET !== null ? builder.createString(this.SECRET) : 0;
    return SecretPutParams.createSecretPutParams(
      builder,
      ID,
      USERNAME,
      SECRET
    );
  }
}
export {
  SecretPutParams,
  SecretPutParamsT
};
