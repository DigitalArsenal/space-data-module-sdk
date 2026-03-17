import * as flatbuffers from 'flatbuffers';
import { CanonicalizationRule, CanonicalizationRuleT } from '../../orbpro/module/canonicalization-rule.js';
import { ModuleBundleEntry, ModuleBundleEntryT } from '../../orbpro/module/module-bundle-entry.js';
/**
 * Metadata stored in the required `sds.bundle` custom section.
 */
export declare class ModuleBundle implements flatbuffers.IUnpackableObject<ModuleBundleT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ModuleBundle;
    static getRootAsModuleBundle(bb: flatbuffers.ByteBuffer, obj?: ModuleBundle): ModuleBundle;
    static getSizePrefixedRootAsModuleBundle(bb: flatbuffers.ByteBuffer, obj?: ModuleBundle): ModuleBundle;
    static bufferHasIdentifier(bb: flatbuffers.ByteBuffer): boolean;
    /**
     * Bundle schema version.
     */
    bundleVersion(): number;
    /**
     * Human-readable package format label.
     */
    moduleFormat(): string | null;
    moduleFormat(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * Canonicalization rule used to compute module hashes.
     */
    canonicalization(obj?: CanonicalizationRule): CanonicalizationRule | null;
    /**
     * SHA-256 of the wasm module after stripping `sds.*` custom sections.
     */
    canonicalModuleHash(index: number): number | null;
    canonicalModuleHashLength(): number;
    canonicalModuleHashArray(): Uint8Array | null;
    /**
     * SHA-256 of the canonical plugin manifest bytes.
     */
    manifestHash(index: number): number | null;
    manifestHashLength(): number;
    manifestHashArray(): Uint8Array | null;
    /**
     * Legacy ABI export retained for backward compatibility.
     */
    manifestExportSymbol(): string | null;
    manifestExportSymbol(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * Legacy ABI export retained for backward compatibility.
     */
    manifestSizeSymbol(): string | null;
    manifestSizeSymbol(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    /**
     * Payloads embedded in the bundle.
     */
    entries(index: number, obj?: ModuleBundleEntry): ModuleBundleEntry | null;
    entriesLength(): number;
    static startModuleBundle(builder: flatbuffers.Builder): void;
    static addBundleVersion(builder: flatbuffers.Builder, bundleVersion: number): void;
    static addModuleFormat(builder: flatbuffers.Builder, moduleFormatOffset: flatbuffers.Offset): void;
    static addCanonicalization(builder: flatbuffers.Builder, canonicalizationOffset: flatbuffers.Offset): void;
    static addCanonicalModuleHash(builder: flatbuffers.Builder, canonicalModuleHashOffset: flatbuffers.Offset): void;
    static createCanonicalModuleHashVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startCanonicalModuleHashVector(builder: flatbuffers.Builder, numElems: number): void;
    static addManifestHash(builder: flatbuffers.Builder, manifestHashOffset: flatbuffers.Offset): void;
    static createManifestHashVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startManifestHashVector(builder: flatbuffers.Builder, numElems: number): void;
    static addManifestExportSymbol(builder: flatbuffers.Builder, manifestExportSymbolOffset: flatbuffers.Offset): void;
    static addManifestSizeSymbol(builder: flatbuffers.Builder, manifestSizeSymbolOffset: flatbuffers.Offset): void;
    static addEntries(builder: flatbuffers.Builder, entriesOffset: flatbuffers.Offset): void;
    static createEntriesVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startEntriesVector(builder: flatbuffers.Builder, numElems: number): void;
    static endModuleBundle(builder: flatbuffers.Builder): flatbuffers.Offset;
    static finishModuleBundleBuffer(builder: flatbuffers.Builder, offset: flatbuffers.Offset): void;
    static finishSizePrefixedModuleBundleBuffer(builder: flatbuffers.Builder, offset: flatbuffers.Offset): void;
    unpack(): ModuleBundleT;
    unpackTo(_o: ModuleBundleT): void;
}
export declare class ModuleBundleT implements flatbuffers.IGeneratedObject {
    bundleVersion: number;
    moduleFormat: string | Uint8Array | null;
    canonicalization: CanonicalizationRuleT | null;
    canonicalModuleHash: (number)[];
    manifestHash: (number)[];
    manifestExportSymbol: string | Uint8Array | null;
    manifestSizeSymbol: string | Uint8Array | null;
    entries: (ModuleBundleEntryT)[];
    constructor(bundleVersion?: number, moduleFormat?: string | Uint8Array | null, canonicalization?: CanonicalizationRuleT | null, canonicalModuleHash?: (number)[], manifestHash?: (number)[], manifestExportSymbol?: string | Uint8Array | null, manifestSizeSymbol?: string | Uint8Array | null, entries?: (ModuleBundleEntryT)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
