var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class IpfsAddParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIpfsAddParams(bb, obj) {
    return (obj || new IpfsAddParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIpfsAddParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IpfsAddParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  DATA(index) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  dataLength() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  dataArray() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  PIN() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : true;
  }
  static startIpfsAddParams(builder) {
    builder.startObject(2);
  }
  static addData(builder, DATAOffset) {
    builder.addFieldOffset(0, DATAOffset, 0);
  }
  static createDataVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startDataVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addPin(builder, PIN) {
    builder.addFieldInt8(1, +PIN, 1);
  }
  static endIpfsAddParams(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createIpfsAddParams(builder, DATAOffset, PIN) {
    IpfsAddParams.startIpfsAddParams(builder);
    IpfsAddParams.addData(builder, DATAOffset);
    IpfsAddParams.addPin(builder, PIN);
    return IpfsAddParams.endIpfsAddParams(builder);
  }
  unpack() {
    return new IpfsAddParamsT(
      this.bb.createScalarList(this.DATA.bind(this), this.dataLength()),
      this.PIN()
    );
  }
  unpackTo(_o) {
    _o.DATA = this.bb.createScalarList(this.DATA.bind(this), this.dataLength());
    _o.PIN = this.PIN();
  }
}
class IpfsAddParamsT {
  constructor(DATA = [], PIN = true) {
    __publicField(this, "DATA", DATA);
    __publicField(this, "PIN", PIN);
  }
  pack(builder) {
    const DATA = IpfsAddParams.createDataVector(builder, this.DATA);
    return IpfsAddParams.createIpfsAddParams(
      builder,
      DATA,
      this.PIN
    );
  }
}
export {
  IpfsAddParams,
  IpfsAddParamsT
};
