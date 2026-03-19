import * as flatbuffers from "flatbuffers";
import { DrainPolicy } from "../../orbpro/manifest/drain-policy.js";
import { PortManifest, PortManifestT } from "../../orbpro/manifest/port-manifest.js";
/**
 * Canonical method declaration.
 */
export declare class MethodManifest implements flatbuffers.IUnpackableObject<MethodManifestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): MethodManifest;
    static getRootAsMethodManifest(bb: flatbuffers.ByteBuffer, obj?: MethodManifest): MethodManifest;
    static getSizePrefixedRootAsMethodManifest(bb: flatbuffers.ByteBuffer, obj?: MethodManifest): MethodManifest;
    methodId(): string | null;
    methodId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    displayName(): string | null;
    displayName(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    inputPorts(index: number, obj?: PortManifest): PortManifest | null;
    inputPortsLength(): number;
    outputPorts(index: number, obj?: PortManifest): PortManifest | null;
    outputPortsLength(): number;
    maxBatch(): number;
    drainPolicy(): DrainPolicy;
    description(): string | null;
    description(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startMethodManifest(builder: flatbuffers.Builder): void;
    static addMethodId(builder: flatbuffers.Builder, methodIdOffset: flatbuffers.Offset): void;
    static addDisplayName(builder: flatbuffers.Builder, displayNameOffset: flatbuffers.Offset): void;
    static addInputPorts(builder: flatbuffers.Builder, inputPortsOffset: flatbuffers.Offset): void;
    static createInputPortsVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startInputPortsVector(builder: flatbuffers.Builder, numElems: number): void;
    static addOutputPorts(builder: flatbuffers.Builder, outputPortsOffset: flatbuffers.Offset): void;
    static createOutputPortsVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startOutputPortsVector(builder: flatbuffers.Builder, numElems: number): void;
    static addMaxBatch(builder: flatbuffers.Builder, maxBatch: number): void;
    static addDrainPolicy(builder: flatbuffers.Builder, drainPolicy: DrainPolicy): void;
    static addDescription(builder: flatbuffers.Builder, descriptionOffset: flatbuffers.Offset): void;
    static endMethodManifest(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createMethodManifest(builder: flatbuffers.Builder, methodIdOffset: flatbuffers.Offset, displayNameOffset: flatbuffers.Offset, inputPortsOffset: flatbuffers.Offset, outputPortsOffset: flatbuffers.Offset, maxBatch: number, drainPolicy: DrainPolicy, descriptionOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): MethodManifestT;
    unpackTo(_o: MethodManifestT): void;
}
export declare class MethodManifestT implements flatbuffers.IGeneratedObject {
    methodId: string | Uint8Array | null;
    displayName: string | Uint8Array | null;
    inputPorts: PortManifestT[];
    outputPorts: PortManifestT[];
    maxBatch: number;
    drainPolicy: DrainPolicy;
    description: string | Uint8Array | null;
    constructor(methodId?: string | Uint8Array | null, displayName?: string | Uint8Array | null, inputPorts?: PortManifestT[], outputPorts?: PortManifestT[], maxBatch?: number, drainPolicy?: DrainPolicy, description?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=method-manifest.d.ts.map