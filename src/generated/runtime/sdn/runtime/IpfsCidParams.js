var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class IpfsCidParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIpfsCidParams(bb, obj) {
    return (obj || new IpfsCidParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIpfsCidParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IpfsCidParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  CID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  static startIpfsCidParams(builder) {
    builder.startObject(1);
  }
  static addCid(builder, CIDOffset) {
    builder.addFieldOffset(0, CIDOffset, 0);
  }
  static endIpfsCidParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createIpfsCidParams(builder, CIDOffset) {
    IpfsCidParams.startIpfsCidParams(builder);
    IpfsCidParams.addCid(builder, CIDOffset);
    return IpfsCidParams.endIpfsCidParams(builder);
  }
  unpack() {
    return new IpfsCidParamsT(
      this.CID()
    );
  }
  unpackTo(_o) {
    _o.CID = this.CID();
  }
}
class IpfsCidParamsT {
  constructor(CID = null) {
    __publicField(this, "CID", CID);
  }
  pack(builder) {
    const CID = this.CID !== null ? builder.createString(this.CID) : 0;
    return IpfsCidParams.createIpfsCidParams(
      builder,
      CID
    );
  }
}
export {
  IpfsCidParams,
  IpfsCidParamsT
};
