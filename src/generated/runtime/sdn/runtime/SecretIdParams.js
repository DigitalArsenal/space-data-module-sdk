var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class SecretIdParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsSecretIdParams(bb, obj) {
    return (obj || new SecretIdParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsSecretIdParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new SecretIdParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  static startSecretIdParams(builder) {
    builder.startObject(1);
  }
  static addId(builder, IDOffset) {
    builder.addFieldOffset(0, IDOffset, 0);
  }
  static endSecretIdParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createSecretIdParams(builder, IDOffset) {
    SecretIdParams.startSecretIdParams(builder);
    SecretIdParams.addId(builder, IDOffset);
    return SecretIdParams.endSecretIdParams(builder);
  }
  unpack() {
    return new SecretIdParamsT(
      this.ID()
    );
  }
  unpackTo(_o) {
    _o.ID = this.ID();
  }
}
class SecretIdParamsT {
  constructor(ID = null) {
    __publicField(this, "ID", ID);
  }
  pack(builder) {
    const ID = this.ID !== null ? builder.createString(this.ID) : 0;
    return SecretIdParams.createSecretIdParams(
      builder,
      ID
    );
  }
}
export {
  SecretIdParams,
  SecretIdParamsT
};
