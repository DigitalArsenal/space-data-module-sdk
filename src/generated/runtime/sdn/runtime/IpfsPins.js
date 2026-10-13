var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { IpfsPin } from "./IpfsPin.js";
class IpfsPins {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIpfsPins(bb, obj) {
    return (obj || new IpfsPins()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIpfsPins(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IpfsPins()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PINS(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? (obj || new IpfsPin()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  pinsLength() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  static startIpfsPins(builder) {
    builder.startObject(1);
  }
  static addPins(builder, PINSOffset) {
    builder.addFieldOffset(0, PINSOffset, 0);
  }
  static createPinsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startPinsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static endIpfsPins(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createIpfsPins(builder, PINSOffset) {
    IpfsPins.startIpfsPins(builder);
    IpfsPins.addPins(builder, PINSOffset);
    return IpfsPins.endIpfsPins(builder);
  }
  unpack() {
    return new IpfsPinsT(
      this.bb.createObjList(this.PINS.bind(this), this.pinsLength())
    );
  }
  unpackTo(_o) {
    _o.PINS = this.bb.createObjList(this.PINS.bind(this), this.pinsLength());
  }
}
class IpfsPinsT {
  constructor(PINS = []) {
    __publicField(this, "PINS", PINS);
  }
  pack(builder) {
    const PINS = IpfsPins.createPinsVector(builder, builder.createObjectOffsetList(this.PINS));
    return IpfsPins.createIpfsPins(
      builder,
      PINS
    );
  }
}
export {
  IpfsPins,
  IpfsPinsT
};
