var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class ProtocolDialParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsProtocolDialParams(bb, obj) {
    return (obj || new ProtocolDialParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsProtocolDialParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new ProtocolDialParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PROTOCOL_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  PEER_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  static startProtocolDialParams(builder) {
    builder.startObject(2);
  }
  static addProtocolId(builder, PROTOCOL_IDOffset) {
    builder.addFieldOffset(0, PROTOCOL_IDOffset, 0);
  }
  static addPeerId(builder, PEER_IDOffset) {
    builder.addFieldOffset(1, PEER_IDOffset, 0);
  }
  static endProtocolDialParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    builder.requiredField(offset, 6);
    return offset;
  }
  static createProtocolDialParams(builder, PROTOCOL_IDOffset, PEER_IDOffset) {
    ProtocolDialParams.startProtocolDialParams(builder);
    ProtocolDialParams.addProtocolId(builder, PROTOCOL_IDOffset);
    ProtocolDialParams.addPeerId(builder, PEER_IDOffset);
    return ProtocolDialParams.endProtocolDialParams(builder);
  }
  unpack() {
    return new ProtocolDialParamsT(
      this.PROTOCOL_ID(),
      this.PEER_ID()
    );
  }
  unpackTo(_o) {
    _o.PROTOCOL_ID = this.PROTOCOL_ID();
    _o.PEER_ID = this.PEER_ID();
  }
}
class ProtocolDialParamsT {
  constructor(PROTOCOL_ID = null, PEER_ID = null) {
    __publicField(this, "PROTOCOL_ID", PROTOCOL_ID);
    __publicField(this, "PEER_ID", PEER_ID);
  }
  pack(builder) {
    const PROTOCOL_ID = this.PROTOCOL_ID !== null ? builder.createString(this.PROTOCOL_ID) : 0;
    const PEER_ID = this.PEER_ID !== null ? builder.createString(this.PEER_ID) : 0;
    return ProtocolDialParams.createProtocolDialParams(
      builder,
      PROTOCOL_ID,
      PEER_ID
    );
  }
}
export {
  ProtocolDialParams,
  ProtocolDialParamsT
};
