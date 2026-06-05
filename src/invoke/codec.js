import * as flatbuffers from "../vendor/flatbuffers/flatbuffers.js";

import {
  PluginInvokeRequest,
  PluginInvokeRequestT,
} from "../generated/orbpro/invoke/plugin-invoke-request.js";
import {
  PluginInvokeResponse,
  PluginInvokeResponseT,
} from "../generated/orbpro/invoke/plugin-invoke-response.js";
import { InvokeSurface } from "../generated/orbpro/manifest/invoke-surface.js";
import { BufferMutability } from "../generated/orbpro/stream/buffer-mutability.js";
import { BufferOwnership } from "../generated/orbpro/stream/buffer-ownership.js";
import { FlatBufferTypeRefT } from "../generated/orbpro/stream/flat-buffer-type-ref.js";
import { PayloadWireFormat } from "../generated/orbpro/stream/payload-wire-format.js";
import { TypedArenaBufferT } from "../generated/orbpro/stream/typed-arena-buffer.js";
import { toUint8Array } from "../runtime/bufferLike.js";

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

function normalizeSchemaHash(value) {
  if (!value) {
    return [];
  }
  if (value instanceof Uint8Array) {
    return Array.from(value);
  }
  if (ArrayBuffer.isView(value)) {
    return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (Array.isArray(value)) {
    return value.map((byte) => Number(byte) & 0xff);
  }
  const normalized = String(value).trim().replace(/^0x/i, "");
  if (!normalized || normalized.length % 2 !== 0) {
    return [];
  }
  const bytes = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(parseInt(normalized.slice(index, index + 2), 16));
  }
  return bytes;
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
  if (value === 1 || value === "aligned-binary") {
    return "aligned-binary";
  }
  return "flatbuffer";
}

function payloadWireFormatName(value) {
  return value === PayloadWireFormat.ALIGNED_BINARY
    ? "aligned-binary"
    : "flatbuffer";
}

function toFlatBufferTypeRefT(value = {}, payloadLength = 0) {
  if (value instanceof FlatBufferTypeRefT) {
    return value;
  }
  const wireFormat = normalizePayloadWireFormat(value.wireFormat);
  const requiredAlignment = normalizeUnsignedInteger(value.requiredAlignment);
  const fixedStringLength = normalizeUnsignedInteger(value.fixedStringLength);
  const byteLength =
    wireFormat === "aligned-binary"
      ? normalizeUnsignedInteger(value.byteLength, payloadLength)
      : normalizeUnsignedInteger(value.byteLength);
  return new FlatBufferTypeRefT(
    value.schemaName ?? null,
    value.fileIdentifier ?? null,
    normalizeSchemaHash(value.schemaHash),
    value.acceptsAnyFlatbuffer === true,
    wireFormat,
    value.rootTypeName ?? null,
    fixedStringLength,
    byteLength,
    requiredAlignment,
  );
}

function alignOffset(offset, alignment) {
  if (alignment <= 1) {
    return offset;
  }
  const remainder = offset % alignment;
  return remainder === 0 ? offset : offset + alignment - remainder;
}

function normalizeArenaFrame(frame = {}, offset) {
  const payload = toUint8Array(frame.payload ?? new Uint8Array()) ?? new Uint8Array();
  const typeRef = toFlatBufferTypeRefT(frame.typeRef ?? frame.allowedType ?? {}, payload.length);
  const alignment = Math.max(
    1,
    normalizeUnsignedInteger(
      frame.alignment,
      typeRef.requiredAlignment > 0 ? typeRef.requiredAlignment : 8,
    ),
  );
  const alignedOffset = alignOffset(offset, alignment);
  return {
    payload,
    padding: alignedOffset - offset,
    buffer: new TypedArenaBufferT(
      typeRef,
      frame.portId ?? null,
      alignment,
      alignedOffset,
      payload.length,
      frame.ownership ?? BufferOwnership.BORROWED,
      normalizeUnsignedInteger(frame.generation),
      frame.mutability ?? BufferMutability.IMMUTABLE,
      normalizeBigInt(frame.traceId),
      normalizeUnsignedInteger(frame.streamId),
      normalizeBigInt(frame.sequence),
      frame.endOfStream === true,
    ),
  };
}

function packArenaFrames(frames = []) {
  const packedFrames = [];
  const normalizedFrames = [];
  let offset = 0;
  for (const frame of frames) {
    const normalized = normalizeArenaFrame(frame, offset);
    offset = normalized.buffer.offset + normalized.buffer.size;
    packedFrames.push(normalized.buffer);
    normalizedFrames.push(normalized);
  }

  const arena = new Uint8Array(offset);
  for (const normalized of normalizedFrames) {
    arena.set(normalized.payload, normalized.buffer.offset);
  }
  return {
    frames: packedFrames,
    arena,
  };
}

