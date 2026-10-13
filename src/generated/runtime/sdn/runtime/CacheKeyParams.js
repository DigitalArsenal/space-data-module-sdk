var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { SqlValue } from "./SqlValue.js";
class CacheKeyParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsCacheKeyParams(bb, obj) {
    return (obj || new CacheKeyParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsCacheKeyParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new CacheKeyParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  SQL(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  PARAMS(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? (obj || new SqlValue()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  paramsLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  SCHEMA_NAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SCHEMA_VERSION(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  FORMAT(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PUBLISH_EVENT_KEY(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PROJECTION(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  projectionLength() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  static startCacheKeyParams(builder) {
    builder.startObject(7);
  }
  static addSql(builder, SQLOffset) {
    builder.addFieldOffset(0, SQLOffset, 0);
  }
  static addParams(builder, PARAMSOffset) {
    builder.addFieldOffset(1, PARAMSOffset, 0);
  }
  static createParamsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startParamsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addSchemaName(builder, SCHEMA_NAMEOffset) {
    builder.addFieldOffset(2, SCHEMA_NAMEOffset, 0);
  }
  static addSchemaVersion(builder, SCHEMA_VERSIONOffset) {
    builder.addFieldOffset(3, SCHEMA_VERSIONOffset, 0);
  }
  static addFormat(builder, FORMATOffset) {
    builder.addFieldOffset(4, FORMATOffset, 0);
  }
  static addPublishEventKey(builder, PUBLISH_EVENT_KEYOffset) {
    builder.addFieldOffset(5, PUBLISH_EVENT_KEYOffset, 0);
  }
  static addProjection(builder, PROJECTIONOffset) {
    builder.addFieldOffset(6, PROJECTIONOffset, 0);
  }
  static createProjectionVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startProjectionVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static endCacheKeyParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createCacheKeyParams(builder, SQLOffset, PARAMSOffset, SCHEMA_NAMEOffset, SCHEMA_VERSIONOffset, FORMATOffset, PUBLISH_EVENT_KEYOffset, PROJECTIONOffset) {
    CacheKeyParams.startCacheKeyParams(builder);
    CacheKeyParams.addSql(builder, SQLOffset);
    CacheKeyParams.addParams(builder, PARAMSOffset);
    CacheKeyParams.addSchemaName(builder, SCHEMA_NAMEOffset);
    CacheKeyParams.addSchemaVersion(builder, SCHEMA_VERSIONOffset);
    CacheKeyParams.addFormat(builder, FORMATOffset);
    CacheKeyParams.addPublishEventKey(builder, PUBLISH_EVENT_KEYOffset);
    CacheKeyParams.addProjection(builder, PROJECTIONOffset);
    return CacheKeyParams.endCacheKeyParams(builder);
  }
  unpack() {
    return new CacheKeyParamsT(
      this.SQL(),
      this.bb.createObjList(this.PARAMS.bind(this), this.paramsLength()),
      this.SCHEMA_NAME(),
      this.SCHEMA_VERSION(),
      this.FORMAT(),
      this.PUBLISH_EVENT_KEY(),
      this.bb.createScalarList(this.PROJECTION.bind(this), this.projectionLength())
    );
  }
  unpackTo(_o) {
    _o.SQL = this.SQL();
    _o.PARAMS = this.bb.createObjList(this.PARAMS.bind(this), this.paramsLength());
    _o.SCHEMA_NAME = this.SCHEMA_NAME();
    _o.SCHEMA_VERSION = this.SCHEMA_VERSION();
    _o.FORMAT = this.FORMAT();
    _o.PUBLISH_EVENT_KEY = this.PUBLISH_EVENT_KEY();
    _o.PROJECTION = this.bb.createScalarList(this.PROJECTION.bind(this), this.projectionLength());
  }
}
class CacheKeyParamsT {
  constructor(SQL = null, PARAMS = [], SCHEMA_NAME = null, SCHEMA_VERSION = null, FORMAT = null, PUBLISH_EVENT_KEY = null, PROJECTION = []) {
    __publicField(this, "SQL", SQL);
    __publicField(this, "PARAMS", PARAMS);
    __publicField(this, "SCHEMA_NAME", SCHEMA_NAME);
    __publicField(this, "SCHEMA_VERSION", SCHEMA_VERSION);
    __publicField(this, "FORMAT", FORMAT);
    __publicField(this, "PUBLISH_EVENT_KEY", PUBLISH_EVENT_KEY);
    __publicField(this, "PROJECTION", PROJECTION);
  }
  pack(builder) {
    const SQL = this.SQL !== null ? builder.createString(this.SQL) : 0;
    const PARAMS = CacheKeyParams.createParamsVector(builder, builder.createObjectOffsetList(this.PARAMS));
    const SCHEMA_NAME = this.SCHEMA_NAME !== null ? builder.createString(this.SCHEMA_NAME) : 0;
    const SCHEMA_VERSION = this.SCHEMA_VERSION !== null ? builder.createString(this.SCHEMA_VERSION) : 0;
    const FORMAT = this.FORMAT !== null ? builder.createString(this.FORMAT) : 0;
    const PUBLISH_EVENT_KEY = this.PUBLISH_EVENT_KEY !== null ? builder.createString(this.PUBLISH_EVENT_KEY) : 0;
    const PROJECTION = CacheKeyParams.createProjectionVector(builder, builder.createObjectOffsetList(this.PROJECTION));
    return CacheKeyParams.createCacheKeyParams(
      builder,
      SQL,
      PARAMS,
      SCHEMA_NAME,
      SCHEMA_VERSION,
      FORMAT,
      PUBLISH_EVENT_KEY,
      PROJECTION
    );
  }
}
export {
  CacheKeyParams,
  CacheKeyParamsT
};
