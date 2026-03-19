import * as flatbuffers from 'flatbuffers';
import { TypedArenaBuffer, TypedArenaBufferT } from '../../orbpro/stream/typed-arena-buffer.js';
/**
 * Canonical invoke envelope consumed by direct ABI and command-mode execution.
 */
export declare class PluginInvokeRequest implements flatbuffers.IUnpackableObject<PluginInvokeRequestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): PluginInvokeRequest;
    static getRootAsPluginInvokeRequest(bb: flatbuffers.ByteBuffer, obj?: PluginInvokeRequest): PluginInvokeRequest;
    static getSizePrefixedRootAsPluginInvokeRequest(bb: flatbuffers.ByteBuffer, obj?: PluginInvokeRequest): PluginInvokeRequest;
    static bufferHasIdentifier(bb: flatbuffers.ByteBuffer): boolean;
    /**
     * Stable method identifier from PluginManifest.methods.
     */
    methodId(): string | null;
    methodId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * Input frames for the invocation, routed by TypedArenaBuffer.port_id.
     */
    inputFrames(index: number, obj?: TypedArenaBuffer): TypedArenaBuffer | null;
    inputFramesLength(): number;
    /**
     * Arena backing all input frame payload bytes.
     */
    payloadArena(index: number): number | null;
    payloadArenaLength(): number;
    payloadArenaArray(): Uint8Array | null;
    static startPluginInvokeRequest(builder: flatbuffers.Builder): void;
    static addMethodId(builder: flatbuffers.Builder, methodIdOffset: flatbuffers.Offset): void;
    static addInputFrames(builder: flatbuffers.Builder, inputFramesOffset: flatbuffers.Offset): void;
    static createInputFramesVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startInputFramesVector(builder: flatbuffers.Builder, numElems: number): void;
    static addPayloadArena(builder: flatbuffers.Builder, payloadArenaOffset: flatbuffers.Offset): void;
    static createPayloadArenaVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startPayloadArenaVector(builder: flatbuffers.Builder, numElems: number): void;
    static endPluginInvokeRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    static finishPluginInvokeRequestBuffer(builder: flatbuffers.Builder, offset: flatbuffers.Offset): void;
    static finishSizePrefixedPluginInvokeRequestBuffer(builder: flatbuffers.Builder, offset: flatbuffers.Offset): void;
    static createPluginInvokeRequest(builder: flatbuffers.Builder, methodIdOffset: flatbuffers.Offset, inputFramesOffset: flatbuffers.Offset, payloadArenaOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): PluginInvokeRequestT;
    unpackTo(_o: PluginInvokeRequestT): void;
}
export declare class PluginInvokeRequestT implements flatbuffers.IGeneratedObject {
    methodId: string | Uint8Array | null;
    inputFrames: (TypedArenaBufferT)[];
    payloadArena: (number)[];
    constructor(methodId?: string | Uint8Array | null, inputFrames?: (TypedArenaBufferT)[], payloadArena?: (number)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=plugin-invoke-request.d.ts.map