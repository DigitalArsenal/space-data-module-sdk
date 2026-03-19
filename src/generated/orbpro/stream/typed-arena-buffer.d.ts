import * as flatbuffers from "flatbuffers";
import { BufferMutability } from "../../orbpro/stream/buffer-mutability.js";
import { BufferOwnership } from "../../orbpro/stream/buffer-ownership.js";
import { FlatBufferTypeRef, FlatBufferTypeRefT } from "../../orbpro/stream/flat-buffer-type-ref.js";
/**
 * Runtime descriptor for one FlatBuffer frame stored in an arena.
 */
export declare class TypedArenaBuffer implements flatbuffers.IUnpackableObject<TypedArenaBufferT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): TypedArenaBuffer;
    static getRootAsTypedArenaBuffer(bb: flatbuffers.ByteBuffer, obj?: TypedArenaBuffer): TypedArenaBuffer;
    static getSizePrefixedRootAsTypedArenaBuffer(bb: flatbuffers.ByteBuffer, obj?: TypedArenaBuffer): TypedArenaBuffer;
    static bufferHasIdentifier(bb: flatbuffers.ByteBuffer): boolean;
    /**
     * Runtime schema identity for this frame.
     */
    typeRef(obj?: FlatBufferTypeRef): FlatBufferTypeRef | null;
    /**
     * Port that produced or will consume this frame.
     */
    portId(): string | null;
    portId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * Required alignment of the underlying frame bytes.
     */
    alignment(): number;
    /**
     * Frame byte offset from the arena base.
     */
    offset(): number;
    /**
     * Frame size in bytes.
     */
    size(): number;
    /**
     * Ownership contract for the buffer.
     */
    ownership(): BufferOwnership;
    /**
     * Generation counter for stale-reference detection.
     */
    generation(): number;
    /**
     * Mutability contract for downstream consumers.
     */
    mutability(): BufferMutability;
    /**
     * Flow/runtime trace identifier.
     */
    traceId(): bigint;
    /**
     * Logical stream identifier.
     */
    streamId(): number;
    /**
     * Monotonic frame sequence number within a stream.
     */
    sequence(): bigint;
    /**
     * True if this frame closes the stream.
     */
    endOfStream(): boolean;
    static startTypedArenaBuffer(builder: flatbuffers.Builder): void;
    static addTypeRef(builder: flatbuffers.Builder, typeRefOffset: flatbuffers.Offset): void;
    static addPortId(builder: flatbuffers.Builder, portIdOffset: flatbuffers.Offset): void;
    static addAlignment(builder: flatbuffers.Builder, alignment: number): void;
    static addOffset(builder: flatbuffers.Builder, offset: number): void;
    static addSize(builder: flatbuffers.Builder, size: number): void;
    static addOwnership(builder: flatbuffers.Builder, ownership: BufferOwnership): void;
    static addGeneration(builder: flatbuffers.Builder, generation: number): void;
    static addMutability(builder: flatbuffers.Builder, mutability: BufferMutability): void;
    static addTraceId(builder: flatbuffers.Builder, traceId: bigint): void;
    static addStreamId(builder: flatbuffers.Builder, streamId: number): void;
    static addSequence(builder: flatbuffers.Builder, sequence: bigint): void;
    static addEndOfStream(builder: flatbuffers.Builder, endOfStream: boolean): void;
    static endTypedArenaBuffer(builder: flatbuffers.Builder): flatbuffers.Offset;
    static finishTypedArenaBufferBuffer(builder: flatbuffers.Builder, offset: flatbuffers.Offset): void;
    static finishSizePrefixedTypedArenaBufferBuffer(builder: flatbuffers.Builder, offset: flatbuffers.Offset): void;
    static createTypedArenaBuffer(builder: flatbuffers.Builder, typeRefOffset: flatbuffers.Offset, portIdOffset: flatbuffers.Offset, alignment: number, offset: number, size: number, ownership: BufferOwnership, generation: number, mutability: BufferMutability, traceId: bigint, streamId: number, sequence: bigint, endOfStream: boolean): flatbuffers.Offset;
    unpack(): TypedArenaBufferT;
    unpackTo(_o: TypedArenaBufferT): void;
}
export declare class TypedArenaBufferT implements flatbuffers.IGeneratedObject {
    typeRef: FlatBufferTypeRefT | null;
    portId: string | Uint8Array | null;
    alignment: number;
    offset: number;
    size: number;
    ownership: BufferOwnership;
    generation: number;
    mutability: BufferMutability;
    traceId: bigint;
    streamId: number;
    sequence: bigint;
    endOfStream: boolean;
    constructor(typeRef?: FlatBufferTypeRefT | null, portId?: string | Uint8Array | null, alignment?: number, offset?: number, size?: number, ownership?: BufferOwnership, generation?: number, mutability?: BufferMutability, traceId?: bigint, streamId?: number, sequence?: bigint, endOfStream?: boolean);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=typed-arena-buffer.d.ts.map