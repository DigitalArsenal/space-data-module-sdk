import * as flatbuffers from 'flatbuffers';
/**
 * Protocol handler declared by a plugin.
 */
export declare class ProtocolSpec implements flatbuffers.IUnpackableObject<ProtocolSpecT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ProtocolSpec;
    static getRootAsProtocolSpec(bb: flatbuffers.ByteBuffer, obj?: ProtocolSpec): ProtocolSpec;
    static getSizePrefixedRootAsProtocolSpec(bb: flatbuffers.ByteBuffer, obj?: ProtocolSpec): ProtocolSpec;
    protocolId(): string | null;
    protocolId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    methodId(): string | null;
    methodId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    inputPortId(): string | null;
    inputPortId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    outputPortId(): string | null;
    outputPortId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    description(): string | null;
    description(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startProtocolSpec(builder: flatbuffers.Builder): void;
    static addProtocolId(builder: flatbuffers.Builder, protocolIdOffset: flatbuffers.Offset): void;
    static addMethodId(builder: flatbuffers.Builder, methodIdOffset: flatbuffers.Offset): void;
    static addInputPortId(builder: flatbuffers.Builder, inputPortIdOffset: flatbuffers.Offset): void;
    static addOutputPortId(builder: flatbuffers.Builder, outputPortIdOffset: flatbuffers.Offset): void;
    static addDescription(builder: flatbuffers.Builder, descriptionOffset: flatbuffers.Offset): void;
    static endProtocolSpec(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createProtocolSpec(builder: flatbuffers.Builder, protocolIdOffset: flatbuffers.Offset, methodIdOffset: flatbuffers.Offset, inputPortIdOffset: flatbuffers.Offset, outputPortIdOffset: flatbuffers.Offset, descriptionOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): ProtocolSpecT;
    unpackTo(_o: ProtocolSpecT): void;
}
export declare class ProtocolSpecT implements flatbuffers.IGeneratedObject {
    protocolId: string | Uint8Array | null;
    methodId: string | Uint8Array | null;
    inputPortId: string | Uint8Array | null;
    outputPortId: string | Uint8Array | null;
    description: string | Uint8Array | null;
    constructor(protocolId?: string | Uint8Array | null, methodId?: string | Uint8Array | null, inputPortId?: string | Uint8Array | null, outputPortId?: string | Uint8Array | null, description?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=protocol-spec.d.ts.map