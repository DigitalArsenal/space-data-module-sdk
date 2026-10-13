var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class FsWriteParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsFsWriteParams(bb, obj) {
    return (obj || new FsWriteParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsFsWriteParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new FsWriteParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PATH(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  DATA(index) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  dataLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  dataArray() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  APPEND() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  static startFsWriteParams(builder) {
    builder.startObject(3);
  }
  static addPath(builder, PATHOffset) {
    builder.addFieldOffset(0, PATHOffset, 0);
  }
  static addData(builder, DATAOffset) {
    builder.addFieldOffset(1, DATAOffset, 0);
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
  static addAppend(builder, APPEND) {
    builder.addFieldInt8(2, +APPEND, 0);
  }
  static endFsWriteParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createFsWriteParams(builder, PATHOffset, DATAOffset, APPEND) {
    FsWriteParams.startFsWriteParams(builder);
    FsWriteParams.addPath(builder, PATHOffset);
    FsWriteParams.addData(builder, DATAOffset);
    FsWriteParams.addAppend(builder, APPEND);
    return FsWriteParams.endFsWriteParams(builder);
  }
  unpack() {
    return new FsWriteParamsT(
      this.PATH(),
      this.bb.createScalarList(this.DATA.bind(this), this.dataLength()),
      this.APPEND()
    );
  }
  unpackTo(_o) {
    _o.PATH = this.PATH();
    _o.DATA = this.bb.createScalarList(this.DATA.bind(this), this.dataLength());
    _o.APPEND = this.APPEND();
  }
}
class FsWriteParamsT {
  constructor(PATH = null, DATA = [], APPEND = false) {
    __publicField(this, "PATH", PATH);
    __publicField(this, "DATA", DATA);
    __publicField(this, "APPEND", APPEND);
  }
  pack(builder) {
    const PATH = this.PATH !== null ? builder.createString(this.PATH) : 0;
    const DATA = FsWriteParams.createDataVector(builder, this.DATA);
    return FsWriteParams.createFsWriteParams(
      builder,
      PATH,
      DATA,
      this.APPEND
    );
  }
}
export {
  FsWriteParams,
  FsWriteParamsT
};
