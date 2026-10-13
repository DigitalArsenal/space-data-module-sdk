var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class IpfsNameResolveParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIpfsNameResolveParams(bb, obj) {
    return (obj || new IpfsNameResolveParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIpfsNameResolveParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IpfsNameResolveParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  NAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  static startIpfsNameResolveParams(builder) {
    builder.startObject(1);
  }
  static addName(builder, NAMEOffset) {
    builder.addFieldOffset(0, NAMEOffset, 0);
  }
  static endIpfsNameResolveParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createIpfsNameResolveParams(builder, NAMEOffset) {
    IpfsNameResolveParams.startIpfsNameResolveParams(builder);
    IpfsNameResolveParams.addName(builder, NAMEOffset);
    return IpfsNameResolveParams.endIpfsNameResolveParams(builder);
  }
  unpack() {
    return new IpfsNameResolveParamsT(
      this.NAME()
    );
  }
  unpackTo(_o) {
    _o.NAME = this.NAME();
  }
}
class IpfsNameResolveParamsT {
  constructor(NAME = null) {
    __publicField(this, "NAME", NAME);
  }
  pack(builder) {
    const NAME = this.NAME !== null ? builder.createString(this.NAME) : 0;
    return IpfsNameResolveParams.createIpfsNameResolveParams(
      builder,
      NAME
    );
  }
}
export {
  IpfsNameResolveParams,
  IpfsNameResolveParamsT
};
