var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { hostCallErrorCode } from "./hostCallErrorCode.js";
class HostCallError {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsHostCallError(bb, obj) {
    return (obj || new HostCallError()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsHostCallError(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new HostCallError()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  CODE() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readUint8(this.bb_pos + offset) : hostCallErrorCode.None;
  }
  MESSAGE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  SANDBOX(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  CAPABILITY(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  static startHostCallError(builder) {
    builder.startObject(4);
  }
  static addCode(builder, CODE) {
    builder.addFieldInt8(0, CODE, hostCallErrorCode.None);
  }
  static addMessage(builder, MESSAGEOffset) {
    builder.addFieldOffset(1, MESSAGEOffset, 0);
  }
  static addSandbox(builder, SANDBOXOffset) {
    builder.addFieldOffset(2, SANDBOXOffset, 0);
  }
  static addCapability(builder, CAPABILITYOffset) {
    builder.addFieldOffset(3, CAPABILITYOffset, 0);
  }
  static endHostCallError(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createHostCallError(builder, CODE, MESSAGEOffset, SANDBOXOffset, CAPABILITYOffset) {
    HostCallError.startHostCallError(builder);
    HostCallError.addCode(builder, CODE);
    HostCallError.addMessage(builder, MESSAGEOffset);
    HostCallError.addSandbox(builder, SANDBOXOffset);
    HostCallError.addCapability(builder, CAPABILITYOffset);
    return HostCallError.endHostCallError(builder);
  }
  unpack() {
    return new HostCallErrorT(
      this.CODE(),
      this.MESSAGE(),
      this.SANDBOX(),
      this.CAPABILITY()
    );
  }
  unpackTo(_o) {
    _o.CODE = this.CODE();
    _o.MESSAGE = this.MESSAGE();
    _o.SANDBOX = this.SANDBOX();
    _o.CAPABILITY = this.CAPABILITY();
  }
}
class HostCallErrorT {
  constructor(CODE = hostCallErrorCode.None, MESSAGE = null, SANDBOX = null, CAPABILITY = null) {
    __publicField(this, "CODE", CODE);
    __publicField(this, "MESSAGE", MESSAGE);
    __publicField(this, "SANDBOX", SANDBOX);
    __publicField(this, "CAPABILITY", CAPABILITY);
  }
  pack(builder) {
    const MESSAGE = this.MESSAGE !== null ? builder.createString(this.MESSAGE) : 0;
    const SANDBOX = this.SANDBOX !== null ? builder.createString(this.SANDBOX) : 0;
    const CAPABILITY = this.CAPABILITY !== null ? builder.createString(this.CAPABILITY) : 0;
    return HostCallError.createHostCallError(
      builder,
      this.CODE,
      MESSAGE,
      SANDBOX,
      CAPABILITY
    );
  }
}
export {
  HostCallError,
  HostCallErrorT
};
