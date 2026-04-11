var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import * as flatbuffers from "flatbuffers";
import { CatalogQueryKind } from "../../orbpro/query/catalog-query-kind.js";
class CatalogQueryRequest {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsCatalogQueryRequest(bb, obj) {
    return (obj || new CatalogQueryRequest()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsCatalogQueryRequest(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new CatalogQueryRequest()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static bufferHasIdentifier(bb) {
    return bb.__has_identifier("CQRQ");
  }
  queryKind() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : CatalogQueryKind.ROWS;
  }
  query(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  entityIndex() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  maxCount() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  entityCount() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  static startCatalogQueryRequest(builder) {
    builder.startObject(5);
  }
  static addQueryKind(builder, queryKind) {
    builder.addFieldInt8(0, queryKind, CatalogQueryKind.ROWS);
  }
  static addQuery(builder, queryOffset) {
    builder.addFieldOffset(1, queryOffset, 0);
  }
  static addEntityIndex(builder, entityIndex) {
    builder.addFieldInt32(2, entityIndex, 0);
  }
  static addMaxCount(builder, maxCount) {
    builder.addFieldInt32(3, maxCount, 0);
  }
  static addEntityCount(builder, entityCount) {
    builder.addFieldInt32(4, entityCount, 0);
  }
  static endCatalogQueryRequest(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static finishCatalogQueryRequestBuffer(builder, offset) {
    builder.finish(offset, "CQRQ");
  }
  static finishSizePrefixedCatalogQueryRequestBuffer(builder, offset) {
    builder.finish(offset, "CQRQ", true);
  }
  static createCatalogQueryRequest(builder, queryKind, queryOffset, entityIndex, maxCount, entityCount) {
    CatalogQueryRequest.startCatalogQueryRequest(builder);
    CatalogQueryRequest.addQueryKind(builder, queryKind);
    CatalogQueryRequest.addQuery(builder, queryOffset);
    CatalogQueryRequest.addEntityIndex(builder, entityIndex);
    CatalogQueryRequest.addMaxCount(builder, maxCount);
    CatalogQueryRequest.addEntityCount(builder, entityCount);
    return CatalogQueryRequest.endCatalogQueryRequest(builder);
  }
}
export {
  CatalogQueryRequest
};
