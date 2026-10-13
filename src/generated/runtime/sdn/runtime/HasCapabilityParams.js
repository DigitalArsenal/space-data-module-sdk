var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class HasCapabilityParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsHasCapabilityParams(bb, obj) {
    return (obj || new HasCapabilityParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsHasCapabilityParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new HasCapabilityParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  CAPABILITY(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  static startHasCapabilityParams(builder) {
    builder.startObject(1);
  }
  static addCapability(builder, CAPABILITYOffset) {
    builder.addFieldOffset(0, CAPABILITYOffset, 0);
  }
  static endHasCapabilityParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createHasCapabilityParams(builder, CAPABILITYOffset) {
    HasCapabilityParams.startHasCapabilityParams(builder);
    HasCapabilityParams.addCapability(builder, CAPABILITYOffset);
    return HasCapabilityParams.endHasCapabilityParams(builder);
  }
  unpack() {
    return new HasCapabilityParamsT(
      this.CAPABILITY()
    );
  }
  unpackTo(_o) {
    _o.CAPABILITY = this.CAPABILITY();
  }
}
class HasCapabilityParamsT {
  constructor(CAPABILITY = null) {
    __publicField(this, "CAPABILITY", CAPABILITY);
  }
  pack(builder) {
    const CAPABILITY = this.CAPABILITY !== null ? builder.createString(this.CAPABILITY) : 0;
    return HasCapabilityParams.createHasCapabilityParams(
      builder,
      CAPABILITY
    );
  }
}
export {
  HasCapabilityParams,
  HasCapabilityParamsT
};
