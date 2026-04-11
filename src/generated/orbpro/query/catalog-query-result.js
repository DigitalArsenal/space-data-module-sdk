var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import * as flatbuffers from "flatbuffers";
import { EntityMetadata } from "../../orbpro/entity/entity-metadata.js";
import { CatalogQueryKind } from "../../orbpro/query/catalog-query-kind.js";
class CatalogQueryResult {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsCatalogQueryResult(bb, obj) {
    return (obj || new CatalogQueryResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsCatalogQueryResult(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new CatalogQueryResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static bufferHasIdentifier(bb) {
    return bb.__has_identifier("CQRS");
  }
  queryKind() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : CatalogQueryKind.ROWS;
  }
  rows(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? (obj || new EntityMetadata()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  rowsLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  entityIndices(index) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint32(this.bb.__vector(this.bb_pos + offset) + index * 4) : 0;
  }
  entityIndicesLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  entityIndicesArray() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? new Uint32Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  mask(index) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  maskLength() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  maskArray() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  visibleCount() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  entityIndex() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  row(obj) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? (obj || new EntityMetadata()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  static startCatalogQueryResult(builder) {
    builder.startObject(7);
  }
  static addQueryKind(builder, queryKind) {
    builder.addFieldInt8(0, queryKind, CatalogQueryKind.ROWS);
  }
  static addRows(builder, rowsOffset) {
    builder.addFieldOffset(1, rowsOffset, 0);
  }
  static createRowsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startRowsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addEntityIndices(builder, entityIndicesOffset) {
    builder.addFieldOffset(2, entityIndicesOffset, 0);
  }
  static createEntityIndicesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt32(data[i]);
    }
    return builder.endVector();
  }
  static startEntityIndicesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addMask(builder, maskOffset) {
    builder.addFieldOffset(3, maskOffset, 0);
  }
  static createMaskVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startMaskVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addVisibleCount(builder, visibleCount) {
    builder.addFieldInt32(4, visibleCount, 0);
  }
  static addEntityIndex(builder, entityIndex) {
    builder.addFieldInt32(5, entityIndex, 0);
  }
  static addRow(builder, rowOffset) {
    builder.addFieldOffset(6, rowOffset, 0);
  }
  static endCatalogQueryResult(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static finishCatalogQueryResultBuffer(builder, offset) {
    builder.finish(offset, "CQRS");
  }
  static finishSizePrefixedCatalogQueryResultBuffer(builder, offset) {
    builder.finish(offset, "CQRS", true);
  }
}
export {
  CatalogQueryResult
};
