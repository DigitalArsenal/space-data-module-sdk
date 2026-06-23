import * as flatbuffers from "../vendor/flatbuffers/flatbuffers.js";

import { InvokeSurface } from "../generated/orbpro/manifest/invoke-surface.js";
import { BufferMutability } from "../generated/orbpro/stream/buffer-mutability.js";
import { BufferOwnership } from "../generated/orbpro/stream/buffer-ownership.js";
import { toUint8Array } from "../runtime/bufferLike.js";
import { PIV } from "spacedatastandards.org/lib/js/PIV/PIV.js";
import { PIVRequest } from "spacedatastandards.org/lib/js/PIV/PIVRequest.js";
import { PIVResponse } from "spacedatastandards.org/lib/js/PIV/PIVResponse.js";
import { TABT as SdsTABT } from "spacedatastandards.org/lib/js/PIV/TAB.js";
import { FlatBufferTypeRefT as SdsFlatBufferTypeRefT } from "spacedatastandards.org/lib/js/PIV/FlatBufferTypeRef.js";
import { bufferMutability as SdsBufferMutability } from "spacedatastandards.org/lib/js/PIV/bufferMutability.js";
import { bufferOwnership as SdsBufferOwnership } from "spacedatastandards.org/lib/js/PIV/bufferOwnership.js";
import { payloadWireFormat as SdsPayloadWireFormat } from "spacedatastandards.org/lib/js/PIV/payloadWireFormat.js";
import { pivStatus as SdsPivStatus } from "spacedatastandards.org/lib/js/PIV/pivStatus.js";

function toByteBuffer(data) {
  if (data instanceof flatbuffers.ByteBuffer) {
    return data;
  }
  const bytes = toUint8Array(data);
  if (bytes) {
    return new flatbuffers.ByteBuffer(bytes);
  }
  throw new TypeError(
    "Expected ByteBuffer, Uint8Array, ArrayBufferView, or ArrayBuffer.",
  );
}

function normalizeUnsignedInteger(value, fallback = 0) {
  const normalized = Number(value ?? fallback);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(normalized));
}

