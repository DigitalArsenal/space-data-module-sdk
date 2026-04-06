import * as flatbuffers from "flatbuffers/mjs/flatbuffers.js";

import { DrainPolicy } from "../generated/orbpro/manifest/drain-policy.js";
import { TypedArenaBuffer } from "../generated/orbpro/stream/typed-arena-buffer.js";

function toByteBuffer(data) {
  if (data instanceof flatbuffers.ByteBuffer) {
    return data;
  }
  return new flatbuffers.ByteBuffer(data);
}

class StreamInvokeRequest {
  constructor() {
    this.bb = null;
    this.bb_pos = 0;
  }

  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }

  static getRootAsStreamInvokeRequest(bb, obj) {
    return (obj || new StreamInvokeRequest()).__init(
      bb.readInt32(bb.position()) + bb.position(),
      bb,
    );
  }

  static startStreamInvokeRequest(builder) {
    builder.startObject(4);
  }

  static addMethodId(builder, methodIdOffset) {
    builder.addFieldOffset(0, methodIdOffset, 0);
  }

  static addInputs(builder, inputsOffset) {
    builder.addFieldOffset(1, inputsOffset, 0);
  }

  static createInputsVector(builder, data) {
    builder.startVector(4, data.length, 4);
    for (let i = data.length - 1; i >= 0; i -= 1) {
      builder.addOffset(data[i]);
    }
    return builder.endVector();
  }

  static addOutputStreamCap(builder, outputStreamCap) {
    builder.addFieldInt32(2, outputStreamCap, 0);
  }

  static addDrainPolicy(builder, drainPolicy) {
    builder.addFieldInt8(3, drainPolicy, DrainPolicy.DRAIN_UNTIL_YIELD);
  }

  static endStreamInvokeRequest(builder) {
    const offset = builder.endObject();
    builder.requiredField(offset, 4);
    return offset;
  }
}

class StreamInvokeRequestT {
  constructor(
    methodId = null,
    inputs = [],
    outputStreamCap = 0,
    drainPolicy = DrainPolicy.DRAIN_UNTIL_YIELD,
  ) {
    this.methodId = methodId;
    this.inputs = inputs;
    this.outputStreamCap = outputStreamCap;
    this.drainPolicy = drainPolicy;
  }

  pack(builder) {
    const methodId =
      this.methodId !== null ? builder.createString(this.methodId) : 0;
    const inputs = StreamInvokeRequest.createInputsVector(
      builder,
      builder.createObjectOffsetList(this.inputs),
    );
    StreamInvokeRequest.startStreamInvokeRequest(builder);
    StreamInvokeRequest.addMethodId(builder, methodId);
    StreamInvokeRequest.addInputs(builder, inputs);
    StreamInvokeRequest.addOutputStreamCap(builder, this.outputStreamCap);
    StreamInvokeRequest.addDrainPolicy(builder, this.drainPolicy);
    return StreamInvokeRequest.endStreamInvokeRequest(builder);
  }
}

class StreamInvokeResponse {
  constructor() {
    this.bb = null;
    this.bb_pos = 0;
  }

  __init(i, bb) {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }

  static getRootAsStreamInvokeResponse(bb, obj) {
    return (obj || new StreamInvokeResponse()).__init(
      bb.readInt32(bb.position()) + bb.position(),
      bb,
    );
  }

  outputs(index, obj) {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset
      ? (obj || new TypedArenaBuffer()).__init(
          this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4),
          this.bb,
        )
      : null;
  }

  outputsLength() {
    const offset = this.bb.__offset(this.bb_pos, 4);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }

  backlogRemaining() {
    const offset = this.bb.__offset(this.bb_pos, 6);
    return offset ? this.bb.readUint32(this.bb_pos + offset) : 0;
  }

  yielded() {
    const offset = this.bb.__offset(this.bb_pos, 8);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : false;
  }

  errorCode() {
    const offset = this.bb.__offset(this.bb_pos, 10);
    return offset ? this.bb.readInt32(this.bb_pos + offset) : 0;
  }

  errorMessage(optionalEncoding) {
    const offset = this.bb.__offset(this.bb_pos, 12);
    return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
  }

  unpack() {
    return {
      outputs: this.bb.createObjList(this.outputs.bind(this), this.outputsLength()),
      backlogRemaining: this.backlogRemaining(),
      yielded: this.yielded(),
      errorCode: this.errorCode(),
      errorMessage: this.errorMessage(),
    };
  }
}

export function encodeStreamInvokeRequest(request) {
  const normalized =
    request instanceof StreamInvokeRequestT
      ? request
      : Object.assign(new StreamInvokeRequestT(), request);
  const builder = new flatbuffers.Builder(1024);
  builder.finish(normalized.pack(builder));
  return builder.asUint8Array();
}

export function decodeStreamInvokeResponse(data) {
  return StreamInvokeResponse.getRootAsStreamInvokeResponse(
    toByteBuffer(data),
  ).unpack();
}
