import * as flatbuffers from "flatbuffers";
import { FlatBufferTypeRef, FlatBufferTypeRefT } from "../../orbpro/stream/flat-buffer-type-ref.js";
/**
 * Accepted schema family for a port.
 */
export declare class AcceptedTypeSet implements flatbuffers.IUnpackableObject<AcceptedTypeSetT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): AcceptedTypeSet;
    static getRootAsAcceptedTypeSet(bb: flatbuffers.ByteBuffer, obj?: AcceptedTypeSet): AcceptedTypeSet;
    static getSizePrefixedRootAsAcceptedTypeSet(bb: flatbuffers.ByteBuffer, obj?: AcceptedTypeSet): AcceptedTypeSet;
    /**
     * Stable type-set identifier.
     */
    setId(): string | null;
    setId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * Specific FlatBuffer types accepted by the set.
     */
    allowedTypes(index: number, obj?: FlatBufferTypeRef): FlatBufferTypeRef | null;
    allowedTypesLength(): number;
    /**
     * Human-readable explanation of the accepted schema family.
     */
    description(): string | null;
    description(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startAcceptedTypeSet(builder: flatbuffers.Builder): void;
    static addSetId(builder: flatbuffers.Builder, setIdOffset: flatbuffers.Offset): void;
    static addAllowedTypes(builder: flatbuffers.Builder, allowedTypesOffset: flatbuffers.Offset): void;
    static createAllowedTypesVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startAllowedTypesVector(builder: flatbuffers.Builder, numElems: number): void;
    static addDescription(builder: flatbuffers.Builder, descriptionOffset: flatbuffers.Offset): void;
    static endAcceptedTypeSet(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createAcceptedTypeSet(builder: flatbuffers.Builder, setIdOffset: flatbuffers.Offset, allowedTypesOffset: flatbuffers.Offset, descriptionOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): AcceptedTypeSetT;
    unpackTo(_o: AcceptedTypeSetT): void;
}
export declare class AcceptedTypeSetT implements flatbuffers.IGeneratedObject {
    setId: string | Uint8Array | null;
    allowedTypes: FlatBufferTypeRefT[];
    description: string | Uint8Array | null;
    constructor(setId?: string | Uint8Array | null, allowedTypes?: FlatBufferTypeRefT[], description?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=accepted-type-set.d.ts.map