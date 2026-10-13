var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
import { Header } from "./Header.js";
class ExecParams {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsExecParams(bb, obj) {
    return (obj || new ExecParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsExecParams(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new ExecParams()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  FILE(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return this.bb.__string(this.bb_pos + offset, optionalEncoding);
  }
  ARGS(index, optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
  }
  argsLength() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  CWD(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  ENV(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? (obj || new Header()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
  }
  envLength() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  INPUT(index) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  inputLength() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  inputArray() {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  TIMEOUT_MS() {
    const offset = this.bb.__offset(this.bb_pos, 14);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }
  static startExecParams(builder) {
    builder.startObject(6);
  }
  static addFile(builder, FILEOffset) {
    builder.addFieldOffset(0, FILEOffset, 0);
  }
  static addArgs(builder, ARGSOffset) {
    builder.addFieldOffset(1, ARGSOffset, 0);
  }
  static createArgsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startArgsVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addCwd(builder, CWDOffset) {
    builder.addFieldOffset(2, CWDOffset, 0);
  }
  static addEnv(builder, ENVOffset) {
    builder.addFieldOffset(3, ENVOffset, 0);
  }
  static createEnvVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }
  static startEnvVector(builder, numElems) {
    builder.startVector(4, numElems, 4);
  }
  static addInput(builder, INPUTOffset) {
    builder.addFieldOffset(4, INPUTOffset, 0);
  }
  static createInputVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startInputVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addTimeoutMs(builder, TIMEOUT_MS) {
    builder.addFieldInt32(5, TIMEOUT_MS, 0);
  }
  static endExecParams(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
  static createExecParams(builder, FILEOffset, ARGSOffset, CWDOffset, ENVOffset, INPUTOffset, TIMEOUT_MS) {
    ExecParams.startExecParams(builder);
    ExecParams.addFile(builder, FILEOffset);
    ExecParams.addArgs(builder, ARGSOffset);
    ExecParams.addCwd(builder, CWDOffset);
    ExecParams.addEnv(builder, ENVOffset);
    ExecParams.addInput(builder, INPUTOffset);
    ExecParams.addTimeoutMs(builder, TIMEOUT_MS);
    return ExecParams.endExecParams(builder);
  }
  unpack() {
    return new ExecParamsT(
      this.FILE(),
      this.bb.createScalarList(this.ARGS.bind(this), this.argsLength()),
      this.CWD(),
      this.bb.createObjList(this.ENV.bind(this), this.envLength()),
      this.bb.createScalarList(this.INPUT.bind(this), this.inputLength()),
      this.TIMEOUT_MS()
    );
  }
  unpackTo(_o) {
    _o.FILE = this.FILE();
    _o.ARGS = this.bb.createScalarList(this.ARGS.bind(this), this.argsLength());
    _o.CWD = this.CWD();
    _o.ENV = this.bb.createObjList(this.ENV.bind(this), this.envLength());
    _o.INPUT = this.bb.createScalarList(this.INPUT.bind(this), this.inputLength());
    _o.TIMEOUT_MS = this.TIMEOUT_MS();
  }
}
class ExecParamsT {
  constructor(FILE = null, ARGS = [], CWD = null, ENV = [], INPUT = [], TIMEOUT_MS = 0) {
    __publicField(this, "FILE", FILE);
    __publicField(this, "ARGS", ARGS);
    __publicField(this, "CWD", CWD);
    __publicField(this, "ENV", ENV);
    __publicField(this, "INPUT", INPUT);
    __publicField(this, "TIMEOUT_MS", TIMEOUT_MS);
  }
  pack(builder) {
    const FILE = this.FILE !== null ? builder.createString(this.FILE) : 0;
    const ARGS = ExecParams.createArgsVector(builder, builder.createObjectOffsetList(this.ARGS));
    const CWD = this.CWD !== null ? builder.createString(this.CWD) : 0;
    const ENV = ExecParams.createEnvVector(builder, builder.createObjectOffsetList(this.ENV));
    const INPUT = ExecParams.createInputVector(builder, this.INPUT);
    return ExecParams.createExecParams(
      builder,
      FILE,
      ARGS,
      CWD,
      ENV,
      INPUT,
      this.TIMEOUT_MS
    );
  }
}
export {
  ExecParams,
  ExecParamsT
};
