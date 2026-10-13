var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { IpfsLink } from "./IpfsLink.js";
class IpfsLinks {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIpfsLinks(bb, obj) {
    return (obj || new IpfsLinks()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIpfsLinks(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IpfsLinks()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  LINKS(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? (obj || new IpfsLink()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  linksLength() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  static startIpfsLinks(builder) {
    builder.startObject(1);
  }
  static addLinks(builder, LINKSOffset) {
    builder.addFieldOffset(0, LINKSOffset, 0);
  }
  static createLinksVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startLinksVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static endIpfsLinks(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createIpfsLinks(builder, LINKSOffset) {
    IpfsLinks.startIpfsLinks(builder);
    IpfsLinks.addLinks(builder, LINKSOffset);
    return IpfsLinks.endIpfsLinks(builder);
  }
  unpack() {
    return new IpfsLinksT(
      this.bb.createObjList(this.LINKS.bind(this), this.linksLength())
    );
  }
  unpackTo(_o) {
    _o.LINKS = this.bb.createObjList(this.LINKS.bind(this), this.linksLength());
  }
}
class IpfsLinksT {
  constructor(LINKS = []) {
    __publicField(this, "LINKS", LINKS);
  }
  pack(builder) {
    const LINKS = IpfsLinks.createLinksVector(builder, builder.createObjectOffsetList(this.LINKS));
    return IpfsLinks.createIpfsLinks(
      builder,
      LINKS
    );
  }
}
export {
  IpfsLinks,
  IpfsLinksT
};
