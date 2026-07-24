import * as flatbuffers from "../vendor/flatbuffers/flatbuffers.js";

import { InvokeSurface } from "../generated/orbpro/manifest/invoke-surface.js";
import { BufferMutability } from "../generated/orbpro/stream/buffer-mutability.js";
import { BufferOwnership } from "../generated/orbpro/stream/buffer-ownership.js";
import {
  isPayloadSchemaHashValid,
  normalizePayloadSchemaHash,
} from "../manifest/typeRefs.js";
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

const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;
const arenaLeaseStates = new WeakMap();
const arenaTransferStates = new WeakMap();
const arenaForwardingReceipts = new WeakMap();

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function readBoundedInteger(value, description, options = {}) {
  const {
    defaultValue,
    minimum = 0,
    maximum = Number.MAX_SAFE_INTEGER,
  } = options;
  if (value === undefined || value === null || value === "") {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new TypeError(`${description} is required.`);
  }
  let normalized;
  if (typeof value === "bigint") {
    if (value < BigInt(minimum) || value > BigInt(maximum)) {
      throw new RangeError(
        `${description} must be an integer between ${minimum} and ${maximum}.`,
      );
    }
    normalized = Number(value);
  } else {
    normalized = typeof value === "number" ? value : Number(value);
  }
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < minimum ||
    normalized > maximum
  ) {
    throw new RangeError(
      `${description} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return normalized;
}

function isPositivePowerOfTwo(value) {
  return value > 0 && Number.isInteger(Math.log2(value));
}

function readAlignment(value, description, options = {}) {
  const alignment = readBoundedInteger(value, description, {
    defaultValue: options.defaultValue,
    minimum: 0,
    maximum: options.maximum ?? UINT32_MAX,
  });
  if (!isPositivePowerOfTwo(alignment)) {
    throw new RangeError(`${description} must be a positive power of two.`);
  }
  return alignment;
}

function assertUint32FrameRange(offset, size, description) {
  if (offset > UINT32_MAX - size) {
    throw new RangeError(
      `${description} offset + size exceeds the uint32 address range.`,
    );
  }
}

function assertViewWithinArena(view, arena, description) {
  if (
    view.buffer !== arena.buffer ||
    view.byteOffset < arena.byteOffset ||
    view.byteOffset + view.byteLength > arena.byteOffset + arena.byteLength
  ) {
    throw new Error(`${description} is outside its arena lease.`);
  }
}

function requireArenaLeaseState(lease) {
  const state = arenaLeaseStates.get(lease);
  if (!state) {
    throw new TypeError("SDS PIV/TAB arena lease is invalid.");
  }
  return state;
}

function assertLiveArenaLease(lease, generation, payload, description) {
  const state = requireArenaLeaseState(lease);
  if (state.closed) {
    throw new Error(`${description} arena lease is closed.`);
  }
  if (generation !== state.generation) {
    throw new Error(
      `${description} has stale arena lease generation ${String(generation)}; active generation is ${state.generation}.`,
    );
  }
  if (payload) {
    assertViewWithinArena(payload, state.arena, description);
  }
  return state;
}

function assertFrameArenaLease(frame, description, options = {}) {
  const lease = frame?.arenaLease;
  if (!lease) {
    if (options.required === true) {
      throw new Error(`${description} requires a live arena lease.`);
    }
    return null;
  }
  const payload = toUint8Array(frame.payload);
  const generation = firstDefined(frame.generation, frame.arenaGeneration);
  return assertLiveArenaLease(lease, generation, payload, description);
}

function assertRetainedAliasSafe(frame, description) {
  const leaseState = assertFrameArenaLease(frame, description);
  if (!leaseState) {
    return null;
  }
  const ownership = normalizeFrameOwnership(frame.ownership);
  const mutability = normalizeFrameMutability(frame.mutability);
  if (
    ownership === BufferOwnership.PRODUCER_OWNED ||
    mutability !== BufferMutability.IMMUTABLE
  ) {
    const payload = toUint8Array(frame.payload);
    const generation = firstDefined(frame.generation, frame.arenaGeneration);
    const receipt = arenaForwardingReceipts.get(frame);
    if (
      receipt &&
      ownership === BufferOwnership.SHARED &&
      receipt.lease === frame.arenaLease &&
      receipt.generation === generation &&
      receipt.payloadBuffer === payload?.buffer &&
      receipt.payloadByteOffset === payload?.byteOffset &&
      receipt.payloadByteLength === payload?.byteLength &&
      receipt.frameId === encodeSdsFrameId(frame) &&
      receipt.ownership === ownership &&
      receipt.mutability === mutability
    ) {
      return leaseState;
    }
    throw new Error(
      `${description} producer-owned or mutable cross-invocation alias requires explicit compatible transfer forwarding.`,
    );
  }
  return leaseState;
}

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
  if (
    value === undefined ||
    value === null ||
    value === 0 ||
    normalized === "" ||
    normalized === "flatbuffer"
  ) {
    return "flatbuffer";
  }
  throw new TypeError(`Unsupported SDS PIV/TAB wire format: ${String(value)}.`);
}

function toSdsWireFormat(value) {
  return normalizePayloadWireFormat(value) === "aligned-binary"
    ? SdsPayloadWireFormat.ALIGNED_BINARY
    : SdsPayloadWireFormat.FLATBUFFER;
}

function fromSdsWireFormat(value) {
  if (value === SdsPayloadWireFormat.ALIGNED_BINARY) {
    return "aligned-binary";
  }
  if (value === SdsPayloadWireFormat.FLATBUFFER) {
    return "flatbuffer";
  }
  throw new TypeError(`Unsupported SDS PIV/TAB wire format value: ${value}.`);
}

function toSdsMutability(value) {
  if (
    value === undefined ||
    value === null ||
    value === BufferMutability.IMMUTABLE ||
    value === "immutable" ||
    value === "IMMUTABLE"
  ) {
    return SdsBufferMutability.IMMUTABLE;
  }
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
  throw new TypeError(`Unsupported SDS PIV/TAB mutability: ${String(value)}.`);
}

function fromSdsMutability(value) {
  if (value === SdsBufferMutability.APPEND_ONLY) {
    return BufferMutability.APPEND_ONLY;
  }
  if (value === SdsBufferMutability.SINGLE_WRITER_MUTABLE) {
    return BufferMutability.MUTABLE;
  }
  if (value === SdsBufferMutability.IMMUTABLE) {
    return BufferMutability.IMMUTABLE;
  }
  throw new TypeError(`Unsupported SDS PIV/TAB mutability value: ${value}.`);
}

function toSdsOwnership(value) {
  if (
    value === undefined ||
    value === null ||
    value === BufferOwnership.BORROWED ||
    value === BufferOwnership.HOST_OWNED ||
    value === "borrowed" ||
    value === "BORROWED" ||
    value === "host-owned" ||
    value === "host_owned" ||
    value === "HOST_OWNED"
  ) {
    return SdsBufferOwnership.HOST_OWNED;
  }
  if (
    value === BufferOwnership.PRODUCER_OWNED ||
    value === "producer-owned" ||
    value === "producer_owned" ||
    value === "PRODUCER_OWNED" ||
    value === "plugin-owned" ||
    value === "plugin_owned" ||
    value === "PLUGIN_OWNED"
  ) {
    return SdsBufferOwnership.PLUGIN_OWNED;
  }
  if (
    value === BufferOwnership.SHARED ||
    value === "shared" ||
    value === "SHARED" ||
    value === "transferred" ||
    value === "TRANSFERRED"
  ) {
    return SdsBufferOwnership.TRANSFERRED;
  }
  throw new TypeError(`Unsupported SDS PIV/TAB ownership: ${String(value)}.`);
}

function fromSdsOwnership(value) {
  if (value === SdsBufferOwnership.PLUGIN_OWNED) {
    return BufferOwnership.PRODUCER_OWNED;
  }
  if (value === SdsBufferOwnership.TRANSFERRED) {
    return BufferOwnership.SHARED;
  }
  if (value === SdsBufferOwnership.HOST_OWNED) {
    return BufferOwnership.HOST_OWNED;
  }
  throw new TypeError(`Unsupported SDS PIV/TAB ownership value: ${value}.`);
}

function normalizeFrameMutability(value) {
  return fromSdsMutability(toSdsMutability(value));
}

function normalizeFrameOwnership(value) {
  return fromSdsOwnership(toSdsOwnership(value));
}

function toSdsFlatBufferTypeRefT(value = {}, wireFormat = undefined) {
  const schemaHashInput = firstDefined(value.schemaHash, value.SCHEMA_HASH);
  if (!isPayloadSchemaHashValid(schemaHashInput)) {
    throw new TypeError("SDS PIV/TAB schemaHash must contain valid bytes or hex.");
  }
  const normalizedWireFormat = normalizePayloadWireFormat(
    firstDefined(value.wireFormat, value.WIRE_FORMAT, wireFormat),
  );
  return new SdsFlatBufferTypeRefT(
    value.schemaName ?? value.SCHEMA_NAME ?? null,
    value.fileIdentifier ?? value.FILE_IDENTIFIER ?? null,
    value.schemaVersion ?? value.SCHEMA_VERSION ?? null,
    value.rootTypeName ?? value.rootType ?? value.ROOT_TYPE ?? null,
    normalizePayloadSchemaHash(schemaHashInput) ?? [],
    Boolean(value.acceptsAnyFlatbuffer ?? value.ACCEPTS_ANY_FLATBUFFER ?? false),
    toSdsWireFormat(normalizedWireFormat),
    readBoundedInteger(
      firstDefined(value.fixedStringLength, value.FIXED_STRING_LENGTH),
      "SDS PIV/TAB fixedStringLength",
      { defaultValue: 0, maximum: UINT16_MAX },
    ),
    readBoundedInteger(
      firstDefined(value.byteLength, value.BYTE_LENGTH),
      "SDS PIV/TAB byteLength",
      { defaultValue: 0, maximum: UINT32_MAX },
    ),
    readBoundedInteger(
      firstDefined(value.requiredAlignment, value.REQUIRED_ALIGNMENT),
      "SDS PIV/TAB requiredAlignment",
      { defaultValue: 0, maximum: UINT16_MAX },
    ),
  );
}

function normalizeFrameTypeRef(frame = {}) {
  const typeRefInput = frame.typeRef ?? frame.allowedType ?? {};
  const frameWireFormatInput = firstDefined(frame.wireFormat, frame.WIRE_FORMAT);
  const typeWireFormatInput = firstDefined(
    typeRefInput.wireFormat,
    typeRefInput.WIRE_FORMAT,
  );
  const wireFormat = normalizePayloadWireFormat(
    firstDefined(typeWireFormatInput, frameWireFormatInput),
  );
  if (
    typeWireFormatInput !== undefined &&
    frameWireFormatInput !== undefined &&
    normalizePayloadWireFormat(typeWireFormatInput) !==
      normalizePayloadWireFormat(frameWireFormatInput)
  ) {
    throw new Error("SDS PIV/TAB frame and typeRef wire formats disagree.");
  }
  const typeRef = toSdsFlatBufferTypeRefT(typeRefInput, wireFormat);
  if (wireFormat === "aligned-binary") {
    typeRef.REQUIRED_ALIGNMENT = readAlignment(
      typeRef.REQUIRED_ALIGNMENT,
      "SDS PIV/TAB aligned type requiredAlignment",
      { maximum: UINT16_MAX },
    );
    typeRef.BYTE_LENGTH = readBoundedInteger(
      typeRef.BYTE_LENGTH,
      "SDS PIV/TAB aligned type byteLength",
      { minimum: 1, maximum: UINT32_MAX },
    );
  } else if (
    typeRef.REQUIRED_ALIGNMENT > 0 &&
    !isPositivePowerOfTwo(typeRef.REQUIRED_ALIGNMENT)
  ) {
    throw new RangeError(
      "SDS PIV/TAB type requiredAlignment must be a positive power of two when declared.",
    );
  }
  return { typeRef, wireFormat };
}

function resolveFrameAlignment(frame, requiredAlignment) {
  const declared = firstDefined(frame?.alignment, frame?.ALIGNMENT);
  const alignment = readAlignment(
    declared,
    "SDS PIV/TAB frame alignment",
    {
      defaultValue: Math.max(INVOKE_ARENA_ALIGNMENT, requiredAlignment || 1),
    },
  );
  if (alignment < requiredAlignment) {
    throw new RangeError(
      `SDS PIV/TAB frame alignment ${alignment} is below required alignment ${requiredAlignment}.`,
    );
  }
  return alignment;
}

function assertAlignedFrameSize(wireFormat, typeRef, size) {
  if (wireFormat !== "aligned-binary") {
    return;
  }
  if (size !== typeRef.BYTE_LENGTH) {
    throw new RangeError(
      `SDS PIV/TAB aligned payload size ${size} does not match declared byteLength ${typeRef.BYTE_LENGTH}.`,
    );
  }
}

function encodeSdsFrameId(frame = {}) {
  if (frame.frameId !== undefined && frame.frameId !== null) {
    return normalizeBigInt(frame.frameId);
  }
  if (
    frame.sequence !== undefined ||
    frame.endOfStream !== undefined ||
    frame.endOfStream === true
  ) {
    const sequence = normalizeBigInt(frame.sequence);
    return (sequence << BigInt(1)) | (frame.endOfStream === true ? BigInt(1) : BigInt(0));
  }
  return normalizeBigInt(frame.traceId);
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
  return readBoundedInteger(
    firstDefined(frame?.offset, frame?.OFFSET),
    "SDS PIV/TAB frame offset",
    { defaultValue: 0, maximum: UINT32_MAX },
  );
}

function arenaFrameSize(frame) {
  return readBoundedInteger(
    firstDefined(frame?.size, frame?.SIZE),
    "SDS PIV/TAB frame size",
    { defaultValue: 0, maximum: UINT32_MAX },
  );
}

function arenaFrameAlignment(frame) {
  return readAlignment(
    firstDefined(frame?.alignment, frame?.ALIGNMENT),
    "SDS PIV/TAB frame alignment",
    { defaultValue: INVOKE_ARENA_ALIGNMENT },
  );
}

function normalizeSdsArenaFrame(frame = {}, offset) {
  const payload = toUint8Array(frame.payload ?? new Uint8Array()) ?? new Uint8Array();
  assertRetainedAliasSafe(frame, "SDS PIV/TAB frame forwarding");
  const { typeRef, wireFormat } = normalizeFrameTypeRef(frame);
  const requiredAlignment = typeRef.REQUIRED_ALIGNMENT;
  const alignment = resolveFrameAlignment(frame, requiredAlignment);
  assertAlignedFrameSize(wireFormat, typeRef, payload.length);
  const alignedOffset = alignOffset(offset, alignment);
  assertUint32FrameRange(alignedOffset, payload.length, "SDS PIV/TAB frame");
  return {
    payload,
    padding: alignedOffset - offset,
    buffer: new SdsTABT(
      alignedOffset,
      payload.length,
      alignment,
      toSdsWireFormat(wireFormat),
      typeRef,
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
 * Create an application-blind lifetime token for an arena view. Decoded PIV
 * envelopes create one automatically; hosts can also create one explicitly
 * for external/shared arenas. Advancing or closing the lease invalidates every
 * frame that captured an older generation.
 */
export function createInvokeArenaLease(arenaInput, options = {}) {
  const arena = toUint8Array(arenaInput);
  if (!arena) {
    throw new TypeError(
      "createInvokeArenaLease requires Uint8Array-compatible arena bytes.",
    );
  }
  const state = {
    arena,
    generation: readBoundedInteger(
      options.generation,
      "SDS PIV/TAB arena lease generation",
      { defaultValue: 1, maximum: UINT32_MAX },
    ),
    closed: false,
  };
  const lease = {
    get arena() {
      return state.arena;
    },
    get generation() {
      return state.generation;
    },
    get closed() {
      return state.closed;
    },
    advance(nextArenaInput = undefined) {
      if (state.closed) {
        throw new Error("SDS PIV/TAB arena lease is closed.");
      }
      if (state.generation >= UINT32_MAX) {
        throw new RangeError(
          "SDS PIV/TAB arena lease generation exceeds the uint32 range.",
        );
      }
      if (nextArenaInput !== undefined) {
        const nextArena = toUint8Array(nextArenaInput);
        if (!nextArena) {
          throw new TypeError(
            "SDS PIV/TAB arena lease advance requires Uint8Array-compatible bytes.",
          );
        }
        state.arena = nextArena;
      }
      state.generation += 1;
      return state.generation;
    },
    close() {
      state.closed = true;
    },
    createTransferToken(frame, transferOptions = {}) {
      const frameState = assertFrameArenaLease(
        frame,
        "SDS PIV/TAB arena transfer",
        { required: true },
      );
      if (frameState !== state || frame.arenaLease !== lease) {
        throw new Error(
          "SDS PIV/TAB arena transfer frame belongs to a different lease.",
        );
      }
      const ownership = normalizeFrameOwnership(
        transferOptions.ownership ?? "transferred",
      );
      if (ownership !== BufferOwnership.SHARED) {
        throw new Error(
          "SDS PIV/TAB arena transfer ownership must be transferred/shared.",
        );
      }
      const mutability = normalizeFrameMutability(
        transferOptions.mutability ?? frame.mutability,
      );
      const payload = toUint8Array(frame.payload);
      const token = Object.freeze({});
      arenaTransferStates.set(token, {
        lease,
        generation: state.generation,
        payloadBuffer: payload.buffer,
        payloadByteOffset: payload.byteOffset,
        payloadByteLength: payload.byteLength,
        frameId: encodeSdsFrameId(frame),
        ownership,
        mutability,
        consumed: false,
      });
      return token;
    },
  };
  arenaLeaseStates.set(lease, state);
  return Object.freeze(lease);
}

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

function arenaBackedBuilder(arenaInput, description) {
  const arena = toUint8Array(arenaInput);
  if (!arena || arena.byteLength <= 0) {
    throw new TypeError(`${description} requires a non-empty Uint8Array arena.`);
  }
  const builder = new flatbuffers.Builder(1);
  builder.bb = new flatbuffers.ByteBuffer(arena);
  builder.space = arena.byteLength;
  builder.clear();
  builder.bb = new flatbuffers.ByteBuffer(arena);
  builder.space = arena.byteLength;
  return builder;
}

function withFixedBuilderArena(callback, description) {
  const previousGrow = flatbuffers.Builder.growByteBuffer;
  try {
    flatbuffers.Builder.growByteBuffer = () => {
      throw new Error(`${description} arena is too small.`);
    };
    return callback();
  } finally {
    flatbuffers.Builder.growByteBuffer = previousGrow;
  }
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
  const leaseState = assertRetainedAliasSafe(
    frame,
    "SDS PIV/TAB external frame forwarding",
  );
  if (leaseState && externalArena) {
    assertViewWithinArena(
      externalArena,
      leaseState.arena,
      "SDS PIV/TAB external arena",
    );
  }
  const { typeRef, wireFormat } = normalizeFrameTypeRef(frame);
  const alignment = resolveFrameAlignment(frame, typeRef.REQUIRED_ALIGNMENT);
  let offset = readBoundedInteger(
    firstDefined(frame.offset, frame.OFFSET),
    "SDS PIV/TAB external arena frame offset",
    { defaultValue: 0, maximum: UINT32_MAX },
  );
  if (
    !hasExplicitFrameOffset(frame) &&
    payload &&
    externalArena &&
    payload.buffer === externalArena.buffer
  ) {
    offset = payload.byteOffset - externalArena.byteOffset;
  }
  const size = readBoundedInteger(
    firstDefined(frame.size, frame.SIZE, frame.byteLength, payload?.byteLength),
    "SDS PIV/TAB external arena frame size",
    { defaultValue: 0, maximum: UINT32_MAX },
  );
  assertUint32FrameRange(offset, size, "SDS PIV/TAB external arena frame");
  assertAlignedFrameSize(wireFormat, typeRef, size);
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
    toSdsWireFormat(wireFormat),
    typeRef,
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

function decodeSdsTypeRef(typeRef) {
  if (!typeRef) {
    return null;
  }
  const schemaHash = typeRef.schemaHashArray?.() ?? new Uint8Array();
  return {
    schemaName: typeRef.SCHEMA_NAME() ?? null,
    fileIdentifier: typeRef.FILE_IDENTIFIER() ?? null,
    schemaVersion: typeRef.SCHEMA_VERSION() ?? null,
    schemaHash:
      schemaHash.byteLength > 0 ? new Uint8Array(schemaHash) : undefined,
    acceptsAnyFlatbuffer: typeRef.ACCEPTS_ANY_FLATBUFFER?.() === true,
    wireFormat: fromSdsWireFormat(typeRef.WIRE_FORMAT()),
    rootTypeName: typeRef.ROOT_TYPE() ?? null,
    fixedStringLength: readBoundedInteger(
      typeRef.FIXED_STRING_LENGTH(),
      "SDS PIV/TAB decoded fixedStringLength",
      { defaultValue: 0, maximum: UINT16_MAX },
    ),
    byteLength: readBoundedInteger(
      typeRef.BYTE_LENGTH(),
      "SDS PIV/TAB decoded byteLength",
      { defaultValue: 0, maximum: UINT32_MAX },
    ),
    requiredAlignment: readBoundedInteger(
      typeRef.REQUIRED_ALIGNMENT(),
      "SDS PIV/TAB decoded requiredAlignment",
      { defaultValue: 0, maximum: UINT16_MAX },
    ),
  };
}

function validateDecodedFrameContract(frame) {
  const typeRef = frame.typeRef;
  if (typeRef && typeRef.wireFormat !== frame.wireFormat) {
    throw new Error("SDS PIV/TAB frame and typeRef wire formats disagree.");
  }
  const requiredAlignment = typeRef?.requiredAlignment ?? 0;
  if (requiredAlignment > 0 && !isPositivePowerOfTwo(requiredAlignment)) {
    throw new RangeError(
      "SDS PIV/TAB decoded requiredAlignment must be a positive power of two.",
    );
  }
  if (frame.alignment < requiredAlignment) {
    throw new RangeError(
      `SDS PIV/TAB frame alignment ${frame.alignment} is below required alignment ${requiredAlignment}.`,
    );
  }
  if (frame.wireFormat === "aligned-binary") {
    if (!typeRef) {
      throw new Error("SDS PIV/TAB aligned frame requires a typeRef.");
    }
    if (!isPositivePowerOfTwo(requiredAlignment)) {
      throw new RangeError(
        "SDS PIV/TAB aligned type requiredAlignment must be a positive power of two.",
      );
    }
    if (typeRef.byteLength <= 0 || frame.size !== typeRef.byteLength) {
      throw new RangeError(
        `SDS PIV/TAB aligned payload size ${frame.size} does not match declared byteLength ${typeRef.byteLength}.`,
      );
    }
  }
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
  const decoded = {
    typeRef: decodeSdsTypeRef(frame.TYPE_REF()),
    portId: frame.PORT_ID() ?? null,
    alignment,
    offset,
    size,
    ownership: fromSdsOwnership(frame.OWNERSHIP()),
    generation: 0,
    mutability: fromSdsMutability(frame.MUTABILITY()),
    frameId,
    traceId: frameId,
    streamId: 0,
    sequence: streamFrame.sequence,
    endOfStream: streamFrame.endOfStream,
    wireFormat,
  };
  validateDecodedFrameContract(decoded);
  return decoded;
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

function resolveDecodedArenaLease(arenaBytes, options = {}) {
  const externalArena = toUint8Array(options.externalArena);
  const sourceArena = arenaBytes.length > 0
    ? arenaBytes
    : externalArena ?? arenaBytes;
  if (!options.arenaLease) {
    return createInvokeArenaLease(sourceArena);
  }
  const state = requireArenaLeaseState(options.arenaLease);
  if (state.closed) {
    throw new Error("SDS PIV/TAB decoded arena lease is closed.");
  }
  assertViewWithinArena(
    sourceArena,
    state.arena,
    "SDS PIV/TAB decoded arena",
  );
  return options.arenaLease;
}

function materializeSdsArenaFrames(frames = [], arenaBytes, options = {}) {
  const externalArena = toUint8Array(options.externalArena);
  const arenaLease = options.arenaLease;
  const arenaGeneration = arenaLease
    ? requireArenaLeaseState(arenaLease).generation
    : undefined;
  return frames.map((frame) => {
    const offset = arenaFrameOffset(frame);
    const size = arenaFrameSize(frame);
    const sourceArena = arenaBytes.length > 0 ? arenaBytes : externalArena;
    const sourceDescription =
      arenaBytes.length > 0 ? "PAYLOAD_ARENA" : "external arena";
    assertUint32FrameRange(offset, size, "SDS PIV/TAB decoded frame");
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
      arenaLease,
      arenaGeneration,
      generation: arenaGeneration,
    };
  });
}

function packFrameOffsets(builder, frames) {
  return frames.map((frame) => frame.pack(builder));
}

function encodePluginInvokeRequestWithBuilder(builder, request = {}) {
  const inputFrames = Array.isArray(request.inputs)
    ? request.inputs
    : request.inputFrames ?? [];
  const { frames, arena, arenaAlignment } =
    request.externalArena !== undefined
      ? packExternalArenaFrames(inputFrames, request.externalArena)
      : packArenaFrames(inputFrames);
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

export function encodePluginInvokeRequest(request = {}) {
  return encodePluginInvokeRequestWithBuilder(
    new flatbuffers.Builder(1024),
    request,
  );
}

export function writePluginInvokeRequestToArena(request = {}, arenaInput) {
  const builder = arenaBackedBuilder(
    arenaInput,
    "SDS PIV direct invoke request",
  );
  const bytes = withFixedBuilderArena(
    () => encodePluginInvokeRequestWithBuilder(builder, request),
    "SDS PIV direct invoke request",
  );
  const arena = toUint8Array(arenaInput);
  if (bytes.buffer !== arena.buffer) {
    throw new Error(
      "SDS PIV direct invoke request was not authored in the supplied arena.",
    );
  }
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
  const arenaLease = resolveDecodedArenaLease(arena, options);
  const inputs = materializeSdsArenaFrames(inputFrames, arena, {
    ...options,
    arenaLease,
  });
  return {
    methodId: request.METHOD_ID() ?? null,
    inputFrames: inputs,
    inputs,
    payloadArena: arena,
    arenaLease,
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
  const arenaLease = resolveDecodedArenaLease(arena, options);
  const outputs = materializeSdsArenaFrames(outputFrames, arena, {
    ...options,
    arenaLease,
  });
  return {
    statusCode: response.STATUS_CODE() ?? 0,
    status: response.STATUS() ?? SdsPivStatus.OK,
    yielded: response.YIELDED() === true,
    backlogRemaining: response.BACKLOG_REMAINING() ?? 0,
    outputFrames: outputs,
    outputs,
    payloadArena: arena,
    arenaLease,
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
function consumeArenaTransferToken(token, outputFrame, payload) {
  const transfer = arenaTransferStates.get(token);
  if (!transfer) {
    throw new TypeError("SDS PIV/TAB arena transfer token is invalid.");
  }
  if (transfer.consumed) {
    throw new Error("SDS PIV/TAB arena transfer token was already consumed.");
  }
  if (
    transfer.lease !== outputFrame.arenaLease ||
    transfer.generation !==
      firstDefined(outputFrame.generation, outputFrame.arenaGeneration) ||
    transfer.payloadBuffer !== payload.buffer ||
    transfer.payloadByteOffset !== payload.byteOffset ||
    transfer.payloadByteLength !== payload.byteLength ||
    transfer.frameId !== encodeSdsFrameId(outputFrame)
  ) {
    throw new Error(
      "SDS PIV/TAB arena transfer token is incompatible with this frame.",
    );
  }
  assertLiveArenaLease(
    transfer.lease,
    transfer.generation,
    payload,
    "SDS PIV/TAB arena transfer",
  );
  transfer.consumed = true;
  return transfer;
}

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
  const typeRef = overrides.typeRef ?? outputFrame.typeRef ?? null;
  const wireFormat = normalizePayloadWireFormat(
    firstDefined(typeRef?.wireFormat, outputFrame.wireFormat),
  );
  const frameId = encodeSdsFrameId(outputFrame);
  if (overrides.copyCanonical === true) {
    if (wireFormat !== "flatbuffer") {
      throw new Error(
        "SDS PIV/TAB canonical copy forwarding cannot copy an aligned-binary frame without schema transcoding.",
      );
    }
    return {
      portId,
      payload: new Uint8Array(payload),
      typeRef,
      alignment: overrides.alignment ?? INVOKE_ARENA_ALIGNMENT,
      ownership: BufferOwnership.HOST_OWNED,
      mutability: BufferMutability.IMMUTABLE,
      frameId,
      traceId: overrides.traceId ?? outputFrame.traceId ?? frameId,
      streamId: overrides.streamId ?? outputFrame.streamId,
      sequence: overrides.sequence ?? outputFrame.sequence,
      endOfStream:
        overrides.endOfStream ?? (outputFrame.endOfStream === true || undefined),
      wireFormat,
    };
  }

  assertFrameArenaLease(outputFrame, "SDS PIV/TAB zero-copy forwarding", {
    required: true,
  });
  const sourceOwnership = normalizeFrameOwnership(outputFrame.ownership);
  const sourceMutability = normalizeFrameMutability(outputFrame.mutability);
  const requestedOwnership = normalizeFrameOwnership(
    overrides.ownership ?? sourceOwnership,
  );
  const requestedMutability = normalizeFrameMutability(
    overrides.mutability ?? sourceMutability,
  );
  const requiresTransfer =
    sourceOwnership === BufferOwnership.PRODUCER_OWNED ||
    sourceMutability !== BufferMutability.IMMUTABLE ||
    requestedOwnership === BufferOwnership.PRODUCER_OWNED ||
    requestedMutability !== BufferMutability.IMMUTABLE ||
    requestedOwnership !== sourceOwnership ||
    requestedMutability !== sourceMutability;
  let ownership = sourceOwnership;
  let mutability = sourceMutability;
  let consumedTransfer = null;
  if (requiresTransfer && !overrides.arenaTransfer) {
    throw new Error(
      "SDS PIV/TAB producer-owned or mutable cross-invocation alias requires an explicit arena transfer token.",
    );
  }
  if (overrides.arenaTransfer) {
    consumedTransfer = consumeArenaTransferToken(
      overrides.arenaTransfer,
      outputFrame,
      payload,
    );
    ownership = consumedTransfer.ownership;
    mutability = consumedTransfer.mutability;
  }
  const forwarded = {
    portId,
    payload,
    typeRef,
    alignment:
      overrides.alignment ??
      (outputFrame.alignment > 0 ? outputFrame.alignment : undefined),
    ownership,
    mutability,
    arenaLease: outputFrame.arenaLease,
    arenaGeneration: outputFrame.arenaGeneration ?? outputFrame.generation,
    generation: outputFrame.generation,
    frameId,
    traceId: overrides.traceId ?? outputFrame.traceId,
    streamId: overrides.streamId ?? outputFrame.streamId,
    sequence: overrides.sequence ?? outputFrame.sequence,
    endOfStream:
      overrides.endOfStream ?? (outputFrame.endOfStream === true || undefined),
    wireFormat,
  };
  if (consumedTransfer) {
    arenaForwardingReceipts.set(forwarded, {
      ...consumedTransfer,
      ownership,
      mutability,
    });
  }
  return forwarded;
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
