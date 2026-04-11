var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import * as flatbuffers from "flatbuffers";
class RawDataPayload {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsRawDataPayload(bb, obj) {
    return (obj || new RawDataPayload()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsRawDataPayload(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new RawDataPayload()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  typeId(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  data(index) {
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
  static startRawDataPayload(builder) {
    builder.startObject(2);
  }
  static addTypeId(builder, typeIdOffset) {
    builder.addFieldOffset(0, typeIdOffset, 0);
  }
  static addData(builder, dataOffset) {
    builder.addFieldOffset(1, dataOffset, 0);
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
  static endRawDataPayload(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static finishRawDataPayloadBuffer(builder, offset) {
    builder.finish(offset);
  }
  static finishSizePrefixedRawDataPayloadBuffer(builder, offset) {
    builder.finish(offset, void 0, true);
  }
  static createRawDataPayload(builder, typeIdOffset, dataOffset) {
    RawDataPayload.startRawDataPayload(builder);
    RawDataPayload.addTypeId(builder, typeIdOffset);
    RawDataPayload.addData(builder, dataOffset);
    return RawDataPayload.endRawDataPayload(builder);
  }
}
export {
  RawDataPayload
};
