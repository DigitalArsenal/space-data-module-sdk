import * as flatbuffers from 'flatbuffers';
import { TypedArenaBuffer, TypedArenaBufferT } from '../../orbpro/stream/typed-arena-buffer.js';
/**
 * Canonical invoke result emitted by direct ABI and command-mode execution.
 */
export declare class PluginInvokeResponse implements flatbuffers.IUnpackableObject<PluginInvokeResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): PluginInvokeResponse;
    static getRootAsPluginInvokeResponse(bb: flatbuffers.ByteBuffer, obj?: PluginInvokeResponse): PluginInvokeResponse;
    static getSizePrefixedRootAsPluginInvokeResponse(bb: flatbuffers.ByteBuffer, obj?: PluginInvokeResponse): PluginInvokeResponse;
    static bufferHasIdentifier(bb: flatbuffers.ByteBuffer): boolean;
    /**
     * Method-specific status code. Zero conventionally indicates success.
     */
    statusCode(): number;
    /**
     * True when the method yielded before fully draining queued work.
     */
    yielded(): boolean;
    /**
     * Remaining backlog, if known.
     */
    backlogRemaining(): number;
    /**
     * Output frames produced by the invocation, routed by port_id.
     */
    outputFrames(index: number, obj?: TypedArenaBuffer): TypedArenaBuffer | null;
    outputFramesLength(): number;
    /**
     * Arena backing all output frame payload bytes.
     */
    payloadArena(index: number): number | null;
    payloadArenaLength(): number;
    payloadArenaArray(): Uint8Array | null;
    /**
     * Stable machine-readable error code when invocation fails.
     */
    errorCode(): string | null;
    errorCode(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * Human-readable error message when invocation fails.
     */
    errorMessage(): string | null;
    errorMessage(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startPluginInvokeResponse(builder: flatbuffers.Builder): void;
    static addStatusCode(builder: flatbuffers.Builder, statusCode: number): void;
    static addYielded(builder: flatbuffers.Builder, yielded: boolean): void;
    static addBacklogRemaining(builder: flatbuffers.Builder, backlogRemaining: number): void;
    static addOutputFrames(builder: flatbuffers.Builder, outputFramesOffset: flatbuffers.Offset): void;
    static createOutputFramesVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startOutputFramesVector(builder: flatbuffers.Builder, numElems: number): void;
    static addPayloadArena(builder: flatbuffers.Builder, payloadArenaOffset: flatbuffers.Offset): void;
    static createPayloadArenaVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startPayloadArenaVector(builder: flatbuffers.Builder, numElems: number): void;
    static addErrorCode(builder: flatbuffers.Builder, errorCodeOffset: flatbuffers.Offset): void;
    static addErrorMessage(builder: flatbuffers.Builder, errorMessageOffset: flatbuffers.Offset): void;
    static endPluginInvokeResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    static finishPluginInvokeResponseBuffer(builder: flatbuffers.Builder, offset: flatbuffers.Offset): void;
    static finishSizePrefixedPluginInvokeResponseBuffer(builder: flatbuffers.Builder, offset: flatbuffers.Offset): void;
    static createPluginInvokeResponse(builder: flatbuffers.Builder, statusCode: number, yielded: boolean, backlogRemaining: number, outputFramesOffset: flatbuffers.Offset, payloadArenaOffset: flatbuffers.Offset, errorCodeOffset: flatbuffers.Offset, errorMessageOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): PluginInvokeResponseT;
    unpackTo(_o: PluginInvokeResponseT): void;
}
export declare class PluginInvokeResponseT implements flatbuffers.IGeneratedObject {
    statusCode: number;
    yielded: boolean;
    backlogRemaining: number;
    outputFrames: (TypedArenaBufferT)[];
    payloadArena: (number)[];
    errorCode: string | Uint8Array | null;
    errorMessage: string | Uint8Array | null;
    constructor(statusCode?: number, yielded?: boolean, backlogRemaining?: number, outputFrames?: (TypedArenaBufferT)[], payloadArena?: (number)[], errorCode?: string | Uint8Array | null, errorMessage?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=plugin-invoke-response.d.ts.map