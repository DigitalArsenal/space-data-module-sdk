var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class StorageWriteParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsStorageWriteParams(bb, obj) {
    return (obj || new StorageWriteParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsStorageWriteParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new StorageWriteParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  SCHEMA(optionalEncoding) {
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
  static startStorageWriteParams(builder) {
    builder.startObject(2);
  }
  static addSchema(builder, SCHEMAOffset) {
    builder.addFieldOffset(0, SCHEMAOffset, 0);
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
  static endStorageWriteParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createStorageWriteParams(builder, SCHEMAOffset, DATAOffset) {
    StorageWriteParams.startStorageWriteParams(builder);
    StorageWriteParams.addSchema(builder, SCHEMAOffset);
    StorageWriteParams.addData(builder, DATAOffset);
    return StorageWriteParams.endStorageWriteParams(builder);
  }
  unpack() {
    return new StorageWriteParamsT(
      this.SCHEMA(),
      this.bb.createScalarList(this.DATA.bind(this), this.dataLength())
    );
  }
  unpackTo(_o) {
    _o.SCHEMA = this.SCHEMA();
    _o.DATA = this.bb.createScalarList(this.DATA.bind(this), this.dataLength());
  }
}
class StorageWriteParamsT {
  constructor(SCHEMA = null, DATA = []) {
    __publicField(this, "SCHEMA", SCHEMA);
    __publicField(this, "DATA", DATA);
  }
  pack(builder) {
    const SCHEMA = this.SCHEMA !== null ? builder.createString(this.SCHEMA) : 0;
    const DATA = StorageWriteParams.createDataVector(builder, this.DATA);
    return StorageWriteParams.createStorageWriteParams(
      builder,
      SCHEMA,
      DATA
    );
  }
}
export {
  StorageWriteParams,
  StorageWriteParamsT
};
