import * as flatbuffers from "flatbuffers";
import { CapabilityKind } from "../../orbpro/manifest/capability-kind.js";
/**
 * One host capability dependency.
 */
export declare class HostCapability implements flatbuffers.IUnpackableObject<HostCapabilityT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): HostCapability;
    static getRootAsHostCapability(bb: flatbuffers.ByteBuffer, obj?: HostCapability): HostCapability;
    static getSizePrefixedRootAsHostCapability(bb: flatbuffers.ByteBuffer, obj?: HostCapability): HostCapability;
    capability(): CapabilityKind;
    scope(): string | null;
    scope(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    required(): boolean;
    description(): string | null;
    description(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startHostCapability(builder: flatbuffers.Builder): void;
    static addCapability(builder: flatbuffers.Builder, capability: CapabilityKind): void;
    static addScope(builder: flatbuffers.Builder, scopeOffset: flatbuffers.Offset): void;
    static addRequired(builder: flatbuffers.Builder, required: boolean): void;
    static addDescription(builder: flatbuffers.Builder, descriptionOffset: flatbuffers.Offset): void;
    static endHostCapability(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createHostCapability(builder: flatbuffers.Builder, capability: CapabilityKind, scopeOffset: flatbuffers.Offset, required: boolean, descriptionOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): HostCapabilityT;
    unpackTo(_o: HostCapabilityT): void;
}
export declare class HostCapabilityT implements flatbuffers.IGeneratedObject {
    capability: CapabilityKind;
    scope: string | Uint8Array | null;
    required: boolean;
    description: string | Uint8Array | null;
    constructor(capability?: CapabilityKind, scope?: string | Uint8Array | null, required?: boolean, description?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=host-capability.d.ts.map