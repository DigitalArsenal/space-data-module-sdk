var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { P2pPnmRef } from "./P2pPnmRef.js";
import { P2pServing } from "./P2pServing.js";
class P2pLatestDataset {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsP2pLatestDataset(bb, obj) {
    return (obj || new P2pLatestDataset()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsP2pLatestDataset(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new P2pLatestDataset()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  KNOWN() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  REASON(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PINNED() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  SELF() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  STANDARD(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SCHEMA(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PNM(obj) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? (obj || new P2pPnmRef()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  FRESH() {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  SERVING(obj) {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? (obj || new P2pServing()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
  static startP2pLatestDataset(builder) {
    builder.startObject(9);
  }
  static addKnown(builder, KNOWN) {
    builder.addFieldInt8(0, +KNOWN, 0);
  }
  static addReason(builder, REASONOffset) {
    builder.addFieldOffset(1, REASONOffset, 0);
  }
  static addPinned(builder, PINNED) {
    builder.addFieldInt8(2, +PINNED, 0);
  }
  static addSelf(builder, SELF) {
    builder.addFieldInt8(3, +SELF, 0);
  }
  static addStandard(builder, STANDARDOffset) {
    builder.addFieldOffset(4, STANDARDOffset, 0);
  }
  static addSchema(builder, SCHEMAOffset) {
    builder.addFieldOffset(5, SCHEMAOffset, 0);
  }
  static addPnm(builder, PNMOffset) {
    builder.addFieldOffset(6, PNMOffset, 0);
  }
  static addFresh(builder, FRESH) {
    builder.addFieldInt8(7, +FRESH, 0);
  }
  static addServing(builder, SERVINGOffset) {
    builder.addFieldOffset(8, SERVINGOffset, 0);
  }
  static endP2pLatestDataset(builder) {
    const offset = builder.endObject();
    return offset;
  }
  unpack() {
    return new P2pLatestDatasetT(
      this.KNOWN(),
      this.REASON(),
      this.PINNED(),
      this.SELF(),
      this.STANDARD(),
      this.SCHEMA(),
      this.PNM() !== null ? this.PNM().unpack() : null,
      this.FRESH(),
      this.SERVING() !== null ? this.SERVING().unpack() : null
    );
  }
  unpackTo(_o) {
    _o.KNOWN = this.KNOWN();
    _o.REASON = this.REASON();
    _o.PINNED = this.PINNED();
    _o.SELF = this.SELF();
    _o.STANDARD = this.STANDARD();
    _o.SCHEMA = this.SCHEMA();
    _o.PNM = this.PNM() !== null ? this.PNM().unpack() : null;
    _o.FRESH = this.FRESH();
    _o.SERVING = this.SERVING() !== null ? this.SERVING().unpack() : null;
  }
}
class P2pLatestDatasetT {
  constructor(KNOWN = false, REASON = null, PINNED = false, SELF = false, STANDARD = null, SCHEMA = null, PNM = null, FRESH = false, SERVING = null) {
    __publicField(this, "KNOWN", KNOWN);
    __publicField(this, "REASON", REASON);
    __publicField(this, "PINNED", PINNED);
    __publicField(this, "SELF", SELF);
    __publicField(this, "STANDARD", STANDARD);
    __publicField(this, "SCHEMA", SCHEMA);
    __publicField(this, "PNM", PNM);
    __publicField(this, "FRESH", FRESH);
    __publicField(this, "SERVING", SERVING);
  }
  pack(builder) {
    const REASON = this.REASON !== null ? builder.createString(this.REASON) : 0;
    const STANDARD = this.STANDARD !== null ? builder.createString(this.STANDARD) : 0;
    const SCHEMA = this.SCHEMA !== null ? builder.createString(this.SCHEMA) : 0;
    const PNM = this.PNM !== null ? this.PNM.pack(builder) : 0;
    const SERVING = this.SERVING !== null ? this.SERVING.pack(builder) : 0;
    P2pLatestDataset.startP2pLatestDataset(builder);
    P2pLatestDataset.addKnown(builder, this.KNOWN);
    P2pLatestDataset.addReason(builder, REASON);
    P2pLatestDataset.addPinned(builder, this.PINNED);
    P2pLatestDataset.addSelf(builder, this.SELF);
    P2pLatestDataset.addStandard(builder, STANDARD);
    P2pLatestDataset.addSchema(builder, SCHEMA);
    P2pLatestDataset.addPnm(builder, PNM);
    P2pLatestDataset.addFresh(builder, this.FRESH);
    P2pLatestDataset.addServing(builder, SERVING);
    return P2pLatestDataset.endP2pLatestDataset(builder);
  }
}
export {
  P2pLatestDataset,
  P2pLatestDatasetT
};