function materializeArenaFrames(frames = [], arenaBytes) {
  return frames.map((frame) => {
    const offset = normalizeUnsignedInteger(frame.offset);
    const size = normalizeUnsignedInteger(frame.size);
    const payload = arenaBytes.subarray(offset, offset + size);
    return {
      ...frame,
      payload,
      typeRef: frame.typeRef ?? null,
    };
  });
}

function decodeFlatBufferTypeRef(typeRef) {
  if (!typeRef) {
    return null;
  }
  return {
    schemaName: typeRef.schemaName(),
    fileIdentifier: typeRef.fileIdentifier(),
    schemaHash: Array.from(typeRef.schemaHashArray() ?? []),
    acceptsAnyFlatbuffer: typeRef.acceptsAnyFlatbuffer(),
    wireFormat: payloadWireFormatName(typeRef.wireFormat()),
    rootTypeName: typeRef.rootTypeName(),
    fixedStringLength: typeRef.fixedStringLength(),
    byteLength: typeRef.byteLength(),
    requiredAlignment: typeRef.requiredAlignment(),
  };
}

function decodeTypedArenaBuffer(frame) {
  if (!frame) {
    return null;
  }
  return {
    typeRef: decodeFlatBufferTypeRef(frame.typeRef()),
    portId: frame.portId(),
    alignment: frame.alignment(),
    offset: frame.offset(),
    size: frame.size(),
    ownership: frame.ownership(),
    generation: frame.generation(),
    mutability: frame.mutability(),
    traceId: frame.traceId(),
    streamId: frame.streamId(),
    sequence: frame.sequence(),
    endOfStream: frame.endOfStream(),
  };
}

function decodeArenaFrames(length, accessor) {
  const frames = [];
  for (let index = 0; index < length; index++) {
    const frame = decodeTypedArenaBuffer(accessor(index));
    if (frame) {
      frames.push(frame);
    }
  }
  return frames;
}

function encodeRoot(builderFactory, finish, value) {
  const builder = new flatbuffers.Builder(1024);
  finish(builder, builderFactory(value).pack(builder));
  return builder.asUint8Array();
}

export function encodePluginInvokeRequest(request = {}) {
  const { frames, arena } = packArenaFrames(
    Array.isArray(request.inputs) ? request.inputs : request.inputFrames ?? [],
  );
  return encodeRoot(
    (value) =>
      new PluginInvokeRequestT(value.methodId ?? null, frames, arena),
    PluginInvokeRequest.finishPluginInvokeRequestBuffer,
    request,
  );
}

export function decodePluginInvokeRequest(data) {
  const bb = toByteBuffer(data);
  if (!PluginInvokeRequest.bufferHasIdentifier(bb)) {
    throw new Error("Plugin invoke request buffer identifier mismatch.");
  }
  const root = PluginInvokeRequest.getRootAsPluginInvokeRequest(bb);
  const arena = root.payloadArenaArray() ?? new Uint8Array();
  const inputFrames = decodeArenaFrames(root.inputFramesLength(), (index) =>
    root.inputFrames(index),
  );
  const inputs = materializeArenaFrames(inputFrames, arena);
  return {
    methodId: root.methodId() ?? null,
    inputFrames: inputs,
    inputs,
    payloadArena: arena,
  };
}

export function encodePluginInvokeResponse(response = {}) {
  const { frames, arena } = packArenaFrames(
    Array.isArray(response.outputs) ? response.outputs : response.outputFrames ?? [],
  );
  return encodeRoot(
    (value) =>
      new PluginInvokeResponseT(
        Number(value.statusCode ?? 0),
        value.yielded === true,
        normalizeUnsignedInteger(value.backlogRemaining),
        frames,
        arena,
        value.errorCode ?? null,
        value.errorMessage ?? null,
      ),
    PluginInvokeResponse.finishPluginInvokeResponseBuffer,
    response,
  );
}

export function decodePluginInvokeResponse(data) {
  const bb = toByteBuffer(data);
  if (!PluginInvokeResponse.bufferHasIdentifier(bb)) {
    throw new Error("Plugin invoke response buffer identifier mismatch.");
  }
  const root = PluginInvokeResponse.getRootAsPluginInvokeResponse(bb);
  const arena = root.payloadArenaArray() ?? new Uint8Array();
  const outputFrames = decodeArenaFrames(root.outputFramesLength(), (index) =>
    root.outputFrames(index),
  );
  const outputs = materializeArenaFrames(outputFrames, arena);
  return {
    statusCode: root.statusCode() ?? 0,
    yielded: root.yielded() === true,
    backlogRemaining: root.backlogRemaining() ?? 0,
    outputFrames: outputs,
    outputs,
    payloadArena: arena,
    errorCode: root.errorCode() ?? null,
    errorMessage: root.errorMessage() ?? null,
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
