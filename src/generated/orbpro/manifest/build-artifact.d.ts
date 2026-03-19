import * as flatbuffers from "flatbuffers";
/**
 * Build artifact emitted by the plugin toolchain.
 */
export declare class BuildArtifact implements flatbuffers.IUnpackableObject<BuildArtifactT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): BuildArtifact;
    static getRootAsBuildArtifact(bb: flatbuffers.ByteBuffer, obj?: BuildArtifact): BuildArtifact;
    static getSizePrefixedRootAsBuildArtifact(bb: flatbuffers.ByteBuffer, obj?: BuildArtifact): BuildArtifact;
    artifactId(): string | null;
    artifactId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    kind(): string | null;
    kind(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    path(): string | null;
    path(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    target(): string | null;
    target(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    entrySymbol(): string | null;
    entrySymbol(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startBuildArtifact(builder: flatbuffers.Builder): void;
    static addArtifactId(builder: flatbuffers.Builder, artifactIdOffset: flatbuffers.Offset): void;
    static addKind(builder: flatbuffers.Builder, kindOffset: flatbuffers.Offset): void;
    static addPath(builder: flatbuffers.Builder, pathOffset: flatbuffers.Offset): void;
    static addTarget(builder: flatbuffers.Builder, targetOffset: flatbuffers.Offset): void;
    static addEntrySymbol(builder: flatbuffers.Builder, entrySymbolOffset: flatbuffers.Offset): void;
    static endBuildArtifact(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createBuildArtifact(builder: flatbuffers.Builder, artifactIdOffset: flatbuffers.Offset, kindOffset: flatbuffers.Offset, pathOffset: flatbuffers.Offset, targetOffset: flatbuffers.Offset, entrySymbolOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): BuildArtifactT;
    unpackTo(_o: BuildArtifactT): void;
}
export declare class BuildArtifactT implements flatbuffers.IGeneratedObject {
    artifactId: string | Uint8Array | null;
    kind: string | Uint8Array | null;
    path: string | Uint8Array | null;
    target: string | Uint8Array | null;
    entrySymbol: string | Uint8Array | null;
    constructor(artifactId?: string | Uint8Array | null, kind?: string | Uint8Array | null, path?: string | Uint8Array | null, target?: string | Uint8Array | null, entrySymbol?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=build-artifact.d.ts.map