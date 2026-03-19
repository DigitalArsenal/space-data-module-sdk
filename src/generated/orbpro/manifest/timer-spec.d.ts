import * as flatbuffers from "flatbuffers";
/**
 * Timer entry declared by a plugin.
 */
export declare class TimerSpec implements flatbuffers.IUnpackableObject<TimerSpecT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): TimerSpec;
    static getRootAsTimerSpec(bb: flatbuffers.ByteBuffer, obj?: TimerSpec): TimerSpec;
    static getSizePrefixedRootAsTimerSpec(bb: flatbuffers.ByteBuffer, obj?: TimerSpec): TimerSpec;
    timerId(): string | null;
    timerId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    methodId(): string | null;
    methodId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    inputPortId(): string | null;
    inputPortId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    defaultIntervalMs(): bigint;
    description(): string | null;
    description(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startTimerSpec(builder: flatbuffers.Builder): void;
    static addTimerId(builder: flatbuffers.Builder, timerIdOffset: flatbuffers.Offset): void;
    static addMethodId(builder: flatbuffers.Builder, methodIdOffset: flatbuffers.Offset): void;
    static addInputPortId(builder: flatbuffers.Builder, inputPortIdOffset: flatbuffers.Offset): void;
    static addDefaultIntervalMs(builder: flatbuffers.Builder, defaultIntervalMs: bigint): void;
    static addDescription(builder: flatbuffers.Builder, descriptionOffset: flatbuffers.Offset): void;
    static endTimerSpec(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createTimerSpec(builder: flatbuffers.Builder, timerIdOffset: flatbuffers.Offset, methodIdOffset: flatbuffers.Offset, inputPortIdOffset: flatbuffers.Offset, defaultIntervalMs: bigint, descriptionOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): TimerSpecT;
    unpackTo(_o: TimerSpecT): void;
}
export declare class TimerSpecT implements flatbuffers.IGeneratedObject {
    timerId: string | Uint8Array | null;
    methodId: string | Uint8Array | null;
    inputPortId: string | Uint8Array | null;
    defaultIntervalMs: bigint;
    description: string | Uint8Array | null;
    constructor(timerId?: string | Uint8Array | null, methodId?: string | Uint8Array | null, inputPortId?: string | Uint8Array | null, defaultIntervalMs?: bigint, description?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=timer-spec.d.ts.map