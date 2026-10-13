var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class ProtocolHandleParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsProtocolHandleParams(bb, obj) {
    return (obj || new ProtocolHandleParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsProtocolHandleParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new ProtocolHandleParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  PROTOCOL_ID(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  static startProtocolHandleParams(builder) {
    builder.startObject(1);
  }
  static addProtocolId(builder, PROTOCOL_IDOffset) {
    builder.addFieldOffset(0, PROTOCOL_IDOffset, 0);
  }
  static endProtocolHandleParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createProtocolHandleParams(builder, PROTOCOL_IDOffset) {
    ProtocolHandleParams.startProtocolHandleParams(builder);
    ProtocolHandleParams.addProtocolId(builder, PROTOCOL_IDOffset);
    return ProtocolHandleParams.endProtocolHandleParams(builder);
  }
  unpack() {
    return new ProtocolHandleParamsT(
      this.PROTOCOL_ID()
    );
  }
  unpackTo(_o) {
    _o.PROTOCOL_ID = this.PROTOCOL_ID();
  }
}
class ProtocolHandleParamsT {
  constructor(PROTOCOL_ID = null) {
    __publicField(this, "PROTOCOL_ID", PROTOCOL_ID);
  }
  pack(builder) {
    const PROTOCOL_ID = this.PROTOCOL_ID !== null ? builder.createString(this.PROTOCOL_ID) : 0;
    return ProtocolHandleParams.createProtocolHandleParams(
      builder,
      PROTOCOL_ID
    );
  }
}
export {
  ProtocolHandleParams,
  ProtocolHandleParamsT
};
