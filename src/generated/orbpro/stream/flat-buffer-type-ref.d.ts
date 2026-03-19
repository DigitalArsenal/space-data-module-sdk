import * as flatbuffers from "flatbuffers";
import { PayloadWireFormat } from "../../orbpro/stream/payload-wire-format.js";
/**
 * Payload schema identity for a stream frame or accepted port type.
 */
export declare class FlatBufferTypeRef implements flatbuffers.IUnpackableObject<FlatBufferTypeRefT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): FlatBufferTypeRef;
    static getRootAsFlatBufferTypeRef(bb: flatbuffers.ByteBuffer, obj?: FlatBufferTypeRef): FlatBufferTypeRef;
    static getSizePrefixedRootAsFlatBufferTypeRef(bb: flatbuffers.ByteBuffer, obj?: FlatBufferTypeRef): FlatBufferTypeRef;
    /**
     * Logical schema name, for example `OMM.fbs`.
     */
    schemaName(): string | null;
    schemaName(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * Optional 4-byte FlatBuffer file identifier.
     */
    fileIdentifier(): string | null;
    fileIdentifier(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * Optional schema hash bytes for stronger compatibility checks.
     */
    schemaHash(index: number): number | null;
    schemaHashLength(): number;
    schemaHashArray(): Uint8Array | null;
    /**
     * True when this port/type set accepts any FlatBuffer frame.
     */
    acceptsAnyFlatbuffer(): boolean;
    wireFormat(): PayloadWireFormat;
    rootTypeName(): string | null;
    rootTypeName(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    fixedStringLength(): number;
    byteLength(): number;
    requiredAlignment(): number;
    static startFlatBufferTypeRef(builder: flatbuffers.Builder): void;
    static addSchemaName(builder: flatbuffers.Builder, schemaNameOffset: flatbuffers.Offset): void;
    static addFileIdentifier(builder: flatbuffers.Builder, fileIdentifierOffset: flatbuffers.Offset): void;
    static addSchemaHash(builder: flatbuffers.Builder, schemaHashOffset: flatbuffers.Offset): void;
    static createSchemaHashVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startSchemaHashVector(builder: flatbuffers.Builder, numElems: number): void;
    static addAcceptsAnyFlatbuffer(builder: flatbuffers.Builder, acceptsAnyFlatbuffer: boolean): void;
    static addWireFormat(builder: flatbuffers.Builder, wireFormat: PayloadWireFormat): void;
    static addRootTypeName(builder: flatbuffers.Builder, rootTypeNameOffset: flatbuffers.Offset): void;
    static addFixedStringLength(builder: flatbuffers.Builder, fixedStringLength: number): void;
    static addByteLength(builder: flatbuffers.Builder, byteLength: number): void;
    static addRequiredAlignment(builder: flatbuffers.Builder, requiredAlignment: number): void;
    static endFlatBufferTypeRef(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createFlatBufferTypeRef(builder: flatbuffers.Builder, schemaNameOffset: flatbuffers.Offset, fileIdentifierOffset: flatbuffers.Offset, schemaHashOffset: flatbuffers.Offset, acceptsAnyFlatbuffer: boolean, wireFormat: PayloadWireFormat, rootTypeNameOffset: flatbuffers.Offset, fixedStringLength: number, byteLength: number, requiredAlignment: number): flatbuffers.Offset;
    unpack(): FlatBufferTypeRefT;
    unpackTo(_o: FlatBufferTypeRefT): void;
}
export declare class FlatBufferTypeRefT implements flatbuffers.IGeneratedObject {
    schemaName: string | Uint8Array | null;
    fileIdentifier: string | Uint8Array | null;
    schemaHash: number[];
    acceptsAnyFlatbuffer: boolean;
    wireFormat: PayloadWireFormat | "flatbuffer" | "aligned-binary";
    rootTypeName: string | Uint8Array | null;
    fixedStringLength: number;
    byteLength: number;
    requiredAlignment: number;
    constructor(schemaName?: string | Uint8Array | null, fileIdentifier?: string | Uint8Array | null, schemaHash?: number[], acceptsAnyFlatbuffer?: boolean, wireFormat?: PayloadWireFormat | "flatbuffer" | "aligned-binary", rootTypeName?: string | Uint8Array | null, fixedStringLength?: number, byteLength?: number, requiredAlignment?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=flat-buffer-type-ref.d.ts.map