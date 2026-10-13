var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class IpfsAddResult {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIpfsAddResult(bb, obj) {
    return (obj || new IpfsAddResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIpfsAddResult(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IpfsAddResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  CID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  NAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SIZE() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  static startIpfsAddResult(builder) {
    builder.startObject(3);
  }
  static addCid(builder, CIDOffset) {
    builder.addFieldOffset(0, CIDOffset, 0);
  }
  static addName(builder, NAMEOffset) {
    builder.addFieldOffset(1, NAMEOffset, 0);
  }
  static addSize(builder, SIZE) {
    builder.addFieldInt64(2, SIZE, BigInt("0"));
  }
  static endIpfsAddResult(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createIpfsAddResult(builder, CIDOffset, NAMEOffset, SIZE) {
    IpfsAddResult.startIpfsAddResult(builder);
    IpfsAddResult.addCid(builder, CIDOffset);
    IpfsAddResult.addName(builder, NAMEOffset);
    IpfsAddResult.addSize(builder, SIZE);
    return IpfsAddResult.endIpfsAddResult(builder);
  }
  unpack() {
    return new IpfsAddResultT(
      this.CID(),
      this.NAME(),
      this.SIZE()
    );
  }
  unpackTo(_o) {
    _o.CID = this.CID();
    _o.NAME = this.NAME();
    _o.SIZE = this.SIZE();
  }
}
class IpfsAddResultT {
  constructor(CID = null, NAME = null, SIZE = BigInt("0")) {
    __publicField(this, "CID", CID);
    __publicField(this, "NAME", NAME);
    __publicField(this, "SIZE", SIZE);
  }
  pack(builder) {
    const CID = this.CID !== null ? builder.createString(this.CID) : 0;
    const NAME = this.NAME !== null ? builder.createString(this.NAME) : 0;
    return IpfsAddResult.createIpfsAddResult(
      builder,
      CID,
      NAME,
      this.SIZE
    );
  }
}
export {
  IpfsAddResult,
  IpfsAddResultT
};
