var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class SourceTags {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsSourceTags(bb, obj) {
    return (obj || new SourceTags()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsSourceTags(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new SourceTags()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PROVIDER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SOURCE_NAME(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  BATCH_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SOURCE_URL(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  CONTENT_KEY_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SOURCE_PEER(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  LICENSE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 16);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  LICENSE_URL(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 18);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  CITATION(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 20);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SHARE_ALIKE() {
    const offset = this.bb.__offset(this.bb_pos, 22);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  static startSourceTags(builder) {
    builder.startObject(10);
  }
  static addProviderId(builder, PROVIDER_IDOffset) {
    builder.addFieldOffset(0, PROVIDER_IDOffset, 0);
  }
  static addSourceName(builder, SOURCE_NAMEOffset) {
    builder.addFieldOffset(1, SOURCE_NAMEOffset, 0);
  }
  static addBatchId(builder, BATCH_IDOffset) {
    builder.addFieldOffset(2, BATCH_IDOffset, 0);
  }
  static addSourceUrl(builder, SOURCE_URLOffset) {
    builder.addFieldOffset(3, SOURCE_URLOffset, 0);
  }
  static addContentKeyId(builder, CONTENT_KEY_IDOffset) {
    builder.addFieldOffset(4, CONTENT_KEY_IDOffset, 0);
  }
  static addSourcePeer(builder, SOURCE_PEEROffset) {
    builder.addFieldOffset(5, SOURCE_PEEROffset, 0);
  }
  static addLicense(builder, LICENSEOffset) {
    builder.addFieldOffset(6, LICENSEOffset, 0);
  }
  static addLicenseUrl(builder, LICENSE_URLOffset) {
    builder.addFieldOffset(7, LICENSE_URLOffset, 0);
  }
  static addCitation(builder, CITATIONOffset) {
    builder.addFieldOffset(8, CITATIONOffset, 0);
  }
  static addShareAlike(builder, SHARE_ALIKE) {
    builder.addFieldInt8(9, +SHARE_ALIKE, 0);
  }
  static endSourceTags(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createSourceTags(builder, PROVIDER_IDOffset, SOURCE_NAMEOffset, BATCH_IDOffset, SOURCE_URLOffset, CONTENT_KEY_IDOffset, SOURCE_PEEROffset, LICENSEOffset, LICENSE_URLOffset, CITATIONOffset, SHARE_ALIKE) {
    SourceTags.startSourceTags(builder);
    SourceTags.addProviderId(builder, PROVIDER_IDOffset);
    SourceTags.addSourceName(builder, SOURCE_NAMEOffset);
    SourceTags.addBatchId(builder, BATCH_IDOffset);
    SourceTags.addSourceUrl(builder, SOURCE_URLOffset);
    SourceTags.addContentKeyId(builder, CONTENT_KEY_IDOffset);
    SourceTags.addSourcePeer(builder, SOURCE_PEEROffset);
    SourceTags.addLicense(builder, LICENSEOffset);
    SourceTags.addLicenseUrl(builder, LICENSE_URLOffset);
    SourceTags.addCitation(builder, CITATIONOffset);
    SourceTags.addShareAlike(builder, SHARE_ALIKE);
    return SourceTags.endSourceTags(builder);
  }
  unpack() {
    return new SourceTagsT(
      this.PROVIDER_ID(),
      this.SOURCE_NAME(),
      this.BATCH_ID(),
      this.SOURCE_URL(),
      this.CONTENT_KEY_ID(),
      this.SOURCE_PEER(),
      this.LICENSE(),
      this.LICENSE_URL(),
      this.CITATION(),
      this.SHARE_ALIKE()
    );
  }
  unpackTo(_o) {
    _o.PROVIDER_ID = this.PROVIDER_ID();
    _o.SOURCE_NAME = this.SOURCE_NAME();
    _o.BATCH_ID = this.BATCH_ID();
    _o.SOURCE_URL = this.SOURCE_URL();
    _o.CONTENT_KEY_ID = this.CONTENT_KEY_ID();
    _o.SOURCE_PEER = this.SOURCE_PEER();
    _o.LICENSE = this.LICENSE();
    _o.LICENSE_URL = this.LICENSE_URL();
    _o.CITATION = this.CITATION();
    _o.SHARE_ALIKE = this.SHARE_ALIKE();
  }
}
class SourceTagsT {
  constructor(PROVIDER_ID = null, SOURCE_NAME = null, BATCH_ID = null, SOURCE_URL = null, CONTENT_KEY_ID = null, SOURCE_PEER = null, LICENSE = null, LICENSE_URL = null, CITATION = null, SHARE_ALIKE = false) {
    __publicField(this, "PROVIDER_ID", PROVIDER_ID);
    __publicField(this, "SOURCE_NAME", SOURCE_NAME);
    __publicField(this, "BATCH_ID", BATCH_ID);
    __publicField(this, "SOURCE_URL", SOURCE_URL);
    __publicField(this, "CONTENT_KEY_ID", CONTENT_KEY_ID);
    __publicField(this, "SOURCE_PEER", SOURCE_PEER);
    __publicField(this, "LICENSE", LICENSE);
    __publicField(this, "LICENSE_URL", LICENSE_URL);
    __publicField(this, "CITATION", CITATION);
    __publicField(this, "SHARE_ALIKE", SHARE_ALIKE);
  }
  pack(builder) {
    const PROVIDER_ID = this.PROVIDER_ID !== null ? builder.createString(this.PROVIDER_ID) : 0;
    const SOURCE_NAME = this.SOURCE_NAME !== null ? builder.createString(this.SOURCE_NAME) : 0;
    const BATCH_ID = this.BATCH_ID !== null ? builder.createString(this.BATCH_ID) : 0;
    const SOURCE_URL = this.SOURCE_URL !== null ? builder.createString(this.SOURCE_URL) : 0;
    const CONTENT_KEY_ID = this.CONTENT_KEY_ID !== null ? builder.createString(this.CONTENT_KEY_ID) : 0;
    const SOURCE_PEER = this.SOURCE_PEER !== null ? builder.createString(this.SOURCE_PEER) : 0;
    const LICENSE = this.LICENSE !== null ? builder.createString(this.LICENSE) : 0;
    const LICENSE_URL = this.LICENSE_URL !== null ? builder.createString(this.LICENSE_URL) : 0;
    const CITATION = this.CITATION !== null ? builder.createString(this.CITATION) : 0;
    return SourceTags.createSourceTags(
      builder,
      PROVIDER_ID,
      SOURCE_NAME,
      BATCH_ID,
      SOURCE_URL,
      CONTENT_KEY_ID,
      SOURCE_PEER,
      LICENSE,
      LICENSE_URL,
      CITATION,
      this.SHARE_ALIKE
    );
  }
}
export {
  SourceTags,
  SourceTagsT
};
