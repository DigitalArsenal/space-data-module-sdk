import * as flatbuffers from 'flatbuffers';
/**
 * Canonicalization rule applied before hashing or signature verification.
 */
export declare class CanonicalizationRule implements flatbuffers.IUnpackableObject<CanonicalizationRuleT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): CanonicalizationRule;
    static getRootAsCanonicalizationRule(bb: flatbuffers.ByteBuffer, obj?: CanonicalizationRule): CanonicalizationRule;
    static getSizePrefixedRootAsCanonicalizationRule(bb: flatbuffers.ByteBuffer, obj?: CanonicalizationRule): CanonicalizationRule;
    /**
     * Schema version for the canonicalization contract.
     */
    version(): number;
    /**
     * Strip any custom section whose name starts with this prefix before
     * hashing the module for signature verification.
     */
    strippedCustomSectionPrefix(): string | null;
    strippedCustomSectionPrefix(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * Name of the required root custom section carrying this bundle.
     */
    bundleSectionName(): string | null;
    bundleSectionName(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * Hash function identifier, for example `sha256`.
     */
    hashAlgorithm(): string | null;
    hashAlgorithm(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startCanonicalizationRule(builder: flatbuffers.Builder): void;
    static addVersion(builder: flatbuffers.Builder, version: number): void;
    static addStrippedCustomSectionPrefix(builder: flatbuffers.Builder, strippedCustomSectionPrefixOffset: flatbuffers.Offset): void;
    static addBundleSectionName(builder: flatbuffers.Builder, bundleSectionNameOffset: flatbuffers.Offset): void;
    static addHashAlgorithm(builder: flatbuffers.Builder, hashAlgorithmOffset: flatbuffers.Offset): void;
    static endCanonicalizationRule(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createCanonicalizationRule(builder: flatbuffers.Builder, version: number, strippedCustomSectionPrefixOffset: flatbuffers.Offset, bundleSectionNameOffset: flatbuffers.Offset, hashAlgorithmOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): CanonicalizationRuleT;
    unpackTo(_o: CanonicalizationRuleT): void;
}
export declare class CanonicalizationRuleT implements flatbuffers.IGeneratedObject {
    version: number;
    strippedCustomSectionPrefix: string | Uint8Array | null;
    bundleSectionName: string | Uint8Array | null;
    hashAlgorithm: string | Uint8Array | null;
    constructor(version?: number, strippedCustomSectionPrefix?: string | Uint8Array | null, bundleSectionName?: string | Uint8Array | null, hashAlgorithm?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
