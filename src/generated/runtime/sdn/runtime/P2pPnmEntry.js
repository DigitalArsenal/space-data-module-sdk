var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class P2pPnmEntry {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsP2pPnmEntry(bb, obj) {
    return (obj || new P2pPnmEntry()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsP2pPnmEntry(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new P2pPnmEntry()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PUBLISHER_PEER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  GOSSIP_PEER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  STANDARD(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SCHEMA(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  FILE_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  FILE_NAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  CID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PUBLISH_MS() {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.readUint64(this.bb_pos + offset) : BigInt("0");
  }
  SIGNATURE_TYPE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SIGNATURE(index) {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  signatureLength() {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  signatureArray() {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  SIGNATURE_VERIFIED() {
    const offset = this.bb.__offset(this.bb_pos, 24);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  ATTRIBUTION(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 26);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  PNM_INDEX() {
    const offset = this.bb.__offset(this.bb_pos, 28);
    return offset ? this.bb.readInt32(this.bb_pos + offset) : -1;
  }
  PUBLISHER_KEY(index) {
    const offset = this.bb.__offset(this.bb_pos, 30);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  publisherKeyLength() {
    const offset = this.bb.__offset(this.bb_pos, 30);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  publisherKeyArray() {
    const offset = this.bb.__offset(this.bb_pos, 30);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  PUBLISHER_KEY_SOURCE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 32);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startP2pPnmEntry(builder) {
    builder.startObject(15);
  }
  static addPublisherPeerId(builder, PUBLISHER_PEER_IDOffset) {
    builder.addFieldOffset(0, PUBLISHER_PEER_IDOffset, 0);
  }
  static addGossipPeerId(builder, GOSSIP_PEER_IDOffset) {
    builder.addFieldOffset(1, GOSSIP_PEER_IDOffset, 0);
  }
  static addStandard(builder, STANDARDOffset) {
    builder.addFieldOffset(2, STANDARDOffset, 0);
  }
  static addSchema(builder, SCHEMAOffset) {
    builder.addFieldOffset(3, SCHEMAOffset, 0);
  }
  static addFileId(builder, FILE_IDOffset) {
    builder.addFieldOffset(4, FILE_IDOffset, 0);
  }
  static addFileName(builder, FILE_NAMEOffset) {
    builder.addFieldOffset(5, FILE_NAMEOffset, 0);
  }
  static addCid(builder, CIDOffset) {
    builder.addFieldOffset(6, CIDOffset, 0);
  }
  static addPublishMs(builder, PUBLISH_MS) {
    builder.addFieldInt64(7, PUBLISH_MS, BigInt("0"));
  }
  static addSignatureType(builder, SIGNATURE_TYPEOffset) {
    builder.addFieldOffset(8, SIGNATURE_TYPEOffset, 0);
  }
  static addSignature(builder, SIGNATUREOffset) {
    builder.addFieldOffset(9, SIGNATUREOffset, 0);
  }
  static createSignatureVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startSignatureVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addSignatureVerified(builder, SIGNATURE_VERIFIED) {
    builder.addFieldInt8(10, +SIGNATURE_VERIFIED, 0);
  }
  static addAttribution(builder, ATTRIBUTIONOffset) {
    builder.addFieldOffset(11, ATTRIBUTIONOffset, 0);
  }
  static addPnmIndex(builder, PNM_INDEX) {
    builder.addFieldInt32(12, PNM_INDEX, -1);
  }
  static addPublisherKey(builder, PUBLISHER_KEYOffset) {
    builder.addFieldOffset(13, PUBLISHER_KEYOffset, 0);
  }
  static createPublisherKeyVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startPublisherKeyVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addPublisherKeySource(builder, PUBLISHER_KEY_SOURCEOffset) {
    builder.addFieldOffset(14, PUBLISHER_KEY_SOURCEOffset, 0);
  }
  static endP2pPnmEntry(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createP2pPnmEntry(builder, PUBLISHER_PEER_IDOffset, GOSSIP_PEER_IDOffset, STANDARDOffset, SCHEMAOffset, FILE_IDOffset, FILE_NAMEOffset, CIDOffset, PUBLISH_MS, SIGNATURE_TYPEOffset, SIGNATUREOffset, SIGNATURE_VERIFIED, ATTRIBUTIONOffset, PNM_INDEX, PUBLISHER_KEYOffset, PUBLISHER_KEY_SOURCEOffset) {
    P2pPnmEntry.startP2pPnmEntry(builder);
    P2pPnmEntry.addPublisherPeerId(builder, PUBLISHER_PEER_IDOffset);
    P2pPnmEntry.addGossipPeerId(builder, GOSSIP_PEER_IDOffset);
    P2pPnmEntry.addStandard(builder, STANDARDOffset);
    P2pPnmEntry.addSchema(builder, SCHEMAOffset);
    P2pPnmEntry.addFileId(builder, FILE_IDOffset);
    P2pPnmEntry.addFileName(builder, FILE_NAMEOffset);
    P2pPnmEntry.addCid(builder, CIDOffset);
    P2pPnmEntry.addPublishMs(builder, PUBLISH_MS);
    P2pPnmEntry.addSignatureType(builder, SIGNATURE_TYPEOffset);
    P2pPnmEntry.addSignature(builder, SIGNATUREOffset);
    P2pPnmEntry.addSignatureVerified(builder, SIGNATURE_VERIFIED);
    P2pPnmEntry.addAttribution(builder, ATTRIBUTIONOffset);
    P2pPnmEntry.addPnmIndex(builder, PNM_INDEX);
    P2pPnmEntry.addPublisherKey(builder, PUBLISHER_KEYOffset);
    P2pPnmEntry.addPublisherKeySource(builder, PUBLISHER_KEY_SOURCEOffset);
    return P2pPnmEntry.endP2pPnmEntry(builder);
  }
  unpack() {
    return new P2pPnmEntryT(
      this.PUBLISHER_PEER_ID(),
      this.GOSSIP_PEER_ID(),
      this.STANDARD(),
      this.SCHEMA(),
      this.FILE_ID(),
      this.FILE_NAME(),
      this.CID(),
      this.PUBLISH_MS(),
      this.SIGNATURE_TYPE(),
      this.bb.createScalarList(this.SIGNATURE.bind(this), this.signatureLength()),
      this.SIGNATURE_VERIFIED(),
      this.ATTRIBUTION(),
      this.PNM_INDEX(),
      this.bb.createScalarList(this.PUBLISHER_KEY.bind(this), this.publisherKeyLength()),
      this.PUBLISHER_KEY_SOURCE()
    );
  }
  unpackTo(_o) {
    _o.PUBLISHER_PEER_ID = this.PUBLISHER_PEER_ID();
    _o.GOSSIP_PEER_ID = this.GOSSIP_PEER_ID();
    _o.STANDARD = this.STANDARD();
    _o.SCHEMA = this.SCHEMA();
    _o.FILE_ID = this.FILE_ID();
    _o.FILE_NAME = this.FILE_NAME();
    _o.CID = this.CID();
    _o.PUBLISH_MS = this.PUBLISH_MS();
    _o.SIGNATURE_TYPE = this.SIGNATURE_TYPE();
    _o.SIGNATURE = this.bb.createScalarList(this.SIGNATURE.bind(this), this.signatureLength());
    _o.SIGNATURE_VERIFIED = this.SIGNATURE_VERIFIED();
    _o.ATTRIBUTION = this.ATTRIBUTION();
    _o.PNM_INDEX = this.PNM_INDEX();
    _o.PUBLISHER_KEY = this.bb.createScalarList(this.PUBLISHER_KEY.bind(this), this.publisherKeyLength());
    _o.PUBLISHER_KEY_SOURCE = this.PUBLISHER_KEY_SOURCE();
  }
}
class P2pPnmEntryT {
  constructor(PUBLISHER_PEER_ID = null, GOSSIP_PEER_ID = null, STANDARD = null, SCHEMA = null, FILE_ID = null, FILE_NAME = null, CID = null, PUBLISH_MS = BigInt("0"), SIGNATURE_TYPE = null, SIGNATURE = [], SIGNATURE_VERIFIED = false, ATTRIBUTION = null, PNM_INDEX = -1, PUBLISHER_KEY = [], PUBLISHER_KEY_SOURCE = null) {
    __publicField(this, "PUBLISHER_PEER_ID", PUBLISHER_PEER_ID);
    __publicField(this, "GOSSIP_PEER_ID", GOSSIP_PEER_ID);
    __publicField(this, "STANDARD", STANDARD);
    __publicField(this, "SCHEMA", SCHEMA);
    __publicField(this, "FILE_ID", FILE_ID);
    __publicField(this, "FILE_NAME", FILE_NAME);
    __publicField(this, "CID", CID);
    __publicField(this, "PUBLISH_MS", PUBLISH_MS);
    __publicField(this, "SIGNATURE_TYPE", SIGNATURE_TYPE);
    __publicField(this, "SIGNATURE", SIGNATURE);
    __publicField(this, "SIGNATURE_VERIFIED", SIGNATURE_VERIFIED);
    __publicField(this, "ATTRIBUTION", ATTRIBUTION);
    __publicField(this, "PNM_INDEX", PNM_INDEX);
    __publicField(this, "PUBLISHER_KEY", PUBLISHER_KEY);
    __publicField(this, "PUBLISHER_KEY_SOURCE", PUBLISHER_KEY_SOURCE);
  }
  pack(builder) {
    const PUBLISHER_PEER_ID = this.PUBLISHER_PEER_ID !== null ? builder.createString(this.PUBLISHER_PEER_ID) : 0;
    const GOSSIP_PEER_ID = this.GOSSIP_PEER_ID !== null ? builder.createString(this.GOSSIP_PEER_ID) : 0;
    const STANDARD = this.STANDARD !== null ? builder.createString(this.STANDARD) : 0;
    const SCHEMA = this.SCHEMA !== null ? builder.createString(this.SCHEMA) : 0;
    const FILE_ID = this.FILE_ID !== null ? builder.createString(this.FILE_ID) : 0;
    const FILE_NAME = this.FILE_NAME !== null ? builder.createString(this.FILE_NAME) : 0;
    const CID = this.CID !== null ? builder.createString(this.CID) : 0;
    const SIGNATURE_TYPE = this.SIGNATURE_TYPE !== null ? builder.createString(this.SIGNATURE_TYPE) : 0;
    const SIGNATURE = P2pPnmEntry.createSignatureVector(builder, this.SIGNATURE);
    const ATTRIBUTION = this.ATTRIBUTION !== null ? builder.createString(this.ATTRIBUTION) : 0;
    const PUBLISHER_KEY = P2pPnmEntry.createPublisherKeyVector(builder, this.PUBLISHER_KEY);
    const PUBLISHER_KEY_SOURCE = this.PUBLISHER_KEY_SOURCE !== null ? builder.createString(this.PUBLISHER_KEY_SOURCE) : 0;
    return P2pPnmEntry.createP2pPnmEntry(
      builder,
      PUBLISHER_PEER_ID,
      GOSSIP_PEER_ID,
      STANDARD,
      SCHEMA,
      FILE_ID,
      FILE_NAME,
      CID,
      this.PUBLISH_MS,
      SIGNATURE_TYPE,
      SIGNATURE,
      this.SIGNATURE_VERIFIED,
      ATTRIBUTION,
      this.PNM_INDEX,
      PUBLISHER_KEY,
      PUBLISHER_KEY_SOURCE
    );
  }
}
export {
  P2pPnmEntry,
  P2pPnmEntryT
};
