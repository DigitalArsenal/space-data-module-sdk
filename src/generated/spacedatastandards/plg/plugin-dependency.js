var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import * as flatbuffers from "flatbuffers";
class PluginDependency {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsPluginDependency(bb, obj) {
    return (obj || new PluginDependency()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsPluginDependency(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new PluginDependency()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  pluginId(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  minVersion(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  maxVersion(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startPluginDependency(builder) {
    builder.startObject(3);
  }
  static addPluginId(builder, pluginIdOffset) {
    builder.addFieldOffset(0, pluginIdOffset, 0);
  }
  static addMinVersion(builder, minVersionOffset) {
    builder.addFieldOffset(1, minVersionOffset, 0);
  }
  static addMaxVersion(builder, maxVersionOffset) {
    builder.addFieldOffset(2, maxVersionOffset, 0);
  }
  static endPluginDependency(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createPluginDependency(builder, pluginIdOffset, minVersionOffset, maxVersionOffset) {
    PluginDependency.startPluginDependency(builder);
    PluginDependency.addPluginId(builder, pluginIdOffset);
    PluginDependency.addMinVersion(builder, minVersionOffset);
    PluginDependency.addMaxVersion(builder, maxVersionOffset);
    return PluginDependency.endPluginDependency(builder);
  }
}
export {
  PluginDependency
};
