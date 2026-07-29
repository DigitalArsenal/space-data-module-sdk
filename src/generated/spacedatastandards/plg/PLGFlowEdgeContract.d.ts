import * as flatbuffers from 'flatbuffers';
import { FlatBufferTypeRef, FlatBufferTypeRefT } from './FlatBufferTypeRef.js';
import { flowEdgeRoutePolicy } from './flowEdgeRoutePolicy.js';
/**
 * Exact validated SDS and representation contract bound into a signed flow
 * edge. CANONICAL_TYPE and ALIGNED_TYPE describe the same logical schema;
 * ALIGNED_TYPE carries its fixed layout in TAB.FlatBufferTypeRef.
 */
export declare class PLGFlowEdgeContract implements flatbuffers.IUnpackableObject<PLGFlowEdgeContractT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): PLGFlowEdgeContract;
    static getRootAsPLGFlowEdgeContract(bb: flatbuffers.ByteBuffer, obj?: PLGFlowEdgeContract): PLGFlowEdgeContract;
    static getSizePrefixedRootAsPLGFlowEdgeContract(bb: flatbuffers.ByteBuffer, obj?: PLGFlowEdgeContract): PLGFlowEdgeContract;
    CANONICAL_TYPE(obj?: FlatBufferTypeRef): FlatBufferTypeRef | null;
    ALIGNED_TYPE(obj?: FlatBufferTypeRef): FlatBufferTypeRef | null;
    CANONICAL_FALLBACK_AVAILABLE(): boolean;
    ALIGNED_ELIGIBLE(): boolean;
    ROUTE_POLICY(): flowEdgeRoutePolicy;
    static startPLGFlowEdgeContract(builder: flatbuffers.Builder): void;
    static addCanonicalType(builder: flatbuffers.Builder, CANONICAL_TYPEOffset: flatbuffers.Offset): void;
    static addAlignedType(builder: flatbuffers.Builder, ALIGNED_TYPEOffset: flatbuffers.Offset): void;
    static addCanonicalFallbackAvailable(builder: flatbuffers.Builder, CANONICAL_FALLBACK_AVAILABLE: boolean): void;
    static addAlignedEligible(builder: flatbuffers.Builder, ALIGNED_ELIGIBLE: boolean): void;
    static addRoutePolicy(builder: flatbuffers.Builder, ROUTE_POLICY: flowEdgeRoutePolicy): void;
    static endPLGFlowEdgeContract(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): PLGFlowEdgeContractT;
    unpackTo(_o: PLGFlowEdgeContractT): void;
}
export declare class PLGFlowEdgeContractT implements flatbuffers.IGeneratedObject {
    CANONICAL_TYPE: FlatBufferTypeRefT | null;
    ALIGNED_TYPE: FlatBufferTypeRefT | null;
    CANONICAL_FALLBACK_AVAILABLE: boolean;
    ALIGNED_ELIGIBLE: boolean;
    ROUTE_POLICY: flowEdgeRoutePolicy;
    constructor(CANONICAL_TYPE?: FlatBufferTypeRefT | null, ALIGNED_TYPE?: FlatBufferTypeRefT | null, CANONICAL_FALLBACK_AVAILABLE?: boolean, ALIGNED_ELIGIBLE?: boolean, ROUTE_POLICY?: flowEdgeRoutePolicy);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=PLGFlowEdgeContract.d.ts.map