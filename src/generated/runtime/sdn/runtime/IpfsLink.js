var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class IpfsLink {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIpfsLink(bb, obj) {
    return (obj || new IpfsLink()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIpfsLink(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IpfsLink()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  NAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  CID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SIZE() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  TYPE() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readInt32(this.bb_pos + offset) : 0;
  }
  static startIpfsLink(builder) {
    builder.startObject(4);
  }
  static addName(builder, NAMEOffset) {
    builder.addFieldOffset(0, NAMEOffset, 0);
  }
  static addCid(builder, CIDOffset) {
    builder.addFieldOffset(1, CIDOffset, 0);
  }
  static addSize(builder, SIZE) {
    builder.addFieldInt64(2, SIZE, BigInt("0"));
  }
  static addType(builder, TYPE) {
    builder.addFieldInt32(3, TYPE, 0);
  }
  static endIpfsLink(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createIpfsLink(builder, NAMEOffset, CIDOffset, SIZE, TYPE) {
    IpfsLink.startIpfsLink(builder);
    IpfsLink.addName(builder, NAMEOffset);
    IpfsLink.addCid(builder, CIDOffset);
    IpfsLink.addSize(builder, SIZE);
    IpfsLink.addType(builder, TYPE);
    return IpfsLink.endIpfsLink(builder);
  }
  unpack() {
    return new IpfsLinkT(
      this.NAME(),
      this.CID(),
      this.SIZE(),
      this.TYPE()
    );
  }
  unpackTo(_o) {
    _o.NAME = this.NAME();
    _o.CID = this.CID();
    _o.SIZE = this.SIZE();
    _o.TYPE = this.TYPE();
  }
}
class IpfsLinkT {
  constructor(NAME = null, CID = null, SIZE = BigInt("0"), TYPE = 0) {
    __publicField(this, "NAME", NAME);
    __publicField(this, "CID", CID);
    __publicField(this, "SIZE", SIZE);
    __publicField(this, "TYPE", TYPE);
  }
  pack(builder) {
    const NAME = this.NAME !== null ? builder.createString(this.NAME) : 0;
    const CID = this.CID !== null ? builder.createString(this.CID) : 0;
    return IpfsLink.createIpfsLink(
      builder,
      NAME,
      CID,
      this.SIZE,
      this.TYPE
    );
  }
}
export {
  IpfsLink,
  IpfsLinkT
};
