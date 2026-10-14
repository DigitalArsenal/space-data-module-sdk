var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { Header } from "./Header.js";
class Provenance {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsProvenance(bb, obj) {
    return (obj || new Provenance()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsProvenance(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new Provenance()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  SOURCE_URL(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  HTTP_STATUS() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readInt32(this.bb_pos + offset) : 0;
  }
  ETAG(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  LAST_MODIFIED(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  CONTENT_TYPE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * When the source was retrieved, Unix milliseconds UTC.
   */
  RETRIEVED_MS() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  PARSER(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PARSER_VERSION(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SOURCE_SHA256(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  NORMALIZED_SHA256(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  NORMALIZED_COUNT() {
    const offset = this.bb.__offset(this.bb_pos, 24);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  SCHEMAS(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 26);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  schemasLength() {
    const offset = this.bb.__offset(this.bb_pos, 26);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  SCHEMA_COUNTS(index) {
    const offset = this.bb.__offset(this.bb_pos, 28);
    return offset ? this.bb.readUint64(this.bb.__vector(this.bb_pos + offset) + index * 8) : BigInt(0);
  }
  schemaCountsLength() {
    const offset = this.bb.__offset(this.bb_pos, 28);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  WARNINGS(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 30);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  warningsLength() {
    const offset = this.bb.__offset(this.bb_pos, 30);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  FROM_CACHE() {
    const offset = this.bb.__offset(this.bb_pos, 32);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  /**
   * Descriptive provenance the parser has no field above for - the method, units, the date range covered, counts
   * of what was dropped or filled - as name / value pairs, kept in order (a name may repeat). Values are text.
   */
  ATTRIBUTES(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 34);
    return offset ? (obj || new Header()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  attributesLength() {
    const offset = this.bb.__offset(this.bb_pos, 34);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  static startProvenance(builder) {
    builder.startObject(16);
  }
  static addSourceUrl(builder, SOURCE_URLOffset) {
    builder.addFieldOffset(0, SOURCE_URLOffset, 0);
  }
  static addHttpStatus(builder, HTTP_STATUS) {
    builder.addFieldInt32(1, HTTP_STATUS, 0);
  }
  static addEtag(builder, ETAGOffset) {
    builder.addFieldOffset(2, ETAGOffset, 0);
  }
  static addLastModified(builder, LAST_MODIFIEDOffset) {
    builder.addFieldOffset(3, LAST_MODIFIEDOffset, 0);
  }
  static addContentType(builder, CONTENT_TYPEOffset) {
    builder.addFieldOffset(4, CONTENT_TYPEOffset, 0);
  }
  static addRetrievedMs(builder, RETRIEVED_MS) {
    builder.addFieldInt64(5, RETRIEVED_MS, BigInt("0"));
  }
  static addParser(builder, PARSEROffset) {
    builder.addFieldOffset(6, PARSEROffset, 0);
  }
  static addParserVersion(builder, PARSER_VERSIONOffset) {
    builder.addFieldOffset(7, PARSER_VERSIONOffset, 0);
  }
  static addSourceSha256(builder, SOURCE_SHA256Offset) {
    builder.addFieldOffset(8, SOURCE_SHA256Offset, 0);
  }
  static addNormalizedSha256(builder, NORMALIZED_SHA256Offset) {
    builder.addFieldOffset(9, NORMALIZED_SHA256Offset, 0);
  }
  static addNormalizedCount(builder, NORMALIZED_COUNT) {
    builder.addFieldInt64(10, NORMALIZED_COUNT, BigInt("0"));
  }
  static addSchemas(builder, SCHEMASOffset) {
    builder.addFieldOffset(11, SCHEMASOffset, 0);
  }
  static createSchemasVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startSchemasVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addSchemaCounts(builder, SCHEMA_COUNTSOffset) {
    builder.addFieldOffset(12, SCHEMA_COUNTSOffset, 0);
  }
  static createSchemaCountsVector(builder, data) {
    builder.startVector(8, data.length, 8);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt64(data[i]);
    }
    return builder.endVector();
  }
  static startSchemaCountsVector(builder, numElems) {
    builder.startVector(8, numElems, 8);
  }
  static addWarnings(builder, WARNINGSOffset) {
    builder.addFieldOffset(13, WARNINGSOffset, 0);
  }
  static createWarningsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startWarningsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addFromCache(builder, FROM_CACHE) {
    builder.addFieldInt8(14, +FROM_CACHE, 0);
  }
  static addAttributes(builder, ATTRIBUTESOffset) {
    builder.addFieldOffset(15, ATTRIBUTESOffset, 0);
  }
  static createAttributesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startAttributesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static endProvenance(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createProvenance(builder, SOURCE_URLOffset, HTTP_STATUS, ETAGOffset, LAST_MODIFIEDOffset, CONTENT_TYPEOffset, RETRIEVED_MS, PARSEROffset, PARSER_VERSIONOffset, SOURCE_SHA256Offset, NORMALIZED_SHA256Offset, NORMALIZED_COUNT, SCHEMASOffset, SCHEMA_COUNTSOffset, WARNINGSOffset, FROM_CACHE, ATTRIBUTESOffset) {
    Provenance.startProvenance(builder);
    Provenance.addSourceUrl(builder, SOURCE_URLOffset);
    Provenance.addHttpStatus(builder, HTTP_STATUS);
    Provenance.addEtag(builder, ETAGOffset);
    Provenance.addLastModified(builder, LAST_MODIFIEDOffset);
    Provenance.addContentType(builder, CONTENT_TYPEOffset);
    Provenance.addRetrievedMs(builder, RETRIEVED_MS);
    Provenance.addParser(builder, PARSEROffset);
    Provenance.addParserVersion(builder, PARSER_VERSIONOffset);
    Provenance.addSourceSha256(builder, SOURCE_SHA256Offset);
    Provenance.addNormalizedSha256(builder, NORMALIZED_SHA256Offset);
    Provenance.addNormalizedCount(builder, NORMALIZED_COUNT);
    Provenance.addSchemas(builder, SCHEMASOffset);
    Provenance.addSchemaCounts(builder, SCHEMA_COUNTSOffset);
    Provenance.addWarnings(builder, WARNINGSOffset);
    Provenance.addFromCache(builder, FROM_CACHE);
    Provenance.addAttributes(builder, ATTRIBUTESOffset);
    return Provenance.endProvenance(builder);
  }
  unpack() {
    return new ProvenanceT(
      this.SOURCE_URL(),
      this.HTTP_STATUS(),
      this.ETAG(),
      this.LAST_MODIFIED(),
      this.CONTENT_TYPE(),
      this.RETRIEVED_MS(),
      this.PARSER(),
      this.PARSER_VERSION(),
      this.SOURCE_SHA256(),
      this.NORMALIZED_SHA256(),
      this.NORMALIZED_COUNT(),
      this.bb.createScalarList(this.SCHEMAS.bind(this), this.schemasLength()),
      this.bb.createScalarList(this.SCHEMA_COUNTS.bind(this), this.schemaCountsLength()),
      this.bb.createScalarList(this.WARNINGS.bind(this), this.warningsLength()),
      this.FROM_CACHE(),
      this.bb.createObjList(this.ATTRIBUTES.bind(this), this.attributesLength())
    );
  }
  unpackTo(_o) {
    _o.SOURCE_URL = this.SOURCE_URL();
    _o.HTTP_STATUS = this.HTTP_STATUS();
    _o.ETAG = this.ETAG();
    _o.LAST_MODIFIED = this.LAST_MODIFIED();
    _o.CONTENT_TYPE = this.CONTENT_TYPE();
    _o.RETRIEVED_MS = this.RETRIEVED_MS();
    _o.PARSER = this.PARSER();
    _o.PARSER_VERSION = this.PARSER_VERSION();
    _o.SOURCE_SHA256 = this.SOURCE_SHA256();
    _o.NORMALIZED_SHA256 = this.NORMALIZED_SHA256();
    _o.NORMALIZED_COUNT = this.NORMALIZED_COUNT();
    _o.SCHEMAS = this.bb.createScalarList(this.SCHEMAS.bind(this), this.schemasLength());
    _o.SCHEMA_COUNTS = this.bb.createScalarList(this.SCHEMA_COUNTS.bind(this), this.schemaCountsLength());
    _o.WARNINGS = this.bb.createScalarList(this.WARNINGS.bind(this), this.warningsLength());
    _o.FROM_CACHE = this.FROM_CACHE();
    _o.ATTRIBUTES = this.bb.createObjList(this.ATTRIBUTES.bind(this), this.attributesLength());
  }
}
class ProvenanceT {
  constructor(SOURCE_URL = null, HTTP_STATUS = 0, ETAG = null, LAST_MODIFIED = null, CONTENT_TYPE = null, RETRIEVED_MS = BigInt("0"), PARSER = null, PARSER_VERSION = null, SOURCE_SHA256 = null, NORMALIZED_SHA256 = null, NORMALIZED_COUNT = BigInt("0"), SCHEMAS = [], SCHEMA_COUNTS = [], WARNINGS = [], FROM_CACHE = false, ATTRIBUTES = []) {
    __publicField(this, "SOURCE_URL", SOURCE_URL);
    __publicField(this, "HTTP_STATUS", HTTP_STATUS);
    __publicField(this, "ETAG", ETAG);
    __publicField(this, "LAST_MODIFIED", LAST_MODIFIED);
    __publicField(this, "CONTENT_TYPE", CONTENT_TYPE);
    __publicField(this, "RETRIEVED_MS", RETRIEVED_MS);
    __publicField(this, "PARSER", PARSER);
    __publicField(this, "PARSER_VERSION", PARSER_VERSION);
    __publicField(this, "SOURCE_SHA256", SOURCE_SHA256);
    __publicField(this, "NORMALIZED_SHA256", NORMALIZED_SHA256);
    __publicField(this, "NORMALIZED_COUNT", NORMALIZED_COUNT);
    __publicField(this, "SCHEMAS", SCHEMAS);
    __publicField(this, "SCHEMA_COUNTS", SCHEMA_COUNTS);
    __publicField(this, "WARNINGS", WARNINGS);
    __publicField(this, "FROM_CACHE", FROM_CACHE);
    __publicField(this, "ATTRIBUTES", ATTRIBUTES);
  }
  pack(builder) {
    const SOURCE_URL = this.SOURCE_URL !== null ? builder.createString(this.SOURCE_URL) : 0;
    const ETAG = this.ETAG !== null ? builder.createString(this.ETAG) : 0;
    const LAST_MODIFIED = this.LAST_MODIFIED !== null ? builder.createString(this.LAST_MODIFIED) : 0;
    const CONTENT_TYPE = this.CONTENT_TYPE !== null ? builder.createString(this.CONTENT_TYPE) : 0;
    const PARSER = this.PARSER !== null ? builder.createString(this.PARSER) : 0;
    const PARSER_VERSION = this.PARSER_VERSION !== null ? builder.createString(this.PARSER_VERSION) : 0;
    const SOURCE_SHA256 = this.SOURCE_SHA256 !== null ? builder.createString(this.SOURCE_SHA256) : 0;
    const NORMALIZED_SHA256 = this.NORMALIZED_SHA256 !== null ? builder.createString(this.NORMALIZED_SHA256) : 0;
    const SCHEMAS = Provenance.createSchemasVector(builder, builder.createObjectOffsetList(this.SCHEMAS));
    const SCHEMA_COUNTS = Provenance.createSchemaCountsVector(builder, this.SCHEMA_COUNTS);
    const WARNINGS = Provenance.createWarningsVector(builder, builder.createObjectOffsetList(this.WARNINGS));
    const ATTRIBUTES = Provenance.createAttributesVector(builder, builder.createObjectOffsetList(this.ATTRIBUTES));
    return Provenance.createProvenance(
      builder,
      SOURCE_URL,
      this.HTTP_STATUS,
      ETAG,
      LAST_MODIFIED,
      CONTENT_TYPE,
      this.RETRIEVED_MS,
      PARSER,
      PARSER_VERSION,
      SOURCE_SHA256,
      NORMALIZED_SHA256,
      this.NORMALIZED_COUNT,
      SCHEMAS,
      SCHEMA_COUNTS,
      WARNINGS,
      this.FROM_CACHE,
      ATTRIBUTES
    );
  }
}
export {
  Provenance,
  ProvenanceT
};
