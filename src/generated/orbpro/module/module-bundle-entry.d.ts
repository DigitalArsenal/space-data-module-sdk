import * as flatbuffers from 'flatbuffers';
import { ModuleBundleEntryRole } from '../../orbpro/module/module-bundle-entry-role.js';
import { ModulePayloadEncoding } from '../../orbpro/module/module-payload-encoding.js';
import { FlatBufferTypeRef, FlatBufferTypeRefT } from '../../orbpro/stream/flat-buffer-type-ref.js';
/**
 * One payload carried inside the bundle.
 */
export declare class ModuleBundleEntry implements flatbuffers.IUnpackableObject<ModuleBundleEntryT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ModuleBundleEntry;
    static getRootAsModuleBundleEntry(bb: flatbuffers.ByteBuffer, obj?: ModuleBundleEntry): ModuleBundleEntry;
    static getSizePrefixedRootAsModuleBundleEntry(bb: flatbuffers.ByteBuffer, obj?: ModuleBundleEntry): ModuleBundleEntry;
    /**
     * Stable bundle-local identifier.
     */
    entryId(): string | null;
    entryId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * High-level semantic role of the payload.
     */
    role(): ModuleBundleEntryRole;
    /**
     * Optional logical section name within the bundle, for example
     * `sds.authorization`.
     */
    sectionName(): string | null;
    sectionName(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * SDS/shared-module schema identity when the payload is itself a
     * FlatBuffer.
     */
    typeRef(obj?: FlatBufferTypeRef): FlatBufferTypeRef | null;
    /**
     * Encoding used for `payload`.
     */
    payloadEncoding(): ModulePayloadEncoding;
    /**
     * Optional media type for transitional payloads such as JSON envelopes.
     */
    mediaType(): string | null;
    mediaType(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * Implementation-defined bit flags for signed/encrypted/compressed state.
     */
    flags(): number;
    /**
     * SHA-256 of the payload bytes.
     */
    sha256(index: number): number | null;
    sha256Length(): number;
    sha256Array(): Uint8Array | null;
    /**
     * Embedded payload bytes. For single-file deployment this should be
     * populated for every entry.
     */
    payload(index: number): number | null;
    payloadLength(): number;
    payloadArray(): Uint8Array | null;
    /**
     * Human-readable description for tooling and diagnostics.
     */
    description(): string | null;
    description(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startModuleBundleEntry(builder: flatbuffers.Builder): void;
    static addEntryId(builder: flatbuffers.Builder, entryIdOffset: flatbuffers.Offset): void;
    static addRole(builder: flatbuffers.Builder, role: ModuleBundleEntryRole): void;
    static addSectionName(builder: flatbuffers.Builder, sectionNameOffset: flatbuffers.Offset): void;
    static addTypeRef(builder: flatbuffers.Builder, typeRefOffset: flatbuffers.Offset): void;
    static addPayloadEncoding(builder: flatbuffers.Builder, payloadEncoding: ModulePayloadEncoding): void;
    static addMediaType(builder: flatbuffers.Builder, mediaTypeOffset: flatbuffers.Offset): void;
    static addFlags(builder: flatbuffers.Builder, flags: number): void;
    static addSha256(builder: flatbuffers.Builder, sha256Offset: flatbuffers.Offset): void;
    static createSha256Vector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startSha256Vector(builder: flatbuffers.Builder, numElems: number): void;
    static addPayload(builder: flatbuffers.Builder, payloadOffset: flatbuffers.Offset): void;
    static createPayloadVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startPayloadVector(builder: flatbuffers.Builder, numElems: number): void;
    static addDescription(builder: flatbuffers.Builder, descriptionOffset: flatbuffers.Offset): void;
    static endModuleBundleEntry(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): ModuleBundleEntryT;
    unpackTo(_o: ModuleBundleEntryT): void;
}
export declare class ModuleBundleEntryT implements flatbuffers.IGeneratedObject {
    entryId: string | Uint8Array | null;
    role: ModuleBundleEntryRole;
    sectionName: string | Uint8Array | null;
    typeRef: FlatBufferTypeRefT | null;
    payloadEncoding: ModulePayloadEncoding;
    mediaType: string | Uint8Array | null;
    flags: number;
    sha256: (number)[];
    payload: (number)[];
    description: string | Uint8Array | null;
    constructor(entryId?: string | Uint8Array | null, role?: ModuleBundleEntryRole, sectionName?: string | Uint8Array | null, typeRef?: FlatBufferTypeRefT | null, payloadEncoding?: ModulePayloadEncoding, mediaType?: string | Uint8Array | null, flags?: number, sha256?: (number)[], payload?: (number)[], description?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
