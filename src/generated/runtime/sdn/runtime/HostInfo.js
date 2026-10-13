var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class HostInfo {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsHostInfo(bb, obj) {
    return (obj || new HostInfo()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsHostInfo(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new HostInfo()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  RUNTIME_TARGET(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  CAPABILITIES(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  capabilitiesLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  SUPPORTED_CAPABILITIES(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  supportedCapabilitiesLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  OPERATIONS(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  operationsLength() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  static startHostInfo(builder) {
    builder.startObject(4);
  }
  static addRuntimeTarget(builder, RUNTIME_TARGETOffset) {
    builder.addFieldOffset(0, RUNTIME_TARGETOffset, 0);
  }
  static addCapabilities(builder, CAPABILITIESOffset) {
    builder.addFieldOffset(1, CAPABILITIESOffset, 0);
  }
  static createCapabilitiesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startCapabilitiesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addSupportedCapabilities(builder, SUPPORTED_CAPABILITIESOffset) {
    builder.addFieldOffset(2, SUPPORTED_CAPABILITIESOffset, 0);
  }
  static createSupportedCapabilitiesVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startSupportedCapabilitiesVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addOperations(builder, OPERATIONSOffset) {
    builder.addFieldOffset(3, OPERATIONSOffset, 0);
  }
  static createOperationsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startOperationsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static endHostInfo(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createHostInfo(builder, RUNTIME_TARGETOffset, CAPABILITIESOffset, SUPPORTED_CAPABILITIESOffset, OPERATIONSOffset) {
    HostInfo.startHostInfo(builder);
    HostInfo.addRuntimeTarget(builder, RUNTIME_TARGETOffset);
    HostInfo.addCapabilities(builder, CAPABILITIESOffset);
    HostInfo.addSupportedCapabilities(builder, SUPPORTED_CAPABILITIESOffset);
    HostInfo.addOperations(builder, OPERATIONSOffset);
    return HostInfo.endHostInfo(builder);
  }
  unpack() {
    return new HostInfoT(
      this.RUNTIME_TARGET(),
      this.bb.createScalarList(this.CAPABILITIES.bind(this), this.capabilitiesLength()),
      this.bb.createScalarList(this.SUPPORTED_CAPABILITIES.bind(this), this.supportedCapabilitiesLength()),
      this.bb.createScalarList(this.OPERATIONS.bind(this), this.operationsLength())
    );
  }
  unpackTo(_o) {
    _o.RUNTIME_TARGET = this.RUNTIME_TARGET();
    _o.CAPABILITIES = this.bb.createScalarList(this.CAPABILITIES.bind(this), this.capabilitiesLength());
    _o.SUPPORTED_CAPABILITIES = this.bb.createScalarList(this.SUPPORTED_CAPABILITIES.bind(this), this.supportedCapabilitiesLength());
    _o.OPERATIONS = this.bb.createScalarList(this.OPERATIONS.bind(this), this.operationsLength());
  }
}
class HostInfoT {
  constructor(RUNTIME_TARGET = null, CAPABILITIES = [], SUPPORTED_CAPABILITIES = [], OPERATIONS = []) {
    __publicField(this, "RUNTIME_TARGET", RUNTIME_TARGET);
    __publicField(this, "CAPABILITIES", CAPABILITIES);
    __publicField(this, "SUPPORTED_CAPABILITIES", SUPPORTED_CAPABILITIES);
    __publicField(this, "OPERATIONS", OPERATIONS);
  }
  pack(builder) {
    const RUNTIME_TARGET = this.RUNTIME_TARGET !== null ? builder.createString(this.RUNTIME_TARGET) : 0;
    const CAPABILITIES = HostInfo.createCapabilitiesVector(builder, builder.createObjectOffsetList(this.CAPABILITIES));
    const SUPPORTED_CAPABILITIES = HostInfo.createSupportedCapabilitiesVector(builder, builder.createObjectOffsetList(this.SUPPORTED_CAPABILITIES));
    const OPERATIONS = HostInfo.createOperationsVector(builder, builder.createObjectOffsetList(this.OPERATIONS));
    return HostInfo.createHostInfo(
      builder,
      RUNTIME_TARGET,
      CAPABILITIES,
      SUPPORTED_CAPABILITIES,
      OPERATIONS
    );
  }
}
export {
  HostInfo,
  HostInfoT
};
