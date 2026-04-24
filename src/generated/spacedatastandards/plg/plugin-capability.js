var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import * as flatbuffers from "flatbuffers";
class PluginCapability {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsPluginCapability(bb, obj) {
    return (obj || new PluginCapability()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsPluginCapability(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new PluginCapability()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  name(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  version(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  /**
   * Whether this capability is required
   */
  required() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }
  static startPluginCapability(builder) {
    builder.startObject(3);
  }
  static addName(builder, nameOffset) {
    builder.addFieldOffset(0, nameOffset, 0);
  }
  static addVersion(builder, versionOffset) {
    builder.addFieldOffset(1, versionOffset, 0);
  }
  static addRequired(builder, required) {
    builder.addFieldInt8(2, +required, 0);
  }
  static endPluginCapability(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createPluginCapability(builder, nameOffset, versionOffset, required) {
    PluginCapability.startPluginCapability(builder);
    PluginCapability.addName(builder, nameOffset);
    PluginCapability.addVersion(builder, versionOffset);
    PluginCapability.addRequired(builder, required);
    return PluginCapability.endPluginCapability(builder);
  }
}
export {
  PluginCapability
};
