var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { flowNoticeKind } from "./flowNoticeKind.js";
class FlowNotice {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsFlowNotice(bb, obj) {
    return (obj || new FlowNotice()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsFlowNotice(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new FlowNotice()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static bufferHasIdentifier(bb) {
    return bb.__has_identifier("FNTC");
  }
  KIND() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : flowNoticeKind.Unchanged;
  }
  SCHEMA(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PROVIDER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SOURCE_NAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  BATCH_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * How many (records expired, leads missing, inventories unchanged ...).
   */
  COUNT() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  REASON(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  ITEMS(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  itemsLength() {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  /**
   * A time the notice is about (e.g. a retention cutoff), Unix milliseconds UTC; 0 = none.
   */
  AT_MS() {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  static startFlowNotice(builder) {
    builder.startObject(9);
  }
  static addKind(builder, KIND) {
    builder.addFieldInt8(0, KIND, flowNoticeKind.Unchanged);
  }
  static addSchema(builder, SCHEMAOffset) {
    builder.addFieldOffset(1, SCHEMAOffset, 0);
  }
  static addProviderId(builder, PROVIDER_IDOffset) {
    builder.addFieldOffset(2, PROVIDER_IDOffset, 0);
  }
  static addSourceName(builder, SOURCE_NAMEOffset) {
    builder.addFieldOffset(3, SOURCE_NAMEOffset, 0);
  }
  static addBatchId(builder, BATCH_IDOffset) {
    builder.addFieldOffset(4, BATCH_IDOffset, 0);
  }
  static addCount(builder, COUNT) {
    builder.addFieldInt64(5, COUNT, BigInt("0"));
  }
  static addReason(builder, REASONOffset) {
    builder.addFieldOffset(6, REASONOffset, 0);
  }
  static addItems(builder, ITEMSOffset) {
    builder.addFieldOffset(7, ITEMSOffset, 0);
  }
  static createItemsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startItemsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addAtMs(builder, AT_MS) {
    builder.addFieldInt64(8, AT_MS, BigInt("0"));
  }
  static endFlowNotice(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static finishFlowNoticeBuffer(builder, offset) {
    builder.finish(offset, "FNTC");
  }
  static finishSizePrefixedFlowNoticeBuffer(builder, offset) {
    builder.finish(offset, "FNTC", true);
  }
  static createFlowNotice(builder, KIND, SCHEMAOffset, PROVIDER_IDOffset, SOURCE_NAMEOffset, BATCH_IDOffset, COUNT, REASONOffset, ITEMSOffset, AT_MS) {
    FlowNotice.startFlowNotice(builder);
    FlowNotice.addKind(builder, KIND);
    FlowNotice.addSchema(builder, SCHEMAOffset);
    FlowNotice.addProviderId(builder, PROVIDER_IDOffset);
    FlowNotice.addSourceName(builder, SOURCE_NAMEOffset);
    FlowNotice.addBatchId(builder, BATCH_IDOffset);
    FlowNotice.addCount(builder, COUNT);
    FlowNotice.addReason(builder, REASONOffset);
    FlowNotice.addItems(builder, ITEMSOffset);
    FlowNotice.addAtMs(builder, AT_MS);
    return FlowNotice.endFlowNotice(builder);
  }
  unpack() {
    return new FlowNoticeT(
      this.KIND(),
      this.SCHEMA(),
      this.PROVIDER_ID(),
      this.SOURCE_NAME(),
      this.BATCH_ID(),
      this.COUNT(),
      this.REASON(),
      this.bb.createScalarList(this.ITEMS.bind(this), this.itemsLength()),
      this.AT_MS()
    );
  }
  unpackTo(_o) {
    _o.KIND = this.KIND();
    _o.SCHEMA = this.SCHEMA();
    _o.PROVIDER_ID = this.PROVIDER_ID();
    _o.SOURCE_NAME = this.SOURCE_NAME();
    _o.BATCH_ID = this.BATCH_ID();
    _o.COUNT = this.COUNT();
    _o.REASON = this.REASON();
    _o.ITEMS = this.bb.createScalarList(this.ITEMS.bind(this), this.itemsLength());
    _o.AT_MS = this.AT_MS();
  }
}
class FlowNoticeT {
  constructor(KIND = flowNoticeKind.Unchanged, SCHEMA = null, PROVIDER_ID = null, SOURCE_NAME = null, BATCH_ID = null, COUNT = BigInt("0"), REASON = null, ITEMS = [], AT_MS = BigInt("0")) {
    __publicField(this, "KIND", KIND);
    __publicField(this, "SCHEMA", SCHEMA);
    __publicField(this, "PROVIDER_ID", PROVIDER_ID);
    __publicField(this, "SOURCE_NAME", SOURCE_NAME);
    __publicField(this, "BATCH_ID", BATCH_ID);
    __publicField(this, "COUNT", COUNT);
    __publicField(this, "REASON", REASON);
    __publicField(this, "ITEMS", ITEMS);
    __publicField(this, "AT_MS", AT_MS);
  }
  pack(builder) {
    const SCHEMA = this.SCHEMA !== null ? builder.createString(this.SCHEMA) : 0;
    const PROVIDER_ID = this.PROVIDER_ID !== null ? builder.createString(this.PROVIDER_ID) : 0;
    const SOURCE_NAME = this.SOURCE_NAME !== null ? builder.createString(this.SOURCE_NAME) : 0;
    const BATCH_ID = this.BATCH_ID !== null ? builder.createString(this.BATCH_ID) : 0;
    const REASON = this.REASON !== null ? builder.createString(this.REASON) : 0;
    const ITEMS = FlowNotice.createItemsVector(builder, builder.createObjectOffsetList(this.ITEMS));
    return FlowNotice.createFlowNotice(
      builder,
      this.KIND,
      SCHEMA,
      PROVIDER_ID,
      SOURCE_NAME,
      BATCH_ID,
      this.COUNT,
      REASON,
      ITEMS,
      this.AT_MS
    );
  }
}
export {
  FlowNotice,
  FlowNoticeT
};
