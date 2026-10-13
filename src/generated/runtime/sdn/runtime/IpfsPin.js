var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class IpfsPin {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIpfsPin(bb, obj) {
    return (obj || new IpfsPin()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIpfsPin(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IpfsPin()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  CID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  TYPE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startIpfsPin(builder) {
    builder.startObject(2);
  }
  static addCid(builder, CIDOffset) {
    builder.addFieldOffset(0, CIDOffset, 0);
  }
  static addType(builder, TYPEOffset) {
    builder.addFieldOffset(1, TYPEOffset, 0);
  }
  static endIpfsPin(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createIpfsPin(builder, CIDOffset, TYPEOffset) {
    IpfsPin.startIpfsPin(builder);
    IpfsPin.addCid(builder, CIDOffset);
    IpfsPin.addType(builder, TYPEOffset);
    return IpfsPin.endIpfsPin(builder);
  }
  unpack() {
    return new IpfsPinT(
      this.CID(),
      this.TYPE()
    );
  }
  unpackTo(_o) {
    _o.CID = this.CID();
    _o.TYPE = this.TYPE();
  }
}
class IpfsPinT {
  constructor(CID = null, TYPE = null) {
    __publicField(this, "CID", CID);
    __publicField(this, "TYPE", TYPE);
  }
  pack(builder) {
    const CID = this.CID !== null ? builder.createString(this.CID) : 0;
    const TYPE = this.TYPE !== null ? builder.createString(this.TYPE) : 0;
    return IpfsPin.createIpfsPin(
      builder,
      CID,
      TYPE
    );
  }
}
export {
  IpfsPin,
  IpfsPinT
};