function normalizeBigInt(value, fallback = BigInt(0)) {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string" && value.trim()) {
    try {
      return BigInt(value.trim());
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function normalizePayloadWireFormat(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    value === 1 ||
    normalized === "aligned-binary" ||
    normalized === "aligned_binary" ||
    normalized === "alignedbinary"
  ) {
    return "aligned-binary";
  }
  return "flatbuffer";
}

function toSdsWireFormat(value) {
  return normalizePayloadWireFormat(value) === "aligned-binary"
    ? SdsPayloadWireFormat.ALIGNED_BINARY
    : SdsPayloadWireFormat.FLATBUFFER;
}

function fromSdsWireFormat(value) {
  return value === SdsPayloadWireFormat.ALIGNED_BINARY
    ? "aligned-binary"
    : "flatbuffer";
}

function toSdsMutability(value) {
  if (
    value === BufferMutability.APPEND_ONLY ||
    value === "append-only" ||
    value === "APPEND_ONLY"
  ) {
    return SdsBufferMutability.APPEND_ONLY;
  }
  if (
    value === BufferMutability.MUTABLE ||
    value === "mutable" ||
    value === "single-writer-mutable" ||
    value === "SINGLE_WRITER_MUTABLE"
  ) {
    return SdsBufferMutability.SINGLE_WRITER_MUTABLE;
  }
  return SdsBufferMutability.IMMUTABLE;
}

function fromSdsMutability(value) {
  if (value === SdsBufferMutability.APPEND_ONLY) {
    return BufferMutability.APPEND_ONLY;
  }
  if (value === SdsBufferMutability.SINGLE_WRITER_MUTABLE) {
    return BufferMutability.MUTABLE;
  }
  return BufferMutability.IMMUTABLE;
}

function toSdsOwnership(value) {
  if (
    value === BufferOwnership.PRODUCER_OWNED ||
    value === "plugin-owned" ||
    value === "PLUGIN_OWNED"
  ) {
    return SdsBufferOwnership.PLUGIN_OWNED;
  }
  if (value === "transferred" || value === "TRANSFERRED") {
    return SdsBufferOwnership.TRANSFERRED;
  }
  return SdsBufferOwnership.HOST_OWNED;
}

function fromSdsOwnership(value) {
  if (value === SdsBufferOwnership.PLUGIN_OWNED) {
    return BufferOwnership.PRODUCER_OWNED;
  }
  if (value === SdsBufferOwnership.TRANSFERRED) {
    return BufferOwnership.SHARED;
  }
  return BufferOwnership.HOST_OWNED;
}

function toSdsFlatBufferTypeRefT(value = {}) {
  if (value instanceof SdsFlatBufferTypeRefT) {
    return value;
  }
  return new SdsFlatBufferTypeRefT(
    value.schemaName ?? value.SCHEMA_NAME ?? null,
    value.fileIdentifier ?? value.FILE_IDENTIFIER ?? null,
    value.schemaVersion ?? value.SCHEMA_VERSION ?? null,
    value.rootTypeName ?? value.rootType ?? value.ROOT_TYPE ?? null,
  );
}

function encodeSdsFrameId(frame = {}) {
  if (
    frame.sequence !== undefined ||
    frame.endOfStream !== undefined ||
    frame.endOfStream === true
  ) {
    const sequence = normalizeBigInt(frame.sequence);
    return (sequence << BigInt(1)) | (frame.endOfStream === true ? BigInt(1) : BigInt(0));
  }
  return normalizeBigInt(frame.frameId ?? frame.traceId);
}

function decodeSdsFrameId(frameId) {
  const normalized = normalizeBigInt(frameId);
  return {
    sequence: normalized >> BigInt(1),
    endOfStream: (normalized & BigInt(1)) === BigInt(1),
  };
}

function alignOffset(offset, alignment) {
  if (alignment <= 1) {
    return offset;
  }
  const remainder = offset % alignment;
  return remainder === 0 ? offset : offset + alignment - remainder;
}

function arenaFrameOffset(frame) {
  return normalizeUnsignedInteger(frame?.offset ?? frame?.OFFSET);
}

function arenaFrameSize(frame) {
  return normalizeUnsignedInteger(frame?.size ?? frame?.SIZE);
}

function arenaFrameAlignment(frame) {
  return Math.max(1, normalizeUnsignedInteger(frame?.alignment ?? frame?.ALIGNMENT, 1));
}

function normalizeSdsArenaFrame(frame = {}, offset) {
  const payload = toUint8Array(frame.payload ?? new Uint8Array()) ?? new Uint8Array();
  const typeRefInput = frame.typeRef ?? frame.allowedType ?? {};
  const wireFormat = toSdsWireFormat(typeRefInput.wireFormat ?? frame.wireFormat);
  const requiredAlignment = normalizeUnsignedInteger(
    typeRefInput.requiredAlignment ?? frame.requiredAlignment,
  );
  const alignment = Math.max(
    INVOKE_ARENA_ALIGNMENT,
    normalizeUnsignedInteger(frame.alignment),
    requiredAlignment,
  );
  const alignedOffset = alignOffset(offset, alignment);
  return {
    payload,
    padding: alignedOffset - offset,
    buffer: new SdsTABT(
      alignedOffset,
      payload.length,
      alignment,
      wireFormat,
      toSdsFlatBufferTypeRefT(typeRefInput),
      toSdsMutability(frame.mutability),
      toSdsOwnership(frame.ownership),
      encodeSdsFrameId(frame),
      frame.portId ?? null,
    ),
  };
}

/**
 * Alignment guaranteed for the payload arena base of every encoded PIV request
 * or response, measured as an absolute byte address.
 */
export const INVOKE_ARENA_ALIGNMENT = 8;

/**
 * Create a ubyte vector whose data is aligned to `alignment` bytes relative to
 * the finished buffer. Generated `createPayloadArenaVector` aligns to one byte.
 */
function createAlignedByteVector(builder, bytes, alignment) {
  builder.startVector(1, bytes.length, alignment);
  builder.bb.setPosition((builder.space -= bytes.length));
  builder.bb.bytes().set(bytes, builder.space);
  return builder.endVector();
}

function describeInvokeBufferKind(kind) {
  return kind === "request" ? "PIV request" : "PIV response";
}

export function assertAlignedInvokeBuffer(
  bytes,
  arenaArray,
  kind,
  arenaAlignment = INVOKE_ARENA_ALIGNMENT,
) {
  if (bytes.byteOffset % INVOKE_ARENA_ALIGNMENT !== 0) {
    throw new Error(
      `${describeInvokeBufferKind(kind)} buffer base is not ${INVOKE_ARENA_ALIGNMENT}-byte aligned (byteOffset ${bytes.byteOffset}).`,
    );
  }
  if (
    arenaArray &&
    arenaArray.length > 0 &&
    arenaArray.byteOffset % arenaAlignment !== 0
  ) {
    throw new Error(
      `${describeInvokeBufferKind(kind)} payload arena base is not ${arenaAlignment}-byte aligned (byteOffset ${arenaArray.byteOffset}).`,
    );
  }
}

function packArenaFrames(frames = [], normalizeFrame = normalizeSdsArenaFrame) {
  const packedFrames = [];
  const normalizedFrames = [];
  let offset = 0;
  let arenaAlignment = INVOKE_ARENA_ALIGNMENT;
  for (const frame of frames) {
    const normalized = normalizeFrame(frame, offset);
    offset = arenaFrameOffset(normalized.buffer) + arenaFrameSize(normalized.buffer);
    arenaAlignment = Math.max(arenaAlignment, arenaFrameAlignment(normalized.buffer));
    packedFrames.push(normalized.buffer);
    normalizedFrames.push(normalized);
  }

  const arena = new Uint8Array(offset);
  for (const normalized of normalizedFrames) {
    arena.set(normalized.payload, arenaFrameOffset(normalized.buffer));
  }
  return {
    frames: packedFrames,
    arena,
    arenaAlignment,
  };
}

function hasExplicitFrameOffset(frame = {}) {
  return frame.offset !== undefined || frame.OFFSET !== undefined;
}

function normalizeExternalArenaFrame(frame = {}, externalArena) {
  const payload = toUint8Array(frame.payload);
  const typeRefInput = frame.typeRef ?? frame.allowedType ?? {};
  const wireFormat = toSdsWireFormat(typeRefInput.wireFormat ?? frame.wireFormat);
  const requiredAlignment = normalizeUnsignedInteger(
    typeRefInput.requiredAlignment ?? frame.requiredAlignment,
  );
  const alignment = Math.max(
    INVOKE_ARENA_ALIGNMENT,
    normalizeUnsignedInteger(frame.alignment),
    requiredAlignment,
  );
  let offset = normalizeUnsignedInteger(frame.offset ?? frame.OFFSET);
  if (
    !hasExplicitFrameOffset(frame) &&
    payload &&
    externalArena &&
    payload.buffer === externalArena.buffer
  ) {
    offset = payload.byteOffset - externalArena.byteOffset;
  }
  const size = normalizeUnsignedInteger(
    frame.size ?? frame.SIZE ?? frame.byteLength ?? payload?.byteLength,
  );
  if (size > 0 && externalArena) {
    if (offset > externalArena.length || size > externalArena.length - offset) {
      throw new Error("SDS PIV external arena frame range exceeds externalArena.");
    }
    const absoluteOffset = externalArena.byteOffset + offset;
    if (alignment > 1 && absoluteOffset % alignment !== 0) {
      throw new Error(
        `SDS PIV external arena frame "${frame.portId ?? ""}" is misaligned: absolute offset ${absoluteOffset} violates alignment ${alignment}.`,
      );
    }
  }
  return new SdsTABT(
    offset,
    size,
    alignment,
    wireFormat,
    toSdsFlatBufferTypeRefT(typeRefInput),
    toSdsMutability(frame.mutability),
    toSdsOwnership(frame.ownership),
    encodeSdsFrameId(frame),
    frame.portId ?? null,
  );
}

function packExternalArenaFrames(frames = [], externalArenaInput) {
  const externalArena = toUint8Array(externalArenaInput);
  if (!externalArena) {
    throw new TypeError(
      "SDS PIV external arena encoding requires externalArena bytes.",
    );
  }
  let arenaAlignment = INVOKE_ARENA_ALIGNMENT;
  const packedFrames = frames.map((frame) => {
    const packedFrame = normalizeExternalArenaFrame(frame, externalArena);
    arenaAlignment = Math.max(arenaAlignment, arenaFrameAlignment(packedFrame));
    return packedFrame;
  });
  return {
    frames: packedFrames,
    arena: new Uint8Array(),
    arenaAlignment,
    externalArena,
  };
}

function decodeSdsTypeRef(typeRef, wireFormat, size, alignment) {
  if (!typeRef) {
    return null;
  }
  return {
    schemaName: typeRef.SCHEMA_NAME() ?? null,
    fileIdentifier: typeRef.FILE_IDENTIFIER() ?? null,
    schemaVersion: typeRef.SCHEMA_VERSION() ?? null,
    wireFormat,
    rootTypeName: typeRef.ROOT_TYPE() ?? null,
    fixedStringLength: 0,
    byteLength: wireFormat === "aligned-binary" ? size : 0,
    requiredAlignment: alignment,
  };
}

function decodeSdsTabFrame(frame) {
  if (!frame) {
    return null;
  }
  const offset = normalizeUnsignedInteger(frame.OFFSET());
  const size = normalizeUnsignedInteger(frame.SIZE());
  const alignment = arenaFrameAlignment({ ALIGNMENT: frame.ALIGNMENT() });
  const wireFormat = fromSdsWireFormat(frame.WIRE_FORMAT());
  const frameId = normalizeBigInt(frame.FRAME_ID());
  const streamFrame = decodeSdsFrameId(frameId);
  return {
    typeRef: decodeSdsTypeRef(frame.TYPE_REF(), wireFormat, size, alignment),
    portId: frame.PORT_ID() ?? null,
    alignment,
    offset,
    size,
    ownership: fromSdsOwnership(frame.OWNERSHIP()),
    generation: 0,
    mutability: fromSdsMutability(frame.MUTABILITY()),
    traceId: frameId,
    streamId: 0,
    sequence: streamFrame.sequence,
    endOfStream: streamFrame.endOfStream,
    wireFormat,
  };
}

function decodeSdsArenaFrames(length, accessor) {
  const frames = [];
  for (let index = 0; index < length; index++) {
    const frame = decodeSdsTabFrame(accessor(index));
    if (frame) {
      frames.push(frame);
    }
  }
  return frames;
}

function materializeSdsArenaFrames(frames = [], arenaBytes, options = {}) {
  const externalArena = toUint8Array(options.externalArena);
  return frames.map((frame) => {
    const offset = arenaFrameOffset(frame);
    const size = arenaFrameSize(frame);
    const sourceArena = arenaBytes.length > 0 ? arenaBytes : externalArena;
    const sourceDescription =
      arenaBytes.length > 0 ? "PAYLOAD_ARENA" : "external arena";
    if (size > 0 && !sourceArena) {
      throw new Error(
        "SDS PIV external arena bytes are required when PAYLOAD_ARENA is empty.",
      );
    }
    if (
      sourceArena &&
      (offset > sourceArena.length || size > sourceArena.length - offset)
    ) {
      throw new Error(`SDS PIV TAB payload range exceeds ${sourceDescription}.`);
    }
    const alignment = arenaFrameAlignment(frame);
    if (sourceArena && alignment > 1 && size > 0) {
      const absoluteOffset = sourceArena.byteOffset + offset;
      if (absoluteOffset % alignment !== 0) {
        throw new Error(
          `SDS PIV TAB "${frame.portId ?? ""}" payload is misaligned: absolute offset ${absoluteOffset} violates alignment ${alignment}.`,
        );
      }
    }
    const payload = sourceArena
      ? sourceArena.subarray(offset, offset + size)
      : new Uint8Array();
    return {
      ...frame,
      payload,
      typeRef: frame.typeRef ?? null,
    };
  });
}

function packFrameOffsets(builder, frames) {
  return frames.map((frame) => frame.pack(builder));
}

export function encodePluginInvokeRequest(request = {}) {
  const inputFrames = Array.isArray(request.inputs)
    ? request.inputs
    : request.inputFrames ?? [];
  const { frames, arena, arenaAlignment } =
    request.externalArena !== undefined
      ? packExternalArenaFrames(inputFrames, request.externalArena)
      : packArenaFrames(inputFrames);
  const builder = new flatbuffers.Builder(1024);
  const methodIdOffset =
    request.methodId !== null && request.methodId !== undefined
      ? builder.createString(String(request.methodId))
      : 0;
  const framesVector = PIVRequest.createInputsVector(
    builder,
    packFrameOffsets(builder, frames),
  );
  const arenaVector = createAlignedByteVector(builder, arena, arenaAlignment);
  PIVRequest.startPIVRequest(builder);
  PIVRequest.addMethodId(builder, methodIdOffset);
  PIVRequest.addInputs(builder, framesVector);
  PIVRequest.addPayloadArena(builder, arenaVector);
  PIVRequest.addTraceId(builder, normalizeBigInt(request.traceId));
  PIVRequest.addOutputStreamCap(
    builder,
    normalizeUnsignedInteger(request.outputStreamCap),
  );
  const requestOffset = PIVRequest.endPIVRequest(builder);
  PIV.startPIV(builder);
  PIV.addRequest(builder, requestOffset);
  PIV.finishPIVBuffer(builder, PIV.endPIV(builder));
  const bytes = builder.asUint8Array();
  const root = PIV.getRootAsPIV(new flatbuffers.ByteBuffer(bytes));
  assertAlignedInvokeBuffer(
    bytes,
    root.REQUEST()?.payloadArenaArray(),
    "request",
    arenaAlignment,
  );
  return bytes;
}

export function decodePluginInvokeRequest(data, options = {}) {
  const bb = toByteBuffer(data);
  if (!PIV.bufferHasIdentifier(bb)) {
    throw new Error("SDS PIV invoke request buffer identifier mismatch.");
  }
  const root = PIV.getRootAsPIV(bb);
  const request = root.REQUEST();
  if (!request) {
    throw new Error("SDS PIV invoke envelope does not contain a request.");
  }
  const arena = request.payloadArenaArray() ?? new Uint8Array();
  const inputFrames = decodeSdsArenaFrames(request.inputsLength(), (index) =>
    request.INPUTS(index),
  );
  const inputs = materializeSdsArenaFrames(inputFrames, arena, options);
  return {
    methodId: request.METHOD_ID() ?? null,
    inputFrames: inputs,
    inputs,
    payloadArena: arena,
    traceId: request.TRACE_ID() ?? BigInt(0),
    outputStreamCap: request.OUTPUT_STREAM_CAP() ?? 0,
    envelope: "PIV",
  };
}

function resolvePivStatus(response = {}) {
  if (response.status !== undefined) {
    return response.status;
  }
  if (response.yielded === true) {
    return SdsPivStatus.YIELDED;
  }
  if (Number(response.statusCode ?? 0) !== 0 || response.errorCode) {
    return SdsPivStatus.FAILED;
  }
  return SdsPivStatus.OK;
}

export function encodePluginInvokeResponse(response = {}) {
  const outputFrames = Array.isArray(response.outputs)
    ? response.outputs
    : response.outputFrames ?? [];
  const { frames, arena, arenaAlignment } =
    response.externalArena !== undefined
      ? packExternalArenaFrames(outputFrames, response.externalArena)
      : packArenaFrames(outputFrames);
  const builder = new flatbuffers.Builder(1024);
  const errorCodeOffset =
    response.errorCode !== null && response.errorCode !== undefined
      ? builder.createString(String(response.errorCode))
      : 0;
  const errorMessageOffset =
    response.errorMessage !== null && response.errorMessage !== undefined
      ? builder.createString(String(response.errorMessage))
      : 0;
  const framesVector = PIVResponse.createOutputsVector(
    builder,
    packFrameOffsets(builder, frames),
  );
  const arenaVector = createAlignedByteVector(builder, arena, arenaAlignment);
  PIVResponse.startPIVResponse(builder);
  PIVResponse.addStatusCode(builder, Number(response.statusCode ?? 0));
  PIVResponse.addStatus(builder, resolvePivStatus(response));
  PIVResponse.addYielded(builder, response.yielded === true);
  PIVResponse.addBacklogRemaining(
    builder,
    normalizeUnsignedInteger(response.backlogRemaining),
  );
  PIVResponse.addOutputs(builder, framesVector);
  PIVResponse.addPayloadArena(builder, arenaVector);
  PIVResponse.addErrorCode(builder, errorCodeOffset);
  PIVResponse.addErrorMessage(builder, errorMessageOffset);
  PIVResponse.addTraceId(builder, normalizeBigInt(response.traceId));
  const responseOffset = PIVResponse.endPIVResponse(builder);
  PIV.startPIV(builder);
  PIV.addResponse(builder, responseOffset);
  PIV.finishPIVBuffer(builder, PIV.endPIV(builder));
  const bytes = builder.asUint8Array();
  const root = PIV.getRootAsPIV(new flatbuffers.ByteBuffer(bytes));
  assertAlignedInvokeBuffer(
    bytes,
    root.RESPONSE()?.payloadArenaArray(),
    "response",
    arenaAlignment,
  );
  return bytes;
}

export function decodePluginInvokeResponse(data, options = {}) {
  const bb = toByteBuffer(data);
  if (!PIV.bufferHasIdentifier(bb)) {
    throw new Error("SDS PIV invoke response buffer identifier mismatch.");
  }
  const root = PIV.getRootAsPIV(bb);
  const response = root.RESPONSE();
  if (!response) {
    throw new Error("SDS PIV invoke envelope does not contain a response.");
  }
  const arena = response.payloadArenaArray() ?? new Uint8Array();
  const outputFrames = decodeSdsArenaFrames(response.outputsLength(), (index) =>
    response.OUTPUTS(index),
  );
  const outputs = materializeSdsArenaFrames(outputFrames, arena, options);
  return {
    statusCode: response.STATUS_CODE() ?? 0,
    status: response.STATUS() ?? SdsPivStatus.OK,
    yielded: response.YIELDED() === true,
    backlogRemaining: response.BACKLOG_REMAINING() ?? 0,
    outputFrames: outputs,
    outputs,
    payloadArena: arena,
    errorCode: response.ERROR_CODE() ?? null,
    errorMessage: response.ERROR_MESSAGE() ?? null,
    traceId: response.TRACE_ID() ?? BigInt(0),
    envelope: "PIV",
  };
}

/**
 * Forward a decoded output frame of one module invocation directly as an input
 * frame for the next invocation. The returned descriptor references the same
 * payload bytes, so no payload decode or re-serialization happens on the hop.
 */
export function forwardOutputFrameAsInput(outputFrame, overrides = {}) {
  if (!outputFrame || typeof outputFrame !== "object") {
    throw new TypeError(
      "forwardOutputFrameAsInput requires a decoded output frame.",
    );
  }
  const payload = toUint8Array(outputFrame.payload);
  if (!payload) {
    throw new TypeError(
      "forwardOutputFrameAsInput requires an output frame with payload bytes.",
    );
  }
  const portId = overrides.portId ?? outputFrame.portId ?? null;
  if (!portId) {
    throw new TypeError(
      "forwardOutputFrameAsInput requires a portId (from the frame or overrides).",
    );
  }
  return {
    portId,
    payload,
    typeRef: overrides.typeRef ?? outputFrame.typeRef ?? null,
    alignment:
      overrides.alignment ??
      (outputFrame.alignment > 0 ? outputFrame.alignment : undefined),
    generation: overrides.generation ?? outputFrame.generation,
    traceId: overrides.traceId ?? outputFrame.traceId,
    streamId: overrides.streamId ?? outputFrame.streamId,
    sequence: overrides.sequence ?? outputFrame.sequence,
    endOfStream:
      overrides.endOfStream ?? (outputFrame.endOfStream === true || undefined),
  };
}

export function normalizeInvokeSurfaceName(value) {
  if (value === InvokeSurface.COMMAND || value === "command") {
    return "command";
  }
  if (value === InvokeSurface.DIRECT || value === "direct") {
    return "direct";
  }
  return null;
}

export function normalizeInvokeSurfaces(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const surfaces = [];
  for (const entry of value) {
    const normalized = normalizeInvokeSurfaceName(entry);
    if (normalized && !surfaces.includes(normalized)) {
      surfaces.push(normalized);
    }
  }
  return surfaces;
}
