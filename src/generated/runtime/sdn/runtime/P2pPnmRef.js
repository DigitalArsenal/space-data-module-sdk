var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class P2pPnmRef {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsP2pPnmRef(bb, obj) {
    return (obj || new P2pPnmRef()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsP2pPnmRef(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new P2pPnmRef()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  CID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  FILE_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PUBLISH_MS() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  BATCH_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  STANDARD(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SCHEMA(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SIGNATURE_VERIFIED() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  ATTRIBUTION(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startP2pPnmRef(builder) {
    builder.startObject(8);
  }
  static addCid(builder, CIDOffset) {
    builder.addFieldOffset(0, CIDOffset, 0);
  }
  static addFileId(builder, FILE_IDOffset) {
    builder.addFieldOffset(1, FILE_IDOffset, 0);
  }
  static addPublishMs(builder, PUBLISH_MS) {
    builder.addFieldInt64(2, PUBLISH_MS, BigInt("0"));
  }
  static addBatchId(builder, BATCH_IDOffset) {
    builder.addFieldOffset(3, BATCH_IDOffset, 0);
  }
  static addStandard(builder, STANDARDOffset) {
    builder.addFieldOffset(4, STANDARDOffset, 0);
  }
  static addSchema(builder, SCHEMAOffset) {
    builder.addFieldOffset(5, SCHEMAOffset, 0);
  }
  static addSignatureVerified(builder, SIGNATURE_VERIFIED) {
    builder.addFieldInt8(6, +SIGNATURE_VERIFIED, 0);
  }
  static addAttribution(builder, ATTRIBUTIONOffset) {
    builder.addFieldOffset(7, ATTRIBUTIONOffset, 0);
  }
  static endP2pPnmRef(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createP2pPnmRef(builder, CIDOffset, FILE_IDOffset, PUBLISH_MS, BATCH_IDOffset, STANDARDOffset, SCHEMAOffset, SIGNATURE_VERIFIED, ATTRIBUTIONOffset) {
    P2pPnmRef.startP2pPnmRef(builder);
    P2pPnmRef.addCid(builder, CIDOffset);
    P2pPnmRef.addFileId(builder, FILE_IDOffset);
    P2pPnmRef.addPublishMs(builder, PUBLISH_MS);
    P2pPnmRef.addBatchId(builder, BATCH_IDOffset);
    P2pPnmRef.addStandard(builder, STANDARDOffset);
    P2pPnmRef.addSchema(builder, SCHEMAOffset);
    P2pPnmRef.addSignatureVerified(builder, SIGNATURE_VERIFIED);
    P2pPnmRef.addAttribution(builder, ATTRIBUTIONOffset);
    return P2pPnmRef.endP2pPnmRef(builder);
  }
  unpack() {
    return new P2pPnmRefT(
      this.CID(),
      this.FILE_ID(),
      this.PUBLISH_MS(),
      this.BATCH_ID(),
      this.STANDARD(),
      this.SCHEMA(),
      this.SIGNATURE_VERIFIED(),
      this.ATTRIBUTION()
    );
  }
  unpackTo(_o) {
    _o.CID = this.CID();
    _o.FILE_ID = this.FILE_ID();
    _o.PUBLISH_MS = this.PUBLISH_MS();
    _o.BATCH_ID = this.BATCH_ID();
    _o.STANDARD = this.STANDARD();
    _o.SCHEMA = this.SCHEMA();
    _o.SIGNATURE_VERIFIED = this.SIGNATURE_VERIFIED();
    _o.ATTRIBUTION = this.ATTRIBUTION();
  }
}
class P2pPnmRefT {
  constructor(CID = null, FILE_ID = null, PUBLISH_MS = BigInt("0"), BATCH_ID = null, STANDARD = null, SCHEMA = null, SIGNATURE_VERIFIED = false, ATTRIBUTION = null) {
    __publicField(this, "CID", CID);
    __publicField(this, "FILE_ID", FILE_ID);
    __publicField(this, "PUBLISH_MS", PUBLISH_MS);
    __publicField(this, "BATCH_ID", BATCH_ID);
    __publicField(this, "STANDARD", STANDARD);
    __publicField(this, "SCHEMA", SCHEMA);
    __publicField(this, "SIGNATURE_VERIFIED", SIGNATURE_VERIFIED);
    __publicField(this, "ATTRIBUTION", ATTRIBUTION);
  }
  pack(builder) {
    const CID = this.CID !== null ? builder.createString(this.CID) : 0;
    const FILE_ID = this.FILE_ID !== null ? builder.createString(this.FILE_ID) : 0;
    const BATCH_ID = this.BATCH_ID !== null ? builder.createString(this.BATCH_ID) : 0;
    const STANDARD = this.STANDARD !== null ? builder.createString(this.STANDARD) : 0;
    const SCHEMA = this.SCHEMA !== null ? builder.createString(this.SCHEMA) : 0;
    const ATTRIBUTION = this.ATTRIBUTION !== null ? builder.createString(this.ATTRIBUTION) : 0;
    return P2pPnmRef.createP2pPnmRef(
      builder,
      CID,
      FILE_ID,
      this.PUBLISH_MS,
      BATCH_ID,
      STANDARD,
      SCHEMA,
      this.SIGNATURE_VERIFIED,
      ATTRIBUTION
    );
  }
}
export {
  P2pPnmRef,
  P2pPnmRefT
};
