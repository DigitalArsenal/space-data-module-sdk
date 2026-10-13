var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { ArchiveTarget } from "./ArchiveTarget.js";
import { Provenance } from "./Provenance.js";
import { SourceTags } from "./SourceTags.js";
import { reconcileMode } from "./reconcileMode.js";
class IngestRequest {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIngestRequest(bb, obj) {
    return (obj || new IngestRequest()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIngestRequest(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IngestRequest()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static bufferHasIdentifier(bb) {
    return bb.__has_identifier("INGQ");
  }
  SCHEMA(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  TAGS(obj) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? (obj || new SourceTags()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  RECONCILE() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : reconcileMode.Duplicates;
  }
  ARCHIVE(obj) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? (obj || new ArchiveTarget()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  PROVENANCE(obj) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? (obj || new Provenance()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  static startIngestRequest(builder) {
    builder.startObject(5);
  }
  static addSchema(builder, SCHEMAOffset) {
    builder.addFieldOffset(0, SCHEMAOffset, 0);
  }
  static addTags(builder, TAGSOffset) {
    builder.addFieldOffset(1, TAGSOffset, 0);
  }
  static addReconcile(builder, RECONCILE) {
    builder.addFieldInt8(2, RECONCILE, reconcileMode.Duplicates);
  }
  static addArchive(builder, ARCHIVEOffset) {
    builder.addFieldOffset(3, ARCHIVEOffset, 0);
  }
  static addProvenance(builder, PROVENANCEOffset) {
    builder.addFieldOffset(4, PROVENANCEOffset, 0);
  }
  static endIngestRequest(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    builder.requiredField(offset, 6);
    return offset;
  }
  static finishIngestRequestBuffer(builder, offset) {
    builder.finish(offset, "INGQ");
  }
  static finishSizePrefixedIngestRequestBuffer(builder, offset) {
    builder.finish(offset, "INGQ", true);
  }
  unpack() {
    return new IngestRequestT(
      this.SCHEMA(),
      this.TAGS() !== null ? this.TAGS().unpack() : null,
      this.RECONCILE(),
      this.ARCHIVE() !== null ? this.ARCHIVE().unpack() : null,
      this.PROVENANCE() !== null ? this.PROVENANCE().unpack() : null
    );
  }
  unpackTo(_o) {
    _o.SCHEMA = this.SCHEMA();
    _o.TAGS = this.TAGS() !== null ? this.TAGS().unpack() : null;
    _o.RECONCILE = this.RECONCILE();
    _o.ARCHIVE = this.ARCHIVE() !== null ? this.ARCHIVE().unpack() : null;
    _o.PROVENANCE = this.PROVENANCE() !== null ? this.PROVENANCE().unpack() : null;
  }
}
class IngestRequestT {
  constructor(SCHEMA = null, TAGS = null, RECONCILE = reconcileMode.Duplicates, ARCHIVE = null, PROVENANCE = null) {
    __publicField(this, "SCHEMA", SCHEMA);
    __publicField(this, "TAGS", TAGS);
    __publicField(this, "RECONCILE", RECONCILE);
    __publicField(this, "ARCHIVE", ARCHIVE);
    __publicField(this, "PROVENANCE", PROVENANCE);
  }
  pack(builder) {
    const SCHEMA = this.SCHEMA !== null ? builder.createString(this.SCHEMA) : 0;
    const TAGS = this.TAGS !== null ? this.TAGS.pack(builder) : 0;
    const ARCHIVE = this.ARCHIVE !== null ? this.ARCHIVE.pack(builder) : 0;
    const PROVENANCE = this.PROVENANCE !== null ? this.PROVENANCE.pack(builder) : 0;
    IngestRequest.startIngestRequest(builder);
    IngestRequest.addSchema(builder, SCHEMA);
    IngestRequest.addTags(builder, TAGS);
    IngestRequest.addReconcile(builder, this.RECONCILE);
    IngestRequest.addArchive(builder, ARCHIVE);
    IngestRequest.addProvenance(builder, PROVENANCE);
    return IngestRequest.endIngestRequest(builder);
  }
}
export {
  IngestRequest,
  IngestRequestT
};
