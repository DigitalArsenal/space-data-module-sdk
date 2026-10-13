var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import * as flatbuffers from "flatbuffers";
class ExecResult {
  constructor() {
    __publicField(this, "bb", null);
    __publicField(this, "bb_pos", 0);
  }
  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }
  static getRootAsExecResult(bb, obj) {
    return (obj || new ExecResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  static getSizePrefixedRootAsExecResult(bb, obj) {
    bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
    return (obj || new ExecResult()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }
  EXIT_CODE() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.readInt32(this.bb_pos + offset) : -1;
  }
  SIGNAL(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }
  STDOUT(index) {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  stdoutLength() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  stdoutArray() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  STDERR(index) {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readUint8(this.bb.__vector(this.bb_pos + offset) + index) : 0;
  }
  stderrLength() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  stderrArray() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? new Uint8Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
  }
  static startExecResult(builder) {
    builder.startObject(4);
  }
  static addExitCode(builder, EXIT_CODE) {
    builder.addFieldInt32(0, EXIT_CODE, -1);
  }
  static addSignal(builder, SIGNALOffset) {
    builder.addFieldOffset(1, SIGNALOffset, 0);
  }
  static addStdout(builder, STDOUTOffset) {
    builder.addFieldOffset(2, STDOUTOffset, 0);
  }
  static createStdoutVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startStdoutVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static addStderr(builder, STDERROffset) {
    builder.addFieldOffset(3, STDERROffset, 0);
  }
  static createStderrVector(builder, data) {
    builder.startVector(1, data.length, 1);
    for (let i = data.length - 1; i >= 0; i--) {
      builder.addInt8(data[i]);
    }
    return builder.endVector();
  }
  static startStderrVector(builder, numElems) {
    builder.startVector(1, numElems, 1);
  }
  static endExecResult(builder) {
    const offset = builder.endObject();
    return offset;
  }
  static createExecResult(builder, EXIT_CODE, SIGNALOffset, STDOUTOffset, STDERROffset) {
    ExecResult.startExecResult(builder);
    ExecResult.addExitCode(builder, EXIT_CODE);
    ExecResult.addSignal(builder, SIGNALOffset);
    ExecResult.addStdout(builder, STDOUTOffset);
    ExecResult.addStderr(builder, STDERROffset);
    return ExecResult.endExecResult(builder);
  }
  unpack() {
    return new ExecResultT(
      this.EXIT_CODE(),
      this.SIGNAL(),
      this.bb.createScalarList(this.STDOUT.bind(this), this.stdoutLength()),
      this.bb.createScalarList(this.STDERR.bind(this), this.stderrLength())
    );
  }
  unpackTo(_o) {
    _o.EXIT_CODE = this.EXIT_CODE();
    _o.SIGNAL = this.SIGNAL();
    _o.STDOUT = this.bb.createScalarList(this.STDOUT.bind(this), this.stdoutLength());
    _o.STDERR = this.bb.createScalarList(this.STDERR.bind(this), this.stderrLength());
  }
}
class ExecResultT {
  constructor(EXIT_CODE = -1, SIGNAL = null, STDOUT = [], STDERR = []) {
    __publicField(this, "EXIT_CODE", EXIT_CODE);
    __publicField(this, "SIGNAL", SIGNAL);
    __publicField(this, "STDOUT", STDOUT);
    __publicField(this, "STDERR", STDERR);
  }
  pack(builder) {
    const SIGNAL = this.SIGNAL !== null ? builder.createString(this.SIGNAL) : 0;
    const STDOUT = ExecResult.createStdoutVector(builder, this.STDOUT);
    const STDERR = ExecResult.createStderrVector(builder, this.STDERR);
    return ExecResult.createExecResult(
      builder,
      this.EXIT_CODE,
      SIGNAL,
      STDOUT,
      STDERR
    );
  }
}
export {
  ExecResult,
  ExecResultT
};
