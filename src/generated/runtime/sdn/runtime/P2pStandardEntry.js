var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class P2pStandardEntry {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsP2pStandardEntry(bb, obj) {
    return (obj || new P2pStandardEntry()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsP2pStandardEntry(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new P2pStandardEntry()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PEER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  STANDARD(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SCHEMA(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  FILE_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  FILE_NAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  CID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PUBLISH_MS() {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  PNM_INDEX() {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.readInt32(this.bb_pos + offset) : -1;
  }
  static startP2pStandardEntry(builder) {
    builder.startObject(8);
  }
  static addPeerId(builder, PEER_IDOffset) {
    builder.addFieldOffset(0, PEER_IDOffset, 0);
  }
  static addStandard(builder, STANDARDOffset) {
    builder.addFieldOffset(1, STANDARDOffset, 0);
  }
  static addSchema(builder, SCHEMAOffset) {
    builder.addFieldOffset(2, SCHEMAOffset, 0);
  }
  static addFileId(builder, FILE_IDOffset) {
    builder.addFieldOffset(3, FILE_IDOffset, 0);
  }
  static addFileName(builder, FILE_NAMEOffset) {
    builder.addFieldOffset(4, FILE_NAMEOffset, 0);
  }
  static addCid(builder, CIDOffset) {
    builder.addFieldOffset(5, CIDOffset, 0);
  }
  static addPublishMs(builder, PUBLISH_MS) {
    builder.addFieldInt64(6, PUBLISH_MS, BigInt("0"));
  }
  static addPnmIndex(builder, PNM_INDEX) {
    builder.addFieldInt32(7, PNM_INDEX, -1);
  }
  static endP2pStandardEntry(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createP2pStandardEntry(builder, PEER_IDOffset, STANDARDOffset, SCHEMAOffset, FILE_IDOffset, FILE_NAMEOffset, CIDOffset, PUBLISH_MS, PNM_INDEX) {
    P2pStandardEntry.startP2pStandardEntry(builder);
    P2pStandardEntry.addPeerId(builder, PEER_IDOffset);
    P2pStandardEntry.addStandard(builder, STANDARDOffset);
    P2pStandardEntry.addSchema(builder, SCHEMAOffset);
    P2pStandardEntry.addFileId(builder, FILE_IDOffset);
    P2pStandardEntry.addFileName(builder, FILE_NAMEOffset);
    P2pStandardEntry.addCid(builder, CIDOffset);
    P2pStandardEntry.addPublishMs(builder, PUBLISH_MS);
    P2pStandardEntry.addPnmIndex(builder, PNM_INDEX);
    return P2pStandardEntry.endP2pStandardEntry(builder);
  }
  unpack() {
    return new P2pStandardEntryT(
      this.PEER_ID(),
      this.STANDARD(),
      this.SCHEMA(),
      this.FILE_ID(),
      this.FILE_NAME(),
      this.CID(),
      this.PUBLISH_MS(),
      this.PNM_INDEX()
    );
  }
  unpackTo(_o) {
    _o.PEER_ID = this.PEER_ID();
    _o.STANDARD = this.STANDARD();
    _o.SCHEMA = this.SCHEMA();
    _o.FILE_ID = this.FILE_ID();
    _o.FILE_NAME = this.FILE_NAME();
    _o.CID = this.CID();
    _o.PUBLISH_MS = this.PUBLISH_MS();
    _o.PNM_INDEX = this.PNM_INDEX();
  }
}
class P2pStandardEntryT {
  constructor(PEER_ID = null, STANDARD = null, SCHEMA = null, FILE_ID = null, FILE_NAME = null, CID = null, PUBLISH_MS = BigInt("0"), PNM_INDEX = -1) {
    __publicField(this, "PEER_ID", PEER_ID);
    __publicField(this, "STANDARD", STANDARD);
    __publicField(this, "SCHEMA", SCHEMA);
    __publicField(this, "FILE_ID", FILE_ID);
    __publicField(this, "FILE_NAME", FILE_NAME);
    __publicField(this, "CID", CID);
    __publicField(this, "PUBLISH_MS", PUBLISH_MS);
    __publicField(this, "PNM_INDEX", PNM_INDEX);
  }
  pack(builder) {
    const PEER_ID = this.PEER_ID !== null ? builder.createString(this.PEER_ID) : 0;
    const STANDARD = this.STANDARD !== null ? builder.createString(this.STANDARD) : 0;
    const SCHEMA = this.SCHEMA !== null ? builder.createString(this.SCHEMA) : 0;
    const FILE_ID = this.FILE_ID !== null ? builder.createString(this.FILE_ID) : 0;
    const FILE_NAME = this.FILE_NAME !== null ? builder.createString(this.FILE_NAME) : 0;
    const CID = this.CID !== null ? builder.createString(this.CID) : 0;
    return P2pStandardEntry.createP2pStandardEntry(
      builder,
      PEER_ID,
      STANDARD,
      SCHEMA,
      FILE_ID,
      FILE_NAME,
      CID,
      this.PUBLISH_MS,
      this.PNM_INDEX
    );
  }
}
export {
  P2pStandardEntry,
  P2pStandardEntryT
};
