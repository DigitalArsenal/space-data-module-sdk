var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class IngestResult {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsIngestResult(bb, obj) {
    return (obj || new IngestResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsIngestResult(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new IngestResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static bufferHasIdentifier(bb) {
    return bb.__has_identifier("INGR");
  }
  SCHEMA(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PROVIDER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SOURCE_NAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  BATCH_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * Records newly stored.
   */
  INSERTED() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  /**
   * Records already held, dropped (reconcile Duplicates).
   */
  RECONCILED_DUPLICATES() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  /**
   * Older records of the lane retired (reconcile Current).
   */
  RECONCILED_OLD_BATCHES() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  ARCHIVED(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  REFUSED(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startIngestResult(builder) {
    builder.startObject(9);
  }
  static addSchema(builder, SCHEMAOffset) {
    builder.addFieldOffset(0, SCHEMAOffset, 0);
  }
  static addProviderId(builder, PROVIDER_IDOffset) {
    builder.addFieldOffset(1, PROVIDER_IDOffset, 0);
  }
  static addSourceName(builder, SOURCE_NAMEOffset) {
    builder.addFieldOffset(2, SOURCE_NAMEOffset, 0);
  }
  static addBatchId(builder, BATCH_IDOffset) {
    builder.addFieldOffset(3, BATCH_IDOffset, 0);
  }
  static addInserted(builder, INSERTED) {
    builder.addFieldInt64(4, INSERTED, BigInt("0"));
  }
  static addReconciledDuplicates(builder, RECONCILED_DUPLICATES) {
    builder.addFieldInt64(5, RECONCILED_DUPLICATES, BigInt("0"));
  }
  static addReconciledOldBatches(builder, RECONCILED_OLD_BATCHES) {
    builder.addFieldInt64(6, RECONCILED_OLD_BATCHES, BigInt("0"));
  }
  static addArchived(builder, ARCHIVEDOffset) {
    builder.addFieldOffset(7, ARCHIVEDOffset, 0);
  }
  static addRefused(builder, REFUSEDOffset) {
    builder.addFieldOffset(8, REFUSEDOffset, 0);
  }
  static endIngestResult(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static finishIngestResultBuffer(builder, offset) {
    builder.finish(offset, "INGR");
  }
  static finishSizePrefixedIngestResultBuffer(builder, offset) {
    builder.finish(offset, "INGR", true);
  }
  static createIngestResult(builder, SCHEMAOffset, PROVIDER_IDOffset, SOURCE_NAMEOffset, BATCH_IDOffset, INSERTED, RECONCILED_DUPLICATES, RECONCILED_OLD_BATCHES, ARCHIVEDOffset, REFUSEDOffset) {
    IngestResult.startIngestResult(builder);
    IngestResult.addSchema(builder, SCHEMAOffset);
    IngestResult.addProviderId(builder, PROVIDER_IDOffset);
    IngestResult.addSourceName(builder, SOURCE_NAMEOffset);
    IngestResult.addBatchId(builder, BATCH_IDOffset);
    IngestResult.addInserted(builder, INSERTED);
    IngestResult.addReconciledDuplicates(builder, RECONCILED_DUPLICATES);
    IngestResult.addReconciledOldBatches(builder, RECONCILED_OLD_BATCHES);
    IngestResult.addArchived(builder, ARCHIVEDOffset);
    IngestResult.addRefused(builder, REFUSEDOffset);
    return IngestResult.endIngestResult(builder);
  }
  unpack() {
    return new IngestResultT(
      this.SCHEMA(),
      this.PROVIDER_ID(),
      this.SOURCE_NAME(),
      this.BATCH_ID(),
      this.INSERTED(),
      this.RECONCILED_DUPLICATES(),
      this.RECONCILED_OLD_BATCHES(),
      this.ARCHIVED(),
      this.REFUSED()
    );
  }
  unpackTo(_o) {
    _o.SCHEMA = this.SCHEMA();
    _o.PROVIDER_ID = this.PROVIDER_ID();
    _o.SOURCE_NAME = this.SOURCE_NAME();
    _o.BATCH_ID = this.BATCH_ID();
    _o.INSERTED = this.INSERTED();
    _o.RECONCILED_DUPLICATES = this.RECONCILED_DUPLICATES();
    _o.RECONCILED_OLD_BATCHES = this.RECONCILED_OLD_BATCHES();
    _o.ARCHIVED = this.ARCHIVED();
    _o.REFUSED = this.REFUSED();
  }
}
class IngestResultT {
  constructor(SCHEMA = null, PROVIDER_ID = null, SOURCE_NAME = null, BATCH_ID = null, INSERTED = BigInt("0"), RECONCILED_DUPLICATES = BigInt("0"), RECONCILED_OLD_BATCHES = BigInt("0"), ARCHIVED = null, REFUSED = null) {
    __publicField(this, "SCHEMA", SCHEMA);
    __publicField(this, "PROVIDER_ID", PROVIDER_ID);
    __publicField(this, "SOURCE_NAME", SOURCE_NAME);
    __publicField(this, "BATCH_ID", BATCH_ID);
    __publicField(this, "INSERTED", INSERTED);
    __publicField(this, "RECONCILED_DUPLICATES", RECONCILED_DUPLICATES);
    __publicField(this, "RECONCILED_OLD_BATCHES", RECONCILED_OLD_BATCHES);
    __publicField(this, "ARCHIVED", ARCHIVED);
    __publicField(this, "REFUSED", REFUSED);
  }
  pack(builder) {
    const SCHEMA = this.SCHEMA !== null ? builder.createString(this.SCHEMA) : 0;
    const PROVIDER_ID = this.PROVIDER_ID !== null ? builder.createString(this.PROVIDER_ID) : 0;
    const SOURCE_NAME = this.SOURCE_NAME !== null ? builder.createString(this.SOURCE_NAME) : 0;
    const BATCH_ID = this.BATCH_ID !== null ? builder.createString(this.BATCH_ID) : 0;
    const ARCHIVED = this.ARCHIVED !== null ? builder.createString(this.ARCHIVED) : 0;
    const REFUSED = this.REFUSED !== null ? builder.createString(this.REFUSED) : 0;
    return IngestResult.createIngestResult(
      builder,
      SCHEMA,
      PROVIDER_ID,
      SOURCE_NAME,
      BATCH_ID,
      this.INSERTED,
      this.RECONCILED_DUPLICATES,
      this.RECONCILED_OLD_BATCHES,
      ARCHIVED,
      REFUSED
    );
  }
}
export {
  IngestResult,
  IngestResultT
};
