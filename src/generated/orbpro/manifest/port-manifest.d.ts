import * as flatbuffers from "flatbuffers";
import { AcceptedTypeSet, AcceptedTypeSetT } from "../../orbpro/manifest/accepted-type-set.js";
/**
 * One input or output port on a method.
 */
export declare class PortManifest implements flatbuffers.IUnpackableObject<PortManifestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): PortManifest;
    static getRootAsPortManifest(bb: flatbuffers.ByteBuffer, obj?: PortManifest): PortManifest;
    static getSizePrefixedRootAsPortManifest(bb: flatbuffers.ByteBuffer, obj?: PortManifest): PortManifest;
    /**
     * Stable port identifier within the method.
     */
    portId(): string | null;
    portId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * Human-readable name for UIs.
     */
    displayName(): string | null;
    displayName(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * Type sets accepted on this port.
     */
    acceptedTypeSets(index: number, obj?: AcceptedTypeSet): AcceptedTypeSet | null;
    acceptedTypeSetsLength(): number;
    /**
     * Minimum number of streams that must be connected.
     */
    minStreams(): number;
    /**
     * Maximum number of streams that may be connected.
     */
    maxStreams(): number;
    /**
     * Whether the port must be connected for invocation.
     */
    required(): boolean;
    /**
     * Optional human-readable description.
     */
    description(): string | null;
    description(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startPortManifest(builder: flatbuffers.Builder): void;
    static addPortId(builder: flatbuffers.Builder, portIdOffset: flatbuffers.Offset): void;
    static addDisplayName(builder: flatbuffers.Builder, displayNameOffset: flatbuffers.Offset): void;
    static addAcceptedTypeSets(builder: flatbuffers.Builder, acceptedTypeSetsOffset: flatbuffers.Offset): void;
    static createAcceptedTypeSetsVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startAcceptedTypeSetsVector(builder: flatbuffers.Builder, numElems: number): void;
    static addMinStreams(builder: flatbuffers.Builder, minStreams: number): void;
    static addMaxStreams(builder: flatbuffers.Builder, maxStreams: number): void;
    static addRequired(builder: flatbuffers.Builder, required: boolean): void;
    static addDescription(builder: flatbuffers.Builder, descriptionOffset: flatbuffers.Offset): void;
    static endPortManifest(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createPortManifest(builder: flatbuffers.Builder, portIdOffset: flatbuffers.Offset, displayNameOffset: flatbuffers.Offset, acceptedTypeSetsOffset: flatbuffers.Offset, minStreams: number, maxStreams: number, required: boolean, descriptionOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): PortManifestT;
    unpackTo(_o: PortManifestT): void;
}
export declare class PortManifestT implements flatbuffers.IGeneratedObject {
    portId: string | Uint8Array | null;
    displayName: string | Uint8Array | null;
    acceptedTypeSets: AcceptedTypeSetT[];
    minStreams: number;
    maxStreams: number;
    required: boolean;
    description: string | Uint8Array | null;
    constructor(portId?: string | Uint8Array | null, displayName?: string | Uint8Array | null, acceptedTypeSets?: AcceptedTypeSetT[], minStreams?: number, maxStreams?: number, required?: boolean, description?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=port-manifest.d.ts.map