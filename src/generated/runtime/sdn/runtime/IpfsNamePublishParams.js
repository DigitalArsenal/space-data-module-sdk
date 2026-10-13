var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class IpfsNamePublishParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIpfsNamePublishParams(bb, obj) {
    return (obj || new IpfsNamePublishParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIpfsNamePublishParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IpfsNamePublishParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  CID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  LIFETIME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  TTL(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startIpfsNamePublishParams(builder) {
    builder.startObject(3);
  }
  static addCid(builder, CIDOffset) {
    builder.addFieldOffset(0, CIDOffset, 0);
  }
  static addLifetime(builder, LIFETIMEOffset) {
    builder.addFieldOffset(1, LIFETIMEOffset, 0);
  }
  static addTtl(builder, TTLOffset) {
    builder.addFieldOffset(2, TTLOffset, 0);
  }
  static endIpfsNamePublishParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createIpfsNamePublishParams(builder, CIDOffset, LIFETIMEOffset, TTLOffset) {
    IpfsNamePublishParams.startIpfsNamePublishParams(builder);
    IpfsNamePublishParams.addCid(builder, CIDOffset);
    IpfsNamePublishParams.addLifetime(builder, LIFETIMEOffset);
    IpfsNamePublishParams.addTtl(builder, TTLOffset);
    return IpfsNamePublishParams.endIpfsNamePublishParams(builder);
  }
  unpack() {
    return new IpfsNamePublishParamsT(
      this.CID(),
      this.LIFETIME(),
      this.TTL()
    );
  }
  unpackTo(_o) {
    _o.CID = this.CID();
    _o.LIFETIME = this.LIFETIME();
    _o.TTL = this.TTL();
  }
}
class IpfsNamePublishParamsT {
  constructor(CID = null, LIFETIME = null, TTL = null) {
    __publicField(this, "CID", CID);
    __publicField(this, "LIFETIME", LIFETIME);
    __publicField(this, "TTL", TTL);
  }
  pack(builder) {
    const CID = this.CID !== null ? builder.createString(this.CID) : 0;
    const LIFETIME = this.LIFETIME !== null ? builder.createString(this.LIFETIME) : 0;
    const TTL = this.TTL !== null ? builder.createString(this.TTL) : 0;
    return IpfsNamePublishParams.createIpfsNamePublishParams(
      builder,
      CID,
      LIFETIME,
      TTL
    );
  }
}
export {
  IpfsNamePublishParams,
  IpfsNamePublishParamsT
};
